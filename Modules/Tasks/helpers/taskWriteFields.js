const { default: mongoose } = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { myCache } = require('../../../Config/config');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { schema } = require('../../../utils/mongo-handler/schema');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { sanitizeInput } = require('../../serviceFunction');
const { BODY_COMPANY_PATHS } = require('../../../Config/taskWritePermissions');
const { canReadProject } = require('../../../Config/projectAccess');
const { mayAttachKey, taskAttachmentKey, formUploadKey, clipKey } = require('../../../common-storage/taskFileKeys');
const { REPORT, scopeMode, countReported } = require('../../../common-storage/storedFileScope');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const PROTECTED_FIELDS = Object.freeze(['_id', 'CompanyId', 'ProjectID', 'TaskKey', 'createdBy', 'createdAt', 'sprintId', 'sprintArray', 'folderObjId']);
const PLACEMENT_FIELDS = Object.freeze(['ProjectID', 'TaskKey', 'sprintId', 'sprintArray', 'folderObjId']);
const PROTOTYPE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const INDEX_NAMES = Object.freeze(['groupByStatusIndex', 'groupByPriorityIndex', 'groupByAssigneeIndex', 'groupByDueDateIndex']);
const SEARCH_KEYS = Object.freeze(['statusKey', 'Task_Priority', 'AssigneeUserId', 'DueDate']);
const UNKNOWN_USER = 'Unknown user';
const USER_CACHE_SECONDS = 604800;

class TaskWriteRefusal extends Error {
    constructor(statusCode, message, code) {
        super(message);
        this.name = 'TaskWriteRefusal';
        this.statusCode = statusCode;
        if (code) this.code = code;
    }
}

const refuse = (statusCode, message) => { throw new TaskWriteRefusal(statusCode, message); };
const ATTACHMENT_KEY_REFUSED = 'ATTACHMENT_KEY_NOT_OWN';
const taskNotFound = () => new TaskWriteRefusal(404, 'Task not found');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
const isScalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

const escapeText = (value) => sanitizeInput(String(value === undefined || value === null ? '' : value));

/* verifyJWTTokenWithCV2 only lets the companyid header through when the token's audience holds it; checking again keeps a route mounted without it from trusting a bare header. */
const validatedCompanyOf = (req) => {
    const header = String((req && req.headers && req.headers.companyid) || '').trim();
    if (!OBJECT_ID.test(header) || !req.aud) return '';
    const audience = Array.isArray(req.aud) ? req.aud : String(req.aud).split(',');
    return audience.some((entry) => String(entry).trim() === header) ? header : '';
};

/* The one id a value names, read as the task handlers and the permission guard read it: hex in any case, a lone { id } / { _id }, or the ObjectId a stored row carries. */
const plainIdOf = (value) => {
    if (value === undefined || value === null) return { absent: true };
    if (value instanceof mongoose.Types.ObjectId) return { id: value.toHexString() };
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return { absent: true };
        return OBJECT_ID.test(trimmed) ? { id: trimmed } : {};
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length === 1 && ['id', '_id'].includes(keys[0]) && typeof value[keys[0]] === 'string') {
            const inner = plainIdOf(value[keys[0]]);
            return inner.id ? inner : {};
        }
    }
    return {};
};

const STATUS_FIELDS = ['status', 'statusKey', 'statusType'];

const valueAt = (body, path) => path.reduce((node, key) => (isPlainObject(node) ? node[key] : undefined), body);

const sameValue = (claimed, stored) => isScalar(claimed) && claimed !== null && stored !== undefined && stored !== null && String(claimed) === String(stored);

const instantOf = (value) => (value === undefined || value === null ? null : new Date(value).getTime());

/* An unreadable date is NaN on either side and never equal. */
const sameInstant = (claimed, stored) => (claimed === null || ['string', 'number'].includes(typeof claimed)) && instantOf(claimed) === instantOf(stored);

const holdsField = (path, field, same = sameValue) => (payload, stored) => same(valueAt(payload, path), stored[field]);

