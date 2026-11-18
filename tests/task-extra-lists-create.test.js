/* Task 046 M3, slice L1: `extraLists` is kept by the server. No request sets it, on a create, an
   update or a bulk action, and no new task document carries it, whichever writer built the
   document. The handlers are the real ones over the test fake; what a new document stores is read
   from what Mongoose hands the driver under the real task schema. */
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

const { driverWrites } = require('./fixtures/realTaskStore');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const { TASK_ACTION_FIELDS, TASK_INDEX_FIELDS, TASK_INDEX_ONLOAD_FIELDS, PRE_V2_ACTION_FIELDS, TaskWriteRefusal, prepareTaskWrite } = require('../Modules/Tasks/helpers/taskWriteFields');
const { CID, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT } = require('./fixtures/taskWriteGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const SOURCE = '6f0000000000000000000b11';
const CLAIMED = [{ projectId: PARITY_PROJECT, sprintId: OTHER_SPRINT, addedBy: MEMBER, addedAt: '2026-10-01T00:00:00.000Z' }];

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active', convertStatus: { key: 1, name: 'To Do', type: 'default_active' } }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0, convertType: { key: 1, value: 'task', name: 'Task' } }];
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const projectData = () => ({ _id: OPEN_PROJECT, id: OPEN_PROJECT, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 4, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });
const sprintObj = () => ({ id: OTHER_SPRINT, name: 'Sprint 2' });

const taskDoc = (extra = {}) => ({
    TaskName: 'Write the brief', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, ParentTaskId: '', Task_Leader: OWNER, sprintArray: { id: SPRINT, name: 'Sprint 1' },
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: SPRINT, statusType: 'default_active', statusKey: 1, AssigneeUserId: [], watchers: [], ...extra,
});

const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = routesOf('../Modules/Tasks/routes');
const CREATE = 'POST /api/v2/tasks';
const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';
const IMPORT = 'PATCH /api/v1/importTasks';

const call = (route, body) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1000);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, routePath] = route.split(' ');
    ROUTES[route]({ method, path: routePath, originalUrl: routePath, headers: { companyid: CID }, aud: CID, uid: MEMBER, body: JSON.parse(JSON.stringify(body)) }, res, () => {});
}).then(async (result) => { await settle(); return result; });

/* Every task document the handlers created, as the real schema would store it. */
const insertedDocuments = async () => {
    const stored = [];
    for (const write of mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && ['save', 'insertMany'].includes(c.method))) {
        const { writes, error } = await driverWrites(write.method, write.data);
        expect(error).toBeNull();
        stored.push(...[].concat(writes[0].args[0]));
    }
    return stored;
};

const req = (body) => ({ headers: { companyid: CID }, aud: CID, uid: MEMBER, body });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    [OPEN_PROJECT, PARITY_PROJECT].forEach((_id) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: OPEN_PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskDoc({ TaskName: 'Source', TaskKey: 'PAR-1', extraLists: CLAIMED, subTasks: 0, tagsArray: [], attachments: [], checklistArray: [] }), _id: SOURCE });
});

