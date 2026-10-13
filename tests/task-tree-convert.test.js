/* Task 046 M2, slice N3b: convert, re-parent, merge, duplicate and convert to list keep the
   subtask tree. Every row a writer moves stores the chain its parents give, its subtree follows it
   with the placement of the new root, the counts follow the rows, and a stamp that names a task no
   longer above a row is dropped. The handlers are the real ones, called as the routes call them,
   over the test fake; the sprint counter is applied to the stored sprint so counts are read back. */
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
const GRANDCHILD = '6f0000000000000000000b13';
const SECOND_CHILD = '6f0000000000000000000b14';
const OTHER_ROOT = '6f0000000000000000000b15';
const OTHER_CHILD = '6f0000000000000000000b16';
const LONE = '6f0000000000000000000b17';
const FAMILY = [ROOT, CHILD, GRANDCHILD, SECOND_CHILD];

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active' }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0 }];
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const ELEMENT = { id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' };
const OTHER_ELEMENT = { id: OTHER_SPRINT, name: 'Sprint 2' };
const PROJECT = { id: OPEN_PROJECT, ProjectCode: 'PAR', ProjectName: 'Parity' };
const OLD_PROJECT = { id: OPEN_PROJECT, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST, ProjectName: 'Parity' };

const taskDoc = (_id, extra = {}) => ({
    _id, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `PAR-${_id.slice(-2)}`, TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, ParentTaskId: '', ancestors: [], Task_Leader: OWNER, sprintArray: { ...ELEMENT },
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: SPRINT, folderObjId: FOLDER, statusType: 'default_active', statusKey: 1,
    AssigneeUserId: [], watchers: [], subTasks: 0, ...extra,
});
const subtask = (_id, ancestors, extra = {}) => taskDoc(_id, { isParentTask: false, ParentTaskId: ancestors[ancestors.length - 1], ancestors, ...extra });
const inOtherSprint = { sprintId: OTHER_SPRINT, sprintArray: { ...OTHER_ELEMENT }, folderObjId: undefined };

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

const allTasks = () => mockDb.store[SCHEMA_TYPE.TASKS];
const stored = (id) => allTasks().find((t) => String(t._id) === id);
const shape = (id) => { const t = stored(id); return { parent: String(t.ParentTaskId || ''), ancestors: t.ancestors, top: t.isParentTask, sprint: String(t.sprintId) }; };
const sprint = (id) => mockDb.store[SCHEMA_TYPE.SPRINTS].find((s) => String(s._id) === id);
const liveCounts = () => [SPRINT, OTHER_SPRINT].map((id) => sprint(id).tasks);
const before = () => JSON.stringify(allTasks());

const toSubTask = (taskId, parentId, isSubTask = false) => call(PATCH, { action: 'convertToSubTask', companyId: CID, projectData: { ...PROJECT }, sprintId: SPRINT, selectedTaskId: taskId, taskId: parentId, oldProject: { ...OLD_PROJECT }, isSubTask, userData: USER });
const toTask = (taskId, element = OTHER_ELEMENT) => call(PATCH, {
    action: 'convertToTask', companyId: CID, projectData: { id: OPEN_PROJECT }, taskId, parentTaskId: stored(taskId).ParentTaskId, sprintObj: { ...element },
    oldSprintObj: { id: SPRINT, folderId: FOLDER, name: 'Sprint 1', folderName: 'Design' }, oldProject: { ...OLD_PROJECT },
});
const setState = (taskId, deletedStatusKey) => call(PATCH, { action: 'updateArchiveDelete', companyId: CID, projectData: { ...PROJECT, _id: OPEN_PROJECT }, sprintId: SPRINT, task: { _id: taskId }, userData: USER, deletedStatusKey });

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
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: OPEN_PROJECT, folderId: FOLDER, deletedStatusKey: 0, tasks: 5, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, deletedStatusKey: 0, tasks: 2, archiveTaskCount: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(ROOT, { subTasks: 2 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(CHILD, [ROOT], { subTasks: 1 }));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(GRANDCHILD, [ROOT, CHILD]));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(SECOND_CHILD, [ROOT]));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(OTHER_ROOT, { subTasks: 1, ...inOtherSprint }));
    mockDb.seed(SCHEMA_TYPE.TASKS, subtask(OTHER_CHILD, [OTHER_ROOT], { ...inOtherSprint }));
    mockDb.seed(SCHEMA_TYPE.TASKS, taskDoc(LONE));
});

