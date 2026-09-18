const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });
const mockHooks = { rejectWhen: null };

// Mongoose treats an update without operators as a $set; fakeMongo only applies operators.
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        if (mockHooks.rejectWhen && mockHooks.rejectWhen(companyId, q, method)) {
            mockHooks.rejectWhen = null;
            return Promise.reject(new Error('database unavailable'));
        }
        const [filter, update, ...rest] = Array.isArray(q.data) ? q.data : [];
        const plain = method === 'findOneAndUpdate' && update && !Object.keys(update).some((k) => k.startsWith('$'));
        return mockDb.crud(companyId, plain ? { ...q, data: [filter, { $set: update }, ...rest] } : q, method);
    },
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

const mongoose = require('mongoose');
const logger = require('../Config/loggerConfig');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const { updateSprintFun } = require('../Modules/Sprints/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { TASK_ACTIONS } = require('../Config/taskWritePermissions');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');
const { TASK_ACTION_FIELDS, PRE_V2_ACTION_FIELDS, TASK_INDEX_FIELDS, TASK_INDEX_ONLOAD_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');
const { CID, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2, MISSING_TASK } = require('./fixtures/taskWriteGuard');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const OTHER_PROJECT = PARITY_PROJECT;
const OWNER_NAME = 'Olivia <Owner> & "co"';
const OWNER_SHOWN = 'Olivia &lt;Owner&gt; &amp; &quot;co&quot;';
const HTML = '<img src=x onerror=alert(1)>';

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const setAt = (target, [key, ...rest], value) => {
    if (!rest.length) { target[key] = value; return; }
    if (target[key] === undefined || target[key] === null || typeof target[key] !== 'object') target[key] = {};
    setAt(target[key], rest, value);
};

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = { ...routesOf('../Modules/Tasks/routes'), ...routesOf('../Modules/taskIndex/routes') };

const call = (route, body, request = {}) => new Promise((resolve) => {
    const uid = 'uid' in request ? request.uid : OWNER;
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1500);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, path] = route.split(' ');
    const req = { method, path, originalUrl: path, headers: { companyid: CID }, aud: CID, uid, body };
    try {
        ROUTES[route](req, res, () => { clearTimeout(timer); resolve({ code: 'next' }); });
    } catch (error) {
        clearTimeout(timer);
        resolve({ code: 'threw', error });
    }
}).then(async (result) => { await settle(); return result; });

const STATUS_LIST = [
    { key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } },
    { key: 3, name: 'Done', type: 'close', convertStatus: { key: 3, name: 'Done', type: 'close' } },
];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0, convertType: { key: 1, value: 'task', name: 'Task' } }];

const taskDoc = (_id, extra = {}) => ({
    _id,
    TaskName: `Task ${_id.slice(-2)}`,
    TaskKey: `PAR-${_id.slice(-1)}`,
    ProjectID: OPEN_PROJECT,
    CompanyId: CID,
    sprintId: SPRINT,
    sprintArray: { id: SPRINT, name: 'Sprint 1', folderName: '' },
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
    mockHooks.rejectWhen = null;
    logger.warn.mockClear();
    HandleBothNotification.mockClear();
    updateSprintFun.mockClear();
    [OPEN_PROJECT, OTHER_PROJECT].forEach((_id) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: OWNER_NAME });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(OPEN_TASK));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(OPEN_TASK_2));
};

beforeEach(reset);

const storedTask = (id = OPEN_TASK) => clone(mockDb.store[SCHEMA_TYPE.TASKS].find((task) => String(task._id) === id) || null);
const snapshot = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.TASKS]);
const historyRows = () => clone(mockDb.store[SCHEMA_TYPE.HISTORY] || []);
const notifications = () => HandleBothNotification.mock.calls.map(([args]) => args);
const writes = () => mockDb.calls.filter((c) => !['find', 'findOne', 'aggregate', 'countDocuments'].includes(c.method));

const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const projectData = (id = OPEN_PROJECT) => ({ _id: id, id, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 4, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });

const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';
const RELATIONS = 'POST /api/v2/tasks/relations';
const PRE_V2 = 'PATCH /api/tasks/';
const INDEX = 'POST /api/v1/taskIndex';
const ONLOAD = 'POST /api/v1/updateTaskIndexOnload';

const withSprintIds = (body) => JSON.parse(JSON.stringify(body, (key, value) => ({ s1: SPRINT, s2: OTHER_SPRINT }[value] || value)));

const CRAFTED = {
    openBlockers: () => ({ action: 'openBlockers', taskId: OPEN_TASK }),
    bulkUpdateStartDate: () => ({ action: 'bulkUpdateStartDate', taskIds: [OPEN_TASK], userData: USER, startDate: '2026-10-01' }),
    bulkRestore: () => ({ action: 'bulkRestore', taskIds: [OPEN_TASK], userData: USER }),
    bulkDuplicate: () => ({ action: 'bulkDuplicate', taskIds: [OPEN_TASK], userData: USER, projectData: projectData(), sprintObj: { id: SPRINT, name: 'Sprint 1', folderId: null }, oldProject: projectData(), duplicateData: [], taskName: 'Copy', oldSprintObj: { id: SPRINT } }),
};

const fixtureOf = (route, action) => WEB_APP_BODIES.find((row) => row.route === route && (row.action || null) === (action || null))
    || (action ? WEB_APP_BODIES.find((row) => row.action === action && row.route !== RELATIONS) : null);

