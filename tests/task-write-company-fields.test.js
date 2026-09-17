const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const logger = require('../Config/loggerConfig');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { TASK_ACTIONS, PRE_V2_TASK_ACTIONS, RELATION_ACTIONS, BODY_COMPANY_PATHS } = require('../Config/taskWritePermissions');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');
const { TASK_ACTION_FIELDS, TASK_INDEX_FIELDS, TASK_INDEX_ONLOAD_FIELDS, prepareTaskWrite } = require('../Modules/Tasks/helpers/taskWriteFields');
const { CID, OTHER_COMPANY, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2, MISSING_TASK } = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const OTHER_TASK = '6f0000000000000000000b09';
const OTHER_PROJECT_ID = PARITY_PROJECT;

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = { ...routesOf('../Modules/Tasks/routes'), ...routesOf('../Modules/taskIndex/routes') };

const call = (route, body, request = {}) => new Promise((resolve) => {
    const companyid = 'companyid' in request ? request.companyid : CID;
    const aud = 'aud' in request ? request.aud : CID;
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1000);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, path] = route.split(' ');
    const req = { method, path, originalUrl: path, headers: companyid === undefined ? {} : { companyid }, aud, uid: OWNER, body };
    try {
        ROUTES[route](req, res, () => { clearTimeout(timer); resolve({ code: 'next' }); });
    } catch (error) {
        clearTimeout(timer);
        resolve({ code: 'threw', error });
    }
}).then(async (result) => { await settle(); return result; });

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0, convertType: { key: 1, value: 'task', name: 'Task' } }];

const taskDoc = (_id, extra = {}) => ({
    _id,
    TaskName: `Task ${_id.slice(-2)}`,
    TaskKey: `PAR-${_id.slice(-1)}`,
    ProjectID: OPEN_PROJECT,
    CompanyId: CID,
    sprintId: SPRINT,
    sprintArray: { id: SPRINT, name: 'Sprint 1', folderName: '' },
    folderObjId: FOLDER,
    status: { key: 1, text: 'To Do', type: 'default_active' },
    statusKey: 1,
    statusType: 'default_active',
    TaskType: 'task',
    TaskTypeKey: 1,
    Task_Priority: 'MEDIUM',
    Task_Leader: OWNER,
    isParentTask: true,
    ParentTaskId: '',
    subTasks: 0,
    deletedStatusKey: 0,
    AssigneeUserId: [],
    watchers: [],
    tagsArray: [],
    attachments: [],
    checklistArray: [],
    favouriteTasks: [],
    queueListArray: [],
    relations: [],
    createdBy: OWNER,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
});

const reset = () => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    logger.warn.mockClear();
    [OPEN_PROJECT, OTHER_PROJECT_ID].forEach((_id) => mockDb.seed('projects', { _id, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST }));
    mockDb.seed('tasks', taskDoc(OPEN_TASK));
    mockDb.seed('tasks', taskDoc(OPEN_TASK_2));
};

beforeEach(reset);

const storedTask = (id = OPEN_TASK) => clone(mockDb.store.tasks.find((task) => String(task._id) === id) || null);
const taskIds = () => (mockDb.store.tasks || []).map((task) => String(task._id)).sort();
const companiesWritten = () => [...new Set(mockDb.calls.map((c) => (typeof c.companyId === 'string' ? c.companyId : JSON.stringify(c.companyId))))];

const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const projectData = () => ({ _id: OPEN_PROJECT, id: OPEN_PROJECT, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 4, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });
const sprintObj = () => ({ id: SPRINT, name: 'Sprint 1', folderId: null });

const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';
const RELATIONS = 'POST /api/v2/tasks/relations';
const PRE_V2 = 'PATCH /api/tasks/';

/* The fixtures name sprints s1 and s2; the handlers cast sprint ids, so they are given real ones here. */
const withSprintIds = (body) => JSON.parse(JSON.stringify(body, (key, value) => ({ s1: SPRINT, s2: OTHER_SPRINT }[value] || value)));

