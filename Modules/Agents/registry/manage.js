const { RISK, SCOPE, read, write, group } = require('../registryKit');
const manageFlag = require('../../Mcp/manageFlag');

const CREATE_PERMISSIONS = Object.freeze({
    rawDescription: 'task.task_description', AssigneeUserId: 'task.task_assignee', Task_Priority: 'task.task_priority', DueDate: 'task.task_due_date',
    startDate: ['task.task_due_date', 'task.task_start_date'], status: 'task.task_status', TaskType: 'task.task_type',
    totalEstimatedTime: 'task.task_estimated_hours', links: 'task.task_attachments',
});
const CREATE_FIELDS = Object.freeze(Object.keys(CREATE_PERMISSIONS));

// These write through the task routes' own preparation and handlers (Agents/taskRequests.js).
const ACTIONS = [
    { key: 'fields.list', label: 'List a project\'s custom fields', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'subtasks.list', label: 'List a task\'s subtasks', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'members.list', label: 'List active members', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'task.edit', label: 'Edit a task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      fields: ['TaskName', 'rawDescription', 'Task_Priority', 'DueDate', 'startDate', 'totalEstimatedTime'],
      permission: { byField: {
          TaskName: 'task.task_name_edit', rawDescription: 'task.task_description', Task_Priority: 'task.task_priority', DueDate: 'task.task_due_date',
          startDate: ['task.task_due_date', 'task.task_start_date'], totalEstimatedTime: 'task.task_estimated_hours',
      } } },
    { key: 'task.assignees.set', label: 'Change who a task is assigned to', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_assignee' },
    { key: 'task.field.set', label: 'Fill in a custom field on a task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: 'task.task_custom_field' },
    { key: 'task.move', label: 'Move a task to another list or project', risk: RISK.HIGH, undoable: false, write: true, cost: 'write',
      constraint: 'only a top-level task; the destination must be one the person behind the agent can move tasks into', permission: 'task.task_move' },
    { key: 'task.archive', label: 'Archive a task', risk: RISK.HIGH, undoable: true, write: true, cost: 'write', permission: 'task.task_archive' },
    { key: 'task.restore', label: 'Restore an archived task', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: { key: 'task.task_list', write: false } },
    { key: 'task.history', label: 'Read a task\'s activity log', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: { key: 'task.task_activity_log', write: true } },
    { key: 'task.links.list', label: 'List a task\'s links', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'task.task_list' },
    { key: 'task.status.change', label: 'Set the status, including Done', risk: RISK.HIGH, undoable: true, write: true, cost: 'write',
      constraint: 'only for a token its person created to manage tasks; the close is recorded as that person\'s, made through the agent, and unchecked', permission: 'task.task_status' },
    { key: 'task.add', label: 'Create a task with its details', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', fields: CREATE_FIELDS,
      permission: { key: 'task.task_create', byField: CREATE_PERMISSIONS } },
    { key: 'subtask.add', label: 'Create a subtask with its details', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', fields: CREATE_FIELDS,
      permission: { key: 'task.sub_task_create', byField: CREATE_PERMISSIONS } },
    { key: 'comment.update', label: 'Edit a comment the agent wrote', risk: RISK.LOW, undoable: true, write: true, cost: 'write', permission: 'task.task_comment' },
    { key: 'tasks.batch', label: 'Make several changes together', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write',
      constraint: 'changes nothing itself: each change in the batch is its own action, checked and audited on its own', permission: { key: 'task.task_list', write: false } },
    { key: 'page.create', label: 'Create a doc', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
    { key: 'page.update', label: 'Change a doc', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', permission: { key: 'project.project_details', write: false } },
];

const RATINGS = {
    'fields.list': read(SCOPE.PROJECT),
    'subtasks.list': read(SCOPE.TASK),
    'members.list': read(SCOPE.WORKSPACE),
    'task.edit': write(SCOPE.TASK),
    'task.assignees.set': write(SCOPE.TASK),
    'task.field.set': write(SCOPE.TASK),
    'task.move': write(SCOPE.PROJECT, false),
    'task.archive': write(SCOPE.PROJECT),
    'task.restore': write(SCOPE.PROJECT),
    'task.history': read(SCOPE.TASK),
    'task.links.list': read(SCOPE.TASK),
    'task.status.change': write(SCOPE.TASK),
    'task.add': write(SCOPE.PROJECT),
    'subtask.add': write(SCOPE.TASK),
    'comment.update': write(SCOPE.TASK),
    'tasks.batch': write(SCOPE.TASK),
    'page.create': write(SCOPE.PROJECT),
    'page.update': write(SCOPE.PROJECT),
};

module.exports = { ...group(manageFlag.enabled, ACTIONS, RATINGS), CREATE_FIELDS };