describe('a subtask becomes a task', () => {
    test('it stores an empty chain, its own subtasks follow it, and the counts follow the rows', async () => {
        const res = await toTask(CHILD);

        expect(res.body.status).toBe(true);
        expect(shape(CHILD)).toEqual({ parent: '', ancestors: [], top: true, sprint: OTHER_SPRINT });
        expect(shape(GRANDCHILD)).toEqual({ parent: CHILD, ancestors: [CHILD], top: false, sprint: OTHER_SPRINT });
        expect(String(stored(GRANDCHILD).sprintArray.id)).toBe(OTHER_SPRINT);
        expect(stored(GRANDCHILD)).not.toHaveProperty('folderObjId');
        expect([stored(ROOT).subTasks, stored(CHILD).subTasks]).toEqual([1, 1]);
        expect(liveCounts()).toEqual([3, 4]);
    });

    test('the task it left can be archived and restored without touching it', async () => {
        await toTask(CHILD);

        await setState(ROOT, 2);
        expect([CHILD, GRANDCHILD, SECOND_CHILD].map((id) => stored(id).deletedStatusKey)).toEqual([0, 0, 3]);

        await setState(ROOT, 0);
        expect([CHILD, GRANDCHILD, SECOND_CHILD].map((id) => stored(id).deletedStatusKey)).toEqual([0, 0, 0]);
    });

    test('a stamp that names the task it left is dropped, so that task\'s restore does not reach it', async () => {
        await setState(ROOT, 2);
        expect([stored(CHILD).cascadedBy, stored(GRANDCHILD).cascadedBy]).toEqual([ROOT, ROOT]);

        await toTask(CHILD);
        expect(stored(CHILD)).not.toHaveProperty('cascadedBy');
        expect(stored(GRANDCHILD)).not.toHaveProperty('cascadedBy');
        const held = stored(GRANDCHILD).deletedStatusKey;

        await setState(ROOT, 0);
        expect(stored(GRANDCHILD).deletedStatusKey).toBe(held);
        expect(stored(SECOND_CHILD).deletedStatusKey).toBe(0);
    });

    test('the chain survives the strict task schema', async () => {
        await toTask(CHILD);
        const write = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'findOneAndUpdate').find((c) => c.data[1].$set && c.data[1].$set.isParentTask === true);

        const { writes, error } = await driverWrites('findOneAndUpdate', write.data);

        expect(error).toBeNull();
        expect(writes[0].args[1].$set.ancestors).toEqual([]);
        expect(writes[0].args[1].$unset).toHaveProperty('cascadedBy');
    });

    const toTaskNaming = (taskId, named) => call(PATCH, {
        action: 'convertToTask', companyId: CID, projectData: { id: OPEN_PROJECT }, taskId, sprintObj: { ...OTHER_ELEMENT }, oldProject: { ...OLD_PROJECT }, ...named,
    });

    test('the parent and the list that lose a row are the ones the task is stored under, whatever the request names', async () => {
        const res = await toTaskNaming(CHILD, { parentTaskId: OTHER_ROOT, oldSprintObj: { id: OTHER_SPRINT, name: 'Sprint 2' } });

        expect(res.body.status).toBe(true);
        expect([stored(ROOT).subTasks, stored(OTHER_ROOT).subTasks]).toEqual([1, 1]);
        expect(liveCounts()).toEqual([3, 4]);
    });

    test('the request does not have to name them', async () => {
        const res = await toTaskNaming(CHILD, {});

        expect(res.body.status).toBe(true);
        expect([stored(ROOT).subTasks, stored(OTHER_ROOT).subTasks]).toEqual([1, 1]);
        expect(liveCounts()).toEqual([3, 4]);
    });

    test('a task that has no parent takes a subtask from no other task', async () => {
        const res = await toTaskNaming(LONE, { parentTaskId: OTHER_ROOT, oldSprintObj: { id: SPRINT, folderId: FOLDER } });

        expect(res.body.status).toBe(true);
        expect(stored(OTHER_ROOT).subTasks).toBe(1);
        expect(shape(LONE)).toEqual({ parent: '', ancestors: [], top: true, sprint: OTHER_SPRINT });
    });
});

