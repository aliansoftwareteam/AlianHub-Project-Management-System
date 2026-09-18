const logger = require('../../../Config/loggerConfig');
const { schema } = require('../../../utils/mongo-handler/schema');
const { BODY_COMPANY_PATHS } = require('../../../Config/taskWritePermissions');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const PROTECTED_FIELDS = Object.freeze(['_id', 'CompanyId', 'ProjectID', 'TaskKey', 'createdBy', 'createdAt', 'sprintId', 'sprintArray', 'folderObjId']);
const PLACEMENT_FIELDS = Object.freeze(['ProjectID', 'TaskKey', 'sprintId', 'sprintArray', 'folderObjId']);
const PROTOTYPE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const INDEX_NAMES = Object.freeze(['groupByStatusIndex', 'groupByPriorityIndex', 'groupByAssigneeIndex', 'groupByDueDateIndex']);

class TaskWriteRefusal extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = 'TaskWriteRefusal';
        this.statusCode = statusCode;
    }
}

const refuse = (statusCode, message) => { throw new TaskWriteRefusal(statusCode, message); };
const taskNotFound = () => new TaskWriteRefusal(404, 'Task not found');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/* verifyJWTTokenWithCV2 only lets the companyid header through when the token's audience holds it; checking again keeps a route mounted without it from trusting a bare header. */
const validatedCompanyOf = (req) => {
    const header = String((req && req.headers && req.headers.companyid) || '').trim();
    if (!OBJECT_ID.test(header) || !req.aud) return '';
    const audience = Array.isArray(req.aud) ? req.aud : String(req.aud).split(',');
    return audience.some((entry) => String(entry).trim() === header) ? header : '';
};

const STATUS_FIELDS = ['status', 'statusKey', 'statusType'];

/*
 * `params` are the body keys the handler and the web app use; any other key is dropped. `writes` names the body objects
 * the handler copies into the task update, with the fields each may carry. `owns` are the protected fields the action is
 * built to set. `company` are the paths the handler picks its database from. `fieldNames` are values naming a task field.
 */
const spec = ({ params, writes = {}, owns = [], company = [], fieldNames = [] }) => Object.freeze({ params, writes, owns, company, fieldNames });

const HISTORY_USER = ['userData'];
const companyId = [['companyId']];
const projectCompany = [['projectData', 'CompanyId']];

const CREATE_DATA_FIELDS = Object.freeze(Object.keys(schema.tasks).filter((field) => !['_id', 'createdBy', 'createdAt'].includes(field)));

const CREATE = spec({
    params: ['data', 'user', 'projectData', 'indexObj', 'setNotif'],
    writes: { data: CREATE_DATA_FIELDS },
    owns: ['CompanyId', ...PLACEMENT_FIELDS],
    company: [['data', 'CompanyId'], ...projectCompany],
    fieldNames: [['indexObj', 'indexName']],
});

