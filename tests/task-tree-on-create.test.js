/* Task 046 M2, slice N2: a subtask can sit under a subtask, three levels at most. The create paths
   take the chain and the placement from the stored parent and its root, never from the request.
   The handlers are the real ones, called as the routes call them, over the test fake; a stored
   field is read from what Mongoose hands the driver under the real task schema. */
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
const { TASK_ACTION_FIELDS, TASK_INDEX_FIELDS, PRE_V2_ACTION_FIELDS, prepareTaskWrite } = require('../Modules/Tasks/helpers/taskWriteFields');
const { CID, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT } = require('./fixtures/taskWriteGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');

mongoHelper.getTotalSprintCount = async () => true;

const SPRINT = '6f0000000000000000000e01';
const OTHER_SPRINT = '6f0000000000000000000e02';
const FOLDER = '6f0000000000000000000f01';
const OTHER_FOLDER = '6f0000000000000000000f02';
const ROOT = '6f0000000000000000000b11';
const CHILD = '6f0000000000000000000b12';
const GRANDCHILD = '6f0000000000000000000b13';
const FOLDERLESS_ROOT = '6f0000000000000000000b14';
const DELETED_ROOT = '6f0000000000000000000b15';
const FOREIGN_ROOT = '6f0000000000000000000b16';
const MISSING = '6f0000000000000000000bff';

const STATUS_LIST = [{ key: 1, name: 'To Do', type: 'default_active' }];
const TYPE_LIST = [{ key: 1, value: 'task', name: 'Task', taskCount: 0 }];
const USER = { Employee_Name: 'Max Member', id: MEMBER, companyOwnerId: OWNER };
const ROOT_ELEMENT = { id: SPRINT, name: 'Sprint 1', folderId: FOLDER, folderName: 'Design' };
const SENT_ELEMENT = { id: OTHER_SPRINT, name: 'Sprint 2', folderId: OTHER_FOLDER, folderName: 'Elsewhere' };
const projectData = (projectId = OPEN_PROJECT) => ({ _id: projectId, id: projectId, CompanyId: CID, ProjectName: 'Parity', ProjectCode: 'PAR', lastTaskId: 4, taskTypeCounts: TYPE_LIST, taskStatusData: STATUS_LIST });

const taskDoc = (extra = {}) => ({
    TaskName: 'Write the brief', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: OPEN_PROJECT, CompanyId: CID,
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, ParentTaskId: '', Task_Leader: OWNER, sprintArray: { ...ROOT_ELEMENT },
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: SPRINT, folderObjId: FOLDER, statusType: 'default_active', statusKey: 1,
    AssigneeUserId: [], watchers: [], ...extra,
});
const subtaskOf = (parentId, ancestors, extra = {}) => taskDoc({ isParentTask: false, ParentTaskId: parentId, ancestors, ...extra });

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

const tasks = () => mockDb.store[SCHEMA_TYPE.TASKS];
const stored = (id) => tasks().find((t) => String(t._id) === id);
const named = (name) => tasks().find((t) => t.TaskName === name);
const saves = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'save');
const underRealSchema = async (doc) => {
    const { writes, error } = await driverWrites('save', doc);
    expect(error).toBeNull();
    return writes[0].args[0];
};
const createBody = (data) => ({ data: taskDoc({ TaskName: 'New row', ...data }), user: USER, projectData: projectData(), indexObj: {} });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    [OPEN_PROJECT, PARITY_PROJECT].forEach((_id) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName: 'Parity', ProjectCode: 'PAR', CompanyId: CID, lastTaskId: 4, taskStatusData: STATUS_LIST, taskTypeCounts: TYPE_LIST }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: OPEN_PROJECT, folderId: FOLDER, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OTHER_SPRINT, name: 'Sprint 2', projectId: OPEN_PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: FOLDER, name: 'Design', projectId: OPEN_PROJECT });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskDoc({ TaskName: 'Root' }), _id: ROOT, subTasks: 1 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...subtaskOf(ROOT, [ROOT], { TaskName: 'Child' }), _id: CHILD, subTasks: 1 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...subtaskOf(CHILD, [ROOT, CHILD], { TaskName: 'Grandchild' }), _id: GRANDCHILD, subTasks: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskDoc({ TaskName: 'Root outside a folder', sprintId: OTHER_SPRINT, sprintArray: { id: OTHER_SPRINT, name: 'Sprint 2' } }), _id: FOLDERLESS_ROOT, folderObjId: undefined });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskDoc({ TaskName: 'Deleted root', deletedStatusKey: 1 }), _id: DELETED_ROOT });
    mockDb.seed(SCHEMA_TYPE.TASKS, { ...taskDoc({ TaskName: 'Root in another project', ProjectID: PARITY_PROJECT }), _id: FOREIGN_ROOT });
});

