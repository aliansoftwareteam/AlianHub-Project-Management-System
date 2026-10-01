const { RISK, SCOPE, read, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A list a task is added to never decides who reads the task: the task routes' own handlers judge it at its home (Agents/workRequests.js).
const ACTIONS = [
    { key: 'task.lists.list', label: 'List the lists a task was added to', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'task.lists.add', label: 'Add a task to another list', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'the task keeps its home list; the person behind the agent must be able to move it there and to open the other list; never a Scrum sprint, a backlog or a personal list',
      permission: 'task.task_move' },
    { key: 'task.lists.remove', label: 'Take a task out of a list it was added to', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'never its home list; the person behind the agent must be able to move the task at its home or in that list\'s project', permission: { key: 'task.task_list', write: false } },
];

const RATINGS = {
    'task.lists.list': read(SCOPE.TASK),
    // The other list may sit in another project.
    'task.lists.add': write(SCOPE.PROJECT),
    'task.lists.remove': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
