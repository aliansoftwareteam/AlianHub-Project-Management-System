const mockFake = require('./fixtures/fakeMongo');
const mockDbs = {};
const mockDbOf = (companyId) => {
    const key = String(companyId);
    mockDbs[key] = mockDbs[key] || mockFake.create({ mongooseCasting: true });
    return mockDbs[key];
};

// Each company has its own database; Mongoose treats an update without operators as a $set, fakeMongo only applies operators.
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        const [filter, update, ...rest] = Array.isArray(q.data) ? q.data : [];
        const plain = method === 'findOneAndUpdate' && update && !Object.keys(update).some((k) => k.startsWith('$'));
        return mockDbOf(companyId).crud(companyId, plain ? { ...q, data: [filter, { $set: update }, ...rest] } : q, method);
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { INDEX_NAMES, SEARCH_KEYS } = require('../Modules/Tasks/helpers/taskWriteFields');
const WEB_APP_BODIES = require('./fixtures/taskWriteBodies');
const { CID, OTHER_COMPANY, OWNER, MEMBER, OPEN_PROJECT, PARITY_PROJECT, LOCKED_PROJECT, OPEN_TASK, OPEN_TASK_2, PARITY_TASK, LOCKED_TASK } = require('./fixtures/taskWriteGuard');

const { VIEW_GROUPS, onLoadIndex } = WEB_APP_BODIES;
const ONLOAD = 'POST /api/v1/updateTaskIndexOnload';
const PRIVATE_PROJECT = LOCKED_PROJECT;
const PRIVATE_TASK = LOCKED_TASK;
const FOREIGN_TASK = '6f0000000000000000000b0f';
const STEP = 65536;

const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (routePath, ...handlers) => { table[`${method} ${routePath}`] = handlers[handlers.length - 1]; };
    require(modulePath).init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};
const ROUTES = routesOf('../Modules/taskIndex/routes');

/* The body crosses the wire as JSON, so a test sends what JSON keeps of it. */
const call = (body, uid = MEMBER) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: 'no answer' }), 1500);
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { clearTimeout(timer); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { method: 'POST', path: '/api/v1/updateTaskIndexOnload', originalUrl: '/api/v1/updateTaskIndexOnload', headers: { companyid: CID }, aud: CID, uid, body: clone(body) };
    ROUTES[ONLOAD](req, res, () => { clearTimeout(timer); resolve({ code: 'next' }); });
}).then(async (result) => { await settle(); return result; });

const taskDoc = (_id, extra = {}) => ({
    _id, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `PAR-${_id.slice(-1)}`, ProjectID: OPEN_PROJECT, CompanyId: CID, sprintId: 's1',
    statusKey: 2, Task_Priority: 'HIGH', AssigneeUserId: [MEMBER], DueDate: null, deletedStatusKey: 0, ...extra,
});

const tasksOf = (companyId = CID) => mockDbOf(companyId).store[SCHEMA_TYPE.TASKS] || [];
const stored = (id, companyId = CID) => clone(tasksOf(companyId).find((task) => String(task._id) === id) || null);
const everyTask = () => JSON.stringify([CID, OTHER_COMPANY].map((companyId) => tasksOf(companyId)));
const taskWrites = () => [CID, OTHER_COMPANY].flatMap((companyId) => mockDbOf(companyId).calls)
    .filter((c) => c.type === SCHEMA_TYPE.TASKS && !['find', 'findOne', 'aggregate', 'countDocuments'].includes(c.method));

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    socketEmitter.emit.mockClear();
    const db = mockDbOf(CID);
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    const taskRules = db.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [] });
    db.seed(SCHEMA_TYPE.RULES, { key: 'task_list', name: 'Task List', isParent: false, parentId: String(taskRules._id), roles: [{ key: 3, permission: true }] });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: OPEN_PROJECT, ProjectName: 'Open', CompanyId: CID });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: PARITY_PROJECT, ProjectName: 'Parity', CompanyId: CID });
    db.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Private', CompanyId: CID, isPrivateSpace: true, AssigneeUserId: [OWNER] });
    db.seed(SCHEMA_TYPE.TASKS, taskDoc(OPEN_TASK));
    db.seed(SCHEMA_TYPE.TASKS, taskDoc(PRIVATE_TASK, { ProjectID: PRIVATE_PROJECT }));
    mockDbOf(OTHER_COMPANY).seed(SCHEMA_TYPE.TASKS, taskDoc(FOREIGN_TASK, { CompanyId: OTHER_COMPANY }));
});

const sent = (group, taskId = OPEN_TASK) => onLoadIndex(group)({ taskId });

const refused = async (body, code) => {
    const before = everyTask();
    const result = await call(body);
    expect(result.code).toBe(code);
    expect(result.body).toMatchObject({ status: false });
    expect(everyTask()).toBe(before);
    expect(taskWrites()).toEqual([]);
    expect(socketEmitter.emit).not.toHaveBeenCalled();
    return result;
};