/* One body per dispatchable name; web-app actions use their fixture shape, the rest a shape their handler reads. */
const fixtureBody = (route, action) => {
    const fixture = WEB_APP_BODIES.find((row) => row.route === route && (row.action || null) === (action || null))
        || (action ? WEB_APP_BODIES.find((row) => row.action === action && row.route !== RELATIONS) : null);
    return fixture ? withSprintIds(fixture.body({ taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT, destinationProjectId: OPEN_PROJECT })) : null;
};

const CRAFTED = {
    updateSupportTicket: () => ({ action: 'updateSupportTicket', companyId: CID, taskId: OPEN_TASK, updateObj: { statusKey: 2 } }),
    addTaskRelation: () => ({ action: 'addTaskRelation', companyId: CID, taskId: OPEN_TASK, relatedTaskId: OPEN_TASK_2, type: 'blocks', userData: USER }),
    removeTaskRelation: () => ({ action: 'removeTaskRelation', companyId: CID, taskId: OPEN_TASK, relatedTaskId: OPEN_TASK_2, userData: USER }),
    getTaskRelations: () => ({ action: 'getTaskRelations', companyId: CID, taskId: OPEN_TASK }),
    getOpenBlockers: () => ({ action: 'getOpenBlockers', companyId: CID, taskId: OPEN_TASK }),
    addRelationHistory: () => ({ action: 'addRelationHistory', companyId: CID, task: { _id: OPEN_TASK, ProjectID: OPEN_PROJECT }, otherKey: 'PAR-2', type: 'blocks', userData: USER }),
    removeRelationHistory: () => ({ action: 'removeRelationHistory', companyId: CID, task: { _id: OPEN_TASK, ProjectID: OPEN_PROJECT }, otherKey: 'PAR-2', userData: USER }),
    notifyRelationChange: () => ({ action: 'notifyRelationChange', companyId: CID, task: { _id: OPEN_TASK, ProjectID: OPEN_PROJECT }, userData: USER, message: 'x' }),
    updateTaskKey: () => ({ action: 'updateTaskKey', companyId: CID, projectCode: 'PAR', projectId: OPEN_PROJECT, taskId: OPEN_TASK, taskTypeKey: 1, sprintId: SPRINT, isParentTask: false }),
    updateParentCount: () => ({ action: 'updateParentCount', companyId: CID, taskId: OPEN_TASK }),
    updateTaskIndex: () => ({ action: 'updateTaskIndex', companyId: CID, projectId: OPEN_PROJECT, taskId: OPEN_TASK }),
    findRelationTask: () => ({ action: 'findRelationTask', companyId: CID, taskId: OPEN_TASK }),
    pushRelationEntry: () => ({ action: 'pushRelationEntry', companyId: CID, taskId: OPEN_TASK }),
    pullRelationEntry: () => ({ action: 'pullRelationEntry', companyId: CID, taskId: OPEN_TASK }),
    bulkUpdateStartDate: () => ({ action: 'bulkUpdateStartDate', taskIds: [OPEN_TASK], userData: USER, startDate: '2026-10-01' }),
    bulkRestore: () => ({ action: 'bulkRestore', taskIds: [OPEN_TASK], userData: USER }),
    _bulkArchiveDelete: () => ({ action: '_bulkArchiveDelete', companyId: CID, taskIds: [OPEN_TASK], userData: USER, deletedStatusKey: 2 }),
    bulkDuplicate: () => ({ action: 'bulkDuplicate', taskIds: [OPEN_TASK], userData: USER, projectData: projectData(), sprintObj: sprintObj(), oldProject: projectData(), duplicateData: [], taskName: 'Copy', oldSprintObj: sprintObj() }),
    create: () => {
        const data = taskDoc(OTHER_TASK);
        ['_id', 'createdBy', 'createdAt'].forEach((field) => { delete data[field]; });
        return { action: 'create', data: { ...data, TaskKey: '-', CompanyId: CID }, user: USER, projectData: projectData(), indexObj: {} };
    },
    createMultipleTasks: () => ({ action: 'createMultipleTasks', tasks: [], userData: USER, projectData: projectData(), indexObj: {}, statusArray: [], sprint: { id: SPRINT }, eventId: 'e1' }),
};

