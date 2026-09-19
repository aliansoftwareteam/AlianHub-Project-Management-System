/*
 * The bodies frontend/src sends to the task write routes, one per request site, with the keys the web app
 * checks before it offers that control. `ids` are a task, a second task, the project both live in and the
 * project a move, copy or conversion writes into. `destination` lists the keys judged in that project.
 */

const USER = { Employee_Name: 'Max Member', id: '6f0000000000000000000003', companyOwnerId: '6f0000000000000000000001' };
const CID = '6f00000000000000000000c1';
const STATUS = { status: { key: 2, value: '', text: 'Doing', type: 'active' }, statusKey: 2, statusType: 'active' };
const sprintObj = { id: 's2', name: 'Sprint 2', folderId: null };
const projectSlice = (projectId) => ({ _id: projectId, CompanyId: CID, lastTaskId: 4, ProjectName: 'Parity', ProjectCode: 'PAR' });

const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';
const RELATIONS = 'POST /api/v2/tasks/relations';

const bulk = (action, payload) => ({ taskId, otherTaskId }) => ({ action, taskIds: [taskId, otherTaskId], userData: USER, ...payload });

const WEB_APP_BODIES = [
    { route: 'POST /api/v2/tasks', source: 'utils/TaskOperations create', keys: ['task.task_create'], body: ({ projectId }) => ({ data: { ProjectID: projectId, sprintId: 's1', TaskName: 'New' }, user: USER, projectData: projectSlice(projectId), indexObj: {} }) },

    { route: PATCH, action: 'updateStatus', source: 'utils/TaskOperations updateStatus', keys: ['task.task_status'], body: ({ taskId, projectId }) => ({ action: 'updateStatus', newStatus: STATUS, prevStatus: { taskId }, projectData: projectSlice(projectId), task: { _id: taskId, sprintId: 's1' }, isUpdateTask: true, userData: USER }) },
    { route: PATCH, action: 'updatePriority', source: 'utils/TaskOperations updatePriority', keys: ['task.task_priority'], body: ({ taskId, projectId }) => ({ action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: projectSlice(projectId), taskData: { _id: taskId, sprintId: 's1' }, priorityObj: {}, isUpdateTask: true, userData: USER }) },
    { route: PATCH, action: 'updateAssignee', source: 'views/Ai/AgentTeammates.vue assignPerson', keys: ['task.task_assignee'], body: ({ taskId, projectId }) => ({ action: 'updateAssignee', firebaseObj: { AssigneeUserId: USER.id }, projectData: { _id: projectId, CompanyId: CID, ProjectName: 'Parity' }, taskData: { _id: taskId, TaskName: 'T', sprintId: 's1', folderObjId: '', AssigneeUserId: [] }, employeeName: 'Max', type: 'assigneeAdd', isUpdateTask: true, userData: USER }) },
    { route: PATCH, action: 'updateDueDate', source: 'utils/TaskOperations updateDueDate', keys: ['task.task_due_date'], body: ({ taskId, projectId }) => ({ action: 'updateDueDate', commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { DueDate: 1 }, project: projectSlice(projectId), task: { _id: taskId, sprintId: 's1' }, obj: {}, userData: USER, isUpdateTask: true }) },
    { route: PATCH, action: 'updateStartDate', source: 'utils/TaskOperations updateStartDate', keys: ['task.task_due_date'], body: ({ taskId, projectId }) => ({ action: 'updateStartDate', commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { startDate: 1 }, project: projectSlice(projectId), task: { _id: taskId, sprintId: 's1' }, obj: {}, userData: USER, isUpdateTask: true }) },
    { route: PATCH, action: 'updateTaskType', source: 'utils/TaskOperations updateTaskType', keys: ['task.task_type'], body: ({ taskId, projectId }) => ({ action: 'updateTaskType', newStatus: { TaskType: 'Bug', TaskTypeKey: 2 }, prevStatus: {}, projectData: projectSlice(projectId), taskData: { _id: taskId, sprintId: 's1' }, isUpdateTask: true, userData: USER }) },
    { route: PATCH, action: 'updateDescription', source: 'utils/TaskOperations updateDescription', keys: ['task.task_description'], body: ({ taskId, projectId }) => ({ action: 'updateDescription', companyId: CID, projectData: projectSlice(projectId), sprintId: 's1', task: { _id: taskId }, userData: USER, text: { blocks: [], text: '' } }) },
    { route: PATCH, action: 'updateTaskTotalEstimate', source: 'utils/TaskOperations updateTotalEstimatedTime', keys: ['task.task_estimated_hours'], body: ({ taskId, projectId }) => ({ action: 'updateTaskTotalEstimate', firebaseObj: { totalEstimatedTime: 60 }, projectData: projectSlice(projectId), taskData: { _id: taskId, sprintId: 's1' }, obj: {}, userData: USER }) },
    { route: PATCH, action: 'updatePoints', source: 'utils/TaskOperations updatePoints', keys: ['task.task_estimated_hours'], body: ({ taskId, projectId }) => ({ action: 'updatePoints', firebaseObj: { points: 3 }, projectData: projectSlice(projectId), taskData: { _id: taskId, sprintId: 's1' }, userData: USER }) },

    { route: PATCH, action: 'updateTaskName', source: 'TaskDetailPanel.vue updateTaskName', keys: ['task.task_name_edit'], body: ({ taskId, projectId }) => ({ action: 'updateTaskName', firebaseObj: { TaskName: 'Renamed' }, projectData: projectSlice(projectId), taskData: { _id: taskId, ProjectID: projectId, sprintId: 's1', TaskName: 'Old' }, obj: { previousTaskName: 'Old', userName: 'Max' }, userData: USER }) },
    { route: PATCH, action: 'updateDates', source: 'GanttView.vue drag', keys: ['task.task_due_date'], body: ({ taskId, projectId }) => ({ action: 'updateDates', firebaseObj: { startDate: 1, DueDate: 2 }, projectData: projectSlice(projectId), taskData: { _id: taskId, ProjectID: projectId, sprintId: 's1' }, userData: USER }) },
    { route: PATCH, action: 'updateStartDateAndDueDate', source: 'CalendarViewComponent.vue event drop', keys: ['task.task_due_date', 'task.task_start_date'], body: ({ taskId, projectId }) => ({ action: 'updateStartDateAndDueDate', commonDateFormatString: 'DD/MM/YYYY', userData: USER, notificationObj: {}, firebaseObj: { DueDate: 2, startDate: 1 }, task: { _id: taskId, ProjectID: projectId, sprintId: 's1' }, project: projectSlice(projectId) }) },
    { route: PATCH, action: 'updateTaskLeader', source: 'TaskDetailRightSide.vue updateTaskLeader', keys: ['task.task_assignee'], body: ({ taskId, projectId }) => ({ action: 'updateTaskLeader', firebaseObj: { Task_Leader: USER.id }, projectData: projectSlice(projectId), taskData: { _id: taskId, ProjectID: projectId, sprintId: 's1' }, employeeName: 'Max', isUpdateTask: true, userData: USER }) },
    { route: PATCH, action: 'updateWatcher', source: 'TaskDetailPanel.vue updateWatchers', keys: ['task.task_list'], body: ({ taskId, projectId }) => ({ action: 'updateWatcher', companyId: CID, projectId, sprintId: 's1', taskId, userId: USER.id, add: true, userData: USER, employeeName: 'Max' }) },
    { route: PATCH, action: 'updateTags', source: 'TagList/helper.js addTaskTag', keys: ['task.task_tag'], body: ({ taskId, projectId }) => ({ action: 'updateTags', companyId: CID, projectId, sprintId: 's1', taskId, tagId: 'tag-1', operation: 'add' }) },
    { route: PATCH, action: 'updateChecklists', source: 'CheckList.vue add item', keys: ['task.task_checklist'], body: ({ taskId, projectId }) => ({ action: 'updateChecklists', companyId: CID, projectId, sprintId: 's1', taskId, data: [{ name: 'Item' }], operation: 'checklistadd', historyObj: {}, taskData: { _id: taskId, ProjectID: projectId } }) },
    { route: PATCH, action: 'updateChecklists', source: 'CheckList.vue assign an item', keys: ['task.task_checklist_assign_remove'], body: ({ taskId, projectId }) => ({ action: 'updateChecklists', companyId: CID, projectId, sprintId: 's1', taskId, data: [], operation: 'checklistassignee', historyObj: {}, taskData: { _id: taskId, ProjectID: projectId } }) },
    { route: PATCH, action: 'updateChecklists', source: 'Comments.vue add a checklist item from a message', keys: ['task.task_checklist'], body: ({ taskId, projectId }) => ({ action: 'updateChecklists', companyId: CID, projectId, sprintId: 's1', taskId, data: { name: 'From chat' }, operation: 'checklistadd', historyObj: {}, taskData: { folderObjId: null, sprintId: 's1' } }) },
    { route: PATCH, action: 'AddAiChecklist', source: 'AiCheckList.vue', keys: ['task.task_checklist'], body: ({ taskId, projectId }) => ({ action: 'AddAiChecklist', companyId: CID, taskId, checklistArray: [], userData: USER, sprintId: 's1', projectId }) },
    { route: PATCH, action: 'updateAttachments', source: 'TaskDetailTab.vue upload', keys: ['task.task_attachments'], body: ({ taskId, projectId }) => ({ action: 'updateAttachments', companyId: CID, sprintId: 's1', taskId, taskData: { _id: taskId, ProjectID: projectId, attachments: [] }, id: '', operation: 'add', data: { id: 'a1' }, userData: USER, projectData: projectSlice(projectId) }) },
    { route: PATCH, action: 'updateTaskCustomField', source: 'TaskDetailTab.vue custom field', keys: ['task.task_custom_field'], body: ({ taskId }) => ({ action: 'updateTaskCustomField', companyId: CID, taskId, updateDetail: { _id: 'cf1', fieldValue: 'x' }, customFieldId: 'cf1' }) },
    { route: PATCH, action: 'updateMarkAsFavourite', source: 'TaskDetailPanel.vue updateFavourite', keys: ['task.task_list'], body: ({ taskId }) => ({ action: 'updateMarkAsFavourite', companyId: CID, taskId, updateDetail: USER.id, type: 'add' }) },
    { route: PATCH, action: 'updateLastMessageTime', source: 'Comments.vue and useMainChatConversation.js', keys: ['chat.one_to_one_chat'], body: ({ taskId }) => ({ action: 'updateLastMessageTime', companyId: CID, taskId, msgObj: { message: 'hi' } }) },
    { route: PATCH, action: 'updateQueueList', source: 'TaskQuickMenu.vue, TaskDetailAction.vue, QueueListComponent.vue', keys: ['task.queue_list'], body: ({ taskId, projectId }) => ({ CompanyId: CID, projectId, action: 'updateQueueList', sprintId: 's1', taskId, userId: USER.id, actionType: 'add', taskName: 'T', userData: USER }) },
    { route: PATCH, action: 'updateArchiveDelete', source: 'TaskDetailAction.vue delete', keys: ['task.task_delete'], body: ({ taskId, projectId }) => ({ action: 'updateArchiveDelete', companyId: CID, projectData: projectSlice(projectId), sprintId: 's1', task: { _id: taskId, ProjectID: projectId, sprintId: 's1', deletedStatusKey: 0 }, userData: USER, deletedStatusKey: 1 }) },
    { route: PATCH, action: 'updateArchiveDelete', source: 'TaskQuickMenu.vue archive a subtask', keys: ['task.task_archive'], body: ({ taskId, otherTaskId, projectId }) => ({ action: 'updateArchiveDelete', companyId: CID, projectData: projectSlice(projectId), sprintId: 's1', task: { _id: taskId, ProjectID: projectId, ParentTaskId: otherTaskId, sprintId: 's1', deletedStatusKey: 0 }, userData: USER, deletedStatusKey: 2 }) },
    { route: PATCH, action: 'updateArchiveDelete', source: 'TaskQuickMenu.vue restore', keys: ['task.task_list'], body: ({ taskId, projectId }) => ({ action: 'updateArchiveDelete', companyId: CID, projectData: projectSlice(projectId), sprintId: 's1', task: { _id: taskId, ProjectID: projectId, sprintId: 's1', deletedStatusKey: 2 }, userData: USER, deletedStatusKey: 0 }) },
    { route: PATCH, action: 'convertToSubTask', source: 'TaskInSidebar.vue', keys: ['task.task_convert_to_subtask', 'task.sub_task_create'], body: ({ taskId, otherTaskId, projectId }) => ({ action: 'convertToSubTask', companyId: CID, projectData: { id: projectId, ProjectName: 'Parity' }, sprintId: 's1', selectedTaskId: taskId, taskId: otherTaskId, oldProject: { id: projectId, taskTypeCounts: [], taskStatusData: [], ProjectName: 'Parity' }, isSubTask: false, userData: USER }) },
    { route: PATCH, action: 'convertToTask', source: 'ConvertToSubTaskSidebar.vue and ItemList.vue', keys: ['task.convert_to_task', 'task.task_create'], destination: ['task.task_create'], body: ({ taskId, otherTaskId, projectId, destinationProjectId }) => ({ action: 'convertToTask', companyId: CID, projectData: { id: destinationProjectId }, taskId, parentTaskId: otherTaskId, sprintObj, oldSprintObj: { id: 's1', folderId: null }, oldProject: { id: projectId, taskTypeCounts: [], taskStatusData: [] } }) },
    { route: PATCH, action: 'convertToList', source: 'ConvertToList.vue', keys: ['task.task_convert_to_list', 'project.project_sprint_create'], destination: ['project.project_sprint_create'], body: ({ taskId, destinationProjectId }) => ({ action: 'convertToList', companyId: CID, projectData: { id: destinationProjectId, ProjectName: 'Parity' }, taskId, userData: USER, folderData: null, sprintObj: { id: 's1', folderId: null }, isSubTask: false }) },
    { route: PATCH, action: 'moveTask', source: 'ConvertToSubTaskSidebar.vue move', keys: ['task.task_move'], destination: ['task.task_move'], body: ({ taskId, projectId, destinationProjectId }) => ({ action: 'moveTask', companyId: CID, projectData: { id: destinationProjectId, ProjectCode: 'PAR', ProjectName: 'Parity' }, sprintObj, moveTaskId: taskId, oldSprintObj: { id: 's1', folderId: null, name: 'Sprint 1', folderName: '' }, oldProject: { id: projectId, taskTypeCounts: [] }, isSubTask: false, assignee: [], watcher: [], userData: USER }) },
    { route: PATCH, action: 'mergeTask', source: 'TaskInSidebar.vue', keys: ['task.task_merge'], body: ({ taskId, otherTaskId, projectId }) => ({ action: 'mergeTask', companyId: CID, projectData: { id: projectId, ProjectName: 'Parity' }, taskId, mergeTaskId: otherTaskId, oldProject: { id: projectId, taskTypeCounts: [], taskStatusData: [], ProjectName: 'Parity' }, isSubTask: false, userData: USER }) },
    { route: PATCH, action: 'duplicateTask', source: 'ConvertToSubTaskSidebar.vue duplicate', keys: ['task.task_duplicate'], destination: ['task.task_duplicate'], body: ({ taskId, projectId, destinationProjectId }) => ({ action: 'duplicateTask', companyId: CID, projectData: { id: destinationProjectId, ProjectCode: 'PAR', ProjectName: 'Parity' }, sprintObj, selectedTaskId: taskId, oldProject: { id: projectId, taskTypeCounts: [], taskStatusData: [], ProjectName: 'Parity' }, userData: USER, isSubTask: false, duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', oldSprintObj: { id: 's1' } }) },
    { route: PATCH, action: 'createSubTaskWithAi', source: 'SubTasks.vue AI subtasks', keys: ['task.sub_task_create'], body: ({ otherTaskId, projectId }) => ({ action: 'createSubTaskWithAi', companyId: CID, userId: USER.id, subTitles: [{ title: 'Step' }], sprintObj, projectData: projectSlice(projectId), userData: USER, parentTask: { id: otherTaskId, ProjectID: projectId }, type: 'subTask' }) },
    { route: PATCH, action: 'createSubTaskWithAi', source: 'SprintsList.vue AI tasks', keys: ['task.task_create'], body: ({ projectId }) => ({ action: 'createSubTaskWithAi', companyId: CID, userId: USER.id, subTitles: [{ title: 'Step' }], sprintObj, projectData: projectSlice(projectId), userData: USER, parentTask: { ProjectID: projectId }, type: 'task' }) },

    { route: BULK, action: 'bulkUpdateStatus', source: 'BulkActionBar.vue and ListBulkBar.vue', keys: ['task.task_status'], body: bulk('bulkUpdateStatus', { newStatus: STATUS }) },
    { route: BULK, action: 'bulkUpdatePriority', source: 'BulkActionBar.vue', keys: ['task.task_priority'], body: bulk('bulkUpdatePriority', { firebaseObj: { Task_Priority: 'HIGH' }, priorityObj: { priorityName: 'High', newPriorityName: 'High' } }) },
    { route: BULK, action: 'bulkUpdateAssignee', source: 'BulkActionBar.vue and ListBulkBar.vue', keys: ['task.task_assignee'], body: bulk('bulkUpdateAssignee', { type: 'assigneeAdd', employeeId: [USER.id], employeeName: 'Max' }) },
    { route: BULK, action: 'bulkUpdateDueDate', source: 'BulkActionBar.vue', keys: ['task.task_due_date'], body: bulk('bulkUpdateDueDate', { DueDate: '2026-10-01' }) },
    { route: BULK, action: 'bulkUpdateTags', source: 'BulkActionBar.vue and ListBulkBar.vue', keys: ['task.task_tag|task.task_status'], body: bulk('bulkUpdateTags', { tagId: 'tag-1', operation: 'add' }) },
    { route: BULK, action: 'bulkArchive', source: 'BulkActionBar.vue and ListBulkBar.vue', keys: ['task.task_archive'], body: bulk('bulkArchive', {}) },
    { route: BULK, action: 'bulkDelete', source: 'BulkActionBar.vue', keys: ['task.task_delete'], body: bulk('bulkDelete', {}) },
    { route: BULK, action: 'bulkTrash', source: 'ListBulkBar.vue', keys: ['task.task_delete'], body: bulk('bulkTrash', {}) },
    { route: BULK, action: 'bulkMove', source: 'BulkActionBar.vue and ListBulkBar.vue', keys: ['task.task_move|task.task_status'], destination: ['task.task_move|task.task_status'], body: ({ destinationProjectId, ...ids }) => bulk('bulkMove', { projectData: { id: destinationProjectId, ProjectCode: 'PAR', ProjectName: 'Parity' }, sprintObj })(ids) },
    { route: BULK, action: 'bulkConvertToSubTask', source: 'BulkActionBar.vue', keys: ['task.task_convert_to_subtask', 'task.sub_task_create'], body: ({ taskId, otherTaskId }) => ({ action: 'bulkConvertToSubTask', taskIds: [taskId], userData: USER, parentTaskId: otherTaskId }) },
    { route: BULK, action: 'bulkConvertToTask', source: 'BulkActionBar.vue', keys: ['task.convert_to_task', 'task.task_create'], destination: ['task.task_create'], body: ({ destinationProjectId, ...ids }) => bulk('bulkConvertToTask', { projectData: { id: destinationProjectId, ProjectCode: 'PAR', ProjectName: 'Parity' }, sprintObj })(ids) },

    { route: RELATIONS, action: 'add', source: 'LinkedTasks.vue and GanttView.vue', keys: ['task.task_list'], body: ({ taskId, otherTaskId }) => ({ action: 'add', taskId, relatedTaskId: otherTaskId, type: 'blocks', userData: USER }) },
    { route: RELATIONS, action: 'remove', source: 'LinkedTasks.vue and GanttView.vue', keys: ['task.task_list'], body: ({ taskId, otherTaskId }) => ({ action: 'remove', taskId, relatedTaskId: otherTaskId, userData: USER }) },
    { route: RELATIONS, action: 'list', source: 'LinkedTasks.vue, TaskDetailPanel.vue, TaskOperations', keys: ['task.task_list'], body: ({ taskId }) => ({ action: 'list', taskId }) },

    { route: 'POST /api/v1/taskIndex', source: 'views/Projects/ListView/useListDragDrop.js', keys: ['task.task_list'], body: ({ taskId, projectId }) => ({ relevantIndex: 2, projectId, companyId: CID, taskId, isFirst: false, isFirstWithRecord: false, indexName: 'groupByStatusIndex', sprintId: 's1', relevantKey: 2, searchKey: 'statusKey', taskKey: 'PAR-1', updateData: {} }) },
    { route: 'POST /api/v1/updateTaskIndexOnload', source: 'views/Projects/TableView/TableViewTable.vue', keys: ['task.task_list'], body: ({ taskId }) => ({ taskUpdate: { data: taskId, item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 2 }, taskKey: 'PAR-1' }, companyId: CID }) },

    { route: 'PATCH /api/v1/importTasks', source: 'utils/TaskOperations createMultipleTasks', keys: ['task.task_create'], body: ({ projectId }) => ({ action: 'createMultipleTasks', tasks: [], userData: USER, projectData: projectSlice(projectId), indexObj: {}, statusArray: [], sprint: { id: 's1' }, eventId: 'e1' }) },
];

/*
 * A drag between groups sends two requests. views/Projects/helper.js updateTaskByGroup builds the action; its isUpdateTask
 * argument defaults to true, which every caller leaves or passes, so the action writes the field as well. The list
 * (useListDragDrop.js) and the board (KanbanBoard.vue) post the index route with the group value in `updateData`.
 * `action` takes that argument, so a test can also send the history-only form the helper builds when it is false.
 */
const MARKER = { user: `tab-${'0'.repeat(32)}`, timeStamp: 1760000000000 };
const DUE = '2026-10-01T00:00:00.000Z';
const START = '2026-09-28T00:00:00.000Z';
const draggedTask = ({ taskId, projectId }) => ({ _id: taskId, ProjectID: projectId, CompanyId: CID, sprintId: 's1', folderObjId: '', TaskName: 'Task 01', TaskKey: 'PAR-1', statusKey: 1, Task_Priority: 'MEDIUM', AssigneeUserId: [], dueDateDeadLine: [] });
const indexWrite = ({ taskId, projectId }, indexName, searchKey, relevantKey, updateData) => ({ relevantIndex: 0, projectId, companyId: CID, taskId, isFirst: true, isFirstWithRecord: false, indexName, sprintId: 's1', relevantKey, searchKey, taskKey: 'PAR-1', updateData: { ...updateData, updateToken: MARKER, islocalSnapStop: true } });
const dueDateNotification = ({ taskId, projectId }) => ({ key: 'task_due_date', projectId, taskId, sprintId: 's1', message: '<p>In <strong>Parity</strong> Project, Due Date of <strong>Task 01</strong> is added as <strong>01/10/2026</strong>.</p>' });

const GROUP_DRAGS = [
    {
        source: 'group by status',
        holds: { statusKey: 3 },
        historyKey: 'Task_Status',
        index: (ids) => indexWrite(ids, 'groupByStatusIndex', 'statusKey', 3, { status: { text: 'Done', key: 3, type: 'close' }, statusType: 'close', statusKey: 3 }),
        action: (ids, isUpdateTask) => ({ action: 'updateStatus', newStatus: { status: { text: 'Done', key: 3, type: 'close' }, statusType: 'close', statusKey: 3 }, prevStatus: { backColor: '#eee', color: '#111', statusName: 'To Do', taskName: 'Task 01', bgColor: '#dfd', textColor: '#060', taskId: ids.taskId, updatedTaskName: 'Done' }, projectData: projectSlice(ids.projectId), task: draggedTask(ids), userData: USER, isUpdateTask }),
    },
    {
        source: 'group by assignee',
        holds: { AssigneeUserId: [USER.id] },
        historyKey: 'Assignee_Changed',
        index: (ids) => indexWrite(ids, 'groupByAssigneeIndex', 'AssigneeUserId', USER.id, { AssigneeUserId: [USER.id] }),
        action: (ids, isUpdateTask) => ({ action: 'updateAssignee', firebaseObj: { AssigneeUserId: [USER.id] }, projectData: projectSlice(ids.projectId), taskData: draggedTask(ids), employeeName: ['Max Member'], type: 'replace', userData: USER, isUpdateTask }),
    },
    {
        source: 'group by priority',
        holds: { Task_Priority: 'HIGH' },
        historyKey: 'task_priority',
        index: (ids) => indexWrite(ids, 'groupByPriorityIndex', 'Task_Priority', 'HIGH', { Task_Priority: 'HIGH', Updated_At: DUE }),
        action: (ids, isUpdateTask) => ({ action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: { _id: ids.projectId, ProjectName: 'Parity', CompanyId: CID }, taskData: draggedTask(ids), priorityObj: { statusImage: '', priorityName: 'MEDIUM', taskId: ids.taskId, taskName: 'Task 01', userName: USER.Employee_Name, newStatusImage: '', newPriorityName: 'HIGH' }, userData: USER, isUpdateTask }),
    },
    {
        source: 'group by due date',
        holds: { DueDate: DUE },
        historyKey: 'Project_DueDate',
        index: (ids) => indexWrite(ids, 'groupByDueDateIndex', 'DueDate', Date.parse(DUE) / 1000, { DueDate: DUE, Updated_At: DUE }),
        action: (ids, isUpdateTask) => ({ action: 'updateDueDate', commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }] }, project: projectSlice(ids.projectId), task: draggedTask(ids), obj: dueDateNotification(ids), userData: USER, isUpdateTask }),
    },
];

