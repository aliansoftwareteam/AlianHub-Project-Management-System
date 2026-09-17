/*
 * Keys are the ones the web app checks before it offers the control. A write the web app offers without a
 * key check reads task.task_list, as the agent registry does. `tasks` are the task ids the handler writes
 * through and `projects` the projects it creates tasks in; every project they reach must allow. A need with
 * its own `lookup` is judged only in the projects that lookup names: the project a move, copy or conversion
 * writes into. API tokens were already refused on the nine token-enforced actions, so those keep their old path.
 */

const write = (key) => Object.freeze({ key, write: true });
const read = (key) => Object.freeze({ key, write: false });
const anyOf = (...options) => Object.freeze({ anyOf: Object.freeze(options) });
const inProject = (paths, need) => Object.freeze({ ...need, lookup: Object.freeze({ tasks: [], projects: paths }) });

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
const DESTINATION = [['projectData', 'id']];

// ListBulkBar.vue offers the sprint move and tags behind task.task_status, BulkActionBar.vue behind their own keys.
const BULK_MOVE = anyOf(write('task.task_move'), write('task.task_status'));
const BULK_TAGS = anyOf(write('task.task_tag'), write('task.task_status'));

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
    // The web app sends this only for direct-message previews, which Chat.vue offers behind this key.
    updateLastMessageTime: entry([write('chat.one_to_one_chat')], { tasks: TASK_ID }),
    updateQueueList: entry([write('task.queue_list')], { tasks: TASK_ID }),
    updateSupportTicket: entry([write('task.task_status')], { tasks: TASK_ID }),
    updateArchiveDelete: entry((body) => archiveDeleteNeeds(body.deletedStatusKey), { tasks: [['task', '_id'], ['task', 'ParentTaskId']] }),

    convertToSubTask: entry([write('task.task_convert_to_subtask'), write('task.sub_task_create')], { tasks: [['selectedTaskId'], ['taskId']] }),
    convertToTask: entry([write('task.convert_to_task'), write('task.task_create'), inProject(DESTINATION, write('task.task_create'))], { tasks: [['taskId'], ['parentTaskId']] }),
    convertToList: entry([write('task.task_convert_to_list'), write('project.project_sprint_create'), inProject(DESTINATION, write('project.project_sprint_create'))], { tasks: TASK_ID }),
    moveTask: entry([write('task.task_move'), inProject(DESTINATION, write('task.task_move'))], { tasks: [['moveTaskId']] }),
    mergeTask: entry([write('task.task_merge')], { tasks: [['taskId'], ['mergeTaskId']] }),
    duplicateTask: entry([write('task.task_duplicate'), inProject(DESTINATION, write('task.task_duplicate'))], { tasks: [['selectedTaskId']] }),

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
    bulkUpdateTags: entry([BULK_TAGS], { tasks: BULK_TASK_IDS }),
    bulkArchive: entry([write('task.task_archive')], { tasks: BULK_TASK_IDS }),
    bulkRestore: entry([VISIBLE], { tasks: BULK_TASK_IDS }),
    bulkDelete: entry([write('task.task_delete')], { tasks: BULK_TASK_IDS }),
    bulkTrash: entry([write('task.task_delete')], { tasks: BULK_TASK_IDS }),
    _bulkArchiveDelete: entry((body) => archiveDeleteNeeds(body.deletedStatusKey), { tasks: BULK_TASK_IDS }),
    bulkMove: entry([BULK_MOVE, inProject(DESTINATION, BULK_MOVE)], { tasks: BULK_TASK_IDS }),
    bulkConvertToSubTask: entry([write('task.task_convert_to_subtask'), write('task.sub_task_create')], { tasks: [...BULK_TASK_IDS, ['parentTaskId']] }),
    bulkConvertToTask: entry([write('task.convert_to_task'), write('task.task_create'), inProject(DESTINATION, write('task.task_create'))], { tasks: BULK_TASK_IDS }),
    bulkDuplicate: entry([write('task.task_duplicate'), inProject(DESTINATION, write('task.task_duplicate'))], { tasks: BULK_TASK_IDS }),
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

/* The body fields the task handlers take a company, and so a database, from. */
const BODY_COMPANY_PATHS = Object.freeze([['companyId'], ['CompanyId'], ['projectData', 'CompanyId'], ['project', 'CompanyId'], ['data', 'CompanyId']]);

const ACTIONS = 'actions';
const ROUTE = 'route';
const HANDLER = 'handler';
const NOT_A_TASK_WRITE = 'not a task write';

const judgedBy = (by) => Object.freeze({ judged: HANDLER, by });
const notATaskWrite = (by) => Object.freeze({ judged: NOT_A_TASK_WRITE, by });