const bodyFor = (route, action) => {
    const body = fixtureBody(route, action) || (CRAFTED[action] ? CRAFTED[action]() : null);
    if (!body) throw new Error(`no body for ${route} ${action}`);
    return clone(body);
};

/* Every body field a handler has taken a company from, pointed at another company. */
const naming = (body, company) => {
    const out = clone(body);
    out.companyId = company;
    out.CompanyId = company;
    ['projectData', 'project', 'data'].forEach((key) => {
        if (out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) out[key].CompanyId = company;
    });
    return out;
};

/* Every row has three cells: jest.each hands a shorter row a done callback in place of the missing argument. */
const WRITES = [
    ...Object.keys(TASK_ACTIONS).map((action) => [PATCH, action, null]),
    ...Object.keys(TASK_ACTIONS).filter((action) => action.startsWith('bulk')).map((action) => [BULK, action, null]),
    ...Object.entries(RELATION_ACTIONS).map(([action, entry]) => [RELATIONS, action, entry.method]),
    ...Object.keys(PRE_V2_TASK_ACTIONS).map((action) => [PRE_V2, action, null]),
    ['POST /api/v2/tasks', null, 'create'],
    ['POST /api/tasks', null, 'create'],
    ['PATCH /api/v1/importTasks', null, 'createMultipleTasks'],
    ['POST /api/v1/taskIndex', null, null],
    ['POST /api/v1/updateTaskIndexOnload', null, null],
];

const bodyForWrite = (route, action, method) => {
    const body = fixtureBody(route, action)
        || fixtureBody(route === PRE_V2 ? PATCH : route, action)
        || (CRAFTED[method || action] ? CRAFTED[method || action]() : null);
    if (!body) throw new Error(`no body for ${route} ${action}`);
    return { ...clone(body), ...(action ? { action } : {}) };
};

const REFUSED = [400, 403];

describe('every task write takes its company from the validated request', () => {
    test.each(WRITES)('%s %s: a body naming another company writes to the validated company only, or is refused', async (route, action, method) => {
        const result = await call(route, naming(bodyForWrite(route, action, method), OTHER_COMPANY));
        expect(result.code).not.toBe('threw');
        const written = companiesWritten();
        expect({ route, action, written: written.filter((company) => company !== CID) }).toEqual({ route, action, written: [] });
        if (!REFUSED.includes(result.code)) expect(result.code).toBe(200);
    });

    const SPEC_OF_WRITE = (route, action, method) => {
        if (route === PRE_V2 || route === PATCH || route === BULK) return TASK_ACTION_FIELDS[action];
        if (route === RELATIONS || route.endsWith('/tasks') || route.includes('importTasks')) return TASK_ACTION_FIELDS[method];
        return route.includes('Onload') ? TASK_INDEX_ONLOAD_FIELDS : TASK_INDEX_FIELDS;
    };

    test.each(WRITES.filter(([route, action, method]) => SPEC_OF_WRITE(route, action, method)))('%s %s: the payload a handler receives names only the validated company', (route, action, method) => {
        const { payload } = prepareTaskWrite({ headers: { companyid: CID }, aud: CID, body: naming(bodyForWrite(route, action, method), OTHER_COMPANY) }, SPEC_OF_WRITE(route, action, method), 'company paths');
        const named = BODY_COMPANY_PATHS.map((path) => path.reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), payload)).filter((value) => value !== undefined);
        expect(named.filter((value) => value !== CID)).toEqual([]);
    });

    test.each([
        ['no companyid header', { companyid: undefined }],
        ['a header that is not an id', { companyid: 'not-a-company' }],
        ['a header outside the token audience', { companyid: CID, aud: OTHER_COMPANY }],
        ['no audience at all', { companyid: CID, aud: undefined }],
    ])('refuses with 400 and writes nothing when there is %s', async (_, request) => {
        for (const [route, action, method] of WRITES.filter(([route]) => !route.includes('taskIndex') && !route.includes('Onload'))) {
            mockDb.calls.length = 0;
            const result = await call(route, bodyForWrite(route, action, method), request);
            expect({ route, action, code: result.code, calls: mockDb.calls.length }).toEqual({ route, action, code: 400, calls: 0 });
        }
    });

    test('a web-app body naming the validated company is served there', async () => {
        const result = await call(PATCH, bodyFor(PATCH, 'updatePriority'));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().Task_Priority).toBe('HIGH');
        expect(companiesWritten()).toEqual([CID]);
    });
});

