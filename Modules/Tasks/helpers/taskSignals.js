const CLOSED_STATUS_TYPES = Object.freeze(['close', 'done', 'default_close']);

const isClosedTask = (task) => CLOSED_STATUS_TYPES.includes(String((task && (task.statusType || (task.status && task.status.type))) || '').toLowerCase());

/* A project names its own statuses, so blocked is read from the status name or a blocked_by
 * link, the same rule the list's risk column uses (frontend/src/views/Projects/composables/taskRisk.js). */
const BLOCKED_NAME = /block/i;

const isBlockedTask = (task) => {
    const name = String((task && task.status && (task.status.text || task.status.value)) || '');
    if (BLOCKED_NAME.test(name)) return true;
    const relations = Array.isArray(task && task.relations) ? task.relations : [];
    return relations.some((relation) => String((relation && relation.type) || '').toLowerCase() === 'blocked_by');
};

const blockedClauses = () => [{ 'status.text': BLOCKED_NAME }, { relations: { $elemMatch: { type: 'blocked_by' } } }];

const taskRef = (task) => {
    const sprint = (task && task.sprintArray) || {};
    return {
        taskId: String(task._id),
        taskKey: task.TaskKey || '',
        taskName: task.TaskName || '',
        projectId: task.ProjectID ? String(task.ProjectID) : '',
        sprintId: String(task.sprintId || sprint.id || ''),
        folderId: String(sprint.folderId || task.folderObjId || ''),
    };
};

module.exports = { CLOSED_STATUS_TYPES, isClosedTask, isBlockedTask, blockedClauses, taskRef };