const TASK_ACTION_FIELDS = Object.freeze({
    create: CREATE,
    createSubTaskWithAi: spec({ params: ['companyId', 'userId', 'subTitles', 'sprintObj', 'projectData', 'userData', 'parentTask', 'type'], owns: PLACEMENT_FIELDS, company: [...companyId, ...projectCompany] }),
    createMultipleTasks: spec({ params: ['tasks', 'userData', 'projectData', 'indexObj', 'statusArray', 'sprint', 'eventId'], owns: PLACEMENT_FIELDS, company: projectCompany, fieldNames: [['indexObj', 'indexName']] }),

    updateStatus: spec({ params: ['newStatus', 'prevStatus', 'projectData', 'task', 'isUpdateTask', ...HISTORY_USER], writes: { newStatus: STATUS_FIELDS }, company: projectCompany }),
    updatePriority: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'priorityObj', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['Task_Priority', 'Updated_At'] }, company: projectCompany }),
    updateDueDate: spec({ params: ['commonDateFormatString', 'firebaseObj', 'project', 'task', 'obj', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['DueDate', 'dueDateDeadLine'] }, company: [['project', 'CompanyId']] }),
    updateStartDate: spec({ params: ['commonDateFormatString', 'firebaseObj', 'project', 'task', 'obj', 'isUpdateTask', 'isHistory', ...HISTORY_USER], writes: { firebaseObj: ['startDate'] }, company: [['project', 'CompanyId']] }),
    updateStartDateAndDueDate: spec({ params: ['commonDateFormatString', 'notificationObj', 'firebaseObj', 'task', 'project', ...HISTORY_USER], writes: { firebaseObj: ['DueDate', 'dueDateDeadLine', 'startDate'] }, company: [['project', 'CompanyId']] }),
    updateTaskName: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'obj', ...HISTORY_USER], writes: { firebaseObj: ['TaskName'] }, company: projectCompany }),
    updateTaskTotalEstimate: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'obj', ...HISTORY_USER], writes: { firebaseObj: ['totalEstimatedTime'] }, company: projectCompany }),
    updatePoints: spec({ params: ['firebaseObj', 'projectData', 'taskData', ...HISTORY_USER], writes: { firebaseObj: ['points'] }, company: projectCompany }),
    updateDates: spec({ params: ['firebaseObj', 'projectData', 'taskData', ...HISTORY_USER], writes: { firebaseObj: ['startDate', 'DueDate'] }, company: projectCompany }),
    updateAssignee: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'employeeName', 'type', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['AssigneeUserId'] }, company: projectCompany }),
    updateTaskLeader: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'employeeName', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['Task_Leader'] }, company: projectCompany }),
    updateTaskType: spec({ params: ['newStatus', 'prevStatus', 'projectData', 'taskData', 'isUpdateTask', ...HISTORY_USER], writes: { newStatus: ['TaskType', 'TaskTypeKey', 'taskTypeImage', 'oldTaskTypeImage', 'taskTypeName'] }, company: projectCompany }),
    updateSupportTicket: spec({ params: ['companyId', 'taskId', 'updateObj'], writes: { updateObj: STATUS_FIELDS }, company: companyId }),

    updateWatcher: spec({ params: ['companyId', 'projectId', 'sprintId', 'taskId', 'userId', 'add', 'employeeName', ...HISTORY_USER], company: companyId }),
    updateTags: spec({ params: ['companyId', 'projectId', 'sprintId', 'taskId', 'tagId', 'operation'], company: companyId }),
    updateChecklists: spec({ params: ['companyId', 'projectId', 'sprintId', 'taskId', 'operation', 'data', 'historyObj', 'taskData'], company: companyId }),
    AddAiChecklist: spec({ params: ['companyId', 'taskId', 'checklistArray', 'sprintId', 'projectId', ...HISTORY_USER], company: companyId }),
    updateAttachments: spec({ params: ['companyId', 'sprintId', 'taskId', 'taskData', 'id', 'operation', 'data', 'projectData', ...HISTORY_USER], company: companyId }),
    updateDescription: spec({ params: ['companyId', 'projectData', 'sprintId', 'task', 'text', ...HISTORY_USER], company: companyId }),
    updateTaskCustomField: spec({ params: ['companyId', 'taskId', 'updateDetail', 'customFieldId'], company: companyId, fieldNames: [['customFieldId']] }),
    updateMarkAsFavourite: spec({ params: ['companyId', 'taskId', 'updateDetail', 'type'], company: companyId }),
    updateLastMessageTime: spec({ params: ['companyId', 'taskId', 'msgObj'], company: companyId }),
    updateQueueList: spec({ params: ['CompanyId', 'projectId', 'sprintId', 'taskId', 'userId', 'actionType', 'taskName', ...HISTORY_USER], company: [['CompanyId']] }),
    updateArchiveDelete: spec({ params: ['companyId', 'projectData', 'sprintId', 'task', 'deletedStatusKey', ...HISTORY_USER], company: companyId }),

    convertToSubTask: spec({ params: ['companyId', 'projectData', 'sprintId', 'selectedTaskId', 'taskId', 'oldProject', 'isSubTask', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    convertToTask: spec({ params: ['companyId', 'projectData', 'taskId', 'sprintObj', 'parentTaskId', 'oldSprintObj', 'oldProject'], owns: PLACEMENT_FIELDS, company: companyId }),
    convertToList: spec({ params: ['companyId', 'projectData', 'taskId', 'folderData', 'sprintObj', 'isSubTask', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    moveTask: spec({ params: ['companyId', 'projectData', 'sprintObj', 'moveTaskId', 'oldSprintObj', 'oldProject', 'isSubTask', 'assignee', 'watcher', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    mergeTask: spec({ params: ['companyId', 'projectData', 'taskId', 'mergeTaskId', 'oldProject', 'isSubTask', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    duplicateTask: spec({ params: ['companyId', 'projectData', 'sprintObj', 'selectedTaskId', 'oldProject', 'isSubTask', 'duplicateData', 'assignee', 'watcher', 'taskName', 'oldSprintObj', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),

    addTaskRelation: spec({ params: ['companyId', 'taskId', 'relatedTaskId', 'type', ...HISTORY_USER], company: companyId }),
    removeTaskRelation: spec({ params: ['companyId', 'taskId', 'relatedTaskId', ...HISTORY_USER], company: companyId }),
    getTaskRelations: spec({ params: ['companyId', 'taskId'], company: companyId }),
    getOpenBlockers: spec({ params: ['companyId', 'taskId'], company: companyId }),

    bulkUpdateStatus: spec({ params: ['companyId', 'taskIds', 'newStatus', ...HISTORY_USER], writes: { newStatus: STATUS_FIELDS }, company: companyId }),
    bulkUpdatePriority: spec({ params: ['companyId', 'taskIds', 'firebaseObj', 'priorityObj', ...HISTORY_USER], writes: { firebaseObj: ['Task_Priority', 'Updated_At'] }, company: companyId }),
    bulkUpdateDueDate: spec({ params: ['companyId', 'taskIds', 'DueDate', 'commonDateFormatString', ...HISTORY_USER], company: companyId }),
    bulkUpdateStartDate: spec({ params: ['companyId', 'taskIds', 'startDate', 'commonDateFormatString', ...HISTORY_USER], company: companyId }),
    bulkUpdateAssignee: spec({ params: ['companyId', 'taskIds', 'employeeName', 'employeeId', 'type', ...HISTORY_USER], company: companyId }),
    bulkUpdateTags: spec({ params: ['companyId', 'taskIds', 'tagId', 'operation', ...HISTORY_USER], company: companyId }),
    bulkArchive: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId }),
    bulkRestore: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId }),
    bulkDelete: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId }),
    bulkTrash: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId }),
    bulkMove: spec({ params: ['companyId', 'taskIds', 'sprintObj', 'projectData', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    bulkConvertToSubTask: spec({ params: ['companyId', 'taskIds', 'parentTaskId', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    bulkConvertToTask: spec({ params: ['companyId', 'taskIds', 'sprintObj', 'projectData', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
    bulkDuplicate: spec({ params: ['companyId', 'taskIds', 'sprintObj', 'oldProject', 'projectData', 'isSubTask', 'duplicateData', 'assignee', 'watcher', 'taskName', 'oldSprintObj', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId }),
});

const PRE_V2_ACTION_FIELDS = Object.freeze({
    updateStatus: TASK_ACTION_FIELDS.updateStatus,
    updatePriority: TASK_ACTION_FIELDS.updatePriority,
    updateTaskName: TASK_ACTION_FIELDS.updateTaskName,
});

const TASK_INDEX_FIELDS = spec({
    params: ['relevantIndex', 'projectId', 'companyId', 'taskId', 'isFirst', 'isFirstWithRecord', 'indexName', 'sprintId', 'relevantKey', 'searchKey', 'taskKey', 'updateData', 'userId'],
    writes: { updateData: [...STATUS_FIELDS, 'AssigneeUserId', 'Task_Priority', 'DueDate', 'Updated_At', 'updateToken', 'islocalSnapStop'] },
    fieldNames: [['indexName']],
});

const TASK_INDEX_ONLOAD_FIELDS = spec({ params: ['taskUpdate', 'companyId'], fieldNames: [['taskUpdate', 'item', 'indexName']] });

const specFor = (table, action) => (typeof action === 'string' && Object.hasOwn(table, action) ? table[action] : null);

const valueAt = (body, path) => path.reduce((node, key) => (isPlainObject(node) ? node[key] : undefined), body);

const setAt = (target, [key, ...rest], value) => {
    if (!rest.length) {
        target[key] = value;
        return;
    }
    target[key] = isPlainObject(target[key]) ? { ...target[key] } : {};
    setAt(target[key], rest, value);
};

const checkKey = (key, where) => {
    if (key.split('.').some((segment) => PROTOTYPE_KEYS.includes(segment))) refuse(400, `The request contains a key that is not accepted in ${where}.`);
    if (key.startsWith('$')) refuse(400, `Update operators are not accepted in ${where}.`);
};

const cleanWrite = (name, value, taskSpec, dropped) => {
    if (value === undefined || value === null) return value;
    if (!isPlainObject(value)) refuse(400, `${name} must be an object.`);
    const allowed = taskSpec.writes[name];
    const kept = {};
    Object.keys(value).forEach((key) => {
        checkKey(key, name);
        const field = key.split('.')[0];
        if (PROTECTED_FIELDS.includes(field) && !taskSpec.owns.includes(field)) refuse(400, `This action cannot change ${field}.`);
        if (allowed.includes(key)) kept[key] = value[key];
        else dropped.push(`${name}.${key}`);
    });
    return kept;
};

/* An index name is written as a field name, so it must be one of the index fields; a custom field id is a key under customField. */
const checkFieldName = (path, value) => {
    if (value === undefined || value === null || value === '') return;
    const name = path[path.length - 1];
    if (name === 'indexName') {
        if (!INDEX_NAMES.includes(value)) refuse(400, 'indexName must name a task index.');
        return;
    }
    if (typeof value !== 'string' || value.startsWith('$') || value.split('.').some((segment) => !segment || PROTOTYPE_KEYS.includes(segment))) {
        refuse(400, `${name} is not accepted.`);
    }
};

const loggedDrops = new Set();

const logDropped = (label, dropped) => {
    if (!dropped.length || loggedDrops.has(label)) return;
    loggedDrops.add(label);
    logger.warn(`task write ${label}: dropped fields this action does not change (${dropped.join(', ')}); logged once per process`);
};

/* Fields an action does not change are dropped rather than refused, so API clients that send extra harmless fields keep working. */
const prepareTaskWrite = (req, taskSpec, label) => {
    const company = validatedCompanyOf(req);
    if (!company) refuse(400, 'A valid company is required for this request.');
    if (!taskSpec) refuse(400, 'This task action is not accepted.');
    const body = req.body;
    if (!isPlainObject(body)) refuse(400, 'The request body must be an object.');

    const dropped = [];
    const payload = {};
    Object.keys(body).forEach((key) => {
        checkKey(key, 'the request');
        if (key === 'action') {
            payload.action = body.action;
        } else if (!taskSpec.params.includes(key)) {
            dropped.push(key);
        } else {
            payload[key] = Object.hasOwn(taskSpec.writes, key) ? cleanWrite(key, body[key], taskSpec, dropped) : body[key];
        }
    });
    taskSpec.fieldNames.forEach((path) => checkFieldName(path, valueAt(payload, path)));

    BODY_COMPANY_PATHS.forEach((path) => {
        if (valueAt(payload, path) !== undefined) setAt(payload, path, company);
    });
    taskSpec.company.forEach((path) => setAt(payload, path, company));

    logDropped(label, dropped);
    return { companyId: company, payload, dropped };
};

const sendRefusal = (res, error) => res.status(error.statusCode).send({ status: false, statusText: error.message });

const prepareOrRefuse = (req, res, taskSpec, label) => {
    try {
        return prepareTaskWrite(req, taskSpec, label).payload;
    } catch (error) {
        if (!(error instanceof TaskWriteRefusal)) throw error;
        sendRefusal(res, error);
        return null;
    }
};

const sendFailure = (res, error) => {
    if (error instanceof TaskWriteRefusal) return sendRefusal(res, error);
    return res.send({ status: false, statusText: error && error.message });
};

module.exports = {
    PROTECTED_FIELDS,
    PLACEMENT_FIELDS,
    INDEX_NAMES,
    TASK_ACTION_FIELDS,
    PRE_V2_ACTION_FIELDS,
    TASK_INDEX_FIELDS,
    TASK_INDEX_ONLOAD_FIELDS,
    TaskWriteRefusal,
    taskNotFound,
    validatedCompanyOf,
    specFor,
    prepareTaskWrite,
    prepareOrRefuse,
    sendFailure,
};