const PROTECTED = {
    _id: OTHER_TASK,
    CompanyId: OTHER_COMPANY,
    ProjectID: OTHER_PROJECT_ID,
    TaskKey: 'ZZZ-9',
    createdBy: MEMBER,
    createdAt: '2001-01-01T00:00:00.000Z',
    sprintId: OTHER_SPRINT,
    sprintArray: { id: OTHER_SPRINT, name: 'Elsewhere' },
    folderObjId: '6f0000000000000000000f02',
};

/* The actions whose handler copies a body object into the task update, with that object as the web app sends it. */
const COPIED_OBJECTS = [
    [PATCH, 'updateStatus', 'newStatus'],
    [PATCH, 'updatePriority', 'firebaseObj'],
    [PATCH, 'updateDueDate', 'firebaseObj'],
    [PATCH, 'updateStartDate', 'firebaseObj'],
    [PATCH, 'updateStartDateAndDueDate', 'firebaseObj'],
    [PATCH, 'updateTaskName', 'firebaseObj'],
    [PATCH, 'updateTaskTotalEstimate', 'firebaseObj'],
    [PATCH, 'updatePoints', 'firebaseObj'],
    [PATCH, 'updateTaskType', 'newStatus'],
    [PATCH, 'updateSupportTicket', 'updateObj'],
    [PATCH, 'bulkUpdateStatus', 'newStatus'],
    [BULK, 'bulkUpdateStatus', 'newStatus'],
    [BULK, 'bulkUpdatePriority', 'firebaseObj'],
    [PRE_V2, 'updateStatus', 'newStatus'],
    [PRE_V2, 'updatePriority', 'firebaseObj'],
    [PRE_V2, 'updateTaskName', 'firebaseObj'],
    ['POST /api/v1/taskIndex', '', 'updateData'],
];

const withCopied = (route, action, key, extra) => {
    const body = bodyForWrite(route, action);
    if (route === PRE_V2) {
        body.prevStatus = { ...(body.prevStatus || {}), taskId: OPEN_TASK };
        body.priorityObj = { ...(body.priorityObj || {}), taskId: OPEN_TASK };
        body.task = { ...(body.task || {}), sprintArray: { id: SPRINT } };
        body.taskData = { ...(body.taskData || {}), sprintArray: { id: SPRINT } };
    }
    body[key] = { ...(body[key] || {}), ...extra };
    return body;
};

const unchanged = async (route, body) => {
    const before = storedTask();
    const ids = taskIds();
    const result = await call(route, body);
    return { result, same: JSON.stringify(storedTask()) === JSON.stringify(before) && JSON.stringify(taskIds()) === JSON.stringify(ids) };
};

