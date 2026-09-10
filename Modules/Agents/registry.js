// The agent action registry — the safety boundary.
//
// Everything an agent (in-product or CLI over MCP) may do is listed here, and
// nothing else exists for it. project.delete, task.delete, billing.*,
// deploy.production, git.merge, member.remove, permissions.edit and
// status.set("Done") are ABSENT — not disabled, absent — so a compromised token
// has nothing to switch on. The guard, the MCP server and the proposal approver
// all resolve actions through this one file.

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

/* A string maps the whole action at its own level (write for writes, read for
 * reads); { key, write } pins the level; { byField } holds each task.update
 * field to the entry a person editing that field is held to. */
const permissionsFor = (key, params = {}) => {
    const action = BY_KEY.get(String(key || ''));
    if (!action) return [];
    const p = action.permission;
    if (typeof p === 'string') return [{ key: p, write: Boolean(action.write) }];
    if (p && p.byField) {
        const fields = Object.keys(params.fields || {});
        const keys = [...new Set((fields.length ? fields : action.fields || []).map((f) => p.byField[f]).filter(Boolean))];
        return keys.map((k) => ({ key: k, write: true }));
    }
    if (p && p.key) return [{ key: p.key, write: typeof p.write === 'boolean' ? p.write : Boolean(action.write) }];
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
            const unmapped = (a.fields || []).filter((f) => !PERMISSION_KEY.test(String(p.byField[f] || '')));
            if (!a.fields || !a.fields.length || unmapped.length) throw bad(a, `leaves fields without a permission mapping: ${unmapped.join(', ') || '(no fields)'}`);
            return;
        }
        if (p && typeof p.key === 'string' && PERMISSION_KEY.test(p.key)) return;
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

const get = (key) => BY_KEY.get(String(key || '')) || null;
const has = (key) => BY_KEY.has(String(key || ''));
const keys = () => ACTIONS.map((a) => a.key);

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
    if (action.key === 'task.update') {
        const fields = Object.keys(params.fields || {});
        const bad = fields.filter((f) => !action.fields.includes(f));
        if (bad.length) return { allowed: false, reason: `Agents cannot perform task.update on ${bad.join(', ')}`, action };
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
    actions: ACTIONS.map((a) => ({ ...a })),
    never: [...NEVER],
    agentStatusNames: [...AGENT_STATUS_NAMES],
    autonomy: Object.entries(AUTONOMY).map(([level, v]) => ({ level: Number(level), ...v })),
});

module.exports = {
    ACTIONS, NEVER, RISK, AUTONOMY, DONE_STATUS_TYPE, DONE_STATUS_TYPES, AGENT_STATUS_NAMES,
    get, has, keys, isNever, indexActions, evaluate, isAgentSettableStatus, mayActDirectly, manifest, permissionsFor, validate,
};