const holdsAssignees = (payload, stored) => {
    const claimed = valueAt(payload, ['firebaseObj', 'AssigneeUserId']);
    const named = Array.isArray(claimed) ? claimed : [claimed];
    if (named.some((id) => typeof id !== 'string' || !id)) return false;
    const assigned = new Set((stored.AssigneeUserId || []).map(String));
    if (payload.type === 'replace') return Array.isArray(claimed) && new Set(named).size === assigned.size && named.every((id) => assigned.has(id));
    if (payload.type === 'assigneeAdd') return named.every((id) => assigned.has(id));
    if (payload.type === 'assigneRemove') return named.every((id) => !assigned.has(id));
    return false;
};

const holdsTaskType = (payload, stored) => {
    const claimed = ['TaskType', 'TaskTypeKey'].filter((field) => valueAt(payload, ['newStatus', field]) !== undefined);
    return claimed.length > 0 && claimed.every((field) => sameValue(payload.newStatus[field], stored[field]));
};

/*
 * `params` are the body keys the handler and the web app use; any other key is dropped. `writes` names the body objects
 * the handler copies into the task update, with the fields each may carry. `owns` are the protected fields the action is
 * built to set. `company` are the paths the handler picks its database from. `fieldNames` are values naming a task field.
 * `ids` must each resolve to one plain id, `scalars` and `numbers` are values a query compares against, `searchKeys` name
 * the field a query matches on, `objects` must be objects when sent. `task` is the task the action writes: it is required,
 * must exist and be visible, its project is written to the `project` paths, its id to the `taskIds` paths and its name to
 * the `taskNames` paths. `held` tells whether the stored task already has the value the body names; an action that takes
 * isUpdateTask records history without writing only when it does. `destination` names the project a move or copy writes
 * into, which must exist. `actor` are the params that receive the signed-in user.
 */
const spec = ({ params, writes = {}, owns = [], company = [], fieldNames = [], ids = [], scalars = [], numbers = [], searchKeys = [], objects = [], task = null, project = [], taskIds = [], taskNames = [], held = null, destination = null, attachments = null, actor }) => Object.freeze({
    params, writes, owns, company, fieldNames, ids, scalars, numbers, searchKeys, objects, task, project, taskIds, taskNames, held, destination, attachments,
    actor: actor || (params.includes('userData') ? ['userData'] : []),
});

const HISTORY_USER = ['userData'];
const companyId = [['companyId']];
const projectCompany = [['projectData', 'CompanyId']];

const TASK_ID = [['taskId']];
const TASK = [['task', '_id']];
const TASK_DATA = [['taskData', '_id']];
const TASK_NAME = [['taskData', 'TaskName']];
const TASK_IDS = [['taskIds', '*']];
const PROJECT_DATA = [['projectData', '_id']];
const PROJECT = [['project', '_id']];
const PROJECT_ID = [['projectId']];
const DESTINATION = ['projectData', 'id'];

const CREATE_DATA_FIELDS = Object.freeze(Object.keys(schema.tasks).filter((field) => !['_id', 'createdBy', 'createdAt'].includes(field)));

const CREATE = spec({
    params: ['data', 'user', 'projectData', 'indexObj', 'setNotif'],
    writes: { data: CREATE_DATA_FIELDS },
    owns: ['CompanyId', ...PLACEMENT_FIELDS],
    company: [['data', 'CompanyId'], ...projectCompany],
    fieldNames: [['indexObj', 'indexName']],
    ids: [['data', 'ParentTaskId'], ['data', 'ProjectID']],
    objects: [['indexObj']],
    actor: ['user'],
    attachments: 'created',
});