describe('a task becomes a subtask', () => {
    test('under a subtask: it takes the chain of two', async () => {
        const res = await toSubTask(LONE, CHILD);

        expect(res.body.status).toBe(true);
        expect(shape(LONE)).toEqual({ parent: CHILD, ancestors: [ROOT, CHILD], top: false, sprint: SPRINT });
        expect(stored(CHILD).subTasks).toBe(2);
    });

    test('with its own subtasks: they stay under it, and every row takes the chain and the placement of the new root', async () => {
        const res = await toSubTask(OTHER_ROOT, ROOT, true);

        expect(res.body.status).toBe(true);
        expect(shape(OTHER_ROOT)).toEqual({ parent: ROOT, ancestors: [ROOT], top: false, sprint: SPRINT });
        expect(shape(OTHER_CHILD)).toEqual({ parent: OTHER_ROOT, ancestors: [ROOT, OTHER_ROOT], top: false, sprint: SPRINT });
        [OTHER_ROOT, OTHER_CHILD].forEach((id) => expect([String(stored(id).sprintArray.id), String(stored(id).folderObjId)]).toEqual([SPRINT, FOLDER]));
        expect([stored(ROOT).subTasks, stored(OTHER_ROOT).subTasks]).toEqual([3, 1]);
        expect(liveCounts()).toEqual([7, 0]);
    });

    test('its subtasks follow even when the request does not say so', async () => {
        await toSubTask(OTHER_ROOT, ROOT, false);

        expect(shape(OTHER_CHILD)).toEqual({ parent: OTHER_ROOT, ancestors: [ROOT, OTHER_ROOT], top: false, sprint: SPRINT });
    });

    test.each([
        ['a task with subtasks under a subtask', OTHER_ROOT, CHILD, 'SUBTREE_TOO_DEEP'],
        ['a task under a level-three subtask', LONE, GRANDCHILD, 'PARENT_AT_MAX_DEPTH'],
        ['a task under one of its own subtasks', ROOT, GRANDCHILD, 'PARENT_IS_DESCENDANT'],
        ['a task under itself', LONE, LONE, 'PARENT_IS_DESCENDANT'],
    ])('%s is refused with the reason, and nothing changes', async (_, taskId, parentId, code) => {
        const snapshot = before();

        const res = await toSubTask(taskId, parentId, true);

        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, code });
        expect(res.body.statusText.length).toBeGreaterThan(10);
        expect(before()).toBe(snapshot);
        expect(liveCounts()).toEqual([5, 2]);
    });

    test('a subtask given another parent: both parents count it, and its chain is the new one', async () => {
        const res = await toSubTask(GRANDCHILD, SECOND_CHILD);

        expect(res.body.status).toBe(true);
        expect(shape(GRANDCHILD)).toEqual({ parent: SECOND_CHILD, ancestors: [ROOT, SECOND_CHILD], top: false, sprint: SPRINT });
        expect([stored(CHILD).subTasks, stored(SECOND_CHILD).subTasks]).toEqual([0, 1]);
        expect(liveCounts()).toEqual([5, 2]);
    });

    test('a subtask with subtasks moved one level up takes them along', async () => {
        await toSubTask(GRANDCHILD, SECOND_CHILD);
        mockDb.calls.length = 0;

        const res = await toSubTask(SECOND_CHILD, OTHER_ROOT, true);

        expect(res.body.status).toBe(true);
        expect(shape(SECOND_CHILD)).toEqual({ parent: OTHER_ROOT, ancestors: [OTHER_ROOT], top: false, sprint: OTHER_SPRINT });
        expect(shape(GRANDCHILD)).toEqual({ parent: SECOND_CHILD, ancestors: [OTHER_ROOT, SECOND_CHILD], top: false, sprint: OTHER_SPRINT });
        expect([stored(ROOT).subTasks, stored(OTHER_ROOT).subTasks]).toEqual([1, 2]);
        expect(liveCounts()).toEqual([3, 4]);
    });

    test('in bulk: under a subtask is allowed, and the cap is the depth rule', async () => {
        const allowed = await call(BULK, { action: 'bulkConvertToSubTask', companyId: CID, taskIds: [LONE], parentTaskId: CHILD, userData: USER });
        expect(allowed.body.data.totals).toMatchObject({ updated: 1, errors: 0 });
        expect(shape(LONE)).toEqual({ parent: CHILD, ancestors: [ROOT, CHILD], top: false, sprint: SPRINT });

        const refused = await call(BULK, { action: 'bulkConvertToSubTask', companyId: CID, taskIds: [OTHER_ROOT], parentTaskId: GRANDCHILD, userData: USER });
        expect(refused.body).toMatchObject({ status: false, statusText: expect.stringMatching(/three levels/) });

        const tooDeep = await call(BULK, { action: 'bulkConvertToSubTask', companyId: CID, taskIds: [OTHER_ROOT], parentTaskId: CHILD, userData: USER });
        expect(tooDeep.body.data.errors).toEqual([{ taskId: OTHER_ROOT, reason: expect.stringMatching(/three levels/) }]);
        expect(shape(OTHER_ROOT)).toEqual({ parent: '', ancestors: [], top: true, sprint: OTHER_SPRINT });
    });
});

