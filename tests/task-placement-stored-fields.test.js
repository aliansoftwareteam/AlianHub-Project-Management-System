/* A task keeps four things of the list it is in: the list's id and name and, for a list in a folder, the
   folder's id and name. A writer may be handed the whole stored list, with its people, counters and the
   flags a picker sets; none of that is stored. Stored forms are read from what Mongoose hands the driver
   under the real task schema; fakeMongo shows what a handler wrote before the schema saw it. */
process.env.STORAGE_TYPE = 'server';

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

const { driverWrites, sprintArraysIn } = require('./fixtures/realTaskStore');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');
const { CID, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2 } = require('./fixtures/taskWriteGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { TASK_ACTION_FIELDS, TaskWriteRefusal, prepareTaskWrite } = require('../Modules/Tasks/helpers/taskWriteFields');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const TASK_ID = '6f0000000000000000000b09';
const SUB_TASK = '6f0000000000000000000b0a';
const KEPT = ['id', 'name', 'folderId', 'folderName'];

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

/* A list as GET sprints answers it, with what the pickers and the older writers add. */
const wholeList = (extra = {}) => ({
    _id: OTHER_SPRINT, id: OTHER_SPRINT, name: 'Sprint 2', value: 'SPRINT_2', projectId: OPEN_PROJECT, tasks: 4, archiveTaskCount: 1, private: true,
    deletedStatusKey: 0, AssigneeUserId: [OWNER, MEMBER], watchers: { [OWNER]: 'all' }, favouriteTasks: [{ userId: OWNER }], legacyId: 'legacy-1',
    isScrum: false, isBacklog: false, goal: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    isDuplicateSprint: true, isTaskExpanded: true, folderId: FOLDER, folderName: 'Design', ...extra,
});
const PLACED = { id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER, folderName: 'Design' };

const taskDoc = (extra = {}) => ({
    TaskName: 'Write the brief', TaskKey: 'PAR-9', TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, Task_Leader: OWNER, sprintArray: wholeList(),
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: OTHER_SPRINT, statusType: 'default_active', statusKey: 1, ...extra,
});

const storedElements = async (method, args) => {
    const { writes } = await driverWrites(method, args);
    return sprintArraysIn(writes.map((write) => write.args));
};

describe('what the task schema stores of a list', () => {
    test.each([
        ['save', 'save', () => taskDoc()],
        ['insertMany', 'insertMany', () => [[taskDoc()]]],
        ['updateOne with $set', 'updateOne', () => [{ _id: TASK_ID }, { $set: { sprintArray: wholeList() } }]],
        ['updateOne with a bare update', 'updateOne', () => [{ _id: TASK_ID }, { sprintArray: wholeList() }]],
        ['updateMany', 'updateMany', () => [{ sprintId: SPRINT }, { $set: { sprintArray: wholeList() } }]],
        ['findOneAndUpdate with an upsert', 'findOneAndUpdate', () => [{ _id: TASK_ID }, { $set: { sprintArray: wholeList() } }, { new: true, upsert: true }]],
        ['bulkWrite', 'bulkWrite', () => [[{ insertOne: { document: taskDoc() } }, { updateOne: { filter: { _id: TASK_ID }, update: { $set: { sprintArray: wholeList() } } } }]]],
        ['replaceOne', 'replaceOne', () => [{ _id: TASK_ID }, taskDoc()]],
    ])('%s keeps the id, the name and the folder of a whole list and nothing else', async (_, method, args) => {
        const stored = await storedElements(method, args());

        expect(stored.length).toBeGreaterThan(0);
        stored.forEach((el) => expect(clone(el)).toEqual(PLACED));
    });

    test('a list at the project root is its id and name', async () => {
        const [el] = await storedElements('save', taskDoc({ sprintArray: wholeList({ folderId: undefined, folderName: undefined }) }));

        expect(clone(el)).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2' });
    });

    test('a stored list that names itself by _id alone is stored under id', async () => {
        const { id, ...document } = wholeList();
        const [el] = await storedElements('save', taskDoc({ sprintArray: document }));

        expect(id).toBe(OTHER_SPRINT);
        expect(clone(el)).toEqual(PLACED);
    });

    test('a value that is not an object is stored as sent', async () => {
        const [el] = await storedElements('save', taskDoc({ sprintArray: [] }));

        expect(el).toEqual([]);
    });
});

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const call = (routes, route, body) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1000);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, routePath] = route.split(' ');
    const req = { method, path: routePath, originalUrl: routePath, headers: { companyid: CID }, aud: CID, uid: OWNER, body };
    try {
        routes[route](req, res, () => { clearTimeout(timer); resolve({ code: 'next' }); });
    } catch (error) {
        clearTimeout(timer);
        resolve({ code: 'threw', error });
    }
}).then(async (result) => { await settle(); return result; });