/* The fixtures abbreviate the display data a few handlers read after the write; history needs it. */
const COMPLETE = {
    updatePriority: (body) => ({ ...body, priorityObj: { taskId: OPEN_TASK, taskName: 'Task 01', priorityName: 'MEDIUM', newPriorityName: 'HIGH' } }),
    updateAttachments: (body) => ({ ...body, taskData: { ...body.taskData, TaskName: 'Task 01', sprintId: SPRINT }, data: { id: 'a1', filename: 'a.txt' } }),
};

/* Where each dispatchable method is reached from: create and the import have their own routes, relations their own action names. */
const routeOf = (method) => ({
    create: ['POST /api/v2/tasks', null],
    createMultipleTasks: ['PATCH /api/v1/importTasks', null],
    addTaskRelation: [RELATIONS, 'add'],
    removeTaskRelation: [RELATIONS, 'remove'],
    getTaskRelations: [RELATIONS, 'list'],
    getOpenBlockers: [RELATIONS, 'openBlockers'],
}[method] || [method.startsWith('bulk') ? BULK : PATCH, method]);

const bodyFor = (route, action) => {
    const fixture = fixtureOf(route === PRE_V2 ? PATCH : route, action);
    const body = fixture
        ? withSprintIds(fixture.body({ taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT, destinationProjectId: OPEN_PROJECT }))
        : (CRAFTED[action] ? CRAFTED[action]() : null);
    if (!body) throw new Error(`no body for ${route} ${action}`);
    if (COMPLETE[action]) Object.assign(body, COMPLETE[action](body));
    if (route === PRE_V2) {
        body.prevStatus = { ...(body.prevStatus || {}), taskId: OPEN_TASK };
        body.priorityObj = { ...(body.priorityObj || {}), taskId: OPEN_TASK };
        body.task = { ...(body.task || {}), sprintArray: { id: SPRINT } };
        body.taskData = { ...(body.taskData || {}), sprintArray: { id: SPRINT } };
    }
    return { ...clone(body), ...(action ? { action } : {}) };
};

const indexBody = (taskId = OPEN_TASK, extra = {}) => ({ ...bodyFor(INDEX, null), taskId, ...extra });
const onloadBody = (taskId = OPEN_TASK) => ({ ...bodyFor(ONLOAD, null), taskUpdate: { ...bodyFor(ONLOAD, null).taskUpdate, data: taskId } });

const refused = async (route, body) => {
    const before = snapshot();
    const result = await call(route, body);
    expect(result.code).toBe(400);
    expect(result.body).toMatchObject({ status: false });
    expect(snapshot()).toBe(before);
    expect(writes()).toEqual([]);
    return result;
};

describe('the index routes validate every value a reorder puts in a query', () => {
    test('a list drag writes the group index', async () => {
        const result = await call(INDEX, indexBody());
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().groupByStatusIndex).toEqual(expect.any(Number));
    });

    test('a board load backfills a missing index, including the unassigned column', async () => {
        const first = await call(ONLOAD, onloadBody());
        expect(first).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().groupByStatusIndex).toBe(0);

        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK_2).groupByAssigneeIndex = 5;
        const body = onloadBody();
        body.taskUpdate.item = { indexName: 'groupByAssigneeIndex', searchKey: 'AssigneeUserId', searchValue: '[]' };
        const unassigned = await call(ONLOAD, body);
        expect(unassigned).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().groupByAssigneeIndex).toBe(5 + 65536);
    });

    test.each([
        ['a search key that is an operator', { searchKey: '$expr' }],
        ['a search key that is not a group field', { searchKey: 'TaskName' }],
        ['a search key that is an object', { searchKey: { $function: 'return true' } }],
        ['a search value that is an operator object', { relevantKey: { $ne: null } }],
        ['a search value that runs code', { relevantKey: { $function: { body: 'function() { return true; }', args: [], lang: 'js' } } }],
        ['a search value starting with $', { relevantKey: '$statusKey' }],
        ['a task key that is an operator object', { taskKey: { $ne: null } }],
        ['an index that is not a number', { relevantIndex: '2' }],
        ['an index that is an operator object', { relevantIndex: { $gt: 0 } }],
        ['a task id that is an operator object', { taskId: { $ne: null } }],
        ['a project id that is an operator object', { projectId: { $ne: null } }],
    ])('the list drag refuses %s', async (_, extra) => {
        await refused(INDEX, indexBody(OPEN_TASK, extra));
        expect(mockDb.calls.filter((c) => c.method === 'aggregate')).toEqual([]);
    });

    test.each([
        ['a search key that is an operator', (body) => { body.taskUpdate.item.searchKey = '$where'; }],
        ['a search key that is not a group field', (body) => { body.taskUpdate.item.searchKey = 'ProjectID'; }],
        ['a search value that is an operator object', (body) => { body.taskUpdate.item.searchValue = { $ne: null }; }],
        ['an item that is not an object', (body) => { body.taskUpdate.item = 'groupByStatusIndex'; }],
        ['a task update that is not an object', (body) => { body.taskUpdate = 'x'; }],
        ['a task id that is an operator object', (body) => { body.taskUpdate.data = { $ne: null }; }],
    ])('the board load refuses %s', async (_, change) => {
        const body = onloadBody();
        change(body);
        await refused(ONLOAD, body);
        expect(mockDb.calls.filter((c) => c.method === 'aggregate')).toEqual([]);
    });

    test.each([[INDEX, () => indexBody(MISSING_TASK)], [ONLOAD, () => onloadBody(MISSING_TASK)]])('%s answers 404 for a missing task', async (route, body) => {
        const result = await call(route, body());
        expect(result.code).toBe(404);
        expect(result.body).toMatchObject({ status: false });
        expect(writes()).toEqual([]);
    });

    test('a drag that fails does not stall the project\'s queue', async () => {
        mockHooks.rejectWhen = (companyId, q, method) => method === 'aggregate';
        const failed = await call(INDEX, indexBody(OPEN_TASK));
        expect(failed.code).toBe(200);
        expect(storedTask(OPEN_TASK).groupByStatusIndex).toBeUndefined();

        const next = await call(INDEX, indexBody(OPEN_TASK_2, { taskKey: 'PAR-2' }));
        expect(next.code).toBe(200);
        expect(storedTask(OPEN_TASK_2).groupByStatusIndex).toEqual(expect.any(Number));
    });
});

