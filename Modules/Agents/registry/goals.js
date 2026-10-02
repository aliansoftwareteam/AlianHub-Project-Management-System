const { RISK, SCOPE, read, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// Goals have no catalogue entry of their own: who reads or edits one is the goal routes' rule (Agents/goalRequests.js).
// What a goal shows is counted from tasks, so an agent reaches goals only for a person whose role may list tasks.
const ACTIONS = [
    { key: 'goals.list', label: 'List the goals the person can read', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'goal.get', label: 'Read a goal', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'goal.target.set', label: 'Report the value of a goal\'s target', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'only on a goal the person behind the agent can edit; never a target counted from tasks', permission: { key: 'task.task_list', write: false } },
    { key: 'goal.target.sources.add', label: 'Count a list or task toward a goal\'s target', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'only on a goal the person behind the agent can edit, and a list or task every reader of the goal can open', permission: { key: 'task.task_list', write: false } },
    { key: 'goal.target.sources.remove', label: 'Stop counting a list or task toward a goal\'s target', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'only on a goal the person behind the agent can edit', permission: { key: 'task.task_list', write: false } },
];

const RATINGS = {
    'goals.list': read(SCOPE.WORKSPACE),
    'goal.get': read(SCOPE.WORKSPACE),
    // A goal belongs to no project and is read by everyone it is shared with.
    'goal.target.set': write(SCOPE.WORKSPACE),
    'goal.target.sources.add': write(SCOPE.WORKSPACE),
    'goal.target.sources.remove': write(SCOPE.WORKSPACE),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