const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';
const CREATE = 'POST /api/v2/tasks';
const IMPORT = 'PATCH /api/v1/importTasks';
const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0, convertType: { key: 1, value: 'task', name: 'Task' } }];
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const projectData = () => ({ _id: OPEN_PROJECT, id: OPEN_PROJECT, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 4, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });

/* Tasks as an older release left them, the whole list on each, so a writer that copies a stored element is covered. */
const storedTaskDoc = (_id) => ({
    ...taskDoc({ TaskName: `Task ${_id.slice(-2)}`, TaskKey: `PAR-${_id.slice(-1)}`, sprintId: SPRINT, sprintArray: wholeList({ _id: SPRINT, id: SPRINT, name: 'Sprint 1' }) }),
    _id, folderObjId: FOLDER, ParentTaskId: '', subTasks: 0, AssigneeUserId: [], watchers: [], tagsArray: [], attachments: [], checklistArray: [],
    relations: [], createdBy: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
});

const withIds = (body) => JSON.parse(JSON.stringify(body, (key, value) => {
    if (key === 'folderId' && value === null) return FOLDER;
    return { s1: SPRINT, s2: OTHER_SPRINT }[value] || value;
}));
const fixture = (route, action) => {
    const row = WEB_APP_BODIES.find((r) => r.route === route && r.action === action) || WEB_APP_BODIES.find((r) => r.action === action);
    return withIds(row.body({ taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT, destinationProjectId: OPEN_PROJECT }));
};
const placedInWholeList = (route, action, extra = {}) => () => ({ ...fixture(route, action), ...extra, sprintObj: wholeList() });

const createBody = () => {
    const data = storedTaskDoc(TASK_ID);
    ['_id', 'createdBy', 'createdAt'].forEach((field) => { delete data[field]; });
    return { action: 'create', data: { ...data, TaskKey: '-', sprintId: OTHER_SPRINT, sprintArray: wholeList() }, user: USER, projectData: projectData(), indexObj: {} };
};
const importBody = () => ({ tasks: [{ TaskName: 'Imported', status: 'To Do', Task_Leader: OWNER }], userData: USER, projectData: projectData(), indexObj: {}, statusArray: STATUS_LIST, sprint: wholeList(), eventId: 'e1' });
const bulkDuplicateBody = () => ({ action: 'bulkDuplicate', taskIds: [OPEN_TASK], userData: USER, projectData: projectData(), sprintObj: wholeList(), oldProject: projectData(), duplicateData: [], taskName: 'Copy', oldSprintObj: { name: 'Sprint 1' } });

/* The list a task lands in comes from the request. */
const PLACED_FROM_THE_BODY = [
    [CREATE, 'create', createBody],
    [PATCH, 'createSubTaskWithAi', placedInWholeList(PATCH, 'createSubTaskWithAi', { type: 'task', parentTask: { ProjectID: OPEN_PROJECT } })],
    [PATCH, 'convertToTask', placedInWholeList(PATCH, 'convertToTask')],
    [PATCH, 'moveTask', placedInWholeList(PATCH, 'moveTask')],
    [PATCH, 'duplicateTask', placedInWholeList(PATCH, 'duplicateTask')],
    [BULK, 'bulkMove', placedInWholeList(BULK, 'bulkMove')],
    [BULK, 'bulkConvertToTask', placedInWholeList(BULK, 'bulkConvertToTask', { taskIds: [SUB_TASK] })],
    [BULK, 'bulkDuplicate', bulkDuplicateBody],
];
/* The list comes from a stored task, from the stored list an import names or from the list the action creates. */
const PLACED_FROM_STORED_DATA = [
    [IMPORT, 'createMultipleTasks', importBody],
    [PATCH, 'createSubTaskWithAi', placedInWholeList(PATCH, 'createSubTaskWithAi')],
    [PATCH, 'convertToSubTask', () => fixture(PATCH, 'convertToSubTask')],
    [PATCH, 'convertToList', () => ({ ...fixture(PATCH, 'convertToList'), isSubTask: true, sprintObj: wholeList({ _id: SPRINT, id: SPRINT }), folderData: { folderId: FOLDER, name: 'Design', sprintsObj: { [SPRINT]: wholeList() } } })],
    [PATCH, 'mergeTask', () => ({ ...fixture(PATCH, 'mergeTask'), isSubTask: true })],
    [BULK, 'bulkConvertToSubTask', () => fixture(BULK, 'bulkConvertToSubTask')],
];