describe('an id in value position names one task', () => {
    const NAMED = [
        [PATCH, 'moveTask', ['moveTaskId']],
        [PATCH, 'convertToSubTask', ['taskId']],
        [PATCH, 'convertToSubTask', ['selectedTaskId']],
        [PATCH, 'updateAssignee', ['taskData', '_id']],
        [PATCH, 'updateTaskLeader', ['taskData', '_id']],
        [PATCH, 'updateStatus', ['task', '_id']],
        [PATCH, 'updateStatus', ['prevStatus', 'taskId']],
        [PATCH, 'updateWatcher', ['taskId']],
        [PATCH, 'updateWatcher', ['userId']],
        [PATCH, 'updateArchiveDelete', ['task', '_id']],
        [PATCH, 'updateArchiveDelete', ['task', 'ParentTaskId']],
        [PATCH, 'updateMarkAsFavourite', ['updateDetail']],
        [RELATIONS, 'add', ['relatedTaskId']],
        [BULK, 'bulkArchive', ['taskIds', 0]],
        [BULK, 'bulkConvertToSubTask', ['parentTaskId']],
        [PRE_V2, 'updatePriority', ['priorityObj', 'taskId']],
        [INDEX, null, ['taskId']],
        [ONLOAD, null, ['taskUpdate', 'data']],
    ];
    const SHAPES = [
        ['an operator object', { $ne: null }],
        ['an $in list', { $in: [OPEN_TASK, OPEN_TASK_2] }],
        ['a list of ids', [OPEN_TASK, OPEN_TASK_2]],
        ['a string that is not an id', 'not-an-id'],
    ];

    describe.each(NAMED)('%s %s %s', (route, action, path) => {
        test.each(SHAPES)('refuses %s and changes nothing', async (_, shape) => {
            const body = bodyFor(route, action);
            setAt(body, path, shape);
            await refused(route, body);
        });
    });

    const everyIdPath = () => {
        const rows = [];
        Object.entries(TASK_ACTION_FIELDS).forEach(([method, spec]) => {
            const [route, action] = routeOf(method);
            spec.ids.forEach((path) => rows.push([route, action, path.map((key) => (key === '*' ? 0 : key))]));
        });
        return rows;
    };

    test.each(everyIdPath())('%s %s: an operator object at %j is refused', async (route, action, path) => {
        const body = bodyFor(route, action);
        setAt(body, path, { $ne: null });
        await refused(route, body);
    });

    test('a lone { id } resolves to the id it names', async () => {
        const body = { ...bodyFor(PATCH, 'updateTags'), taskId: { id: OPEN_TASK } };
        const result = await call(PATCH, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().tagsArray).toEqual(['tag-1']);
    });

    test.each([
        ['a priority that is an operator object', PATCH, 'updatePriority', (body) => { body.firebaseObj.Task_Priority = { $ne: null }; }],
        ['an assignee removal by condition', PATCH, 'updateAssignee', (body) => { body.type = 'assigneRemove'; body.firebaseObj.AssigneeUserId = { $ne: null }; }],
        ['a watcher removal by condition', PATCH, 'updateWatcher', (body) => { body.add = false; body.userId = { $ne: null }; }],
        ['a tag removal by condition', PATCH, 'updateTags', (body) => { body.operation = 'remove'; body.tagId = { $in: ['tag-1'] }; }],
        ['an attachment removal by condition', PATCH, 'updateAttachments', (body) => { body.operation = 'remove'; body.data = { id: { $ne: null } }; }],
        ['a favourite removal by condition', PATCH, 'updateMarkAsFavourite', (body) => { body.type = 'remove'; body.updateDetail = { $ne: null }; }],
        ['an operator nested three levels down', PATCH, 'updateDescription', (body) => { body.text.blocks = [{ data: { $where: '1' } }]; }],
        ['a due date that is an operator object', BULK, 'bulkUpdateDueDate', (body) => { body.DueDate = { $ne: null }; }],
    ])('%s is refused and changes nothing', async (_, route, action, change) => {
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).AssigneeUserId = [MEMBER];
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).watchers = [MEMBER, OWNER];
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).attachments = [{ id: 'a1', filename: 'a.txt' }];
        const body = bodyFor(route, action);
        change(body);
        await refused(route, body);
    });
});