describe('extraLists is never taken from a request', () => {
    test('a create body loses it before the handler runs', () => {
        const { payload, dropped } = prepareTaskWrite(req({ data: taskDoc({ extraLists: CLAIMED }), user: USER, projectData: projectData(), indexObj: {} }), TASK_ACTION_FIELDS.create, 'create');

        expect(payload.data).not.toHaveProperty('extraLists');
        expect(payload.data.TaskName).toBe('Write the brief');
        expect(dropped).toContain('data.extraLists');
    });

    const everySpec = [
        ...Object.entries(TASK_ACTION_FIELDS),
        ...Object.entries(PRE_V2_ACTION_FIELDS).map(([action, spec]) => [`pre-v2 ${action}`, spec]),
        ['taskIndex', TASK_INDEX_FIELDS],
        ['updateTaskIndexOnload', TASK_INDEX_ONLOAD_FIELDS],
    ];

    test('no action copies it from a body into a task', () => {
        const writing = everySpec.flatMap(([action, spec]) => Object.entries(spec.writes).filter(([, fields]) => fields.includes('extraLists')).map(([name]) => `${action}.${name}`));

        expect(everySpec.length).toBeGreaterThan(50);
        expect(writing).toEqual([]);
    });

    test.each(everySpec)('%s drops or refuses it, at the top of the body and in every object it writes from', (action, spec) => {
        const body = { action, extraLists: CLAIMED, ...Object.fromEntries(Object.keys(spec.writes).map((name) => [name, { extraLists: CLAIMED, 'extraLists.0': CLAIMED[0] }])) };
        let prepared = null;
        let refusal = null;
        try {
            prepared = prepareTaskWrite(req(body), spec, action);
        } catch (error) {
            refusal = error;
        }

        if (refusal) {
            expect(refusal).toBeInstanceOf(TaskWriteRefusal);
            expect(refusal.statusCode).toBe(400);
        } else {
            expect(prepared.payload).not.toHaveProperty('extraLists');
            Object.keys(spec.writes).forEach((name) => expect(Object.keys(prepared.payload[name]).filter((key) => key.startsWith('extraLists'))).toEqual([]));
            expect(prepared.dropped).toContain('extraLists');
        }
    });
});

describe('a new task document never carries extra lists', () => {
    test('a created task stores none, whatever the body says', async () => {
        const res = await call(CREATE, { data: taskDoc({ TaskName: 'New row', extraLists: CLAIMED }), user: USER, projectData: projectData(), indexObj: {} });

        expect(res.body.status).toBe(true);
        const saved = mockDb.store[SCHEMA_TYPE.TASKS].find((row) => row.TaskName === 'New row');
        expect(saved).toBeDefined();
        expect(saved).not.toHaveProperty('extraLists');
        (await insertedDocuments()).forEach((doc) => expect(doc.extraLists).toBeUndefined());
    });

    test.each([
        ['a copy of a task that is in other lists', PATCH, () => ({
            action: 'duplicateTask', companyId: CID, projectData: projectData(), sprintObj: sprintObj(), selectedTaskId: SOURCE, oldProject: projectData(),
            isSubTask: false, duplicateData: [], assignee: [], watcher: [], taskName: 'Copy', oldSprintObj: { id: SPRINT, name: 'Sprint 1' }, userData: USER,
        })],
        ['copies made in bulk', BULK, () => ({
            action: 'bulkDuplicate', taskIds: [SOURCE], userData: USER, projectData: projectData(), sprintObj: sprintObj(), oldProject: projectData(),
            duplicateData: [], taskName: 'Copy', oldSprintObj: { id: SPRINT, name: 'Sprint 1' },
        })],
        ['an imported row that names lists', IMPORT, () => ({
            tasks: [{ TaskName: 'Imported', status: 'To Do', Task_Leader: OWNER, extraLists: CLAIMED }], userData: USER, projectData: projectData(), indexObj: {},
            statusArray: STATUS_LIST, sprint: sprintObj(), eventId: 'e1',
        })],
        ['subtasks made under a task that is in other lists', PATCH, () => ({
            action: 'createSubTaskWithAi', companyId: CID, userId: MEMBER, subTitles: [{ title: 'Step one' }], sprintObj: sprintObj(), projectData: projectData(),
            userData: USER, parentTask: { id: SOURCE, ProjectID: OPEN_PROJECT }, type: 'subTask',
        })],
    ])('%s', async (_, route, body) => {
        const res = await call(route, body());

        expect(res.code).toBe(200);
        const created = await insertedDocuments();
        expect(created.length).toBeGreaterThan(0);
        created.forEach((doc) => expect(doc.extraLists).toBeUndefined());
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((row) => row._id === SOURCE).extraLists).toEqual(CLAIMED);
    });
});
