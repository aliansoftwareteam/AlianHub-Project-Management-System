/* Task 040 phase 2: a task's sprintArray.id and sprintArray.folderId are stored as ObjectIds,
   whichever form the writer passed. Every stored form here is read from what Mongoose hands the
   driver under the real task schema; fakeMongo only records which writes a handler made. */
process.env.STORAGE_TYPE = 'server';
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

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

const { driverWrites, sprintArraysIn, isObjectId } = require('./fixtures/realTaskStore');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');
const { CID, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT, OPEN_TASK, OPEN_TASK_2 } = require('./fixtures/taskWriteGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const oid = (id) => new mongoose.Types.ObjectId(id);
const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const TASK_ID = '6f0000000000000000000b09';
const SUB_TASK = '6f0000000000000000000b0a';

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

/* The element as older web apps send it, plus a field no writer declares; the schema keeps the id, the name and the folder. */
const STORED_ELEMENT = { id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' };
const element = () => ({ id: SPRINT, name: 'Sprint 1', value: 'SPRINT_1', folderId: FOLDER, folderName: 'Design', isAccessible: true, legacyNote: { kept: true } });
const taskDoc = (extra = {}) => ({
    TaskName: 'Write the brief', TaskKey: 'PAR-9', TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, Task_Leader: OWNER, sprintArray: element(),
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: SPRINT, statusType: 'default_active', statusKey: 1, ...extra,
});

const storedElements = async (method, args) => {
    const { writes } = await driverWrites(method, args);
    return sprintArraysIn(writes.map((write) => write.args));
};

describe('the task schema stores a sprint id and a folder id as ObjectIds', () => {
    test.each([
        ['save', 'save', () => taskDoc()],
        ['insertMany', 'insertMany', () => [[taskDoc()]]],
        ['updateOne with $set', 'updateOne', () => [{ _id: TASK_ID }, { $set: { sprintArray: element() } }]],
        ['updateOne with a bare update', 'updateOne', () => [{ _id: TASK_ID }, { sprintArray: element() }]],
        ['updateMany', 'updateMany', () => [{ sprintId: SPRINT }, { $set: { sprintArray: element() } }]],
        ['findOneAndUpdate with an upsert', 'findOneAndUpdate', () => [{ _id: TASK_ID }, { $set: { sprintArray: element() } }, { new: true, upsert: true }]],
        ['bulkWrite', 'bulkWrite', () => [[{ insertOne: { document: taskDoc() } }, { updateOne: { filter: { _id: TASK_ID }, update: { $set: { sprintArray: element() } } } }]]],
        ['replaceOne', 'replaceOne', () => [{ _id: TASK_ID }, taskDoc()]],
    ])('%s converts both ids and keeps the two names', async (_, method, args) => {
        const stored = await storedElements(method, args());
        expect(stored.length).toBeGreaterThan(0);
        stored.forEach((el) => {
            expect(isObjectId(el.id)).toBe(true);
            expect(isObjectId(el.folderId)).toBe(true);
            expect({ ...el, id: String(el.id), folderId: String(el.folderId) }).toEqual(STORED_ELEMENT);
        });
    });

    test('an id that is already an ObjectId is stored as it is', async () => {
        const [el] = await storedElements('save', taskDoc({ sprintArray: { ...element(), id: oid(SPRINT), folderId: oid(FOLDER) } }));
        expect(isObjectId(el.id) && isObjectId(el.folderId)).toBe(true);
        expect([String(el.id), String(el.folderId)]).toEqual([SPRINT, FOLDER]);
    });

    test.each([
        ['an empty folder id (a sprint at the project root)', { folderId: '' }],
        ['a null folder id', { folderId: null }],
        ['a legacy key that is not an id', { id: 'firebase-sprint', folderId: 'firebase-folder' }],
    ])('%s is stored as sent', async (_, ids) => {
        const [el] = await storedElements('save', taskDoc({ sprintArray: { ...element(), ...ids } }));
        Object.entries(ids).forEach(([key, value]) => expect(el[key]).toBe(value));
    });

    test('a filter is sent as written, so a read still matches either form and a legacy key', async () => {
        const { writes, error } = await driverWrites('find', [{ 'sprintArray.id': { $in: ['firebase-sprint', SPRINT, oid(SPRINT)] } }]);
        expect(error).toBeNull();
        const [first, second, third] = writes[0].args[0]['sprintArray.id'].$in;
        expect([first, second]).toEqual(['firebase-sprint', SPRINT]);
        expect(isObjectId(third)).toBe(true);
    });
});

/* A dotted update ($set 'sprintArray.folderId') reaches the schema as a bare value it cannot tell
   apart from a name, so a writer of a dotted id path passes an ObjectId itself. Moving a sprint into
   a folder (Sprints/controller.js) is the one such writer; that file does not load under jest. */
describe('a writer that sets one id path of the element', () => {
    const SOURCES = ['Modules', 'utils', 'event', 'middlewares'];
    const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });

    test('passes an ObjectId, an empty value, or is a filter', () => {
        const root = path.join(__dirname, '..');
        const offenders = SOURCES.flatMap((dir) => sourceFiles(path.join(root, dir))).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
            .map((line, i) => ({ line: line.trim(), at: `${path.relative(root, file)}:${i + 1}` }))
            .filter(({ line }) => /['"]sprintArray\.(id|folderId)['"]\s*:/.test(line))
            .filter(({ line }) => !/['"]sprintArray\.(id|folderId)['"]\s*:\s*(new mongoose\.Types\.ObjectId\(|''|""|\{\s*\$in\b)/.test(line))
            .map(({ at, line }) => `${at} ${line}`));
        expect(offenders).toEqual([]);
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

describe('every web-app task write that places a task in a sprint', () => {
    const PATCH = 'PATCH /api/v2/tasks';
    const BULK = 'POST /api/v2/tasks/bulk';
    const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }];
    const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0, convertType: { key: 1, value: 'task', name: 'Task' } }];
    const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
    const projectData = () => ({ _id: OPEN_PROJECT, id: OPEN_PROJECT, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 4, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });
    const sprintObj = () => ({ id: OTHER_SPRINT, name: 'Sprint 2', value: 'SPRINT_2', folderId: FOLDER, folderName: 'Design' });

    /* Stored tasks as legacy data has them, both ids as text, so a writer that copies the element is caught
       too. The two parents sit in different sprints and the first has a subtask, so a conversion or a merge
       rewrites the sprint. */
    const storedTaskDoc = (_id) => ({
        ...taskDoc({ TaskName: `Task ${_id.slice(-2)}`, TaskKey: `PAR-${_id.slice(-1)}`, sprintArray: { id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' } }),
        _id, folderObjId: FOLDER, ParentTaskId: '', subTasks: 0, AssigneeUserId: [], watchers: [], tagsArray: [], attachments: [], checklistArray: [],
        relations: [], createdBy: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
    });

    /* Fixture sprints s1 and s2 become real ids, and a sprint the body names sits in a folder. */
    const withIds = (body) => JSON.parse(JSON.stringify(body, (key, value) => {
        if (key === 'folderId' && value === null) return FOLDER;
        return { s1: SPRINT, s2: OTHER_SPRINT }[value] || value;
    }));
    const fixture = (route, action) => {
        const row = WEB_APP_BODIES.find((r) => r.route === route && r.action === action) || WEB_APP_BODIES.find((r) => r.action === action);
        return withIds(row.body({ taskId: OPEN_TASK, otherTaskId: OPEN_TASK_2, projectId: OPEN_PROJECT, destinationProjectId: OPEN_PROJECT }));
    };
    const CRAFTED = {
        create: () => {
            const data = storedTaskDoc(TASK_ID);
            ['_id', 'createdBy', 'createdAt'].forEach((field) => { delete data[field]; });
            return { action: 'create', data: { ...data, TaskKey: '-', sprintId: OTHER_SPRINT, sprintArray: sprintObj() }, user: USER, projectData: projectData(), indexObj: {} };
        },
        createMultipleTasks: () => ({ tasks: [{ TaskName: 'Imported', status: 'To Do', Task_Leader: OWNER }], userData: USER, projectData: projectData(), indexObj: {}, statusArray: STATUS_LIST, sprint: sprintObj(), eventId: 'e1' }),
        bulkDuplicate: () => ({ action: 'bulkDuplicate', taskIds: [OPEN_TASK], userData: USER, projectData: projectData(), sprintObj: sprintObj(), oldProject: projectData(), duplicateData: [], taskName: 'Copy', oldSprintObj: sprintObj() }),
    };

    const WRITERS = [
        ['POST /api/v2/tasks', 'create', CRAFTED.create],
        ['PATCH /api/v1/importTasks', 'createMultipleTasks', CRAFTED.createMultipleTasks],
        [PATCH, 'createSubTaskWithAi', () => fixture(PATCH, 'createSubTaskWithAi')],
        [PATCH, 'convertToTask', () => fixture(PATCH, 'convertToTask')],
        [PATCH, 'convertToSubTask', () => fixture(PATCH, 'convertToSubTask')],
        [PATCH, 'convertToList', () => ({ ...fixture(PATCH, 'convertToList'), isSubTask: true })],
        [PATCH, 'moveTask', () => fixture(PATCH, 'moveTask')],
        [PATCH, 'mergeTask', () => ({ ...fixture(PATCH, 'mergeTask'), isSubTask: true })],
        [PATCH, 'duplicateTask', () => fixture(PATCH, 'duplicateTask')],
        [BULK, 'bulkMove', () => fixture(BULK, 'bulkMove')],
        [BULK, 'bulkConvertToTask', () => ({ ...fixture(BULK, 'bulkConvertToTask'), taskIds: [SUB_TASK] })],
        [BULK, 'bulkConvertToSubTask', () => fixture(BULK, 'bulkConvertToSubTask')],
        [BULK, 'bulkDuplicate', CRAFTED.bulkDuplicate],
    ];

    const ROUTES = { ...routesOf('../Modules/Tasks/routes'), ...routesOf('../Modules/taskIndex/routes') };
    const PLACING = ['save', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'bulkWrite', 'replaceOne'];

    beforeEach(() => {
        Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
        mockDb.calls.length = 0;
        [OPEN_PROJECT, PARITY_PROJECT].forEach((_id) => mockDb.seed('projects', { _id, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST }));
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, folderId: FOLDER });
        require('../Modules/Sprints/controller').addSprintFun.mockResolvedValue({ status: true, data: { _id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER, folderName: 'Design' } });
        mockDb.seed('tasks', storedTaskDoc(OPEN_TASK));
        mockDb.seed('tasks', { ...storedTaskDoc(OPEN_TASK_2), sprintId: OTHER_SPRINT, sprintArray: { id: OTHER_SPRINT, name: 'Sprint 2', folderId: FOLDER, folderName: 'Design' } });
        mockDb.seed('tasks', { ...storedTaskDoc(SUB_TASK), isParentTask: false, ParentTaskId: OPEN_TASK });
    });

    test.each(WRITERS)('%s %s stores the ids of the sprint it writes as ObjectIds', async (route, action, body) => {
        const result = await call(ROUTES, route, { ...clone(body()), ...(route === PATCH || route === BULK ? { action } : {}) });
        expect(result.code).not.toBe('threw');
        const writes = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && PLACING.includes(c.method));
        const stored = [];
        for (const write of writes) {
            const replays = write.method === 'insertMany' ? write.data[0].map((doc) => ['save', doc]) : [[write.method, write.data]];
            for (const [method, data] of replays) stored.push(...await storedElements(method, data));
        }
        expect({ action, wroteAnElement: stored.length > 0 }).toEqual({ action, wroteAnElement: true });
        const forms = stored.flatMap((el) => ['id', 'folderId'].filter((key) => el[key] !== undefined && el[key] !== null && el[key] !== '').map((key) => `${key}:${isObjectId(el[key]) ? 'ObjectId' : typeof el[key]}`));
        expect(forms.length).toBeGreaterThan(0);
        expect(forms.filter((form) => !form.endsWith(':ObjectId'))).toEqual([]);
    });
});
