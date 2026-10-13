const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
let mockAggregateFails = false;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => {
        if (mockAggregateFails && args[2] === 'aggregate') return Promise.reject(new Error('aggregate unavailable'));
        return mockDb.crud(...args);
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const ON_SPRINT = 'a00000000000000000000003';
const OFF_SPRINT = 'a00000000000000000000004';
const ON_TEAM = 'a00000000000000000000005';
const GUEST = 'a00000000000000000000006';
const MEMBER_ROLE = 3;
const GUEST_ROLE = 0;

const oid = () => new mongoose.Types.ObjectId().toString();

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require(modulePath).init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    return res;
};

const call = async (path, uid, { query = {}, body = {}, params = {} } = {}) => {
    const res = response();
    for (const handler of routesOf('../Modules/Epics/routes')[path]) {
        let advanced = false;
        await handler({ uid, params, body, query, headers: { companyid: C } }, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

let project;
let epic;
let openSprint;
let privateSprint;
let teamSprint;

const seedTask = (sprintId, statusType, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), TaskName: 'Work', ProjectID: String(project._id), sprintId: String(sprintId), epicId: String(epic._id), statusType, isParentTask: true, deletedStatusKey: 0, AssigneeUserId: [], ...extra,
});

const progressFor = async (uid) => {
    const res = await call('GET /api/v2/epics', uid, { query: { projectId: String(project._id) } });
    expect(res.body.status).toBe(true);
    const row = res.body.data.find((e) => String(e._id) === String(epic._id));
    return [row.completedCount, row.taskCount];
};

beforeEach(() => {
    myCache.flushAll();
    mockAggregateFails = false;
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ADMIN, 2], [ON_SPRINT, MEMBER_ROLE], [OFF_SPRINT, MEMBER_ROLE], [ON_TEAM, MEMBER_ROLE], [GUEST, GUEST_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    const taskRules = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }, { key: GUEST_ROLE, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', isParent: false, parentId: String(taskRules._id), roles: [{ key: MEMBER_ROLE, permission: true }, { key: GUEST_ROLE, permission: false }] });
    const team = mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Crew', assigneeUsersArray: [ON_TEAM] });
    project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] });
    openSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Open', projectId: String(project._id) });
    privateSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Closed door', projectId: String(project._id), private: true, AssigneeUserId: [ON_SPRINT] });
    teamSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Crew only', projectId: String(project._id), private: true, AssigneeUserId: [`tId_${team._id}`] });
    epic = mockDb.seed(SCHEMA_TYPE.EPICS, { _id: oid(), name: 'Checkout', ProjectID: String(project._id), deletedStatusKey: 0, taskCount: 7, completedCount: 4, createdAt: new Date() });
    seedTask(openSprint._id, 'close');
    seedTask(openSprint._id, 'active');
    seedTask(openSprint._id, 'close', { deletedStatusKey: 1 });
    seedTask(privateSprint._id, 'close');
    seedTask(privateSprint._id, 'close');
    seedTask(privateSprint._id, 'active');
    seedTask(teamSprint._id, 'close');
    seedTask(teamSprint._id, 'default_active');
});

describe('epic progress in the epic list', () => {
    it.each([
        ['an owner', OWNER, [4, 7]],
        ['an admin', ADMIN, [4, 7]],
        ['a member on the private sprint', ON_SPRINT, [3, 5]],
        ['a member whose team is on a private sprint', ON_TEAM, [2, 4]],
        ['a member on neither private sprint', OFF_SPRINT, [1, 2]],
    ])('counts, for %s, the tasks in the sprints they can open', async (_who, uid, expected) => {
        expect(await progressFor(uid)).toEqual(expected);
    });

    it('leaves a conversation row out of the counts', async () => {
        seedTask(openSprint._id, 'close', { mainChat: true });
        expect(await progressFor(OWNER)).toEqual([4, 7]);
    });

    it('gives the stored counters, when the live count fails, only to someone who reads every sprint', async () => {
        mockAggregateFails = true;
        expect(await progressFor(OWNER)).toEqual([4, 7]);
        expect(await progressFor(OFF_SPRINT)).toEqual([0, 0]);
    });

    it('answers 404 for a personal list that is someone else\'s, whatever the role', async () => {
        const list = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Mine', isPrivateSpace: true, isPersonal: true, personalOwner: OFF_SPRINT, AssigneeUserId: [OFF_SPRINT] });
        const query = { projectId: String(list._id) };
        expect((await call('GET /api/v2/epics', OWNER, { query })).statusCode).toBe(404);
        expect((await call('GET /api/v2/epics', ON_SPRINT, { query })).statusCode).toBe(404);
        expect((await call('GET /api/v2/epics', OFF_SPRINT, { query })).body.status).toBe(true);
    });
});

