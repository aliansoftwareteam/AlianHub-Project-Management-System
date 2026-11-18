/* Task 046 M2, slice N3a: archive, delete, restore and move reach every level of subtasks. A
   cascade finds the rows by `ancestors`, stamps the ones it changes with the task that carried
   them (`cascadedBy`), and a restore brings back exactly those. The sprint counts follow the rows
   that really changed. The handlers are the real ones, called as the routes call them, over the
   test fake; the sprint counter is applied to the stored sprint so the counts can be read back. */
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
const { updateSprintFun } = require('../Modules/Sprints/controller');
const socketEmitter = require('../event/socketEventEmitter');
const { CID, OWNER, MEMBER, OPEN_PROJECT } = require('./fixtures/taskWriteGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const ROOT = '6f0000000000000000000b11';
const CHILD = '6f0000000000000000000b12';
const GRANDCHILD = '6f0000000000000000000b13';
const SECOND_CHILD = '6f0000000000000000000b14';
const OTHER_ROOT = '6f0000000000000000000b15';
const FAMILY = [ROOT, CHILD, GRANDCHILD, SECOND_CHILD];

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active' }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0 }];
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const ELEMENT = { id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' };
const TARGET_ELEMENT = { id: OTHER_SPRINT, name: 'Sprint 2', folderId: null };
const projectData = () => ({ _id: OPEN_PROJECT, id: OPEN_PROJECT, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 9, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });

const taskDoc = (_id, extra = {}) => ({
    _id, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `PAR-${_id.slice(-2)}`, TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, ParentTaskId: '', ancestors: [], Task_Leader: OWNER, sprintArray: { ...ELEMENT },
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: SPRINT, folderObjId: FOLDER, statusType: 'default_active', statusKey: 1,
    AssigneeUserId: [], watchers: [], subTasks: 0, ...extra,
});
const subtask = (_id, ancestors, extra = {}) => taskDoc(_id, { isParentTask: false, ParentTaskId: ancestors[ancestors.length - 1], ancestors, ...extra });

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};
const ROUTES = routesOf('../Modules/Tasks/routes');
const PATCH = 'PATCH /api/v2/tasks';
const BULK = 'POST /api/v2/tasks/bulk';

const call = (route, body) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1000);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const [method, routePath] = route.split(' ');
    ROUTES[route]({ method, path: routePath, originalUrl: routePath, headers: { companyid: CID }, aud: CID, uid: MEMBER, body: JSON.parse(JSON.stringify(body)) }, res, () => {});
}).then(async (result) => { await settle(); return result; });

const stored = (id) => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === id);
const keys = (ids = FAMILY) => ids.map((id) => stored(id).deletedStatusKey);
const stamps = (ids = FAMILY) => ids.map((id) => stored(id).cascadedBy);
const sprint = (id = SPRINT) => mockDb.store[SCHEMA_TYPE.SPRINTS].find((s) => String(s._id) === id);
const counts = (id = SPRINT) => ({ tasks: sprint(id).tasks, archiveTaskCount: sprint(id).archiveTaskCount });
const emittedFor = () => socketEmitter.emit.mock.calls.filter(([event, payload]) => event === 'update' && payload.module === 'task' && payload.data).map(([, payload]) => String(payload.data._id));

const setState = (taskId, deletedStatusKey) => call(PATCH, {
    action: 'updateArchiveDelete', companyId: CID, projectData: projectData(), sprintId: SPRINT,
    task: { _id: taskId, ProjectID: OPEN_PROJECT, sprintId: SPRINT, deletedStatusKey: stored(taskId).deletedStatusKey }, userData: USER, deletedStatusKey,
});
const archive = (taskId) => setState(taskId, 2);
const remove = (taskId) => setState(taskId, 1);
const restore = (taskId) => setState(taskId, 0);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    updateSprintFun.mockImplementation(async ({ body, params }) => mockDb.crud(body.companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: params.id }, body.updateObject] }, 'updateOne'));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 9, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: OPEN_PROJECT, folderId: FOLDER, deletedStatusKey: 0, tasks: 5, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, deletedStatusKey: 0, tasks: 0, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(ROOT, { subTasks: 2 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(CHILD, [ROOT], { subTasks: 1 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(GRANDCHILD, [ROOT, CHILD]));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(SECOND_CHILD, [ROOT]));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(OTHER_ROOT));
});