const TASK_ACTION_FIELDS = Object.freeze({
    create: CREATE,
    createSubTaskWithAi: spec({ params: ['companyId', 'userId', 'subTitles', 'sprintObj', 'projectData', 'userData', 'parentTask', 'type'], owns: PLACEMENT_FIELDS, company: [...companyId, ...projectCompany], ids: [['parentTask', 'id'], ['parentTask', 'ProjectID']] }),
    createMultipleTasks: spec({ params: ['tasks', 'userData', 'projectData', 'indexObj', 'statusArray', 'sprint', 'eventId'], owns: PLACEMENT_FIELDS, company: projectCompany, fieldNames: [['indexObj', 'indexName']], ids: PROJECT_DATA, objects: [['indexObj']], attachments: 'imported' }),

    updateStatus: spec({ params: ['newStatus', 'prevStatus', 'projectData', 'task', 'isUpdateTask', ...HISTORY_USER], writes: { newStatus: STATUS_FIELDS }, company: projectCompany, ids: [...TASK, ['prevStatus', 'taskId']], task: TASK[0], project: PROJECT_DATA, taskIds: [...TASK, ['prevStatus', 'taskId']], taskNames: [['prevStatus', 'taskName']], held: holdsField(['newStatus', 'statusKey'], 'statusKey') }),
    updatePriority: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'priorityObj', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['Task_Priority', 'Updated_At'] }, company: projectCompany, ids: [...TASK_DATA, ['priorityObj', 'taskId']], task: TASK_DATA[0], project: PROJECT_DATA, taskIds: [...TASK_DATA, ['priorityObj', 'taskId']], taskNames: [['priorityObj', 'taskName']], held: holdsField(['firebaseObj', 'Task_Priority'], 'Task_Priority') }),
    updateDueDate: spec({ params: ['commonDateFormatString', 'firebaseObj', 'project', 'task', 'obj', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['DueDate', 'dueDateDeadLine'] }, company: [['project', 'CompanyId']], ids: TASK, task: TASK[0], project: PROJECT, held: holdsField(['firebaseObj', 'DueDate'], 'DueDate', sameInstant) }),
    updateStartDate: spec({ params: ['commonDateFormatString', 'firebaseObj', 'project', 'task', 'obj', 'isUpdateTask', 'isHistory', ...HISTORY_USER], writes: { firebaseObj: ['startDate'] }, company: [['project', 'CompanyId']], ids: TASK, task: TASK[0], project: PROJECT, held: holdsField(['firebaseObj', 'startDate'], 'startDate', sameInstant) }),
    updateStartDateAndDueDate: spec({ params: ['commonDateFormatString', 'notificationObj', 'firebaseObj', 'task', 'project', ...HISTORY_USER], writes: { firebaseObj: ['DueDate', 'dueDateDeadLine', 'startDate'] }, company: [['project', 'CompanyId']], ids: TASK, task: TASK[0], project: PROJECT }),
    updateTaskName: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'obj', ...HISTORY_USER], writes: { firebaseObj: ['TaskName'] }, company: projectCompany, ids: TASK_DATA, task: TASK_DATA[0], project: PROJECT_DATA }),
    updateTaskTotalEstimate: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'obj', ...HISTORY_USER], writes: { firebaseObj: ['totalEstimatedTime'] }, company: projectCompany, ids: TASK_DATA, task: TASK_DATA[0], project: PROJECT_DATA }),
    updatePoints: spec({ params: ['firebaseObj', 'projectData', 'taskData', ...HISTORY_USER], writes: { firebaseObj: ['points'] }, company: projectCompany, ids: TASK_DATA, task: TASK_DATA[0], project: PROJECT_DATA }),
    updateDates: spec({ params: ['firebaseObj', 'projectData', 'taskData', ...HISTORY_USER], writes: { firebaseObj: ['startDate', 'DueDate'] }, company: projectCompany, ids: TASK_DATA, task: TASK_DATA[0], project: PROJECT_DATA }),
    updateAssignee: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'employeeName', 'type', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['AssigneeUserId'] }, company: projectCompany, ids: TASK_DATA, task: TASK_DATA[0], project: PROJECT_DATA, taskNames: TASK_NAME, held: holdsAssignees }),
    updateTaskLeader: spec({ params: ['firebaseObj', 'projectData', 'taskData', 'employeeName', 'isUpdateTask', ...HISTORY_USER], writes: { firebaseObj: ['Task_Leader'] }, company: projectCompany, ids: [...TASK_DATA, ['firebaseObj', 'Task_Leader']], task: TASK_DATA[0], project: PROJECT_DATA, held: holdsField(['firebaseObj', 'Task_Leader'], 'Task_Leader') }),
    updateTaskType: spec({ params: ['newStatus', 'prevStatus', 'projectData', 'taskData', 'isUpdateTask', ...HISTORY_USER], writes: { newStatus: ['TaskType', 'TaskTypeKey', 'taskTypeImage', 'oldTaskTypeImage', 'taskTypeName'] }, company: projectCompany, ids: TASK_DATA, task: TASK_DATA[0], project: PROJECT_DATA, taskNames: TASK_NAME, held: holdsTaskType }),

    updateWatcher: spec({ params: ['companyId', 'projectId', 'sprintId', 'taskId', 'userId', 'add', 'employeeName', ...HISTORY_USER], company: companyId, ids: [...TASK_ID, ['userId']], task: TASK_ID[0], project: PROJECT_ID }),
    updateTags: spec({ params: ['companyId', 'projectId', 'sprintId', 'taskId', 'tagId', 'operation'], company: companyId, ids: TASK_ID, scalars: [['tagId']], task: TASK_ID[0], project: PROJECT_ID }),
    updateChecklists: spec({ params: ['companyId', 'projectId', 'sprintId', 'taskId', 'operation', 'data', 'historyObj', 'taskData', ...HISTORY_USER], company: companyId, ids: TASK_ID, task: TASK_ID[0], project: PROJECT_ID }),
    AddAiChecklist: spec({ params: ['companyId', 'taskId', 'checklistArray', 'sprintId', 'projectId', ...HISTORY_USER], company: companyId, ids: TASK_ID, task: TASK_ID[0], project: PROJECT_ID }),
    updateAttachments: spec({ params: ['companyId', 'sprintId', 'taskId', 'taskData', 'id', 'operation', 'data', 'projectData', ...HISTORY_USER], company: companyId, ids: [...TASK_ID, ...TASK_DATA], scalars: [['data', 'id']], task: TASK_ID[0], project: [['projectData', 'id']], attachments: 'added' }),
    updateDescription: spec({ params: ['companyId', 'projectData', 'sprintId', 'task', 'text', ...HISTORY_USER], company: companyId, ids: TASK, task: TASK[0] }),
    updateTaskCustomField: spec({ params: ['companyId', 'taskId', 'updateDetail', 'customFieldId'], company: companyId, fieldNames: [['customFieldId']], ids: TASK_ID, task: TASK_ID[0] }),
    updateMarkAsFavourite: spec({ params: ['companyId', 'taskId', 'updateDetail', 'type'], company: companyId, ids: [...TASK_ID, ['updateDetail']], task: TASK_ID[0] }),
    updateLastMessageTime: spec({ params: ['companyId', 'taskId', 'msgObj'], company: companyId, ids: TASK_ID, task: TASK_ID[0] }),
    updateQueueList: spec({ params: ['CompanyId', 'projectId', 'sprintId', 'taskId', 'userId', 'actionType', 'taskName', ...HISTORY_USER], company: [['CompanyId']], ids: [...TASK_ID, ['userId']], task: TASK_ID[0], project: PROJECT_ID }),
    updateArchiveDelete: spec({ params: ['companyId', 'projectData', 'sprintId', 'task', 'deletedStatusKey', ...HISTORY_USER], company: companyId, ids: [...TASK, ['task', 'ParentTaskId']], task: TASK[0], project: PROJECT_DATA }),

    convertToSubTask: spec({ params: ['companyId', 'projectData', 'sprintId', 'selectedTaskId', 'taskId', 'oldProject', 'isSubTask', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [['selectedTaskId'], ...TASK_ID], task: ['selectedTaskId'] }),
    convertToTask: spec({ params: ['companyId', 'projectData', 'taskId', 'sprintObj', 'parentTaskId', 'oldSprintObj', 'oldProject'], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_ID, ['parentTaskId'], DESTINATION], task: TASK_ID[0], destination: DESTINATION }),
    convertToList: spec({ params: ['companyId', 'projectData', 'taskId', 'folderData', 'sprintObj', 'isSubTask', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_ID, DESTINATION], task: TASK_ID[0], destination: DESTINATION }),
    moveTask: spec({ params: ['companyId', 'projectData', 'sprintObj', 'moveTaskId', 'oldSprintObj', 'oldProject', 'isSubTask', 'assignee', 'watcher', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [['moveTaskId'], DESTINATION], task: ['moveTaskId'], destination: DESTINATION }),
    mergeTask: spec({ params: ['companyId', 'projectData', 'taskId', 'mergeTaskId', 'oldProject', 'isSubTask', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_ID, ['mergeTaskId']], task: TASK_ID[0] }),
    duplicateTask: spec({ params: ['companyId', 'projectData', 'sprintObj', 'selectedTaskId', 'oldProject', 'isSubTask', 'duplicateData', 'assignee', 'watcher', 'taskName', 'oldSprintObj', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [['selectedTaskId'], DESTINATION], task: ['selectedTaskId'], destination: DESTINATION }),

    addTaskRelation: spec({ params: ['companyId', 'taskId', 'relatedTaskId', 'type', ...HISTORY_USER], company: companyId, ids: [...TASK_ID, ['relatedTaskId']], task: TASK_ID[0] }),
    removeTaskRelation: spec({ params: ['companyId', 'taskId', 'relatedTaskId', ...HISTORY_USER], company: companyId, ids: [...TASK_ID, ['relatedTaskId']], task: TASK_ID[0] }),
    getTaskRelations: spec({ params: ['companyId', 'taskId'], company: companyId, ids: TASK_ID, task: TASK_ID[0] }),
    getOpenBlockers: spec({ params: ['companyId', 'taskId'], company: companyId, ids: TASK_ID, task: TASK_ID[0] }),

    bulkUpdateStatus: spec({ params: ['companyId', 'taskIds', 'newStatus', ...HISTORY_USER], writes: { newStatus: STATUS_FIELDS }, company: companyId, ids: TASK_IDS }),
    bulkUpdatePriority: spec({ params: ['companyId', 'taskIds', 'firebaseObj', 'priorityObj', ...HISTORY_USER], writes: { firebaseObj: ['Task_Priority', 'Updated_At'] }, company: companyId, ids: TASK_IDS }),
    bulkUpdateDueDate: spec({ params: ['companyId', 'taskIds', 'DueDate', 'commonDateFormatString', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkUpdateStartDate: spec({ params: ['companyId', 'taskIds', 'startDate', 'commonDateFormatString', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkUpdateAssignee: spec({ params: ['companyId', 'taskIds', 'employeeName', 'employeeId', 'type', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkUpdateTags: spec({ params: ['companyId', 'taskIds', 'tagId', 'operation', ...HISTORY_USER], company: companyId, ids: TASK_IDS, scalars: [['tagId']] }),
    bulkArchive: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkRestore: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkDelete: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkTrash: spec({ params: ['companyId', 'taskIds', ...HISTORY_USER], company: companyId, ids: TASK_IDS }),
    bulkMove: spec({ params: ['companyId', 'taskIds', 'sprintObj', 'projectData', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_IDS, DESTINATION], destination: DESTINATION }),
    bulkConvertToSubTask: spec({ params: ['companyId', 'taskIds', 'parentTaskId', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_IDS, ['parentTaskId']] }),
    bulkConvertToTask: spec({ params: ['companyId', 'taskIds', 'sprintObj', 'projectData', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_IDS, DESTINATION], destination: DESTINATION }),
    bulkDuplicate: spec({ params: ['companyId', 'taskIds', 'sprintObj', 'oldProject', 'projectData', 'isSubTask', 'duplicateData', 'assignee', 'watcher', 'taskName', 'oldSprintObj', ...HISTORY_USER], owns: PLACEMENT_FIELDS, company: companyId, ids: [...TASK_IDS, DESTINATION], destination: DESTINATION }),
});

/* The pre-v2 class writes through prevStatus.taskId and priorityObj.taskId, not the task object. */
const PRE_V2_ACTION_FIELDS = Object.freeze({
    updateStatus: spec({ ...TASK_ACTION_FIELDS.updateStatus, task: ['prevStatus', 'taskId'] }),
    updatePriority: spec({ ...TASK_ACTION_FIELDS.updatePriority, task: ['priorityObj', 'taskId'] }),
    updateTaskName: TASK_ACTION_FIELDS.updateTaskName,
});

const TASK_INDEX_FIELDS = spec({
    params: ['relevantIndex', 'projectId', 'companyId', 'taskId', 'isFirst', 'isFirstWithRecord', 'indexName', 'sprintId', 'relevantKey', 'searchKey', 'taskKey', 'updateData', 'userId'],
    writes: { updateData: [...STATUS_FIELDS, 'AssigneeUserId', 'Task_Priority', 'DueDate', 'Updated_At', 'updateToken', 'islocalSnapStop'] },
    fieldNames: [['indexName']],
    ids: [...TASK_ID, ...PROJECT_ID],
    scalars: [['relevantKey'], ['taskKey']],
    numbers: [['relevantIndex']],
    searchKeys: [['searchKey']],
    task: TASK_ID[0],
    project: PROJECT_ID,
});

const TASK_INDEX_ONLOAD_FIELDS = spec({
    params: ['taskUpdate', 'companyId'],
    fieldNames: [['taskUpdate', 'item', 'indexName']],
    ids: [['taskUpdate', 'data']],
    scalars: [['taskUpdate', 'item', 'searchValue']],
    searchKeys: [['taskUpdate', 'item', 'searchKey']],
    objects: [['taskUpdate'], ['taskUpdate', 'item']],
    task: ['taskUpdate', 'data'],
});

const specFor = (table, action) => (typeof action === 'string' && Object.hasOwn(table, action) ? table[action] : null);

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

/* An operator or prototype key is refused at any depth, so a value cannot carry a query or update condition. */
const checkTree = (value, where) => {
    if (Array.isArray(value)) {
        value.forEach((item) => checkTree(item, where));
    } else if (isPlainObject(value)) {
        Object.keys(value).forEach((key) => {
            checkKey(key, where);
            checkTree(value[key], where);
        });
    }
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

const nameOf = (path) => path.filter((key) => key !== '*').join('.');

const checkScalar = (path, value) => {
    if (value === undefined) return;
    if (!isScalar(value) || (typeof value === 'string' && value.startsWith('$'))) refuse(400, `${nameOf(path)} must be a plain value.`);
};

const checkNumber = (path, value) => {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) refuse(400, `${nameOf(path)} must be a number.`);
};

const checkSearchKey = (path, value) => {
    if (value === undefined || value === null || value === '') return;
    if (!SEARCH_KEYS.includes(value)) refuse(400, `${nameOf(path)} must name a field tasks are grouped by.`);
};

const checkObject = (path, value) => {
    if (value === undefined || value === null) return;
    if (!isPlainObject(value)) refuse(400, `${nameOf(path)} must be an object.`);
};

/* Each id is written back as the plain id it names, so a handler never sees an object where it filters by id. */
const resolveIds = (payload, path) => {
    const star = path.indexOf('*');
    if (star === -1) {
        const read = plainIdOf(valueAt(payload, path));
        if (read.absent) return;
        if (!read.id) refuse(400, `${nameOf(path)} must be an id.`);
        setAt(payload, path, read.id);
        return;
    }
    const list = valueAt(payload, path.slice(0, star));
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) refuse(400, `${nameOf(path)} must be a list of ids.`);
    const rest = path.slice(star + 1);
    list.forEach((item, at) => {
        const read = plainIdOf(rest.length ? valueAt(item, rest) : item);
        if (read.absent) return;
        if (!read.id) refuse(400, `${nameOf(path)} must be a list of ids.`);
        if (rest.length) setAt(item, rest, read.id);
        else list[at] = read.id;
    });
};

const LOG_WINDOW_MS = 60000;
const loggedDrops = new Map();
const printable = (text) => String(text).replace(/[^\x20-\x7e]/g, '').slice(0, 60);

const logDropped = (label, dropped) => {
    if (!dropped.length) return;
    const now = Date.now();
    const last = loggedDrops.get(label);
    if (last !== undefined && now - last < LOG_WINDOW_MS) return;
    loggedDrops.set(label, now);
    logger.warn(`task write ${printable(label)}: dropped fields this action does not change (${dropped.map(printable).join(', ')}); logged at most once a minute per action`);
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
        checkTree(body[key], key);
        if (key === 'action') {
            payload.action = body.action;
        } else if (!taskSpec.params.includes(key)) {
            dropped.push(key);
        } else {
            payload[key] = Object.hasOwn(taskSpec.writes, key) ? cleanWrite(key, body[key], taskSpec, dropped) : body[key];
        }
    });
    taskSpec.fieldNames.forEach((path) => checkFieldName(path, valueAt(payload, path)));
    taskSpec.objects.forEach((path) => checkObject(path, valueAt(payload, path)));
    taskSpec.searchKeys.forEach((path) => checkSearchKey(path, valueAt(payload, path)));
    taskSpec.scalars.forEach((path) => checkScalar(path, valueAt(payload, path)));
    taskSpec.numbers.forEach((path) => checkNumber(path, valueAt(payload, path)));
    taskSpec.ids.forEach((path) => resolveIds(payload, path));
    /* updateStartDate reads the flag loosely; only a literal false may skip the write, because only that is checked against the stored task. */
    if (taskSpec.params.includes('isUpdateTask')) payload.isUpdateTask = payload.isUpdateTask !== false;

    BODY_COMPANY_PATHS.forEach((path) => {
        if (valueAt(payload, path) !== undefined) setAt(payload, path, company);
    });
    taskSpec.company.forEach((path) => setAt(payload, path, company));

    logDropped(label, dropped);
    return { companyId: company, payload, dropped };
};

const userCacheKey = (uid) => `UserData:${uid}`;

const employeeNameOf = async (uid) => {
    let user = null;
    const cached = myCache.get(userCacheKey(uid));
    if (cached) {
        try {
            user = JSON.parse(cached);
        } catch {
            user = null;
        }
    }
    if (!user) {
        user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: new mongoose.Types.ObjectId(uid) }] }, 'findOne');
        if (user) myCache.set(userCacheKey(uid), JSON.stringify(user), USER_CACHE_SECONDS);
    }
    const name = user && user.Employee_Name ? String(user.Employee_Name).trim() : '';
    return name || UNKNOWN_USER;
};

/* The actor is the signed-in user; the name is escaped here because every history and notification message renders it as HTML. */
const sessionActor = async (req) => {
    const uid = String((req && req.uid) || '').trim();
    if (!OBJECT_ID.test(uid)) refuse(401, 'A signed-in user is required for this request.');
    return { id: uid, Employee_Name: escapeText(await employeeNameOf(uid)) };
};

/* A filter that names no task would match the first task in the collection once the driver drops the empty id. */
const taskFilterOf = (id) => {
    const read = plainIdOf(id);
    if (!read.id) refuse(400, 'A task id is required.');
    return { _id: new mongoose.Types.ObjectId(read.id) };
};

const storedTaskOf = (company, id) => MongoDbCrudOpration(company, { type: SCHEMA_TYPE.TASKS, data: [taskFilterOf(id)] }, 'findOne');

const storedProjectOf = (company, id) => MongoDbCrudOpration(company, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new mongoose.Types.ObjectId(id) }] }, 'findOne');