const ROUTES = { ...routesOf('../Modules/Tasks/routes'), ...routesOf('../Modules/taskIndex/routes') };
const PLACING = ['save', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'bulkWrite', 'replaceOne'];

const send = (route, action, body) => call(ROUTES, route, { ...clone(body()), ...(route === PATCH || route === BULK ? { action } : {}) });
const taskWrites = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && PLACING.includes(c.method));
const storedByTheSchema = async () => {
    const stored = [];
    for (const write of taskWrites()) {
        const replays = write.method === 'insertMany' ? write.data[0].map((doc) => ['save', doc]) : [[write.method, write.data]];
        for (const [method, data] of replays) stored.push(...await storedElements(method, data));
    }
    return stored.filter((el) => !Array.isArray(el));
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    [OPEN_PROJECT, PARITY_PROJECT].forEach((_id) => mockDb.seed('projects', { _id, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, folderId: FOLDER });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: FOLDER, name: 'Design' });
    require('../Modules/Sprints/controller').addSprintFun.mockResolvedValue({ status: true, data: { _id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER, folderName: 'Design' } });
    mockDb.seed('tasks', storedTaskDoc(OPEN_TASK));
    mockDb.seed('tasks', { ...storedTaskDoc(OPEN_TASK_2), sprintId: OTHER_SPRINT, sprintArray: wholeList() });
    mockDb.seed('tasks', { ...storedTaskDoc(SUB_TASK), isParentTask: false, ParentTaskId: OPEN_TASK });
});

describe('a task write that is sent a whole list', () => {
    test.each(PLACED_FROM_THE_BODY)('%s %s hands its handler the four fields', async (route, action, body) => {
        const result = await send(route, action, body);

        expect(result.code).not.toBe('threw');
        const written = sprintArraysIn(taskWrites().map((write) => write.data)).filter((el) => Object.keys(el).length > 1);
        expect({ action, wroteAList: written.length > 0 }).toEqual({ action, wroteAList: true });
        written.forEach((el) => expect(clone(el)).toEqual(PLACED));
    });

    test.each([...PLACED_FROM_THE_BODY, ...PLACED_FROM_STORED_DATA])('%s %s stores nothing of a list but its id, name and folder', async (route, action, body) => {
        const result = await send(route, action, body);

        expect(result.code).not.toBe('threw');
        const stored = await storedByTheSchema();
        expect({ action, storedAList: stored.length > 0 }).toEqual({ action, storedAList: true });
        expect([...new Set(stored.flatMap((el) => Object.keys(el)))].filter((key) => !KEPT.includes(key))).toEqual([]);
    });
});