describe('an action changes only the fields it is built to change', () => {
    describe.each(COPIED_OBJECTS)('%s %s (%s)', (route, action, key) => {
        test.each(Object.keys(PROTECTED))('a body setting %s is refused with 400 and the stored task is unchanged', async (field) => {
            const { result, same } = await unchanged(route, withCopied(route, action, key, { [field]: PROTECTED[field] }));
            expect(result.code).toBe(400);
            expect(result.body).toMatchObject({ status: false });
            expect(same).toBe(true);
        });

        test.each([
            ['$rename of a protected field', { $rename: { ProjectID: 'formerProject' } }],
            ['$unset of a protected field', { $unset: { sprintId: 1 } }],
            ['$set nested inside the object', { $set: { ProjectID: OTHER_PROJECT_ID } }],
            ['a dotted path into a protected field', { 'sprintArray.name': 'Elsewhere' }],
            ['a dotted path into the task key', { 'TaskKey.0': 'Z' }],
            ['a prototype key', JSON.parse('{"__proto__": {"ProjectID": "6f0000000000000000000a03"}}')],
            ['a constructor key', { constructor: { prototype: { ProjectID: OTHER_PROJECT_ID } } }],
        ])('%s is refused with 400 and the stored task is unchanged', async (_, extra) => {
            const body = withCopied(route, action, key, {});
            Object.keys(extra).forEach((name) => { Object.defineProperty(body[key], name, { value: extra[name], enumerable: true, configurable: true, writable: true }); });
            const { result, same } = await unchanged(route, body);
            expect(result.code).toBe(400);
            expect(same).toBe(true);
        });
    });

    test.each([
        [PATCH, 'updatePriority', 'firebaseObj', 'Task_Priority', 'HIGH'],
        [PATCH, 'updateTaskName', 'firebaseObj', 'TaskName', 'Renamed'],
        [PATCH, 'updatePoints', 'firebaseObj', 'points', 3],
        [BULK, 'bulkUpdatePriority', 'firebaseObj', 'Task_Priority', 'HIGH'],
    ])('%s %s drops an unknown field from %s and still writes %s', async (route, action, key, field, value) => {
        const body = withCopied(route, action, key, { mood: 'sunny', 'status.text': 'Done' });
        const result = await call(route, body);
        expect(result.code).toBe(200);
        const stored = storedTask();
        expect(stored[field]).toEqual(value);
        expect(stored).not.toHaveProperty('mood');
        expect(stored.status).toEqual(taskDoc(OPEN_TASK).status);
    });

    test('unknown fields are logged once per action, not on every request', () => {
        jest.isolateModules(() => {
            const freshLogger = require('../Config/loggerConfig');
            const fields = require('../Modules/Tasks/helpers/taskWriteFields');
            const request = (extra) => ({ headers: { companyid: CID }, aud: CID, body: { ...bodyFor(PATCH, 'updateTaskName'), ...extra } });
            const first = fields.prepareTaskWrite(request({ mood: 'sunny' }), fields.TASK_ACTION_FIELDS.updateTaskName, 'updateTaskName');
            const second = fields.prepareTaskWrite(request({ mood: 'sunny', colour: 'blue' }), fields.TASK_ACTION_FIELDS.updateTaskName, 'updateTaskName');
            fields.prepareTaskWrite(request({ mood: 'sunny' }), fields.TASK_ACTION_FIELDS.updatePoints, 'updatePoints');
            expect([first.dropped, second.dropped]).toEqual([['mood'], ['mood', 'colour']]);
            const lines = freshLogger.warn.mock.calls.map(([line]) => String(line));
            expect(lines.filter((line) => line.includes('updateTaskName'))).toHaveLength(1);
            expect(lines.filter((line) => line.includes('updatePoints'))).toHaveLength(1);
            expect(lines[0]).toContain('mood');
        });
    });

    test('a top-level operator key is refused', async () => {
        const body = bodyFor(PATCH, 'updateTaskName');
        body.$set = { ProjectID: OTHER_PROJECT_ID };
        const { result, same } = await unchanged(PATCH, body);
        expect(result.code).toBe(400);
        expect(same).toBe(true);
    });

    test.each([
        ['updateTaskKey', CRAFTED.updateTaskKey],
        ['updateParentCount', CRAFTED.updateParentCount],
        ['_bulkArchiveDelete', CRAFTED._bulkArchiveDelete],
        ['notifyRelationChange', CRAFTED.notifyRelationChange],
        ['hasOwnProperty', () => ({ action: 'hasOwnProperty', companyId: CID })],
        ['constructor', () => ({ action: 'constructor', companyId: CID })],
    ])('%s is not a request action: 400, and nothing is written', async (_, body) => {
        const { result, same } = await unchanged(PATCH, body());
        expect(result.code).toBe(400);
        expect(same).toBe(true);
    });

    test.each([
        ['a protected index name', { indexName: 'TaskKey' }],
        ['a field that is not an index', { indexName: 'TaskName' }],
    ])('the list and board reorder refuses %s', async (_, extra) => {
        const { result, same } = await unchanged('POST /api/v1/taskIndex', { ...bodyForWrite('POST /api/v1/taskIndex', null), ...extra });
        expect(result.code).toBe(400);
        expect(same).toBe(true);
    });

    test('the onload index refuses an index name that is not an index', async () => {
        const body = bodyForWrite('POST /api/v1/updateTaskIndexOnload', null);
        body.taskUpdate.item.indexName = 'ProjectID';
        const { result, same } = await unchanged('POST /api/v1/updateTaskIndexOnload', body);
        expect(result.code).toBe(400);
        expect(same).toBe(true);
    });

    test.each([
        ['a task created with a chosen _id', { _id: OTHER_TASK }, null],
        ['a task created with createdBy', { createdBy: MEMBER }, null],
        ['a task created with createdAt', { createdAt: '2001-01-01T00:00:00.000Z' }, null],
        ['an index name that is a protected field', null, { indexName: 'TaskKey', searchKey: 'statusKey', searchValue: 1 }],
    ])('create refuses %s', async (_, data, indexObj) => {
        const body = CRAFTED.create();
        if (data) Object.assign(body.data, data);
        if (indexObj) body.indexObj = indexObj;
        const { result, same } = await unchanged('POST /api/v2/tasks', body);
        expect(result.code).toBe(400);
        expect(same).toBe(true);
    });

    test('create keeps the placement it is built to set and the validated company', async () => {
        const body = CRAFTED.create();
        body.data.CompanyId = OTHER_COMPANY;
        body.projectData.CompanyId = OTHER_COMPANY;
        const result = await call('POST /api/v2/tasks', body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        const created = mockDb.store.tasks.find((task) => String(task._id) === String(result.body.id));
        expect(String(created.CompanyId)).toBe(CID);
        expect(String(created.ProjectID)).toBe(OPEN_PROJECT);
        expect(companiesWritten()).toEqual([CID]);
    });
});

describe('an update never creates the task it names', () => {
    test.each([
        ['updateWatcher', { taskId: MISSING_TASK }],
        ['updateTags', { taskId: MISSING_TASK }],
        ['updateAttachments', { taskId: MISSING_TASK }],
        ['convertToList', { taskId: MISSING_TASK }],
    ])('%s on a missing task answers 404 and creates nothing', async (action, ids) => {
        const before = taskIds();
        const result = await call(PATCH, { ...bodyFor(PATCH, action), ...ids });
        expect(result.code).toBe(404);
        expect(result.body).toMatchObject({ status: false });
        expect(taskIds()).toEqual(before);
        expect(mockDb.calls.filter((c) => c.data && c.data[2] && c.data[2].upsert)).toEqual([]);
    });

    test.each([['updateWatcher'], ['updateTags'], ['updateAttachments'], ['convertToList']])('%s on an existing task still writes it', async (action) => {
        const result = await call(PATCH, bodyFor(PATCH, action));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(mockDb.calls.filter((c) => c.data && c.data[2] && c.data[2].upsert)).toEqual([]);
    });
});

/* Masks the ids and times a run generates, so two runs of the same body compare equal. */
const SEEDED = new Set([OPEN_TASK, OPEN_TASK_2, OPEN_PROJECT, OTHER_PROJECT_ID, MEMBER, OWNER, CID, SPRINT, FOLDER]);
const normalise = (value) => JSON.parse(JSON.stringify(value, (key, v) => {
    if (typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) && !SEEDED.has(v) && !v.startsWith('6f')) return '<generated>';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !v.startsWith('2026-01-01') && !v.startsWith('2026-10-01')) return '<time>';
    if (['lastMessage', 'updatedAt'].includes(key)) return '<time>';
    return v;
}));
const taskWrites = () => normalise(mockDb.calls
    .filter((c) => c.type === 'tasks' && !['find', 'findOne', 'aggregate', 'countDocuments'].includes(c.method))
    .map(({ companyId, method, data }) => ({ companyId, method, data })))
    .map((row) => JSON.stringify(row))
    .sort();

