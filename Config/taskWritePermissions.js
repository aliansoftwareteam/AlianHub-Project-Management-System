/*
 * Keys are the ones the web app checks before it offers the control. A write the web app offers without a
 * key check reads task.task_list, as the agent registry does. `tasks` are the task ids the handler writes
 * through and `projects` the projects it creates tasks in; every project they reach must allow.
 * API tokens were already refused on the nine token-enforced actions, so those keep their old path.
 */

const write = (key) => Object.freeze({ key, write: true });
const read = (key) => Object.freeze({ key, write: false });

const VISIBLE = read('task.task_list');

const archiveDeleteNeeds = (deletedStatusKey) => {
    if (deletedStatusKey === 1) return [write('task.task_delete')];
    if (deletedStatusKey === 2) return [write('task.task_archive')];
    if (deletedStatusKey === undefined || deletedStatusKey === 0) return [VISIBLE];
    return [write('task.task_delete'), write('task.task_archive')];
};

const CHECKLIST_ASSIGN_OPERATIONS = ['checklistassignee', 'assigneeremove'];

const entry = (needs, lookup = {}) => Object.freeze({ needs, ...lookup });
const tokenEnforcedEntry = (key) => Object.freeze({ needs: [write(key)], tokenEnforced: true });

const TASK_ID = [['taskId']];
const BULK_TASK_IDS = [['taskIds', '*']];

