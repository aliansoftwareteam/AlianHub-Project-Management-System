// The agent action registry — the safety boundary.
//
// Everything an agent (in-product or CLI over MCP) may do is listed here, and
// nothing else exists for it. project.delete, task.delete, billing.*,
// deploy.production, git.merge, member.remove, permissions.edit and
// status.set("Done") are ABSENT — not disabled, absent — so a compromised token
// has nothing to switch on. The guard, the MCP server and the proposal approver
// all resolve actions through this one file.
//
// One exception is deliberate and off by default: with MCP_TOOLS_MANAGE on, a
// person may create a token whose agent closes tasks for them (task.status.change).
// Nothing else reaches it, and the close is recorded as theirs, made through the
// agent, and unchecked.

const performanceFlag = require('./performanceFlag');
const dataFlag = require('../Mcp/dataFlag');
const manageFlag = require('../Mcp/manageFlag');
const connectorsFlag = require('./connectors/flag');
const workFlag = require('../Mcp/workFlag');

// `permission` names the Security & Permissions catalogue entry
// (Config/permissionGuard) that governs the same operation for a person.
// perform() evaluates it for the person behind the agent, so a token never
// exceeds its holder's role. An action without one cannot be registered.
const RISK = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });
const PERMISSION_KEY = /^[a-z_]+\.[a-z_]+$/;
const DONE_STATUS_TYPE = 'close';
const DONE_STATUS_TYPES = Object.freeze(['close', 'done', 'default_close']);

// Status types an agent may move a task into. 'close' is deliberately missing.
const AGENT_STATUS_TYPES = Object.freeze(['default_active', 'active']);
const AGENT_STATUS_NAMES = Object.freeze(['in progress', 'in review']);
const AGENT_STATUS_NAME_PATTERN = /progress|review|doing|testing|qa/;

const CREATE_PERMISSIONS = Object.freeze({
    rawDescription: 'task.task_description', AssigneeUserId: 'task.task_assignee', Task_Priority: 'task.task_priority', DueDate: 'task.task_due_date',
    startDate: ['task.task_due_date', 'task.task_start_date'], status: 'task.task_status', TaskType: 'task.task_type',
    totalEstimatedTime: 'task.task_estimated_hours', links: 'task.task_attachments',
});
const CREATE_FIELDS = Object.freeze(Object.keys(CREATE_PERMISSIONS));