describe('archive and restore', () => {
    test('archiving a task carries every level of its subtasks, stamped with the task that carried them', async () => {
        const res = await archive(ROOT);

        expect(res.body.status).toBe(true);
        expect(keys()).toEqual([2, 3, 3, 3]);
        expect(stamps()).toEqual([undefined, ROOT, ROOT, ROOT]);
        expect(stored(OTHER_ROOT).deletedStatusKey).toBe(0);
        expect(counts()).toEqual({ tasks: 1, archiveTaskCount: 4 });
    });

    test('the cascade is one company-scoped update by ancestors, and every changed row is announced', async () => {
        await archive(ROOT);

        const cascades = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'updateMany');
        expect(cascades).toHaveLength(1);
        expect(cascades[0].companyId).toBe(CID);
        expect(cascades[0].data[0]).toEqual({ ancestors: ROOT, deletedStatusKey: 0 });
        expect(emittedFor().sort()).toEqual([...FAMILY].sort());
        expect(mockDb.calls.every((c) => [CID, SCHEMA_TYPE.GOLBAL].includes(String(c.companyId)))).toBe(true);
    });

    test('the stamp survives the strict task schema', async () => {
        await archive(ROOT);
        const cascade = mockDb.calls.find((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'updateMany');

        const { writes, error } = await driverWrites('updateMany', cascade.data);

        expect(error).toBeNull();
        expect(writes[0].args[1].$set).toMatchObject({ deletedStatusKey: 3, cascadedBy: ROOT });
    });

    test('restoring it brings every level back and clears the stamp', async () => {
        await archive(ROOT);

        const res = await restore(ROOT);

        expect(res.body.status).toBe(true);
        expect(keys()).toEqual([0, 0, 0, 0]);
        FAMILY.forEach((id) => expect(stored(id)).not.toHaveProperty('cascadedBy'));
        expect(counts()).toEqual({ tasks: 5, archiveTaskCount: 0 });
        expect([stored(ROOT).subTasks, stored(CHILD).subTasks]).toEqual([2, 1]);
    });

    test('a grandchild archived on its own before stays archived when its root comes back', async () => {
        await archive(GRANDCHILD);
        expect(counts()).toEqual({ tasks: 4, archiveTaskCount: 1 });
        expect(stored(CHILD).subTasks).toBe(0);

        await archive(ROOT);
        expect(keys()).toEqual([2, 3, 2, 3]);
        expect(counts()).toEqual({ tasks: 1, archiveTaskCount: 4 });

        await restore(ROOT);
        expect(keys()).toEqual([0, 0, 2, 0]);
        expect(counts()).toEqual({ tasks: 4, archiveTaskCount: 1 });
    });

    test('archiving a subtask carries its own subtasks, and its parent counts one fewer', async () => {
        await archive(CHILD);

        expect(keys()).toEqual([0, 2, 3, 0]);
        expect(stamps()).toEqual([undefined, undefined, CHILD, undefined]);
        expect(stored(ROOT).subTasks).toBe(1);
        expect(counts()).toEqual({ tasks: 3, archiveTaskCount: 2 });
    });

    test('rows a subtask carried are not brought back by its root', async () => {
        await archive(CHILD);
        await archive(ROOT);
        expect(keys()).toEqual([2, 2, 3, 3]);
        expect(counts()).toEqual({ tasks: 1, archiveTaskCount: 4 });

        await restore(ROOT);

        expect(keys()).toEqual([0, 2, 3, 0]);
        expect(stamps()).toEqual([undefined, undefined, CHILD, undefined]);
        expect(counts()).toEqual({ tasks: 3, archiveTaskCount: 2 });

        await restore(CHILD);
        expect(keys()).toEqual([0, 0, 0, 0]);
        expect(counts()).toEqual({ tasks: 5, archiveTaskCount: 0 });
        expect(stored(ROOT).subTasks).toBe(2);
    });

    test('subtasks archived with their parent before the stamp existed still come back with it', async () => {
        Object.assign(stored(ROOT), { deletedStatusKey: 2 });
        Object.assign(stored(CHILD), { deletedStatusKey: 3 });
        Object.assign(stored(SECOND_CHILD), { deletedStatusKey: 2 });
        Object.assign(sprint(), { tasks: 2, archiveTaskCount: 3 });

        await restore(ROOT);

        expect(keys()).toEqual([0, 0, 0, 2]);
        expect(counts()).toEqual({ tasks: 4, archiveTaskCount: 1 });
    });

    test('archiving an archived task again changes nothing', async () => {
        await archive(ROOT);
        const before = JSON.stringify([mockDb.store[SCHEMA_TYPE.TASKS], counts()]);

        await archive(ROOT);

        expect(JSON.stringify([mockDb.store[SCHEMA_TYPE.TASKS], counts()])).toBe(before);
    });
});