describe('the actor is the signed-in user', () => {
    const spoofed = () => ({ id: MEMBER, Employee_Name: HTML, companyOwnerId: MEMBER });

    test('history and notifications carry the session user, with the name escaped', async () => {
        const result = await call(PATCH, { ...bodyFor(PATCH, 'updatePriority'), userData: spoofed() });
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        const [row] = historyRows();
        expect(row).toMatchObject({ UserId: OWNER, TaskId: OPEN_TASK });
        expect(row.Message).toContain(OWNER_SHOWN);
        expect(row.Message).not.toContain('<img');
        expect(row.Message).not.toContain('<Owner>');
        expect(notifications()).toHaveLength(1);
        expect(notifications()[0].userData).toEqual({ id: OWNER, Employee_Name: OWNER_SHOWN });
    });

    test('a rename names the session user, not the userName the body sends', async () => {
        const body = bodyFor(PATCH, 'updateTaskName');
        body.obj.userName = '<b>evil</b>';
        body.userData = spoofed();
        await call(PATCH, body);
        const [row] = historyRows();
        expect(row.UserId).toBe(OWNER);
        expect(row.Message).toContain(OWNER_SHOWN);
        expect(row.Message).not.toContain('evil');
    });

    test('a completion records the session user', async () => {
        const body = bodyFor(PATCH, 'updateStatus');
        body.newStatus = { status: { key: 3, text: 'Done', type: 'close' }, statusKey: 3, statusType: 'close' };
        body.userData = spoofed();
        const result = await call(PATCH, body);
        expect(result.code).toBe(200);
        expect(storedTask().completion.closedBy).toMatchObject({ actorId: OWNER, actorType: 'human' });
    });

    test('a relation is created by the session user', async () => {
        const result = await call(RELATIONS, { ...bodyFor(RELATIONS, 'add'), userData: spoofed() });
        expect(result.code).toBe(200);
        expect(storedTask().relations).toEqual([expect.objectContaining({ createdBy: OWNER })]);
        expect(storedTask(OPEN_TASK_2).relations).toEqual([expect.objectContaining({ createdBy: OWNER })]);
    });

    test('a checklist entry records the session user and escapes what was typed', async () => {
        const body = bodyFor(PATCH, 'updateChecklists');
        body.data = [{ id: 'c1', name: '<script>x</script>' }];
        body.historyObj = { userId: MEMBER, Employee_Name: HTML, name: '<script>x</script>' };
        const result = await call(PATCH, body);
        expect(result.code).toBe(200);
        const [row] = historyRows();
        expect(row.UserId).toBe(OWNER);
        expect(row.Message).toContain(OWNER_SHOWN);
        expect(row.Message).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(row.Message).not.toContain('<script>');
        expect(row.Message).not.toContain('<img');
    });

    test.each([
        [PATCH, 'updateAssignee', 'Assignee'],
        [PATCH, 'updateTaskLeader', 'Created by'],
        [PATCH, 'updateWatcher', 'Watcher'],
        [BULK, 'bulkUpdateAssignee', 'Assignee'],
    ])('%s %s escapes the employee name it is given', async (route, action, label) => {
        const body = { ...bodyFor(route, action), employeeName: '<b onmouseover=alert(1)>Max</b>' };
        const result = await call(route, body);
        expect(result.code).toBe(200);
        const rows = historyRows();
        const shown = '&lt;b onmouseover=alert&#40;1&#41;&gt;Max&lt;/b&gt;';
        expect(rows.some((row) => row.Message.includes(label) && row.Message.includes(shown))).toBe(true);
        rows.forEach((row) => expect(row.Message).not.toMatch(/<b onmouseover|&amp;lt;/));
        notifications().forEach((sent) => expect(sent.object.message).not.toMatch(/<b onmouseover|&amp;lt;/));
    });

    test('a queue entry names the stored task, not the name the body sends', async () => {
        const result = await call(PATCH, { ...bodyFor(PATCH, 'updateQueueList'), taskName: '<script>alert(1)</script>' });
        expect(result.code).toBe(200);
        const [row] = historyRows();
        expect(row.Message).toContain('Task 01');
        expect(row.Message).not.toContain('<script>');
    });

    test('a user the directory no longer lists is still recorded by id', async () => {
        mockDb.store[SCHEMA_TYPE.USERS].length = 0;
        const result = await call(PATCH, bodyFor(PATCH, 'updatePriority'));
        expect(result.code).toBe(200);
        const [row] = historyRows();
        expect(row.UserId).toBe(OWNER);
        expect(row.Message).toContain('Unknown user');
    });

    test('a request without a signed-in user is refused and writes nothing', async () => {
        const result = await call(PATCH, bodyFor(PATCH, 'updatePriority'), { uid: undefined });
        expect(result.code).toBe(401);
        expect(writes()).toEqual([]);
    });
});