describe('ancestors is never taken from a request', () => {
    const req = (body) => ({ headers: { companyid: CID }, aud: CID, uid: MEMBER, body });

    test('a create body loses it before the handler runs', () => {
        const { payload, dropped } = prepareTaskWrite(req(createBody({ ancestors: [GRANDCHILD] })), TASK_ACTION_FIELDS.create, 'create');

        expect(payload.data).not.toHaveProperty('ancestors');
        expect(payload.data.TaskName).toBe('New row');
        expect(dropped).toContain('data.ancestors');
    });

    test('no action copies it from a body into a task', () => {
        const specs = [...Object.entries(TASK_ACTION_FIELDS), ...Object.entries(PRE_V2_ACTION_FIELDS), ['taskIndex', TASK_INDEX_FIELDS]];
        const writing = specs.flatMap(([action, spec]) => Object.entries(spec.writes).filter(([, fields]) => fields.includes('ancestors')).map(([name]) => `${action}.${name}`));

        expect(writing).toEqual([]);
    });

    test.each([
        ['updateTaskName', { firebaseObj: { TaskName: 'Renamed', ancestors: [GRANDCHILD] } }, 'firebaseObj'],
        ['updateStatus', { newStatus: { statusKey: 1, ancestors: [GRANDCHILD] } }, 'newStatus'],
    ])('%s drops it from the fields it writes', (action, body, name) => {
        const { payload, dropped } = prepareTaskWrite(req({ action, ...body }), TASK_ACTION_FIELDS[action], action);

        expect(payload[name]).not.toHaveProperty('ancestors');
        expect(dropped).toContain(`${name}.ancestors`);
    });

    test('a top-level task stores an empty chain whatever the body says', async () => {
        const res = await call(CREATE, createBody({ ancestors: [ROOT, CHILD] }));

        expect(res.body.status).toBe(true);
        expect(named('New row').ancestors).toEqual([]);
        expect((await underRealSchema(saves()[0].data)).ancestors).toEqual([]);
    });
});