/* What beta's routes handed the handler for the same body. */
const directly = async (route, body) => {
    if (route === BULK) return taskMongo[body.action]({ ...body, companyId: CID });
    if (route === RELATIONS) return taskMongo[RELATION_ACTIONS[body.action].method]({ ...body, companyId: CID });
    if (route === 'POST /api/v2/tasks') return taskMongo.create(body);
    if (route === 'PATCH /api/v1/importTasks') return taskMongo.createMultipleTasks(body);
    return taskMongo[body.action](body);
};

const TASK_ROUTES = [PATCH, BULK, RELATIONS, 'POST /api/v2/tasks', 'PATCH /api/v1/importTasks'];

const specOfRow = (row) => ({
    [PATCH]: () => TASK_ACTION_FIELDS[row.action],
    [BULK]: () => TASK_ACTION_FIELDS[row.action],
    [RELATIONS]: () => TASK_ACTION_FIELDS[RELATION_ACTIONS[row.action].method],
    'POST /api/v2/tasks': () => TASK_ACTION_FIELDS.create,
    'PATCH /api/v1/importTasks': () => TASK_ACTION_FIELDS.createMultipleTasks,
    'POST /api/v1/taskIndex': () => TASK_INDEX_FIELDS,
    'POST /api/v1/updateTaskIndexOnload': () => TASK_INDEX_ONLOAD_FIELDS,
}[row.route]());