describe('history and notifications go to the stored task\'s project', () => {
    test.each([
        ['updatePriority', (body) => { body.projectData = projectData(OTHER_PROJECT); }],
        ['updateWatcher', (body) => { body.projectId = OTHER_PROJECT; }],
        ['updateDueDate', (body) => { body.project = projectData(OTHER_PROJECT); body.firebaseObj.dueDateDeadLine = [{ date: 1 }]; }],
        ['updateAttachments', (body) => { body.projectData = projectData(OTHER_PROJECT); }],
        ['updateTaskName', (body) => { body.projectData = projectData(OTHER_PROJECT); }],
    ])('%s with a body naming another project', async (action, change) => {
        const body = bodyFor(PATCH, action);
        change(body);
        const result = await call(PATCH, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        historyRows().forEach((row) => expect(row.ProjectId).toBe(OPEN_PROJECT));
        expect(historyRows().length).toBeGreaterThan(0);
        notifications().forEach((sent) => expect(sent.projectId).toBe(OPEN_PROJECT));
    });

    test('a move still writes into the project it is sent to', async () => {
        const body = bodyFor(PATCH, 'moveTask');
        body.projectData = { id: OTHER_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' };
        body.oldProject = { id: OPEN_PROJECT, ProjectName: 'Parity', taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST };
        const result = await call(PATCH, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(String(storedTask().ProjectID)).toBe(OTHER_PROJECT);
        expect(historyRows().map((row) => row.ProjectId)).toEqual([OTHER_PROJECT]);
    });
});

describe('archive, delete and restore count from the stored task', () => {
    const archiveBody = (task, deletedStatusKey, extra = {}) => ({
        action: 'updateArchiveDelete', companyId: CID, projectData: projectData(), sprintId: SPRINT, userData: USER, deletedStatusKey,
        task: { _id: OPEN_TASK, ProjectID: OPEN_PROJECT, sprintId: SPRINT, deletedStatusKey: 0, ...task }, ...extra,
    });
    const sprintCount = () => updateSprintFun.mock.calls.map(([args]) => args);

    test('a claimed subtask count and parent do not move the counts', async () => {
        const result = await call(PATCH, archiveBody({ isParentTask: true, subTasks: 99, ParentTaskId: OPEN_TASK_2 }, 2));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().deletedStatusKey).toBe(2);
        expect(sprintCount()).toEqual([expect.objectContaining({ body: expect.objectContaining({ projectId: OPEN_PROJECT, updateObject: { $inc: { archiveTaskCount: 1, tasks: -1 } } }), params: { id: SPRINT } })]);
        expect(storedTask(OPEN_TASK_2).subTasks).toBe(0);
    });

    test('a stored subtask moves its real parent\'s count even when the body hides the parent', async () => {
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).isParentTask = false;
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).ParentTaskId = OPEN_TASK_2;
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK_2).subTasks = 1;
        const result = await call(PATCH, archiveBody({ isParentTask: true, ParentTaskId: '', subTasks: 0 }, 2));
        expect(result.code).toBe(200);
        expect(storedTask(OPEN_TASK_2).subTasks).toBe(0);
        expect(sprintCount()[0].body.updateObject).toEqual({ $inc: { archiveTaskCount: 1, tasks: -1 } });
    });

    test('deleting an archived task adjusts the archive count, whatever state the body claims', async () => {
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).deletedStatusKey = 2;
        const result = await call(PATCH, archiveBody({ deletedStatusKey: 0 }, 1));
        expect(result.code).toBe(200);
        expect(sprintCount()[0].body.updateObject).toEqual({ $inc: { archiveTaskCount: -1 } });
    });

    test('the sprint and project come from the stored task', async () => {
        const result = await call(PATCH, archiveBody({ sprintId: OTHER_SPRINT }, 2, { sprintId: OTHER_SPRINT, projectData: projectData(OTHER_PROJECT) }));
        expect(result.code).toBe(200);
        expect(sprintCount()[0]).toMatchObject({ body: { projectId: OPEN_PROJECT }, params: { id: SPRINT } });
        historyRows().forEach((row) => expect(row.ProjectId).toBe(OPEN_PROJECT));
    });

    test.each([[3], ['2'], [{ $gt: 0 }]])('a state of %j is refused', async (deletedStatusKey) => {
        await refused(PATCH, archiveBody({}, deletedStatusKey));
    });

    test('the bulk path hands the handler a stored row, whose id is an ObjectId', async () => {
        const stored = { ...storedTask(), _id: new mongoose.Types.ObjectId(OPEN_TASK) };
        const result = await taskMongo.updateArchiveDelete({ companyId: CID, projectData: projectData(), task: stored, userData: USER, deletedStatusKey: 2 });
        expect(result).toMatchObject({ status: true });
        expect(storedTask().deletedStatusKey).toBe(2);
    });
});