const ACTIONS = Object.freeze([
    { key: 'tasks.next', label: 'Next assigned task', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'tasks.search', label: 'Search own tasks', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'task.get', label: 'Read a task brief', risk: RISK.LOW, undoable: false, write: false, cost: 'read+summary', permission: 'task.task_list' },
    { key: 'task.comment', label: 'Comment on a task', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_comment' },
    { key: 'task.status.set', label: 'Set status (In progress / In review only)', risk: RISK.LOW, undoable: true, write: true, cost: 'write',
      constraint: 'statusType must not be "close"; status name must be In progress or In review', permission: 'task.task_status' },
    { key: 'task.link', label: 'Attach a PR, branch or doc', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_attachments' },
    { key: 'task.assign', label: 'Assign a task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_assignee' },
    { key: 'task.update', label: 'Update task fields', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      fields: ['TaskName', 'description', 'rawDescription', 'Task_Priority', 'DueDate', 'startDate', 'tagsArray', 'checklistArray', 'points', 'totalEstimatedTime'],
      permission: { byField: {
          TaskName: 'task.task_name_edit', description: 'task.task_description', rawDescription: 'task.task_description',
          Task_Priority: 'task.task_priority', DueDate: 'task.task_due_date', startDate: 'task.task_start_date',
          tagsArray: 'task.task_tag', checklistArray: 'task.task_checklist', points: 'task.task_estimated_hours', totalEstimatedTime: 'task.task_estimated_hours',
      } } },
    { key: 'aifield.fill', label: 'Fill an AI field on a task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_custom_field' },
    { key: 'task.sprint.move', label: 'Move a task between sprints', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_move' },
    { key: 'subtask.create', label: 'Create a subtask', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.sub_task_create' },
    { key: 'task.create', label: 'File a task (opening status, unassigned)', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'always the project\'s opening status; never assigned; only in a project the token can see', permission: 'task.task_create' },
    { key: 'timelog.start', label: 'Start a timer', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'sheet_settings.user_timesheet' },
    { key: 'timelog.stop', label: 'Stop a timer', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'sheet_settings.user_timesheet' },
    { key: 'docs.read', label: 'Read a linked doc', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' },
    { key: 'page.draft', label: 'Draft a page (stays a draft until approved)', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'project.project_details' },
    { key: 'chat.post', label: 'Post in a channel', risk: RISK.LOW, undoable: false, write: true, cost: 'write', permission: 'task.task_comment' },
    { key: 'reminder.create', label: 'Create a reminder', risk: RISK.LOW, undoable: false, write: true, cost: 'write', permission: { key: 'task.task_list', write: false } },
    { key: 'deploy.staging', label: 'Propose a staging deploy', risk: RISK.HIGH, undoable: false, write: true, cost: 'write',
      gate: 'owner_admin', proposeOnly: true, permission: 'settings.settings_edit_company' },
]);

// Registered only while their flag is on. ACTIONS stays the unflagged list, so
// everything that reads it directly is unchanged whatever the flags say.
const FLAGGED = Object.freeze([
    {
        enabled: performanceFlag.enabled,
        action: Object.freeze({ key: performanceFlag.ACTION, label: 'Read project performance numbers', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' }),
    },
    ...[
        { key: 'projects.list', label: 'List projects', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
        { key: 'project.get', label: 'Read a project', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' },
        { key: 'sprints.list', label: 'List a project\'s sprints', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
        { key: 'statuses.list', label: 'List a project\'s statuses', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'comments.list', label: 'Read a task\'s comments', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'pages.search', label: 'Search pages', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' },
        { key: 'page.get', label: 'Read a page', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' },
        { key: 'timesheet.read', label: 'Read time entries', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: { key: 'sheet_settings.user_timesheet', write: false } },
        { key: 'comment.create', label: 'Comment on a task', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_comment' },
        { key: 'timelog.create', label: 'Log time on a task (own time)', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'sheet_settings.user_timesheet' },
    ].map((action) => ({ enabled: dataFlag.enabled, action: Object.freeze(action) })),
    // These write through the task routes' own preparation and handlers (Agents/taskRequests.js).
    ...[
        { key: 'fields.list', label: 'List a project\'s custom fields', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'subtasks.list', label: 'List a task\'s subtasks', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'members.list', label: 'List active members', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'task.edit', label: 'Edit a task\'s title, description, priority, dates or estimate', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
          fields: ['TaskName', 'rawDescription', 'Task_Priority', 'DueDate', 'startDate', 'totalEstimatedTime'],
          permission: { byField: {
              TaskName: 'task.task_name_edit', rawDescription: 'task.task_description', Task_Priority: 'task.task_priority', DueDate: 'task.task_due_date',
              startDate: ['task.task_due_date', 'task.task_start_date'], totalEstimatedTime: 'task.task_estimated_hours',
          } } },
        { key: 'task.assignees.set', label: 'Set, add or remove a task\'s assignees', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_assignee' },
        { key: 'task.field.set', label: 'Set a custom field on a task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_custom_field' },
        { key: 'task.move', label: 'Move a task with its subtasks to another list or project', risk: RISK.HIGH, undoable: false, write: true, cost: 'write',
          constraint: 'only a top-level task; the destination must be one the person behind the agent can move tasks into', permission: 'task.task_move' },
        { key: 'task.archive', label: 'Archive a task with its subtasks', risk: RISK.HIGH, undoable: true, write: true, cost: 'write', permission: 'task.task_archive' },
        { key: 'task.restore', label: 'Restore an archived task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: { key: 'task.task_list', write: false } },
        { key: 'task.history', label: 'Read a task\'s activity log', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: { key: 'task.task_activity_log', write: true } },
        { key: 'task.links.list', label: 'List a task\'s links', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'task.status.change', label: 'Set any status of the task\'s project, Done included', risk: RISK.HIGH, undoable: true, write: true, cost: 'write',
          constraint: 'only for a token its person created to manage tasks; the close is recorded as that person\'s, made through the agent, and unchecked', permission: 'task.task_status' },
        { key: 'task.add', label: 'Create a task with its details', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', fields: CREATE_FIELDS,
          permission: { key: 'task.task_create', byField: CREATE_PERMISSIONS } },
        { key: 'subtask.add', label: 'Create a subtask with its details', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', fields: CREATE_FIELDS,
          permission: { key: 'task.sub_task_create', byField: CREATE_PERMISSIONS } },
        { key: 'comment.update', label: 'Edit a comment the agent wrote', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_comment' },
        { key: 'tasks.batch', label: 'Record a batch of task changes as one group', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
          constraint: 'changes nothing itself: each change in the batch is its own action, checked and audited on its own', permission: { key: 'task.task_list', write: false } },
        { key: 'page.create', label: 'Create a doc (a draft until a person approves it)', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
        { key: 'page.update', label: 'Change a doc\'s title or body', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
    ].map((action) => ({ enabled: manageFlag.enabled, action: Object.freeze(action) })),
    {
        enabled: connectorsFlag.slackOn,
        action: Object.freeze({ key: 'slack.message.post', label: 'Propose a Slack message', risk: RISK.HIGH, undoable: false, write: true, cost: 'write',
            gate: 'owner_admin', proposeOnly: true, constraint: 'only to a channel on the workspace\'s Slack allow-list; plain text, no files; never sent without a person\'s approval',
            permission: 'settings.settings_edit_company' }),
    },
    {
        enabled: connectorsFlag.slackOn,
        action: Object.freeze({ key: 'slack.channel.read', label: 'Read recent messages of a Slack channel', risk: RISK.LOW, undoable: false, write: false, cost: 'read',
            constraint: 'only a public channel on the workspace\'s Slack allow-list for reading; text only, capped per read and per run; the run is marked and makes no web fetch after it',
            permission: { key: 'project.project_details', write: false } }),
    },
    // These run the web app's own tag, relation, list and doc comment handlers (Agents/workRequests.js).
    ...[
        { key: 'tags.list', label: 'List a project\'s tags', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'task.tags.add', label: 'Add a tag to a task', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_tag' },
        { key: 'task.tags.remove', label: 'Remove a tag from a task', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_tag' },
        { key: 'task.relations.list', label: 'List the tasks a task is linked to', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
        { key: 'task.relation.add', label: 'Link two tasks', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
          constraint: 'both tasks must be ones the person behind the agent can open', permission: { key: 'task.task_list', write: false } },
        { key: 'task.relation.remove', label: 'Remove the link between two tasks', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
          constraint: 'both tasks must be ones the person behind the agent can open', permission: { key: 'task.task_list', write: false } },
        { key: 'lists.list', label: 'List a project\'s lists and folders', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
        { key: 'list.create', label: 'Create a list in a project or folder', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'project.project_sprint_create' },
        { key: 'list.rename', label: 'Rename a list', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'project.project_sprint_name_edit' },
        { key: 'list.move', label: 'Move a list into or out of a folder', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
          permission: { anyOf: ['project.project_sprint_name_edit', 'project.sprint_type_change', 'project.project_sprint_create'] } },
        { key: 'page.comments.list', label: 'Read a doc\'s comments', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' },
        { key: 'page.comment.create', label: 'Comment on a doc', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
        { key: 'page.comment.reply', label: 'Reply to a comment on a doc', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
        { key: 'page.comment.assign', label: 'Assign a doc comment thread', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
    ].map((action) => ({ enabled: workFlag.enabled, action: Object.freeze(action) })),
]);

/* A string maps the whole action at its own level (write for writes, read for
 * reads); { key, write } pins the level; { byField } holds each edited field
 * to the entry, or entries, a person editing that field is held to, beside
 * the action's own { key } when it has one; { anyOf } is met by any one of its
 * entries, as a route that takes several keys for one control is. */
const permissionsFor = (key, params = {}) => {
    const action = get(key);
    if (!action) return [];
    const p = action.permission;
    if (typeof p === 'string') return [{ key: p, write: Boolean(action.write) }];
    if (p && p.byField) {
        const fields = Object.keys(params.fields || {});
        // With a key of its own the action needs that key and one per field named; without, naming no field asks for every one.
        const named = p.key || fields.length ? fields : action.fields || [];
        const keys = [...new Set([...(p.key ? [p.key] : []), ...named.flatMap((f) => p.byField[f] || [])])];
        return keys.map((k) => ({ key: k, write: true }));
    }
    if (p && p.key) return [{ key: p.key, write: typeof p.write === 'boolean' ? p.write : Boolean(action.write) }];
    if (p && Array.isArray(p.anyOf)) return [{ key: p.anyOf[0], anyOf: [...p.anyOf], write: Boolean(action.write) }];
    return [];
};

const validate = (entries) => {
    const bad = (a, why) => new Error(`agent registry: ${a.key || '(no key)'} ${why}`);
    entries.forEach((a) => {
        const p = a.permission;
        if (typeof p === 'string') {
            if (!PERMISSION_KEY.test(p)) throw bad(a, `has an invalid permission mapping "${p}"`);
            return;
        }
        if (p && p.byField && typeof p.byField === 'object') {
            const unmapped = (a.fields || []).filter((f) => { const keys = [].concat(p.byField[f] || []); return !keys.length || keys.some((k) => !PERMISSION_KEY.test(String(k))); });
            if (!a.fields || !a.fields.length || unmapped.length) throw bad(a, `leaves fields without a permission mapping: ${unmapped.join(', ') || '(no fields)'}`);
            if (p.key !== undefined && !PERMISSION_KEY.test(String(p.key))) throw bad(a, `has an invalid permission mapping "${p.key}"`);
            return;
        }
        if (p && typeof p.key === 'string' && PERMISSION_KEY.test(p.key)) return;
        if (p && Array.isArray(p.anyOf) && p.anyOf.length && p.anyOf.every((k) => PERMISSION_KEY.test(String(k)))) return;
        throw bad(a, 'has no permission mapping; every action must name the catalogue entry that governs it for a person');
    });
    return entries;
};


// Named so a reviewer can confirm they are not reachable. A trailing `.*` covers
// every key under that prefix.
const NEVER = Object.freeze([
    'project.delete', 'task.delete', 'billing.*', 'deploy.production', 'git.merge',
    'member.remove', 'permissions.edit', 'status.set("Done")',
]);

const isNever = (key) => {
    const k = String(key || '');
    return NEVER.some((n) => n === k || (n.endsWith('.*') && k.startsWith(n.slice(0, -1))));
};

const indexActions = (actions) => {
    const overlap = actions.map((a) => a.key).filter(isNever);
    if (overlap.length) throw new Error(`never-listed action(s) cannot be registered: ${overlap.join(', ')}`);
    return new Map(actions.map((a) => [a.key, a]));
};

const BY_KEY = indexActions(validate(ACTIONS));
indexActions(validate(FLAGGED.map((f) => f.action)));
const FLAGGED_BY_KEY = new Map(FLAGGED.map((f) => [f.action.key, f]));

const active = () => [...ACTIONS, ...FLAGGED.filter((f) => f.enabled()).map((f) => f.action)];

const get = (key) => {
    const k = String(key || '');
    if (BY_KEY.has(k)) return BY_KEY.get(k);
    const flagged = FLAGGED_BY_KEY.get(k);
    return flagged && flagged.enabled() ? flagged.action : null;
};
const has = (key) => Boolean(get(key));
const keys = () => active().map((a) => a.key);
const knows = (key) => BY_KEY.has(String(key || '')) || FLAGGED_BY_KEY.has(String(key || ''));

/* An agent's allowed list narrows it and an empty list allows everything, so a save
 * keeps every name the registry knows whether or not its flag is on (evaluate ignores
 * the ones that are off), and a list that names only unknown actions is refused
 * rather than stored empty. */
const allowedActionsToStore = (list) => {
    const given = (Array.isArray(list) ? list : []).map(String);
    const kept = given.filter(knows);
    if (given.length && !kept.length) {
        throw Object.assign(new Error('allowedActions names no action an agent can be given, and an empty list would allow every action.'), { status: 400 });
    }
    return kept;
};

const normalizeName = (v) => String(v || '').trim().toLowerCase();

/* Would setting this status be allowed for an agent? Type wins over name so a
 * renamed "Complete" still counts as Done. */
const isAgentSettableStatus = ({ statusType, name } = {}) => {
    const type = normalizeName(statusType);
    const n = normalizeName(name).replace(/[-_]/g, ' ');
    if (DONE_STATUS_TYPES.includes(type)) return false;
    if (/done|complete|closed/.test(n) && !type) return false;
    if (type && !AGENT_STATUS_TYPES.includes(type)) return false;
    if (!type && !n) return false;
    if (n && !AGENT_STATUS_NAME_PATTERN.test(n)) return false;
    return true;
};

/* The one decision every agent call goes through. Returns { allowed, reason, action }. */
const evaluate = (key, params = {}, { allowedActions } = {}) => {
    if (isNever(key)) return { allowed: false, code: 'never_listed', reason: `Agents cannot perform ${key} (never_listed)`, action: null };
    const action = get(key);
    if (!action) return { allowed: false, reason: `Agents cannot perform ${key || '(unknown action)'}`, action: null };
    if (Array.isArray(allowedActions) && allowedActions.length && !allowedActions.includes(action.key)) {
        return { allowed: false, reason: `Agents cannot perform ${action.key} (not in this agent's skills)`, action };
    }
    if (action.key === 'task.status.set') {
        const target = params.status || {};
        if (!isAgentSettableStatus({ statusType: target.statusType || target.type, name: target.name || target.text })) {
            const label = DONE_STATUS_TYPES.includes(normalizeName(target.statusType || target.type)) ? 'Done' : (target.name || target.text || target.statusType || '?');
            return { allowed: false, reason: `Agents cannot perform task.status.set("${label}")`, action };
        }
    }
    if (Array.isArray(action.fields)) {
        const fields = Object.keys(params.fields || {});
        const bad = fields.filter((f) => !action.fields.includes(f));
        if (bad.length) return { allowed: false, reason: `Agents cannot perform ${action.key} on ${bad.join(', ')}`, action };
    }
    if (action.proposeOnly && !params.__proposal) {
        return { allowed: false, reason: `Agents cannot perform ${action.key} directly — it must be proposed`, action };
    }
    return { allowed: true, reason: '', action };
};

/* Autonomy levels (9c). Anything at or under the level runs; the rest is proposed. */
/* Matches the ladder the product shows (L0 Assist · L1 Suggest · L2 Act in bounds ·
 * L3 Scheduled). L1 used to act on low-risk actions, so an agent labelled
 * "Suggest" filed subtasks on the board without anyone approving them. */
const AUTONOMY = Object.freeze({
    0: { label: 'Assist — answers only, proposes nothing on its own', actsOn: [] },
    1: { label: 'Suggest — proposes everything, a person approves', actsOn: [] },
    2: { label: 'Act in bounds — low and medium risk directly, proposes the rest', actsOn: [RISK.LOW, RISK.MEDIUM] },
    3: { label: 'Scheduled — as L2, and may run unattended', actsOn: [RISK.LOW, RISK.MEDIUM] },
});

const mayActDirectly = (autonomy, key) => {
    const action = get(key);
    if (!action) return false;
    if (action.proposeOnly || action.gate) return false;
    const level = AUTONOMY[Number(autonomy)] || AUTONOMY[0];
    return level.actsOn.includes(action.risk);
};

const manifest = () => ({
    actions: active().map((a) => ({ ...a })),
    never: [...NEVER],
    agentStatusNames: [...AGENT_STATUS_NAMES],
    autonomy: Object.entries(AUTONOMY).map(([level, v]) => ({ level: Number(level), ...v })),
});

module.exports = {
    ACTIONS, NEVER, RISK, AUTONOMY, DONE_STATUS_TYPE, DONE_STATUS_TYPES, AGENT_STATUS_NAMES,
    CREATE_FIELDS, get, has, keys, knows, allowedActionsToStore, isNever, indexActions, evaluate, isAgentSettableStatus, mayActDirectly, manifest, permissionsFor, validate,
};