describe('the body a task view sends when it opens is accepted and writes the missing index', () => {
    const rows = WEB_APP_BODIES.filter((row) => row.route === ONLOAD).map((row) => [row.source, row]);

    test('every view that repairs indexes is in the fixture', () => {
        expect([...new Set(rows.map(([source]) => source.split(',')[0]))].sort()).toEqual([
            'components/organisms/ItemList/ItemList.vue', 'plugins/tasklistDashboard TaskItemList.vue',
            'views/Projects/Kanban/KanbanBoard.vue', 'views/Projects/TableView/TableViewTable.vue',
        ]);
    });

    test.each(rows)('%s', async (_, row) => {
        const body = row.body({ taskId: OPEN_TASK });
        const { indexName } = body.taskUpdate.item;

        const result = await call(body);

        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(stored(OPEN_TASK)[indexName]).toBe(0);
        expect(taskWrites()).toHaveLength(1);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'task', updatedFields: { [indexName]: 0 } }));
    });

    test.each([
        ['status', { statusKey: 2 }],
        ['priority', { Task_Priority: 'HIGH' }],
        ['assignee', { AssigneeUserId: [MEMBER, OWNER] }],
        ['unassigned', { AssigneeUserId: [] }],
    ])('a task joins the end of its %s group', async (kind, held) => {
        const group = VIEW_GROUPS[kind];
        Object.assign(tasksOf().find((task) => task._id === OPEN_TASK), held);
        mockDbOf(CID).seed(SCHEMA_TYPE.TASKS, taskDoc(OPEN_TASK_2, { ...held, [group.indexName]: 5 }));

        const result = await call(sent(group));

        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(stored(OPEN_TASK)[group.indexName]).toBe(5 + STEP);
        expect(stored(OPEN_TASK_2)[group.indexName]).toBe(5);
    });

    test('a task that already holds the index is left alone', async () => {
        tasksOf().find((task) => task._id === OPEN_TASK).groupByStatusIndex = 7;

        const result = await call(sent(VIEW_GROUPS.status));

        expect(result).toMatchObject({ code: 200, body: { status: true } });
        expect(stored(OPEN_TASK).groupByStatusIndex).toBe(7);
        expect(taskWrites()).toEqual([]);
    });

    test('a task is placed among the tasks of its own project', async () => {
        mockDbOf(CID).seed(SCHEMA_TYPE.TASKS, taskDoc(PARITY_TASK, { ProjectID: PARITY_PROJECT, groupByStatusIndex: 5 }));

        await call(sent(VIEW_GROUPS.status));

        expect(stored(OPEN_TASK).groupByStatusIndex).toBe(0);
        expect(stored(PARITY_TASK).groupByStatusIndex).toBe(5);
    });

    test('the views name the groups the route knows', () => {
        const { GROUP_INDEXES } = require('../frontend/src/views/Projects/composables/taskGroupIndex');
        expect(Object.keys(GROUP_INDEXES).sort()).toEqual([...SEARCH_KEYS].sort());
        expect(Object.values(GROUP_INDEXES).sort()).toEqual([...INDEX_NAMES].sort());
    });
});

describe('the on-load index route still refuses what it should', () => {
    const plain = () => ({ taskUpdate: { data: OPEN_TASK, item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 2 }, taskKey: 'PAR-1' }, companyId: CID });

    test.each([
        ['a whole group, which carries its query', (body) => { body.taskUpdate.item = VIEW_GROUPS.status; }],
        ['an update operator beside the item', (body) => { body.taskUpdate.$set = { groupByStatusIndex: 1 }; }],
        ['an update operator inside the item', (body) => { body.taskUpdate.item.$inc = { groupByStatusIndex: 1 }; }],
        ['an update operator at the top', (body) => { body.$unset = { groupByStatusIndex: 1 }; }],
        ['a list as the group value', (body) => { body.taskUpdate.item.searchValue = [MEMBER]; }],
        ['a custom field as the group', (body) => { body.taskUpdate.item = VIEW_GROUPS.customField; }],
    ])('%s is refused and nothing is written', async (_, change) => {
        const body = plain();
        change(body);
        await refused(body, 400);
    });

    test('another company\'s task is not found and stays as it was', async () => {
        const body = plain();
        body.taskUpdate.data = FOREIGN_TASK;

        await refused(body, 404);
        expect(stored(FOREIGN_TASK, OTHER_COMPANY).groupByStatusIndex).toBeUndefined();
    });

    test('a body naming another company is refused', async () => {
        const body = plain();
        body.taskUpdate.data = FOREIGN_TASK;
        body.companyId = OTHER_COMPANY;

        await refused(body, 403);
    });

    test('a task in a project the caller cannot open is not found', async () => {
        const body = plain();
        body.taskUpdate.data = PRIVATE_TASK;

        await refused(body, 404);

        const owner = await call(body, OWNER);
        expect(owner).toMatchObject({ code: 200, body: { status: true } });
        expect(stored(PRIVATE_TASK).groupByStatusIndex).toBe(0);
    });
});