describe('every route answers a missing task', () => {
    const missingRows = () => {
        const rows = [];
        Object.entries(TASK_ACTION_FIELDS).filter(([, spec]) => spec.task).forEach(([method, spec]) => rows.push([...routeOf(method), spec.task]));
        Object.entries(PRE_V2_ACTION_FIELDS).filter(([, spec]) => spec.task).forEach(([action, spec]) => rows.push([PRE_V2, action, spec.task]));
        rows.push([INDEX, null, TASK_INDEX_FIELDS.task], [ONLOAD, null, TASK_INDEX_ONLOAD_FIELDS.task]);
        return rows;
    };

    test.each(missingRows())('%s %s answers 404 when %j names no task', async (route, action, path) => {
        const body = bodyFor(route, action);
        setAt(body, path, MISSING_TASK);
        const result = await call(route, body);
        expect(result.code).toBe(404);
        expect(result.body).toMatchObject({ status: false });
        expect(writes()).toEqual([]);
    });

    test.each([
        ['updateAssignee', () => ({ ...bodyFor(PATCH, 'updateAssignee'), taskData: { _id: MISSING_TASK, TaskName: 'T', sprintId: SPRINT, AssigneeUserId: [] } })],
        ['updateTaskLeader', () => ({ ...bodyFor(PATCH, 'updateTaskLeader'), taskData: { _id: MISSING_TASK, sprintId: SPRINT } })],
        ['updateChecklists', () => ({ ...bodyFor(PATCH, 'updateChecklists'), taskId: MISSING_TASK, userData: USER })],
        ['updateArchiveDelete', () => ({ ...bodyFor(PATCH, 'updateArchiveDelete'), task: { _id: MISSING_TASK } })],
        ['moveTask', () => ({ ...bodyFor(PATCH, 'moveTask'), moveTaskId: MISSING_TASK })],
        ['convertToSubTask', () => ({ ...bodyFor(PATCH, 'convertToSubTask'), selectedTaskId: MISSING_TASK })],
        ['updateQueueList', () => ({ ...bodyFor(PATCH, 'updateQueueList'), taskId: MISSING_TASK })],
        ['updateDescription', () => ({ ...bodyFor(PATCH, 'updateDescription'), task: { _id: MISSING_TASK } })],
    ])('%s called directly rejects with 404 rather than hanging', async (action, body) => {
        const outcome = await Promise.race([
            taskMongo[action](body()).then(() => 'resolved', (error) => error),
            new Promise((resolve) => setTimeout(() => resolve('hung'), 1500)),
        ]);
        expect(outcome).toMatchObject({ statusCode: 404 });
    });
});

describe('checklist item ids are plain ids', () => {
    const checklistBody = (operation, data, historyObj) => ({ ...bodyFor(PATCH, 'updateChecklists'), operation, data, historyObj });

    beforeEach(() => {
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === OPEN_TASK).checklistArray = [{ id: 'c1', name: 'Item', AssigneeUserId: [] }, { id: 'c2', name: 'Other', AssigneeUserId: [] }];
    });

    test.each([
        ['an edit by condition', 'checklistedit', [], { updatedId: { $ne: null }, newName: 'x', previousName: 'Item' }],
        ['an assignment by condition', 'checklistassignee', [], { updateCheckListId: { $exists: true }, assigneeId: MEMBER, type: 'add', label: 'Max', checkList: 'Item' }],
        ['an assignee that is an operator object', 'checklistassignee', [], { updateCheckListId: 'c1', assigneeId: { $ne: null }, type: 'add', label: 'Max', checkList: 'Item' }],
        ['a removal that is not a list', 'checklistremove', { $ne: null }, { name: 'Item', extractedData: { name: 'Item', subItemNames: ['Item'] } }],
        ['a removal listing a condition', 'checklistremove', [{ $ne: null }], { name: 'Item', extractedData: { name: 'Item', subItemNames: ['Item'] } }],
        ['a removal listing an object', 'checklistremove', [{ id: 'c1' }], { name: 'Item', extractedData: { name: 'Item', subItemNames: ['Item'] } }],
    ])('%s is refused and the checklist is unchanged', async (_, operation, data, historyObj) => {
        await refused(PATCH, checklistBody(operation, data, historyObj));
    });

    test('a plain item id is edited', async () => {
        const result = await call(PATCH, checklistBody('checklistedit', [], { updatedId: 'c1', newName: 'Renamed', previousName: 'Item' }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(writes()).toEqual([expect.objectContaining({ method: 'findOneAndUpdate', data: [{ _id: expect.anything() }, { $set: { 'checklistArray.$[elem].name': 'Renamed' } }, expect.objectContaining({ arrayFilters: [{ 'elem.id': 'c1' }] })] }), expect.objectContaining({ type: SCHEMA_TYPE.HISTORY })]);
    });

    test('plain item ids are removed', async () => {
        const result = await call(PATCH, checklistBody('checklistremove', ['c1'], { name: 'Item', extractedData: { name: 'Item', subItemNames: ['Item'] } }));
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(writes()[0].data[1]).toEqual({ $pull: { checklistArray: { id: { $in: ['c1'] } } } });
    });
});

describe('dropped fields are logged once a minute per action, with printable names', () => {
    test('the log repeats after a minute and never carries control characters', () => {
        jest.isolateModules(() => {
            const freshLogger = require('../Config/loggerConfig');
            const fields = require('../Modules/Tasks/helpers/taskWriteFields');
            const now = jest.spyOn(Date, 'now');
            const request = (extra) => ({ headers: { companyid: CID }, aud: CID, body: { ...bodyFor(PATCH, 'updatePoints'), ...extra } });
            const prepare = (extra) => fields.prepareTaskWrite(request(extra), fields.TASK_ACTION_FIELDS.updatePoints, 'updatePoints');
            const lines = () => freshLogger.warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('updatePoints'));

            now.mockReturnValue(1_000_000);
            const odd = `mood [31m${'x'.repeat(200)}`;
            prepare({ [odd]: 1 });
            prepare({ mood: 'sunny' });
            expect(lines()).toHaveLength(1);
            expect([...lines()[0]].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)).toBe(false);
            expect(lines()[0]).not.toContain('x'.repeat(61));
            expect(lines()[0]).toContain('mood');

            now.mockReturnValue(1_000_000 + 59_000);
            prepare({ mood: 'sunny' });
            expect(lines()).toHaveLength(1);

            now.mockReturnValue(1_000_000 + 61_000);
            prepare({ mood: 'sunny' });
            expect(lines()).toHaveLength(2);
            now.mockRestore();
        });
    });
});

