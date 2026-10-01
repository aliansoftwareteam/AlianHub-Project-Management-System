const { RISK, SCOPE, read, write, group } = require('../registryKit');
const dataFlag = require('../../Mcp/dataFlag');

const ACTIONS = [
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
];

const RATINGS = {
    'projects.list': read(SCOPE.WORKSPACE),
    'project.get': read(SCOPE.PROJECT),
    'sprints.list': read(SCOPE.PROJECT),
    'statuses.list': read(SCOPE.PROJECT),
    'comments.list': read(SCOPE.TASK),
    'pages.search': read(SCOPE.WORKSPACE),
    'page.get': read(SCOPE.PROJECT),
    'timesheet.read': read(SCOPE.WORKSPACE),
    'comment.create': write(SCOPE.TASK),
    'timelog.create': write(SCOPE.TASK),
};

module.exports = group(dataFlag.enabled, ACTIONS, RATINGS);