describe('a task becomes a list', () => {
    test('its subtasks become tasks in the new list and theirs stay under them', async () => {
        const res = await call(PATCH, { action: 'convertToList', companyId: CID, projectData: { ...PROJECT }, taskId: ROOT, userData: USER, folderData: null, sprintObj: { id: SPRINT, folderId: FOLDER }, isSubTask: true });

        expect(res.body.status).toBe(true);
        expect(stored(ROOT)).toBeUndefined();
        expect(shape(CHILD)).toEqual({ parent: '', ancestors: [], top: true, sprint: NEW_SPRINT });
        expect(shape(SECOND_CHILD)).toEqual({ parent: '', ancestors: [], top: true, sprint: NEW_SPRINT });
        expect(shape(GRANDCHILD)).toEqual({ parent: CHILD, ancestors: [CHILD], top: false, sprint: NEW_SPRINT });
        expect(stored(CHILD).subTasks).toBe(1);
        expect([sprint(SPRINT).tasks, sprint(NEW_SPRINT).tasks]).toEqual([1, 3]);
    });
});

describe('a task that became a list', () => {
    const FIELD = '6f0000000000000000000f01';
    const linked = () => (mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS] || []).map((row) => [String(row.taskId), row.ids]);

    test('leaves no linked tasks or votes of its own, and no task linking to it', async () => {
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: ROOT, fieldId: FIELD, kind: 'relationship', ids: [LONE] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: ROOT, fieldId: '6f0000000000000000000f02', kind: 'voting', ids: [MEMBER] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: LONE, fieldId: FIELD, kind: 'relationship', ids: [ROOT, CHILD] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { taskId: CHILD, fieldId: FIELD, kind: 'relationship', ids: [LONE] });

        const res = await call(PATCH, { action: 'convertToList', companyId: CID, projectData: { ...PROJECT }, taskId: ROOT, userData: USER, folderData: null, sprintObj: { id: SPRINT, folderId: FOLDER }, isSubTask: true });

        expect(res.body.status).toBe(true);
        expect(stored(ROOT)).toBeUndefined();
        expect(linked()).toEqual([[LONE, [CHILD]], [CHILD, [LONE]]]);
    });
});

describe('merge', () => {
    const merge = (taskId, mergeTaskId) => call(PATCH, { action: 'mergeTask', companyId: CID, projectData: { ...PROJECT }, taskId, mergeTaskId, oldProject: { ...OLD_PROJECT }, isSubTask: true, userData: USER });

    test('the subtasks of the merged task go under the kept one, with its chain and placement', async () => {
        const res = await merge(OTHER_ROOT, CHILD);

        expect(res.body.status).toBe(true);
        expect(stored(OTHER_ROOT).deletedStatusKey).toBe(1);
        expect(shape(OTHER_CHILD)).toEqual({ parent: CHILD, ancestors: [ROOT, CHILD], top: false, sprint: SPRINT });
        expect(String(stored(OTHER_CHILD).folderObjId)).toBe(FOLDER);
        expect(stored(CHILD).subTasks).toBe(2);
    });

    test('under a level-three task they go to the nearest task above it that can take them', async () => {
        const res = await merge(OTHER_ROOT, GRANDCHILD);

        expect(res.body.status).toBe(true);
        expect(shape(OTHER_CHILD)).toEqual({ parent: CHILD, ancestors: [ROOT, CHILD], top: false, sprint: SPRINT });
        expect([stored(CHILD).subTasks, stored(GRANDCHILD).subTasks]).toEqual([2, 0]);
    });

    test('a subtree keeps its shape where it fits', async () => {
        const res = await merge(ROOT, OTHER_ROOT);

        expect(res.body.status).toBe(true);
        expect(shape(CHILD)).toEqual({ parent: OTHER_ROOT, ancestors: [OTHER_ROOT], top: false, sprint: OTHER_SPRINT });
        expect(shape(GRANDCHILD)).toEqual({ parent: CHILD, ancestors: [OTHER_ROOT, CHILD], top: false, sprint: OTHER_SPRINT });
        expect(shape(SECOND_CHILD)).toEqual({ parent: OTHER_ROOT, ancestors: [OTHER_ROOT], top: false, sprint: OTHER_SPRINT });
        expect(stored(OTHER_ROOT).subTasks).toBe(3);
    });
});