describe('the list a task write names', () => {
    const prepared = (action, body) => prepareTaskWrite({ headers: { companyid: CID }, aud: CID, uid: OWNER, body: { action, companyId: CID, ...body } }, TASK_ACTION_FIELDS[action], action).payload;
    const refusal = (action, body) => {
        try {
            prepared(action, body);
        } catch (error) {
            return error instanceof TaskWriteRefusal ? { code: error.statusCode, message: error.message } : error;
        }
        return null;
    };

    test('is read from id or, for a stored list, from _id', () => {
        expect(prepared('moveTask', { sprintObj: { _id: OTHER_SPRINT, name: 'Sprint 2', tasks: 4 } }).sprintObj).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2' });
        expect(prepared('moveTask', { sprintObj: wholeList({ _id: SPRINT }) }).sprintObj).toEqual(PLACED);
    });

    test('carries a folder name only with a folder id', () => {
        expect(prepared('bulkMove', { taskIds: [OPEN_TASK], sprintObj: { id: OTHER_SPRINT, name: 'Sprint 2', folderId: '', folderName: 'Design' } }).sprintObj).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2', folderId: '' });
        expect(prepared('bulkMove', { taskIds: [OPEN_TASK], sprintObj: { id: OTHER_SPRINT, name: 'Sprint 2', folderId: null, tasks: 4 } }).sprintObj).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2', folderId: null });
        expect(prepared('bulkMove', { taskIds: [OPEN_TASK], sprintObj: { id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER } }).sprintObj).toEqual({ id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER });
    });

    test('is left for the handler to refuse when none is sent', () => {
        expect(prepared('bulkMove', { taskIds: [OPEN_TASK] })).not.toHaveProperty('sprintObj');
        expect(prepared('bulkMove', { taskIds: [OPEN_TASK], sprintObj: null }).sprintObj).toBeNull();
    });

    test('has names cut to 255 characters', () => {
        const long = 'n'.repeat(400);

        const placed = prepared('duplicateTask', { sprintObj: { id: OTHER_SPRINT, name: long, folderId: FOLDER, folderName: long } }).sprintObj;

        expect([placed.name.length, placed.folderName.length]).toEqual([255, 255]);
    });

    test.each([
        ['a list that is not an object', { sprintObj: [wholeList()] }, 'sprintObj must be an object.'],
        ['an id that is not text', { sprintObj: { id: { toString: 'x' }, name: 'Sprint 2' } }, 'sprintObj.id must be an id.'],
        ['an id longer than an id', { sprintObj: { id: 'a'.repeat(65), name: 'Sprint 2' } }, 'sprintObj.id must be an id.'],
        ['a folder id that is not text', { sprintObj: { id: OTHER_SPRINT, name: 'Sprint 2', folderId: 7 } }, 'sprintObj.folderId must be an id.'],
        ['a name that is not text', { sprintObj: { id: OTHER_SPRINT, name: ['Sprint 2'] } }, 'sprintObj.name must be text.'],
        ['a folder name that is not text', { sprintObj: { id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER, folderName: { a: 1 } } }, 'sprintObj.folderName must be text.'],
    ])('is refused for %s', (_label, body, message) => {
        expect(refusal('moveTask', body)).toEqual({ code: 400, message });
    });

    test('on a new task is narrowed where the task carries it', () => {
        const { data } = prepared('create', { data: { TaskName: 'New', sprintId: OTHER_SPRINT, sprintArray: wholeList() }, user: USER, projectData: projectData(), indexObj: {} });

        expect(data.sprintArray).toEqual(PLACED);
        expect(refusal('create', { data: { TaskName: 'New', sprintArray: 'Sprint 2' } })).toEqual({ code: 400, message: 'data.sprintArray must be an object.' });
    });

    test('on an import is narrowed too', () => {
        const body = importBody();
        const { sprint } = prepareTaskWrite({ headers: { companyid: CID }, aud: CID, uid: OWNER, body }, TASK_ACTION_FIELDS.createMultipleTasks, 'createMultipleTasks').payload;

        expect(sprint).toEqual(PLACED);
    });
});

describe('the folder a new list is put in', () => {
    const prepared = (folderData) => prepareTaskWrite({ headers: { companyid: CID }, aud: CID, uid: OWNER, body: { action: 'convertToList', companyId: CID, taskId: OPEN_TASK, folderData } }, TASK_ACTION_FIELDS.convertToList, 'convertToList').payload;

    test('is its id and name', () => {
        const node = { folderId: FOLDER, id: FOLDER, _id: FOLDER, name: 'Design', deletedStatusKey: 0, parentFolderId: null, depth: 0, path: 'Design', sprintsObj: { [SPRINT]: wholeList() } };

        expect(prepared(node).folderData).toEqual({ folderId: FOLDER, name: 'Design' });
    });

    test('is nothing when none was picked', () => {
        expect(prepared({}).folderData).toBeNull();
        expect(prepared(null).folderData).toBeNull();
    });

    test.each([
        ['a folder that is not an object', 'Design', 'folderData must be an object.'],
        ['a folder id that is not text', { folderId: [FOLDER], name: 'Design' }, 'folderData.folderId must be an id.'],
        ['a name that is not text', { folderId: FOLDER, name: 7 }, 'folderData.name must be text.'],
    ])('is refused for %s', (_label, folderData, message) => {
        expect(() => prepared(folderData)).toThrow(message);
    });
});
