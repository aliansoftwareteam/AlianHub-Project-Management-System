// The agent action registry — the safety boundary.
//
// Everything an agent (in-product or CLI over MCP) may do is listed here, and
// nothing else exists for it. project.delete, task.delete, billing.*,
// deploy.production, git.merge, member.remove, permissions.edit and
// status.set("Done") are ABSENT — not disabled, absent — so a compromised token
// has nothing to switch on. The guard, the MCP server and the proposal approver
// all resolve actions through this one file.

const RISK = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });
const DONE_STATUS_TYPE = 'close';
const DONE_STATUS_TYPES = Object.freeze(['close', 'done', 'default_close']);

// Status types an agent may move a task into. 'close' is deliberately missing.
const AGENT_STATUS_TYPES = Object.freeze(['default_active', 'active']);
const AGENT_STATUS_NAMES = Object.freeze(['in progress', 'in review']);
const AGENT_STATUS_NAME_PATTERN = /progress|review|doing|testing|qa/;

const ACTIONS = Object.freeze([
    { key: 'tasks.next', label: 'Next assigned task', risk: RISK.LOW, undoable: false, write: false, cost: 'read' },
    { key: 'tasks.search', label: 'Search own tasks', risk: RISK.LOW, undoable: false, write: false, cost: 'read' },
    { key: 'task.get', label: 'Read a task brief', risk: RISK.LOW, undoable: false, write: false, cost: 'read+summary' },
    { key: 'task.comment', label: 'Comment on a task', risk: RISK.LOW, undoable: true, write: true, cost: 'write' },
    { key: 'task.status.set', label: 'Set status (In progress / In review only)', risk: RISK.LOW, undoable: true, write: true, cost: 'write',
      constraint: 'statusType must not be "close"; status name must be In progress or In review' },
    { key: 'task.link', label: 'Attach a PR, branch or doc', risk: RISK.LOW, undoable: true, write: true, cost: 'write' },
    { key: 'task.assign', label: 'Assign a task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write' },
    { key: 'task.update', label: 'Update task fields', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      fields: ['TaskName', 'description', 'rawDescription', 'Task_Priority', 'DueDate', 'startDate', 'tagsArray', 'checklistArray', 'points', 'totalEstimatedTime'] },
    { key: 'task.sprint.move', label: 'Move a task between sprints', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write' },
    { key: 'subtask.create', label: 'Create a subtask', risk: RISK.LOW, undoable: true, write: true, cost: 'write' },
    { key: 'task.create', label: 'File a task (opening status, unassigned)', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'always the project\'s opening status; never assigned; only in a project the token can see' },
    { key: 'timelog.start', label: 'Start a timer', risk: RISK.LOW, undoable: true, write: true, cost: 'write' },
    { key: 'timelog.stop', label: 'Stop a timer', risk: RISK.LOW, undoable: true, write: true, cost: 'write' },
    { key: 'docs.read', label: 'Read a linked doc', risk: RISK.LOW, undoable: false, write: false, cost: 'read' },
    { key: 'page.draft', label: 'Draft a page (stays a draft until approved)', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write' },
    { key: 'chat.post', label: 'Post in a channel', risk: RISK.LOW, undoable: false, write: true, cost: 'write' },
    { key: 'reminder.create', label: 'Create a reminder', risk: RISK.LOW, undoable: false, write: true, cost: 'write' },
    { key: 'deploy.staging', label: 'Propose a staging deploy', risk: RISK.HIGH, undoable: false, write: true, cost: 'write',
      gate: 'owner_admin', proposeOnly: true },
]);

const BY_KEY = new Map(ACTIONS.map((a) => [a.key, a]));

// Named so a reviewer can confirm they are not reachable. Never added to ACTIONS.
const NEVER = Object.freeze([
    'project.delete', 'task.delete', 'billing.*', 'deploy.production', 'git.merge',
    'member.remove', 'permissions.edit', 'status.set("Done")',
]);

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
const AUTONOMY = Object.freeze({
    0: { label: 'Suggest everything', actsOn: [] },
    1: { label: 'Act on low-risk, propose the rest', actsOn: [RISK.LOW] },
    2: { label: 'Act on low and medium risk, propose the rest', actsOn: [RISK.LOW, RISK.MEDIUM] },
    3: { label: 'Also run on a schedule', actsOn: [RISK.LOW, RISK.MEDIUM] },
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
    get, has, keys, evaluate, isAgentSettableStatus, mayActDirectly, manifest,
};