describe('delete and restore', () => {
    test('deleting a task carries every level, and restoring it brings back what it carried', async () => {
        await remove(ROOT);
        expect(keys()).toEqual([1, 1, 1, 1]);
        expect(stamps()).toEqual([undefined, ROOT, ROOT, ROOT]);
        expect(counts()).toEqual({ tasks: 1, archiveTaskCount: 0 });

        await restore(ROOT);
        expect(keys()).toEqual([0, 0, 0, 0]);
        expect(counts()).toEqual({ tasks: 5, archiveTaskCount: 0 });
    });

    test('a subtask deleted on its own before stays deleted when its root comes back', async () => {
        await remove(SECOND_CHILD);
        await remove(ROOT);

        await restore(ROOT);

        expect(keys()).toEqual([0, 0, 0, 1]);
        expect(counts()).toEqual({ tasks: 4, archiveTaskCount: 0 });
        expect(stored(ROOT).subTasks).toBe(1);
    });

    test('deleting an archived task takes the rows it carried out of the archive count', async () => {
        await archive(ROOT);

        await remove(ROOT);
        expect(keys()).toEqual([1, 1, 1, 1]);
        expect(counts()).toEqual({ tasks: 1, archiveTaskCount: 0 });

        await restore(ROOT);
        expect(keys()).toEqual([0, 0, 0, 0]);
        expect(counts()).toEqual({ tasks: 5, archiveTaskCount: 0 });
    });

    test('bulk archive and bulk restore go through the same cascade', async () => {
        await call(BULK, { action: 'bulkArchive', companyId: CID, taskIds: [ROOT], userData: USER });
        expect(keys()).toEqual([2, 3, 3, 3]);
        expect(counts()).toEqual({ tasks: 1, archiveTaskCount: 4 });

        await call(BULK, { action: 'bulkRestore', companyId: CID, taskIds: [ROOT], userData: USER });
        expect(keys()).toEqual([0, 0, 0, 0]);
        expect(counts()).toEqual({ tasks: 5, archiveTaskCount: 0 });
    });
});

describe('move', () => {
    const moveBody = (taskId, extra = {}) => ({
        action: 'moveTask', companyId: CID, projectData: { id: OPEN_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' }, sprintObj: { ...TARGET_ELEMENT }, moveTaskId: taskId,
        oldSprintObj: { id: SPRINT, folderId: FOLDER, name: 'Sprint 1', folderName: 'Design' }, oldProject: { id: OPEN_PROJECT, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST, ProjectName: 'Parity' },
        isSubTask: false, assignee: [], watcher: [], userData: USER, ...extra,
    });
    const placements = (ids = FAMILY) => ids.map((id) => [String(stored(id).sprintId), String(stored(id).sprintArray.id), stored(id).folderObjId]);
    const chains = () => FAMILY.map((id) => stored(id).ancestors);
    const CHAINS = [[], [ROOT], [ROOT, CHILD], [ROOT]];

    test('moving a task takes every level with it, with its placement and their own chains', async () => {
        const res = await call(PATCH, moveBody(ROOT));

        expect(res.body.status).toBe(true);
        expect(placements()).toEqual(FAMILY.map(() => [OTHER_SPRINT, OTHER_SPRINT, undefined]));
        expect(chains()).toEqual(CHAINS);
        expect(String(stored(OTHER_ROOT).sprintId)).toBe(SPRINT);
        expect([sprint(SPRINT).tasks, sprint(OTHER_SPRINT).tasks]).toEqual([1, 4]);
        expect(emittedFor()).toEqual(expect.arrayContaining(FAMILY));
    });

    test('a subtask does not move on its own', async () => {
        const res = await call(PATCH, moveBody(CHILD));

        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, code: 'SUBTASK_MOVES_WITH_PARENT' });
        expect((await call(PATCH, moveBody(GRANDCHILD, { rowOnly: true }))).code).toBe(400);
        expect(placements()).toEqual(FAMILY.map(() => [SPRINT, SPRINT, FOLDER]));
        expect([sprint(SPRINT).tasks, sprint(OTHER_SPRINT).tasks]).toEqual([5, 0]);
    });

    test('a bulk move of a task takes every level with it', async () => {
        const res = await call(BULK, { action: 'bulkMove', companyId: CID, taskIds: [ROOT], sprintObj: { ...TARGET_ELEMENT }, projectData: { id: OPEN_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' }, userData: USER });

        expect(res.body.status).toBe(true);
        expect(res.body.data.totals).toMatchObject({ updated: 4, errors: 0 });
        expect(placements()).toEqual(FAMILY.map(() => [OTHER_SPRINT, OTHER_SPRINT, undefined]));
        expect(chains()).toEqual(CHAINS);
        expect([sprint(SPRINT).tasks, sprint(OTHER_SPRINT).tasks]).toEqual([1, 4]);
    });

    test('a bulk move skips a subtask selected without its root, and moves it once when the root is selected too', async () => {
        const alone = await call(BULK, { action: 'bulkMove', companyId: CID, taskIds: [GRANDCHILD, CHILD], sprintObj: { ...TARGET_ELEMENT }, projectData: { id: OPEN_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' }, userData: USER });
        expect(alone.body.data.skipped.map((entry) => `${entry.taskId} ${entry.reason}`).sort()).toEqual([`${CHILD} subtask-moves-with-its-parent`, `${GRANDCHILD} subtask-moves-with-its-parent`]);
        expect(placements()).toEqual(FAMILY.map(() => [SPRINT, SPRINT, FOLDER]));

        const together = await call(BULK, { action: 'bulkMove', companyId: CID, taskIds: [GRANDCHILD, ROOT], sprintObj: { ...TARGET_ELEMENT }, projectData: { id: OPEN_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' }, userData: USER });
        expect(together.body.data.totals).toMatchObject({ updated: 4, skipped: 0, errors: 0 });
        expect([sprint(SPRINT).tasks, sprint(OTHER_SPRINT).tasks]).toEqual([1, 4]);
    });
});