/* The fixtures abbreviate a few bodies; these fill in what the web app also sends, so every one runs to success. */
const COMPLETE = {
    'POST /api/v2/tasks': (body) => ({ ...body, data: { ...body.data, TaskKey: '--', TaskType: 'task', TaskTypeKey: 1, CompanyId: CID, status: { text: 'To Do', key: 1, type: 'default_active' }, statusKey: 1, statusType: 'default_active', isParentTask: true, ParentTaskId: '', Task_Leader: MEMBER, Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintArray: { id: SPRINT, name: 'Sprint 1' }, AssigneeUserId: [], watchers: [], dueDateDeadLine: [] } }),
    updateDueDate: (body) => ({ ...body, firebaseObj: { ...body.firebaseObj, dueDateDeadLine: [{ date: 1 }] } }),
    updateStartDateAndDueDate: (body) => ({ ...body, firebaseObj: { ...body.firebaseObj, dueDateDeadLine: [{ date: 2 }] } }),
    'Comments.vue add a checklist item from a message': (body) => ({ ...body, data: [body.data] }),
};
const completed = (row, body) => (COMPLETE[row.source] || COMPLETE[row.action] || COMPLETE[row.route] || ((b) => b))(body);

const linkTasks = () => {
    const link = (task, other, type) => { mockDb.store.tasks.find((t) => t._id === task).relations = [{ taskId: other, type, createdBy: OWNER }]; };
    link(OPEN_TASK, OPEN_TASK_2, 'blocks');
    link(OPEN_TASK_2, OPEN_TASK, 'blocked_by');
};

describe('every web-app body is served as before', () => {
    const rows = WEB_APP_BODIES.map((row) => [`${row.route}${row.action ? ` ${row.action}` : ''} (${row.source})`, row]);

    test.each(rows)('%s', async (_, row) => {
        const ids = { taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT, destinationProjectId: OPEN_PROJECT };
        const body = completed(row, withSprintIds(row.body(ids)));
        const before = row.action === 'remove' ? linkTasks : () => {};

        const prepared = prepareTaskWrite({ headers: { companyid: CID }, aud: CID, body: clone(body) }, specOfRow(row), 'web app');
        expect(prepared.dropped).toEqual([]);

        before();
        const result = await call(row.route, clone(body));
        expect(result.code).toBe(200);
        expect(result.body.status).not.toBe(false);
        if (!TASK_ROUTES.includes(row.route)) return;

        const served = { status: result.body.status, writes: taskWrites(), tasks: normalise(mockDb.store.tasks) };

        reset();
        before();
        let direct;
        try {
            direct = await Promise.race([directly(row.route, clone(body)), new Promise((resolve) => setTimeout(() => resolve('no answer'), 1000))]);
        } catch (error) {
            direct = { status: false };
        }
        await settle();
        const wrapped = direct && direct.status === false ? false : true;
        expect(served).toEqual({ status: row.route === RELATIONS ? direct.status : wrapped, writes: taskWrites(), tasks: normalise(mockDb.store.tasks) });
    });
});
