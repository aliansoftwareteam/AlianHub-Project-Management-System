/* A move or a convert takes the row off its list by marking it deleted for a moment. That event
   says why the row left, so a screen showing the task does not call it a delete. The handlers are
   the real ones, called as the routes call them, over the test fake. */
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

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const { updateSprintFun, addSprintFun } = require('../Modules/Sprints/controller');
const { CID, OWNER, MEMBER, OPEN_PROJECT } = require('./fixtures/taskWriteGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const NEW_SPRINT = '6f0000000000000000000e03';
const FOLDER = '6f0000000000000000000f01';
const ROOT = '6f0000000000000000000b11';
const CHILD = '6f0000000000000000000b12';
const LONE = '6f0000000000000000000b17';

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active' }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0 }];
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const ELEMENT = { id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' };
const OTHER_ELEMENT = { id: OTHER_SPRINT, name: 'Sprint 2' };
const PROJECT = { id: OPEN_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' };
const OLD_PROJECT = { id: OPEN_PROJECT, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST, ProjectName: 'Parity' };
const OLD_ELEMENT = { id: SPRINT, folderId: FOLDER, name: 'Sprint 1', folderName: 'Design' };

const taskDoc = (_id, extra = {}) => ({
    _id, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `PAR-${_id.slice(-2)}`, TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, ParentTaskId: '', ancestors: [], Task_Leader: OWNER, sprintArray: { ...ELEMENT },
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: SPRINT, folderObjId: FOLDER, statusType: 'default_active', statusKey: 1,
    AssigneeUserId: [], watchers: [], subTasks: 0, ...extra,
});

const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = routesOf('../Modules/Tasks/routes');
const PATCH = 'PATCH /api/v2/tasks';

const call = (body) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1000);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    ROUTES[PATCH]({ method: 'PATCH', path: '/api/v2/tasks', originalUrl: '/api/v2/tasks', headers: { companyid: CID }, aud: CID, uid: MEMBER, body: JSON.parse(JSON.stringify(body)) }, res, () => {});
}).then(async (result) => { await settle(); return result; });

/* What each event that took `taskId` off its list said, in the order they were sent. */
const leavings = (taskId) => socketEmitter.emit.mock.calls
    .map(([, change]) => change)
    .filter((change) => change && change.module === 'task' && change.updatedFields && change.updatedFields.deletedStatusKey === 1 && String(change.data && change.data._id) === taskId)
    .map((change) => change.leftBecause);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    updateSprintFun.mockImplementation(async ({ body, params }) => mockDb.crud(body.companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: params.id }, body.updateObject] }, 'updateOne'));
    addSprintFun.mockImplementation(async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: NEW_SPRINT, name: 'Task 11', projectId: OPEN_PROJECT, deletedStatusKey: 0, tasks: 0, archiveTaskCount: 0 });
        return { status: true, data: { _id: NEW_SPRINT, name: 'Task 11' } };
    });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 20, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: OPEN_PROJECT, folderId: FOLDER, deletedStatusKey: 0, tasks: 3, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, deletedStatusKey: 0, tasks: 0, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(ROOT, { subTasks: 1 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(CHILD, { isParentTask: false, ParentTaskId: ROOT, ancestors: [ROOT] }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(LONE));
});

describe('the event that takes a task off its list says why', () => {
    test('a move says the task was moved, for the task and for the subtask that follows it', async () => {
        const res = await call({
            action: 'moveTask', companyId: CID, projectData: { ...PROJECT }, sprintObj: { ...OTHER_ELEMENT, folderId: null }, moveTaskId: ROOT,
            oldSprintObj: { ...OLD_ELEMENT }, oldProject: { ...OLD_PROJECT }, isSubTask: true, assignee: [], watcher: [], userData: USER,
        });

        expect(res.body.status).toBe(true);
        expect(leavings(ROOT)).toEqual(['moved']);
        expect(leavings(CHILD)).toEqual(['moved']);
    });

    test('a convert to a subtask says the task became a subtask', async () => {
        const res = await call({ action: 'convertToSubTask', companyId: CID, projectData: { ...PROJECT }, sprintId: SPRINT, selectedTaskId: LONE, taskId: ROOT, oldProject: { ...OLD_PROJECT }, isSubTask: false, userData: USER });

        expect(res.body.status).toBe(true);
        expect(leavings(LONE)).toEqual(['subtask']);
    });

    test('a convert to a list says the task became a list', async () => {
        const res = await call({ action: 'convertToList', companyId: CID, projectData: { ...PROJECT }, taskId: LONE, userData: USER, folderData: null, sprintObj: { id: SPRINT, folderId: FOLDER }, isSubTask: false });

        expect(res.body.status).toBe(true);
        expect(leavings(LONE)).toEqual(['list']);
    });

    test('a subtask made a task says it became a task', async () => {
        const res = await call({
            action: 'convertToTask', companyId: CID, projectData: { id: OPEN_PROJECT }, taskId: CHILD, parentTaskId: ROOT, sprintObj: { ...OTHER_ELEMENT },
            oldSprintObj: { ...OLD_ELEMENT }, oldProject: { ...OLD_PROJECT },
        });

        expect(res.body.status).toBe(true);
        expect(leavings(CHILD)).toEqual(['task']);
    });

    test('a delete gives no reason: it is a delete', async () => {
        const res = await call({ action: 'updateArchiveDelete', companyId: CID, projectData: { ...PROJECT, _id: OPEN_PROJECT }, sprintId: SPRINT, task: { _id: LONE }, userData: USER, deletedStatusKey: 1 });

        expect(res.body.status).toBe(true);
        expect(leavings(LONE)).toEqual([undefined]);
    });
});