describe('the routes and handlers nothing calls are gone', () => {
    test('the pre-v2 create route is not registered', () => {
        expect(ROUTES['POST /api/tasks']).toBeUndefined();
    });

    test('updateSupportTicket is neither a handler nor an action', async () => {
        expect(taskMongo.updateSupportTicket).toBeUndefined();
        expect(TASK_ACTIONS.updateSupportTicket).toBeUndefined();
        await refused(PATCH, { action: 'updateSupportTicket', companyId: CID, taskId: OPEN_TASK, updateObj: { statusKey: 2 } });
    });
});

describe('an index object must be an object', () => {
    test.each([
        ['a string', 'groupByStatusIndex'],
        ['a list', ['groupByStatusIndex']],
        ['a number', 1],
    ])('create refuses an indexObj that is %s', async (_, indexObj) => {
        const before = mockDb.store[SCHEMA_TYPE.TASKS].length;
        const result = await call('POST /api/v2/tasks', { ...bodyFor('POST /api/v2/tasks', null), indexObj });
        expect(result.code).toBe(400);
        expect(mockDb.store[SCHEMA_TYPE.TASKS]).toHaveLength(before);
    });

    test('the import refuses an indexObj that is a string', async () => {
        const result = await call('PATCH /api/v1/importTasks', { ...bodyFor('PATCH /api/v1/importTasks', null), indexObj: 'groupByStatusIndex' });
        expect(result.code).toBe(400);
    });
});

const emptyIdWrites = () => writes().filter((c) => c.type === SCHEMA_TYPE.TASKS && c.data && c.data[0] && typeof c.data[0] === 'object' && Object.hasOwn(c.data[0], '_id') && [undefined, null, ''].includes(c.data[0]._id));

describe('a write must name its task', () => {
    const PRIVATE_PROJECT = '6f0000000000000000000a09';
    const HIDDEN_TASK = '6f0000000000000000000b0a';
    const ORPHAN_TASK = '6f0000000000000000000b0b';

    test('a list drag without a task id changes no task and sends no empty filter', async () => {
        const before = snapshot();
        const body = indexBody(OPEN_TASK, { updateData: { Task_Priority: 'HIGH' } });
        delete body.taskId;
        const result = await call(INDEX, body);
        expect(result.code).toBe(400);
        expect(result.body).toMatchObject({ status: false });
        expect(snapshot()).toBe(before);
        expect(emptyIdWrites()).toEqual([]);
        expect(writes()).toEqual([]);
    });

    test.each([['null', null], ['an empty string', ''], ['a blank string', '  ']])('a list drag whose task id is %s is refused', async (_, taskId) => {
        await refused(INDEX, indexBody(taskId, { updateData: { Task_Priority: 'HIGH' } }));
    });

    test.each([['relevantKey'], ['searchKey'], ['taskKey'], ['relevantIndex'], ['updateData']])('a list drag without %s is answered once and never queued', async (field) => {
        const body = indexBody(OPEN_TASK, { updateData: { Task_Priority: 'HIGH' } });
        delete body[field];
        await refused(INDEX, body);
        expect(mockDb.calls.filter((c) => c.method === 'aggregate')).toEqual([]);
    });

    test('a board load without a task id is refused', async () => {
        const body = onloadBody();
        delete body.taskUpdate.data;
        await refused(ONLOAD, body);
    });

    const requiredRows = () => {
        const rows = [];
        Object.entries(TASK_ACTION_FIELDS).filter(([, spec]) => spec.task).forEach(([method, spec]) => rows.push([...routeOf(method), spec.task]));
        Object.entries(PRE_V2_ACTION_FIELDS).filter(([, spec]) => spec.task).forEach(([action, spec]) => rows.push([PRE_V2, action, spec.task]));
        return rows;
    };

    test.each(requiredRows())('%s %s without %j is refused with 400', async (route, action, path) => {
        const body = bodyFor(route, action);
        const parent = path.slice(0, -1).reduce((node, key) => node[key], body);
        delete parent[path[path.length - 1]];
        await refused(route, body);
    });

    test('a task in a private space the caller is not assigned to answers 404', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Hidden', ProjectCode: 'HID', CompanyId: CID, isPrivateSpace: true, AssigneeUserId: [OWNER], lastTaskId: 1, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST });
        mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(HIDDEN_TASK, { ProjectID: PRIVATE_PROJECT }));
        const body = { ...bodyFor(PATCH, 'updatePriority'), taskData: { _id: HIDDEN_TASK, sprintId: SPRINT } };

        const asMember = await call(PATCH, clone(body), { uid: MEMBER });
        expect(asMember.code).toBe(404);
        expect(asMember.body).toMatchObject({ status: false });
        expect(storedTask(HIDDEN_TASK).Task_Priority).toBe('MEDIUM');
        expect(writes()).toEqual([]);

        const asOwner = await call(PATCH, clone(body));
        expect(asOwner).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask(HIDDEN_TASK).Task_Priority).toBe('HIGH');
    });

    test('a task whose project is gone answers 404', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(ORPHAN_TASK, { ProjectID: '6f0000000000000000000aee' }));
        const result = await call(PATCH, { ...bodyFor(PATCH, 'updatePriority'), taskData: { _id: ORPHAN_TASK, sprintId: SPRINT } });
        expect(result.code).toBe(404);
        expect(writes()).toEqual([]);
    });
});