describe('creating a subtask', () => {
    test('under a task: the chain is the parent, and the parent counts it', async () => {
        const res = await call(CREATE, createBody({ isParentTask: false, ParentTaskId: ROOT }));

        expect(res.body).toMatchObject({ status: true });
        expect(named('New row')).toMatchObject({ ParentTaskId: ROOT, isParentTask: false, ancestors: [ROOT] });
        expect(stored(ROOT).subTasks).toBe(2);
        expect((await underRealSchema(saves()[0].data)).ancestors).toEqual([ROOT]);
    });

    test('under a subtask: allowed, with a chain of two and the direct parent counting it', async () => {
        const res = await call(CREATE, createBody({ isParentTask: false, ParentTaskId: CHILD }));

        expect(res.body).toMatchObject({ status: true });
        expect(named('New row')).toMatchObject({ ParentTaskId: CHILD, isParentTask: false, ancestors: [ROOT, CHILD] });
        expect(stored(CHILD).subTasks).toBe(2);
        expect(stored(ROOT).subTasks).toBe(1);
        expect((await underRealSchema(saves()[0].data)).ancestors).toEqual([ROOT, CHILD]);
    });

    test('under a level-three subtask: refused with the reason, and nothing is written', async () => {
        const res = await call(CREATE, createBody({ isParentTask: false, ParentTaskId: GRANDCHILD }));

        expect(res.code).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: expect.stringMatching(/three levels/), code: 'PARENT_AT_MAX_DEPTH' });
        expect(saves()).toEqual([]);
        expect(stored(GRANDCHILD).subTasks).toBe(0);
        expect(updateSprintFun).not.toHaveBeenCalled();
    });

    test('the sprint, the folder and the chain come from the stored root, not from the body', async () => {
        const res = await call(CREATE, createBody({
            isParentTask: true, ParentTaskId: CHILD, ancestors: [FOLDERLESS_ROOT],
            sprintId: OTHER_SPRINT, sprintArray: SENT_ELEMENT, folderObjId: OTHER_FOLDER,
        }));

        expect(res.body).toMatchObject({ status: true });
        const row = await underRealSchema(saves()[0].data);
        expect(row.ancestors).toEqual([ROOT, CHILD]);
        expect(row.isParentTask).toBe(false);
        expect([String(row.ProjectID), String(row.sprintId), String(row.folderObjId)]).toEqual([OPEN_PROJECT, SPRINT, FOLDER]);
        expect({ ...row.sprintArray, id: String(row.sprintArray.id), folderId: String(row.sprintArray.folderId) }).toEqual(ROOT_ELEMENT);
    });

    test('the sprint that counts the new row is the root\'s', async () => {
        await call(CREATE, createBody({ isParentTask: false, ParentTaskId: CHILD, sprintId: OTHER_SPRINT, sprintArray: SENT_ELEMENT, folderObjId: OTHER_FOLDER }));

        expect(updateSprintFun).toHaveBeenCalledTimes(1);
        const [{ body, params }] = updateSprintFun.mock.calls[0];
        expect(String(params.id)).toBe(SPRINT);
        expect(body.updateObject).toEqual({ $inc: { tasks: 1 } });
        expect(String(body.folder.folderId)).toBe(FOLDER);
    });

    test('a root outside a folder leaves the subtask outside one, whatever the body says', async () => {
        await call(CREATE, createBody({ isParentTask: false, ParentTaskId: FOLDERLESS_ROOT, folderObjId: OTHER_FOLDER }));

        const row = await underRealSchema(saves()[0].data);
        expect(row.folderObjId).toBeUndefined();
        expect(String(row.sprintId)).toBe(OTHER_SPRINT);
    });

    test.each([
        ['a parent that does not exist', MISSING, {}],
        ['a deleted parent', DELETED_ROOT, {}],
        ['a parent in a project the request was not judged in', FOREIGN_ROOT, {}],
    ])('%s is refused as not found', async (_, parentId, extra) => {
        const res = await call(CREATE, createBody({ isParentTask: false, ParentTaskId: parentId, ...extra }));

        expect(res.code).toBe(404);
        expect(res.body).toMatchObject({ status: false, code: 'PARENT_NOT_FOUND' });
        expect(saves()).toEqual([]);
    });
});

describe('AI subtasks', () => {
    const aiBody = (parentId, extra = {}) => ({
        action: 'createSubTaskWithAi', companyId: CID, userId: MEMBER, subTitles: [{ title: 'Step one' }, { title: 'Step two' }],
        sprintObj: { ...SENT_ELEMENT }, projectData: projectData(), userData: USER, parentTask: { id: parentId, ProjectID: OPEN_PROJECT }, type: 'subTask', ...extra,
    });

    test('under a subtask they take its chain and the root\'s sprint', async () => {
        const res = await call(PATCH, aiBody(CHILD));

        expect(res.body.status).toBe(true);
        expect(saves()).toHaveLength(2);
        for (const save of saves()) {
            const row = await underRealSchema(save.data);
            expect(row.ancestors).toEqual([ROOT, CHILD]);
            expect([String(row.sprintId), String(row.folderObjId), String(row.sprintArray.id)]).toEqual([SPRINT, FOLDER, SPRINT]);
        }
        expect(stored(CHILD).subTasks).toBe(3);
    });

    test('under a level-three subtask they are refused with the reason', async () => {
        const res = await call(PATCH, aiBody(GRANDCHILD));

        expect(res.code).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: expect.stringMatching(/three levels/), code: 'PARENT_AT_MAX_DEPTH' });
        expect(saves()).toEqual([]);
    });

    test('as tasks they stay top-level', async () => {
        const res = await call(PATCH, aiBody(undefined, { type: 'task', sprintObj: { id: OTHER_SPRINT, name: 'Sprint 2' }, parentTask: { ProjectID: OPEN_PROJECT } }));

        expect(res.body.status).toBe(true);
        expect(saves().map((save) => [save.data.ParentTaskId, save.data.isParentTask, save.data.ancestors])).toEqual([['', true, []], ['', true, []]]);
    });
});