/*
 * CalendarViewComponent.vue updateDueDate. A resize sends updateDueDate without isUpdateTask. A drop sets isUpdateTask to
 * false on the body it has built, sends updateStartDateAndDueDate from that body's parts and returns; `historyOnly` is
 * that built body, which the drop leaves unsent.
 */
const calendarTask = ({ taskId }) => ({ sprintId: 's1', _id: taskId, sprintArray: { id: 's1', name: 'Sprint 1' } });
const calendarBody = (ids) => ({ commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }] }, project: projectSlice(ids.projectId), task: calendarTask(ids), obj: dueDateNotification(ids), userData: USER });
const CALENDAR_DRAG = {
    resize: (ids) => ({ action: 'updateDueDate', ...calendarBody(ids) }),
    drop: (ids) => ({ action: 'updateStartDateAndDueDate', commonDateFormatString: 'DD/MM/YYYY', userData: USER, notificationObj: dueDateNotification(ids), firebaseObj: { ...calendarBody(ids).firebaseObj, startDate: START }, task: calendarTask(ids), project: projectSlice(ids.projectId) }),
    historyOnly: (ids) => ({ action: 'updateDueDate', ...calendarBody(ids), isUpdateTask: false }),
};

module.exports = WEB_APP_BODIES;
module.exports.GROUP_DRAGS = GROUP_DRAGS;
module.exports.CALENDAR_DRAG = CALENDAR_DRAG;