const TASK_ACTIONS = Object.freeze({
    updateStatus: tokenEnforcedEntry('task.task_status'),
    updatePriority: tokenEnforcedEntry('task.task_priority'),
    updateAssignee: tokenEnforcedEntry('task.task_assignee'),
    updateDueDate: tokenEnforcedEntry('task.task_due_date'),
    updateStartDate: tokenEnforcedEntry('task.task_due_date'),
    updateTaskType: tokenEnforcedEntry('task.task_type'),
    updateDescription: tokenEnforcedEntry('task.task_description'),
    updateTaskTotalEstimate: tokenEnforcedEntry('task.task_estimated_hours'),
    updatePoints: tokenEnforcedEntry('task.task_estimated_hours'),

    create: entry([write('task.task_create')], { tasks: [['data', 'ParentTaskId']], projects: [['data', 'ProjectID']] }),
    createSubTaskWithAi: entry((body) => [write(body.type === 'subTask' ? 'task.sub_task_create' : 'task.task_create')], {
        tasks: [['parentTask', 'id']], projects: [['parentTask', 'ProjectID']],
    }),
    createMultipleTasks: entry([write('task.task_create')], { projects: [['projectData', '_id']] }),

    updateTaskName: entry([write('task.task_name_edit')], { tasks: [['taskData', '_id']] }),
    updateDates: entry([write('task.task_due_date')], { tasks: [['taskData', '_id']] }),
    updateStartDateAndDueDate: entry([write('task.task_due_date'), write('task.task_start_date')], { tasks: [['task', '_id']] }),
    updateTaskLeader: entry([write('task.task_assignee')], { tasks: [['taskData', '_id']] }),
    updateWatcher: entry([VISIBLE], { tasks: TASK_ID }),
    updateTags: entry([write('task.task_tag')], { tasks: TASK_ID }),
    updateChecklists: entry((body) => [write(CHECKLIST_ASSIGN_OPERATIONS.includes(body.operation) ? 'task.task_checklist_assign_remove' : 'task.task_checklist')], { tasks: TASK_ID }),
    AddAiChecklist: entry([write('task.task_checklist')], { tasks: TASK_ID }),
    updateAttachments: entry([write('task.task_attachments')], { tasks: TASK_ID }),
    updateTaskCustomField: entry([write('task.task_custom_field')], { tasks: TASK_ID }),
    updateMarkAsFavourite: entry([VISIBLE], { tasks: TASK_ID }),
    updateLastMessageTime: entry([write('task.task_comment')], { tasks: TASK_ID }),
    updateQueueList: entry([write('task.queue_list')], { tasks: TASK_ID }),
    updateSupportTicket: entry([write('task.task_status')], { tasks: TASK_ID }),
    updateArchiveDelete: entry((body) => archiveDeleteNeeds(body.deletedStatusKey), { tasks: [['task', '_id'], ['task', 'ParentTaskId']] }),

    convertToSubTask: entry([write('task.task_convert_to_subtask'), write('task.sub_task_create')], { tasks: [['selectedTaskId'], ['taskId']] }),
    convertToTask: entry([write('task.convert_to_task'), write('task.task_create')], { tasks: [['taskId'], ['parentTaskId']] }),
    convertToList: entry([write('task.task_convert_to_list'), write('project.project_sprint_create')], { tasks: TASK_ID }),
    moveTask: entry([write('task.task_move')], { tasks: [['moveTaskId']] }),
    mergeTask: entry([write('task.task_merge')], { tasks: [['taskId'], ['mergeTaskId']] }),
    duplicateTask: entry([write('task.task_duplicate')], { tasks: [['selectedTaskId']] }),

    addTaskRelation: entry([VISIBLE], { tasks: [['taskId'], ['relatedTaskId']] }),
    removeTaskRelation: entry([VISIBLE], { tasks: [['taskId'], ['relatedTaskId']] }),
    getTaskRelations: entry([VISIBLE], { tasks: TASK_ID }),
    getOpenBlockers: entry([VISIBLE], { tasks: TASK_ID }),
    addRelationHistory: entry([VISIBLE], { tasks: [['task', '_id']] }),
    removeRelationHistory: entry([VISIBLE], { tasks: [['task', '_id']] }),
    notifyRelationChange: entry([VISIBLE], { tasks: [['task', '_id']] }),

    // The web app never sends these helpers as actions, but dispatch reaches them.
    updateTaskKey: entry([write('task.task_create')], { tasks: TASK_ID, projects: [['projectId']] }),
    updateParentCount: entry([write('task.sub_task_create')]),
    updateTaskIndex: entry([write('task.task_move')]),
    findRelationTask: entry([VISIBLE]),
    pushRelationEntry: entry([VISIBLE]),
    pullRelationEntry: entry([VISIBLE]),

    bulkUpdateStatus: entry([write('task.task_status')], { tasks: BULK_TASK_IDS }),
    bulkUpdatePriority: entry([write('task.task_priority')], { tasks: BULK_TASK_IDS }),
    bulkUpdateDueDate: entry([write('task.task_due_date')], { tasks: BULK_TASK_IDS }),
    bulkUpdateStartDate: entry([write('task.task_start_date')], { tasks: BULK_TASK_IDS }),
    bulkUpdateAssignee: entry([write('task.task_assignee')], { tasks: BULK_TASK_IDS }),
    bulkUpdateTags: entry([write('task.task_tag')], { tasks: BULK_TASK_IDS }),
    bulkArchive: entry([write('task.task_archive')], { tasks: BULK_TASK_IDS }),
    bulkRestore: entry([write('task.task_archive')], { tasks: BULK_TASK_IDS }),
    bulkDelete: entry([write('task.task_delete')], { tasks: BULK_TASK_IDS }),
    bulkTrash: entry([write('task.task_delete')], { tasks: BULK_TASK_IDS }),
    _bulkArchiveDelete: entry((body) => archiveDeleteNeeds(body.deletedStatusKey), { tasks: BULK_TASK_IDS }),
    bulkMove: entry([write('task.task_move')], { tasks: BULK_TASK_IDS }),
    bulkConvertToSubTask: entry([write('task.task_convert_to_subtask'), write('task.sub_task_create')], { tasks: [...BULK_TASK_IDS, ['parentTaskId']] }),
    bulkConvertToTask: entry([write('task.convert_to_task'), write('task.task_create')], { tasks: BULK_TASK_IDS }),
    bulkDuplicate: entry([write('task.task_duplicate')], { tasks: BULK_TASK_IDS }),
});

