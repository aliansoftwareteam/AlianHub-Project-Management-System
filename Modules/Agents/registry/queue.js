const { RISK, SCOPE, read, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A claim only marks who is working on an item (Agents/manager/workQueue.js). It needs no more than reading
// the task, and gives nothing: the change itself is another action, held to its own permission.
const ACTIONS = [
    { key: 'queue.list', label: 'List the work waiting for an agent', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'queue.claim', label: 'Take an item from the work queue', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: { key: 'task.task_list', write: false } },
    { key: 'queue.release', label: 'Give back or finish an item from the work queue', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: { key: 'task.task_list', write: false } },
];

const RATINGS = {
    'queue.list': read(SCOPE.WORKSPACE),
    'queue.claim': write(SCOPE.TASK),
    'queue.release': write(SCOPE.TASK),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