/* A task in a project the caller cannot see answers as if it did not exist, as the project routes do. */
const visibleTaskOf = async (req, company, taskId) => {
    const stored = await storedTaskOf(company, taskId);
    if (!stored) throw taskNotFound();
    const access = await canReadProject(company, req.uid, String(stored.ProjectID));
    if (!access.allowed) throw new TaskWriteRefusal(access.statusCode || 404, 'Task not found');
    return stored;
};

/* A new or imported task has no id yet and its body's origin is the client's word, so only its placement counts. */
const attachmentsWritten = (taskSpec, { payload, task }) => {
    if (taskSpec.attachments === 'created') {
        const data = payload.data || {};
        return { task: { ProjectID: data.ProjectID, sprintId: data.sprintId }, actor: payload.user, records: Array.isArray(data.attachments) ? data.attachments : [] };
    }
    if (taskSpec.attachments === 'imported') {
        const rows = Array.isArray(payload.tasks) ? payload.tasks : [];
        const records = rows.flatMap((row) => (isPlainObject(row) && Array.isArray(row.attachments) ? row.attachments : []));
        return { task: { ProjectID: valueAt(payload, ['projectData', '_id']), sprintId: valueAt(payload, ['sprint', 'id']) }, actor: payload.userData, records };
    }
    if (taskSpec.attachments === 'added' && payload.operation === 'add') {
        return { task, actor: payload.userData, records: [payload.data] };
    }
    return null;
};