describe('the epic a write answers with', () => {
    it('carries the editor\'s own counts after an update', async () => {
        const params = { id: String(epic._id) };
        const mine = await call('PUT /api/v2/epics/:id', OFF_SPRINT, { params, body: { name: 'Checkout v2' } });
        expect([mine.body.data.completedCount, mine.body.data.taskCount]).toEqual([1, 2]);
        const all = await call('PUT /api/v2/epics/:id', OWNER, { params, body: { name: 'Checkout v3' } });
        expect([all.body.data.completedCount, all.body.data.taskCount]).toEqual([4, 7]);
    });

    it('carries the caller\'s own counts after a recount, while the stored counters cover every task', async () => {
        const res = await call('POST /api/v2/epics/:id/recount', OFF_SPRINT, { params: { id: String(epic._id) } });
        expect([res.body.data.completedCount, res.body.data.taskCount]).toEqual([1, 2]);
        const stored = mockDb.store[SCHEMA_TYPE.EPICS][0];
        expect([stored.completedCount, stored.taskCount]).toEqual([4, 7]);
    });
});

describe('putting a task into an epic', () => {
    const assign = (uid, taskId) => call('POST /api/v2/epics/assign', uid, { body: { taskId: String(taskId), epicId: String(epic._id) } });

    it('is refused for a task in a private sprint the caller is not on', async () => {
        const task = seedTask(privateSprint._id, 'active', { epicId: undefined });
        const res = await assign(OFF_SPRINT, task._id);
        expect(res.body).toMatchObject({ status: false, statusText: 'Task not found.' });
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === task._id).epicId).toBeUndefined();
    });

    it.each([['a member on the sprint', ON_SPRINT], ['an owner', OWNER]])('goes through for %s', async (_who, uid) => {
        const task = seedTask(privateSprint._id, 'active', { epicId: undefined });
        const res = await assign(uid, task._id);
        expect(res.body.status).toBe(true);
        expect(String(mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === task._id).epicId)).toBe(String(epic._id));
    });

    it('is refused for a conversation the caller is not in', async () => {
        const row = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskName: 'Direct message', ProjectID: oid(), mainChat: true, AssigneeUserId: [OWNER, ADMIN], deletedStatusKey: 0 });
        const res = await assign(OFF_SPRINT, row._id);
        expect(res.body).toMatchObject({ status: false, statusText: 'Task not found.' });
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === row._id).epicId).toBeUndefined();
    });
});

describe('a role that may not create tasks in the project', () => {
    const epicCount = () => mockDb.store[SCHEMA_TYPE.EPICS].filter((row) => row.deletedStatusKey === 0).length;

    it('reads the epics', async () => {
        const res = await call('GET /api/v2/epics', GUEST, { query: { projectId: String(project._id) } });
        expect(res.body.status).toBe(true);
        expect(res.body.data).toHaveLength(1);
    });

    it.each([
        ['create an epic', 'POST /api/v2/epics', () => ({ body: { name: 'Mine', projectId: String(project._id) } })],
        ['edit an epic', 'PUT /api/v2/epics/:id', () => ({ params: { id: String(epic._id) }, body: { name: 'Renamed' } })],
        ['delete an epic', 'DELETE /api/v2/epics/:id', () => ({ params: { id: String(epic._id) } })],
        ['recount an epic', 'POST /api/v2/epics/:id/recount', () => ({ params: { id: String(epic._id) } })],
        ['move a task between epics', 'POST /api/v2/epics/assign', () => ({ body: { taskId: String(mockDb.store[SCHEMA_TYPE.TASKS][0]._id), epicId: null } })],
    ])('cannot %s', async (_what, path, request) => {
        const res = await call(path, GUEST, request());
        expect(res.statusCode).toBe(403);
        expect(epicCount()).toBe(1);
        expect(mockDb.store[SCHEMA_TYPE.EPICS][0]).toMatchObject({ name: 'Checkout', taskCount: 7 });
        expect(String(mockDb.store[SCHEMA_TYPE.TASKS][0].epicId)).toBe(String(epic._id));
    });

    it('leaves a member who may create tasks able to create, edit and delete an epic', async () => {
        const created = await call('POST /api/v2/epics', OFF_SPRINT, { body: { name: 'Mine', projectId: String(project._id) } });
        expect(created.body.status).toBe(true);
        const params = { id: String(created.body.data._id) };
        expect((await call('PUT /api/v2/epics/:id', OFF_SPRINT, { params, body: { name: 'Ours' } })).body.status).toBe(true);
        expect((await call('DELETE /api/v2/epics/:id', OFF_SPRINT, { params })).body.status).toBe(true);
    });
});