describe('history and notifications follow the written task', () => {
    const CLOSE = { status: { key: 3, text: '<i>Done</i>', type: 'close' }, statusKey: 3, statusType: 'close' };
    const SHOWN = '&lt;b onmouseover=alert&#40;1&#41;&gt;Done&lt;/b&gt;';

    test('a status change records the task it wrote, whatever prevStatus names', async () => {
        const body = bodyFor(PATCH, 'updateStatus');
        body.newStatus = CLOSE;
        body.prevStatus = { taskId: OPEN_TASK_2, taskName: 'somebody else', statusName: 'To Do', name: 'To Do', updatedTaskName: '<b onmouseover=alert(1)>Done</b>', backColor: '"><script>' };
        const result = await call(PATCH, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().statusKey).toBe(3);
        expect(storedTask(OPEN_TASK_2).statusKey).toBe(1);
        const rows = historyRows();
        expect(rows.map((row) => row.TaskId)).toEqual([OPEN_TASK]);
        expect(rows[0].Message).toContain(SHOWN);
        expect(rows[0].Message).not.toContain('<b onmouseover');
        expect(notifications().map((sent) => sent.taskId)).toEqual([OPEN_TASK]);
        const sent = notifications()[0].object.message;
        expect(sent).toContain('Task 01');
        expect(sent).not.toContain('<i>Done</i>');
        expect(sent).not.toContain('"><script>');
    });

    test('a priority change records the task it wrote, whatever priorityObj names', async () => {
        const body = bodyFor(PATCH, 'updatePriority');
        body.priorityObj = { taskId: OPEN_TASK_2, taskName: 'somebody else', priorityName: 'MEDIUM', newPriorityName: '<img src=x onerror=alert(1)>', statusImage: '" onerror="alert(1)' };
        const result = await call(PATCH, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().Task_Priority).toBe('HIGH');
        expect(storedTask(OPEN_TASK_2).Task_Priority).toBe('MEDIUM');
        const rows = historyRows();
        expect(rows.map((row) => row.TaskId)).toEqual([OPEN_TASK]);
        expect(rows[0].Message).toContain('&lt;img src=x onerror=alert&#40;1&#41;&gt;');
        expect(rows[0].Message).not.toContain('<img');
        expect(notifications().map((sent) => sent.taskId)).toEqual([OPEN_TASK]);
        const sent = notifications()[0].object.message;
        expect(sent).toContain('Task 01');
        expect(sent).not.toContain('<img src=x');
        expect(sent).not.toContain('" onerror="');
    });

    test('the pre-v2 status route records the task it wrote', async () => {
        const body = bodyFor(PRE_V2, 'updateStatus');
        body.newStatus = CLOSE;
        body.task = { _id: OPEN_TASK_2, sprintArray: { id: SPRINT } };
        body.prevStatus = { taskId: OPEN_TASK, taskName: 'somebody else', statusName: 'To Do', name: 'To Do', updatedTaskName: '<b onmouseover=alert(1)>Done</b>' };
        const result = await call(PRE_V2, body);
        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(storedTask().statusKey).toBe(3);
        expect(storedTask(OPEN_TASK_2).statusKey).toBe(1);
        expect(historyRows().map((row) => row.TaskId)).toEqual([OPEN_TASK]);
        expect(historyRows()[0].Message).toContain(SHOWN);
    });

    test.each([['updateStatus'], ['updatePriority'], ['updateAssignee'], ['updateDueDate'], ['updateTaskLeader'], ['updateTaskType']])('%s asking for history without a write is refused', async (action) => {
        await refused(PATCH, { ...bodyFor(PATCH, action), isUpdateTask: false });
        expect(historyRows()).toEqual([]);
        expect(notifications()).toEqual([]);
    });
});

describe('a move or copy needs its destination project', () => {
    const MISSING_PROJECT = '6f0000000000000000000aff';
    const MOVES = [[PATCH, 'moveTask'], [PATCH, 'duplicateTask'], [PATCH, 'convertToTask'], [PATCH, 'convertToList'], [BULK, 'bulkMove'], [BULK, 'bulkConvertToTask'], [BULK, 'bulkDuplicate']];

    test.each(MOVES)('%s %s into a project that does not exist answers 404 and changes nothing', async (route, action) => {
        const body = bodyFor(route, action);
        body.projectData = { ...(body.projectData || {}), id: MISSING_PROJECT };
        const before = snapshot();
        const result = await call(route, body);
        expect(result.code).toBe(404);
        expect(result.body).toMatchObject({ status: false });
        expect(snapshot()).toBe(before);
        expect(writes()).toEqual([]);
    });

    test.each(MOVES)('%s %s without a destination is refused', async (route, action) => {
        const body = bodyFor(route, action);
        delete body.projectData.id;
        await refused(route, body);
    });
});