const refusedKeyReason = (key) => {
    if (taskAttachmentKey(key)) return 'other_task';
    if (formUploadKey(key)) return 'form_upload';
    if (clipKey(key)) return 'clip';
    return 'unknown';
};

const checkAttachmentKeys = async (taskSpec, prepared) => {
    const written = attachmentsWritten(taskSpec, prepared);
    if (!written) return;
    const actorId = written.actor && written.actor.id;
    for (const record of written.records) {
        const key = isPlainObject(record) ? record.url : undefined;
        if (key !== undefined && key !== null && typeof key !== 'string') throw new TaskWriteRefusal(400, 'An attachment url must be text.', ATTACHMENT_KEY_REFUSED);
        if (!(await mayAttachKey(prepared.companyId, written.task, key, actorId))) {
            if (scopeMode() !== REPORT) throw new TaskWriteRefusal(400, 'An attachment can only name a file stored for this task.', ATTACHMENT_KEY_REFUSED);
            const reason = refusedKeyReason(key);
            logger.warn(`attachment write would be refused (reason: ${reason}, reported so far for this reason: ${countReported(`attachment_write:${reason}`)})`);
        }
    }
};

const prepareTaskRequest = async (req, taskSpec, label) => {
    const prepared = prepareTaskWrite(req, taskSpec, label);
    const { companyId: company, payload } = prepared;
    if (taskSpec.actor.length) {
        const actor = await sessionActor(req);
        taskSpec.actor.forEach((name) => { payload[name] = actor; });
    }
    if (taskSpec.task) {
        const taskId = valueAt(payload, taskSpec.task);
        if (typeof taskId !== 'string' || !taskId) refuse(400, `${nameOf(taskSpec.task)} is required.`);
        const stored = await visibleTaskOf(req, company, taskId);
        prepared.task = stored;
        taskSpec.project.forEach((path) => setAt(payload, path, String(stored.ProjectID)));
        taskSpec.taskIds.forEach((path) => setAt(payload, path, String(stored._id)));
        taskSpec.taskNames.forEach((path) => setAt(payload, path, stored.TaskName));
        if (payload.isUpdateTask === false && !(taskSpec.held && taskSpec.held(payload, stored))) refuse(409, 'The task does not hold the change this request records.');
    }
    if (taskSpec.destination) {
        const projectId = valueAt(payload, taskSpec.destination);
        if (typeof projectId !== 'string' || !projectId) refuse(400, `${nameOf(taskSpec.destination)} is required.`);
        if (!(await storedProjectOf(company, projectId))) throw new TaskWriteRefusal(404, 'Project not found');
    }
    await checkAttachmentKeys(taskSpec, prepared);
    return prepared;
};

const sendRefusal = (res, error) => res.status(error.statusCode).send({ status: false, statusText: error.message, ...(error.code ? { code: error.code } : {}) });

const prepareOrRefuse = async (req, res, taskSpec, label) => {
    try {
        return (await prepareTaskRequest(req, taskSpec, label)).payload;
    } catch (error) {
        if (error instanceof TaskWriteRefusal) {
            sendRefusal(res, error);
        } else {
            logger.error(`task write ${printable(label)} could not be prepared: ${error && error.message}`);
            res.status(500).send({ status: false, statusText: 'The request could not be processed.' });
        }
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
    SEARCH_KEYS,
    TASK_ACTION_FIELDS,
    PRE_V2_ACTION_FIELDS,
    TASK_INDEX_FIELDS,
    TASK_INDEX_ONLOAD_FIELDS,
    TaskWriteRefusal,
    taskNotFound,
    escapeText,
    plainIdOf,
    taskFilterOf,
    validatedCompanyOf,
    specFor,
    prepareTaskWrite,
    prepareTaskRequest,
    prepareOrRefuse,
    sessionActor,
    sendFailure,
};