describe('duplicate', () => {
    test('the copy keeps the shape: three levels, each with the chain of its own copy', async () => {
        const res = await call(PATCH, {
            action: 'duplicateTask', companyId: CID, projectData: { ...PROJECT }, sprintObj: { ...OTHER_ELEMENT }, selectedTaskId: ROOT, oldProject: { ...OLD_PROJECT }, userData: USER,
            isSubTask: true, duplicateData: [], assignee: [], watcher: [], taskName: 'Copy of root', oldSprintObj: { id: SPRINT, name: 'Sprint 1' },
        });

        expect(res.body.status).toBe(true);
        const copies = allTasks().filter((t) => ![...FAMILY, OTHER_ROOT, OTHER_CHILD, LONE].includes(String(t._id)));
        expect(copies).toHaveLength(4);
        const copyOf = (name, parentId) => copies.find((t) => t.TaskName === name && String(t.ParentTaskId || '') === parentId);
        const root = copyOf('Copy of root', '');
        const child = copyOf('Task 12', String(root._id));
        const second = copyOf('Task 14', String(root._id));
        const grandchild = copyOf('Task 13', String(child._id));
        expect(root).toMatchObject({ isParentTask: true, ancestors: [] });
        expect(child.ancestors).toEqual([String(root._id)]);
        expect(second.ancestors).toEqual([String(root._id)]);
        expect(grandchild.ancestors).toEqual([String(root._id), String(child._id)]);
        copies.forEach((copy) => {
            expect(String(copy.sprintId)).toBe(OTHER_SPRINT);
            expect(copy).not.toHaveProperty('cascadedBy');
        });
        expect(FAMILY.map((id) => stored(id).ancestors)).toEqual([[], [ROOT], [ROOT, CHILD], [ROOT]]);
        expect(liveCounts()).toEqual([5, 6]);
    });
});

describe('rows carried by a move or a bulk archive', () => {
    test('an archived subtask moved with its task stays archived, and is counted as archived where it lands', async () => {
        await setState(GRANDCHILD, 2);
        expect([sprint(SPRINT).tasks, sprint(SPRINT).archiveTaskCount]).toEqual([4, 1]);

        const res = await call(PATCH, {
            action: 'moveTask', companyId: CID, projectData: { ...PROJECT }, sprintObj: { ...OTHER_ELEMENT, folderId: null }, moveTaskId: ROOT,
            oldSprintObj: { id: SPRINT, folderId: FOLDER, name: 'Sprint 1', folderName: 'Design' }, oldProject: { ...OLD_PROJECT }, isSubTask: true, assignee: [], watcher: [], userData: USER,
        });

        expect(res.body.status).toBe(true);
        expect(FAMILY.map((id) => [String(stored(id).sprintId), stored(id).deletedStatusKey])).toEqual([[OTHER_SPRINT, 0], [OTHER_SPRINT, 0], [OTHER_SPRINT, 2], [OTHER_SPRINT, 0]]);
        expect([sprint(SPRINT).tasks, sprint(SPRINT).archiveTaskCount]).toEqual([1, 0]);
        expect([sprint(OTHER_SPRINT).tasks, sprint(OTHER_SPRINT).archiveTaskCount]).toEqual([5, 1]);
    });

    test('a task and its own subtask archived in one bulk action: the subtask is carried, not archived twice', async () => {
        const res = await call(BULK, { action: 'bulkArchive', companyId: CID, taskIds: [CHILD, ROOT, GRANDCHILD], userData: USER });

        expect(res.body.data.totals).toMatchObject({ updated: 1, errors: 0 });
        expect(res.body.data.skipped.map((entry) => `${entry.taskId} ${entry.reason}`).sort()).toEqual([`${CHILD} carried-with-its-parent`, `${GRANDCHILD} carried-with-its-parent`]);
        expect(FAMILY.map((id) => stored(id).deletedStatusKey)).toEqual([2, 3, 3, 3]);
        expect([stored(ROOT).subTasks, stored(CHILD).subTasks]).toEqual([2, 1]);
        expect([sprint(SPRINT).tasks, sprint(SPRINT).archiveTaskCount]).toEqual([1, 4]);

        await call(BULK, { action: 'bulkRestore', companyId: CID, taskIds: [ROOT], userData: USER });
        expect(FAMILY.map((id) => stored(id).deletedStatusKey)).toEqual([0, 0, 0, 0]);
    });
});
