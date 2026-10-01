const { RISK, SCOPE, read, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// These run the web app's own tag, relation, list and doc comment handlers (Agents/workRequests.js).
const ACTIONS = [
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
];

const RATINGS = {
    'tags.list': read(SCOPE.PROJECT),
    'task.tags.add': write(SCOPE.TASK),
    'task.tags.remove': write(SCOPE.TASK),
    'task.relations.list': read(SCOPE.TASK),
    // A link is written on both tasks, which may sit in two projects.
    'task.relation.add': write(SCOPE.PROJECT),
    'task.relation.remove': write(SCOPE.PROJECT),
    'lists.list': read(SCOPE.PROJECT),
    'list.create': write(SCOPE.PROJECT),
    'list.rename': write(SCOPE.PROJECT),
    'list.move': write(SCOPE.PROJECT),
    'page.comments.list': read(SCOPE.PROJECT),
    'page.comment.create': write(SCOPE.PROJECT),
    'page.comment.reply': write(SCOPE.PROJECT),
    'page.comment.assign': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