/* The pre-v2 class writes through prevStatus.taskId and priorityObj.taskId, not the task object. */
const PRE_V2_TASK_ACTIONS = Object.freeze({
    updateStatus: entry([write('task.task_status')], { tasks: [['prevStatus', 'taskId']] }),
    updatePriority: entry([write('task.task_priority')], { tasks: [['priorityObj', 'taskId']] }),
    updateTaskName: entry([write('task.task_name_edit')], { tasks: [['taskData', '_id']] }),
});

const RELATION_ACTIONS = Object.freeze({
    add: Object.freeze({ method: 'addTaskRelation', ...TASK_ACTIONS.addTaskRelation }),
    remove: Object.freeze({ method: 'removeTaskRelation', ...TASK_ACTIONS.removeTaskRelation }),
    list: Object.freeze({ method: 'getTaskRelations', ...TASK_ACTIONS.getTaskRelations }),
    openBlockers: Object.freeze({ method: 'getOpenBlockers', ...TASK_ACTIONS.getOpenBlockers }),
});

const ACTIONS = 'actions';
const ROUTE = 'route';
const HANDLER = 'handler';
const NOT_A_TASK_WRITE = 'not a task write';

const TASK_WRITE_ROUTES = Object.freeze({
    'POST /api/tasks': { judged: ROUTE, entry: entry([write('task.task_create')], { projects: [['data', 'ProjectID']] }) },
    'PATCH /api/tasks/': { judged: ACTIONS, actions: PRE_V2_TASK_ACTIONS },
    'POST /api/v2/tasks': { judged: ROUTE, tokenEnforced: true, entry: tokenEnforcedEntry('task.task_create') },
    'PATCH /api/v2/tasks': { judged: ACTIONS, actions: TASK_ACTIONS },
    'POST /api/v2/tasks/bulk': { judged: ACTIONS, actions: TASK_ACTIONS },
    'POST /api/v2/tasks/relations': { judged: ACTIONS, actions: RELATION_ACTIONS },
    'PATCH /api/v1/importTasks': { judged: ROUTE, entry: TASK_ACTIONS.createMultipleTasks },
    'PUT /api/v1/task': { judged: HANDLER, by: 'Modules/Tasks/helpers/taskWriteGuard.js CASCADE_PERMISSIONS, for every caller' },
    'PUT /api/v1/project/allTask/:id': { judged: HANDLER, by: 'Config/projectAccess.js DELETE_OR_CLOSE on the route, for every caller' },
    'POST /api/v1/tabSyncTask': { judged: NOT_A_TASK_WRITE, by: 'a read' },
    'POST /api/v1/task/find': { judged: NOT_A_TASK_WRITE, by: 'a read' },
    'POST /api/v1/task/filter/create': { judged: NOT_A_TASK_WRITE, by: 'a saved filter' },
    'PUT /api/v1/task/filter/update': { judged: NOT_A_TASK_WRITE, by: 'a saved filter' },
    'DELETE /api/v1/task/filter/delete/:cid/:id': { judged: NOT_A_TASK_WRITE, by: 'a saved filter' },
});

const requirementsOf = (taskEntry, body) => {
    const needs = typeof taskEntry.needs === 'function' ? taskEntry.needs(body || {}) : taskEntry.needs;
    return Array.isArray(needs) ? needs : [];
};

const actionEntry = (actions, action) => (typeof action === 'string' && Object.hasOwn(actions, action) ? actions[action] : null);

module.exports = {
    TASK_ACTIONS,
    PRE_V2_TASK_ACTIONS,
    RELATION_ACTIONS,
    TASK_WRITE_ROUTES,
    JUDGED: Object.freeze({ ACTIONS, ROUTE, HANDLER, NOT_A_TASK_WRITE }),
    requirementsOf,
    actionEntry,
};
