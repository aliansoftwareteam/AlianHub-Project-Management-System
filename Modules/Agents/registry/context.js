const { RISK, SCOPE, read, group } = require('../registryKit');
const dataFlag = require('../../Mcp/dataFlag');

const READ = Object.freeze({ risk: RISK.LOW, undoable: false, write: false, cost: 'read' });

const ACTIONS = [
    { key: 'person.me', label: 'Say who the connection acts for', ...READ, permission: 'project.project_list' },
    { key: 'workdays.get', label: 'Read the working days of the workspace or a project', ...READ, permission: 'project.project_list' },
    { key: 'task.fields.list', label: 'Read a task\'s custom field values', ...READ, permission: 'task.task_custom_field' },
    { key: 'chat.channels.list', label: 'List the chat channels the person can open', ...READ, permission: 'task.task_comment' },
    { key: 'chat.messages.list', label: 'Read the recent messages of a channel or a task', ...READ, permission: 'task.task_comment' },
    { key: 'proposal.get', label: 'Read what became of a proposal the connection filed', ...READ, permission: 'task.task_list' },
];

const RATINGS = {
    'person.me': read(SCOPE.WORKSPACE),
    'workdays.get': read(SCOPE.WORKSPACE),
    'task.fields.list': read(SCOPE.TASK),
    'chat.channels.list': read(SCOPE.WORKSPACE),
    'chat.messages.list': read(SCOPE.PROJECT),
    'proposal.get': read(SCOPE.PROJECT),
};

module.exports = group(dataFlag.enabled, ACTIONS, RATINGS);