/* Every route in Modules whose path names tasks, with a write verb or as an app.use mount. */
const TASK_WRITE_ROUTES = Object.freeze({
    'POST /api/tasks': { judged: ROUTE, entry: entry([write('task.task_create')], { projects: [['data', 'ProjectID']] }) },
    'PATCH /api/tasks/': { judged: ACTIONS, actions: PRE_V2_TASK_ACTIONS },
    'POST /api/v2/tasks': { judged: ROUTE, entry: tokenEnforcedEntry('task.task_create') },
    'PATCH /api/v2/tasks': { judged: ACTIONS, actions: TASK_ACTIONS },
    'POST /api/v2/tasks/bulk': { judged: ACTIONS, actions: TASK_ACTIONS },
    'POST /api/v2/tasks/relations': { judged: ACTIONS, actions: RELATION_ACTIONS },
    'PATCH /api/v1/importTasks': { judged: ROUTE, entry: TASK_ACTIONS.createMultipleTasks },
    'POST /api/v1/taskIndex': { judged: ROUTE, entry: entry([VISIBLE], { tasks: TASK_ID, projects: [['projectId']] }) },
    'POST /api/v1/updateTaskIndexOnload': { judged: ROUTE, entry: entry([VISIBLE], { tasks: [['taskUpdate', 'data']] }) },
    'PUT /api/v1/task': judgedBy('Modules/Tasks/helpers/taskWriteGuard.js CASCADE_PERMISSIONS, for every caller'),
    'PUT /api/v1/project/allTask/:id': judgedBy('Config/projectAccess.js DELETE_OR_CLOSE on the route, for every caller'),
    'POST /api/v1/projectSetting/taskType': judgedBy('requireProjectAccess with project.project_details on the route'),
    'POST /api/v1/projectSetting/taskStatus': judgedBy('requireProjectAccess with project.project_details on the route'),
    'POST /api/v1/projectSetting/taskStatus/wipLimit': judgedBy('requireProjectAccess with project.project_details on the route'),
    'POST /api/v1/recurring-tasks': judgedBy('requireProjectAccess with task.task_create on the route'),
    'PATCH /api/v1/recurring-tasks/:id': judgedBy('requireProjectAccess on the definition\'s project'),
    'DELETE /api/v1/recurring-tasks/:id': judgedBy('requireProjectAccess on the definition\'s project'),
    'POST /api/v1/recurring-tasks/:id/run-now': judgedBy('requireProjectAccess with task.task_create on the route'),
    'POST /api/v1/recurring-tasks/run-due': judgedBy('runs the workspace\'s stored definitions; its key is a follow-up'),
    'POST /api/v1/ai/project/:projectId/tasks/execute': judgedBy('guardTaskTarget in Modules/AIProjectGenerator/controller.js'),
    'POST /api/v1/ai/project/:projectId/tasks/plan': notATaskWrite('generates a plan; execute writes it'),
    'POST /api/v1/ai/task-summary': notATaskWrite('a read, cached in memory'),
    'POST /api/v1/ai/task-category': notATaskWrite('a suggestion; the task is not written'),
    'POST /api/v1/templates/taskType': notATaskWrite('company templates, owners and admins only'),
    'PUT /api/v1/templates/taskType': notATaskWrite('company templates, owners and admins only'),
    'DELETE /api/v1/templates/taskType/:id': notATaskWrite('company templates, owners and admins only'),
    'POST /api/v1/templates/taskStatus': notATaskWrite('company templates, owners and admins only'),
    'PUT /api/v1/templates/taskStatus': notATaskWrite('company templates, owners and admins only'),
    'DELETE /api/v1/templates/taskStatus/:id': notATaskWrite('company templates, owners and admins only'),
    'PUT /api/v1/setting/taskType': notATaskWrite('company settings, owners and admins only'),
    'PUT /api/v1/setting/taskStatus': notATaskWrite('company settings, owners and admins only'),
    'PUT /api/v1/taskPriority': notATaskWrite('company settings, owners and admins only'),
    'POST /api/v1/tabSyncTask': notATaskWrite('a read'),
    'POST /api/v1/task/find': notATaskWrite('a read'),
    'POST /api/v1/advance/filter/search/tasks': notATaskWrite('a read'),
    'POST /api/v1/dashboard/team-tasktype-breakdown': notATaskWrite('a read'),
    'POST /api/v1/dashboard/my-next-tasks': notATaskWrite('a read'),
    'POST /api/v1/dashboard/tasks-by-status': notATaskWrite('a read'),
    'POST /api/v1/getTaskTypeImage': notATaskWrite('a read'),
    'POST /api/v1/task/filter/create': notATaskWrite('a saved filter'),
    'PUT /api/v1/task/filter/update': notATaskWrite('a saved filter'),
    'DELETE /api/v1/task/filter/delete/:cid/:id': notATaskWrite('a saved filter'),
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
    BODY_COMPANY_PATHS,
    JUDGED: Object.freeze({ ACTIONS, ROUTE, HANDLER, NOT_A_TASK_WRITE }),
    requirementsOf,
    actionEntry,
};