describe('an import creates its rows level by level', () => {
    const row = (_id, ParentTaskId = '') => ({ _id, TaskName: `Row ${_id}`, status: 'To Do', Task_Leader: OWNER, ParentTaskId });
    const importBody = (rows) => ({ tasks: rows, userData: USER, projectData: projectData(), indexObj: {}, statusArray: STATUS_LIST, sprint: { id: OTHER_SPRINT, name: 'Sprint 2' }, eventId: 'e1' });
    const idOf = (localId) => String(named(`Row ${localId}`)._id);

    test('a three-level file keeps three levels, whatever order its rows come in', async () => {
        const res = await call(IMPORT, importBody([row('c', 'b'), row('b', 'a'), row('a'), row('b2', 'a')]));

        expect(res.body.status).toBe(true);
        expect(named('Row a')).toMatchObject({ isParentTask: true, ParentTaskId: '', ancestors: [], subTasks: 2 });
        expect(named('Row b')).toMatchObject({ isParentTask: false, ParentTaskId: idOf('a'), ancestors: [idOf('a')], subTasks: 1 });
        expect(named('Row b2')).toMatchObject({ isParentTask: false, ParentTaskId: idOf('a'), ancestors: [idOf('a')] });
        expect(named('Row c')).toMatchObject({ isParentTask: false, ParentTaskId: idOf('b'), ancestors: [idOf('a'), idOf('b')] });
        expect(res.body.data.adjusted).toEqual([]);
        for (const save of saves()) expect(String((await underRealSchema(save.data)).sprintId)).toBe(OTHER_SPRINT);
    });

    test('a four-level file hangs the fourth level on its level-two ancestor and says so', async () => {
        const res = await call(IMPORT, importBody([row('a'), row('b', 'a'), row('c', 'b'), row('d', 'c'), row('e', 'd')]));

        expect(res.body.status).toBe(true);
        expect(named('Row c')).toMatchObject({ ParentTaskId: idOf('b'), ancestors: [idOf('a'), idOf('b')] });
        ['d', 'e'].forEach((id) => expect(named(`Row ${id}`)).toMatchObject({ isParentTask: false, ParentTaskId: idOf('b'), ancestors: [idOf('a'), idOf('b')] }));
        expect(named('Row b').subTasks).toBe(3);
        expect(res.body.data.adjusted).toEqual([
            { _id: 'd', TaskName: 'Row d', reason: 'TOO_DEEP' },
            { _id: 'e', TaskName: 'Row e', reason: 'TOO_DEEP' },
        ]);
    });

    test('a row whose parent is not in the file, or that loops, is imported as a task and reported', async () => {
        const res = await call(IMPORT, importBody([row('a', 'gone'), row('x', 'y'), row('y', 'x')]));

        expect(res.body.status).toBe(true);
        ['a', 'x', 'y'].forEach((id) => expect(named(`Row ${id}`)).toMatchObject({ isParentTask: true, ParentTaskId: '', ancestors: [] }));
        expect(res.body.data.adjusted).toEqual([
            { _id: 'a', TaskName: 'Row a', reason: 'PARENT_MISSING' },
            { _id: 'x', TaskName: 'Row x', reason: 'CYCLE' },
            { _id: 'y', TaskName: 'Row y', reason: 'CYCLE' },
        ]);
    });
});
