const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockChat = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: mockChat }),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const CREATOR = 'a00000000000000000000003';
const OPENS_ALL = 'a00000000000000000000004';
const OPENS_SOME = 'a00000000000000000000005';
const OPENS_NONE = 'a00000000000000000000006';
const MEMBER_ROLE = 3;

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

const call = async (modulePath, path, uid, { query = {}, body = {}, params = {} } = {}) => {
    const res = response();
    for (const handler of routesOf(modulePath)[path]) {
        let advanced = false;
        await handler({ uid, aud: C, params, body, query, headers: { companyid: C } }, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};
const portfolio = (path, uid, request) => call('../Modules/Portfolio/routes', path, uid, request);

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

let alpha;
let beta;
let board;
let betaPrivateSprint;

const seedTask = (project, statusType, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), TaskName: 'Work', ProjectID: String(project._id), statusType, isParentTask: true, deletedStatusKey: 0, AssigneeUserId: [], ...extra,
});
const stored = (id) => mockDb.store[SCHEMA_TYPE.PORTFOLIOS].find((row) => String(row._id) === String(id));
const listFor = async (uid) => (await portfolio('GET /api/v1/portfolio', uid)).body.data;
const rollupFor = (uid, id = board._id) => portfolio('GET /api/v1/portfolio/:id/rollup', uid, { params: { id: String(id) } });

beforeEach(() => {
    myCache.flushAll();
    mockChat.mockReset();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ADMIN, 2], [CREATOR, MEMBER_ROLE], [OPENS_ALL, MEMBER_ROLE], [OPENS_SOME, MEMBER_ROLE], [OPENS_NONE, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    seedRules({ 'project.private_projects': 1 });
    alpha = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Alpha', isPrivateSpace: true, AssigneeUserId: [CREATOR, OPENS_ALL], status: 'active' });
    beta = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Beta', isPrivateSpace: true, AssigneeUserId: [CREATOR, OPENS_ALL, OPENS_SOME], status: 'active' });
    const betaSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Open', projectId: String(beta._id) });
    betaPrivateSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Closed door', projectId: String(beta._id), private: true, AssigneeUserId: [OPENS_ALL] });
    seedTask(alpha, 'close');
    seedTask(alpha, 'active');
    seedTask(beta, 'close', { sprintId: String(betaSprint._id) });
    seedTask(beta, 'active', { sprintId: String(betaSprint._id) });
    seedTask(beta, 'close', { sprintId: String(betaPrivateSprint._id) });
    seedTask(beta, 'close', { sprintId: String(betaPrivateSprint._id) });
    seedTask(beta, 'active', { sprintId: String(betaPrivateSprint._id), DueDate: new Date('2020-01-01') });
    board = mockDb.seed(SCHEMA_TYPE.PORTFOLIOS, { _id: oid(), name: 'Board pack', description: 'Q4 bets', projectIds: [String(alpha._id), String(beta._id)], createdBy: CREATOR, deletedStatusKey: 0 });
});

describe('the portfolio list', () => {
    it('leaves out a portfolio none of whose projects the caller can open', async () => {
        const rows = await listFor(OPENS_NONE);
        expect(rows).toEqual([]);
        expect(JSON.stringify(rows)).not.toContain('Board pack');
    });

    it('names only the projects the caller can open', async () => {
        const [row] = await listFor(OPENS_SOME);
        expect(row.name).toBe('Board pack');
        expect(row.projectIds).toEqual([String(beta._id)]);
    });

    it.each([
        ['a member who can open every project', OPENS_ALL],
        ['its creator', CREATOR],
        ['an owner', OWNER],
        ['an admin', ADMIN],
    ])('names every project to %s', async (_who, uid) => {
        const [row] = await listFor(uid);
        expect(row.projectIds).toEqual([String(alpha._id), String(beta._id)]);
    });

    it('lists a portfolio to its creator and to owners even when it holds nothing they can open', async () => {
        const empty = mockDb.seed(SCHEMA_TYPE.PORTFOLIOS, { _id: oid(), name: 'Draft', projectIds: [], createdBy: OPENS_NONE, deletedStatusKey: 0 });
        expect((await listFor(OPENS_NONE)).map((row) => String(row._id))).toEqual([String(empty._id)]);
        expect((await listFor(OWNER)).map((row) => row.name).sort()).toEqual(['Board pack', 'Draft']);
        expect((await listFor(OPENS_SOME)).map((row) => row.name)).toEqual(['Board pack']);
    });

    it('never names a personal list that is someone else\'s, whatever the role', async () => {
        const list = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Errands', isPrivateSpace: true, isPersonal: true, personalOwner: OPENS_SOME, AssigneeUserId: [OPENS_SOME], status: 'active' });
        seedTask(list, 'active');
        const mine = mockDb.seed(SCHEMA_TYPE.PORTFOLIOS, { _id: oid(), name: 'Mine', projectIds: [String(list._id)], createdBy: OPENS_SOME, deletedStatusKey: 0 });
        const forOwner = (await listFor(OWNER)).find((row) => String(row._id) === String(mine._id));
        expect(forOwner.projectIds).toEqual([]);
        const res = await rollupFor(OWNER, mine._id);
        expect(res.body.data.projects).toEqual([]);
        expect((await rollupFor(OPENS_SOME, mine._id)).body.data.totals.totalTasks).toBe(1);
    });
});

describe('the portfolio rollup', () => {
    it('answers 404 to a caller who can open none of its projects', async () => {
        const res = await rollupFor(OPENS_NONE);
        expect(res.statusCode).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('Board pack');
    });

    it('counts, for a member not on a private sprint, only the tasks outside it', async () => {
        const { data } = (await rollupFor(OPENS_SOME)).body;
        expect(data.projects.map((p) => p.name)).toEqual(['Beta']);
        expect(data.totals).toMatchObject({ projects: 1, totalTasks: 2, doneTasks: 1, overdueTasks: 0 });
    });

    it.each([
        ['a member on the private sprint', OPENS_ALL],
        ['an owner', OWNER],
        ['an admin', ADMIN],
    ])('counts every task for %s', async (_who, uid) => {
        const { data } = (await rollupFor(uid)).body;
        expect(data.totals).toMatchObject({ projects: 2, totalTasks: 7, doneTasks: 4, overdueTasks: 1 });
    });

    it('counts, for the creator, the projects they can open minus the private sprint they are not on', async () => {
        const { data } = (await rollupFor(CREATOR)).body;
        expect(data.totals).toMatchObject({ projects: 2, totalTasks: 4, doneTasks: 2, overdueTasks: 0 });
    });
});

describe('the written summary', () => {
    const summaryFor = (uid) => portfolio('POST /api/v1/portfolio/summary', uid, { body: { portfolioId: String(board._id) } });

    it('answers 404 to a caller who can open none of the portfolio\'s projects', async () => {
        const res = await summaryFor(OPENS_NONE);
        expect(res.statusCode).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('is written from the caller\'s own figures and never served to someone who sees different ones', async () => {
        mockChat.mockImplementation(async ({ messages }) => ({ content: `figures ${messages[0].content}`, model: 'test' }));
        const forOwner = (await summaryFor(OWNER)).body.data;
        const forCreator = (await summaryFor(CREATOR)).body.data;
        expect(forOwner.summary).toContain('"totalTasks":7');
        expect(forCreator.cached).toBeUndefined();
        expect(forCreator.summary).toContain('"totalTasks":4');
        expect((await summaryFor(ADMIN)).body.data).toMatchObject({ cached: true, summary: forOwner.summary });
    });
});

describe('changing a portfolio', () => {
    const update = (uid, body, id = board._id) => portfolio('PUT /api/v1/portfolio/:id', uid, { params: { id: String(id) }, body });
    const remove = (uid, id = board._id) => portfolio('DELETE /api/v1/portfolio/:id', uid, { params: { id: String(id) } });

    it('is refused with 404 for a caller who cannot see it', async () => {
        const res = await update(OPENS_NONE, { name: 'Renamed', projectIds: [] });
        expect(res.statusCode).toBe(404);
        expect(stored(board._id)).toMatchObject({ name: 'Board pack', projectIds: [String(alpha._id), String(beta._id)] });
        expect((await remove(OPENS_NONE)).statusCode).toBe(404);
        expect(stored(board._id).deletedStatusKey).toBe(0);
    });

    it('keeps the projects the editor cannot open when they save their own selection', async () => {
        const res = await update(OPENS_SOME, { name: 'Board pack v2', projectIds: [] });
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toMatchObject({ name: 'Board pack v2', projectIds: [] });
        expect(stored(board._id).projectIds).toEqual([String(alpha._id)]);
    });

    it('does not add a project the editor cannot open', async () => {
        const gamma = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Gamma', isPrivateSpace: true, AssigneeUserId: [OWNER], status: 'active' });
        const res = await update(OPENS_SOME, { projectIds: [String(beta._id), String(gamma._id), 'not-an-id'] });
        expect(res.body.data.projectIds).toEqual([String(beta._id)]);
        expect(stored(board._id).projectIds).toEqual([String(alpha._id), String(beta._id)]);
        const byOwner = await update(OWNER, { projectIds: [String(gamma._id)] });
        expect(byOwner.body.data.projectIds).toEqual([String(gamma._id)]);
        expect(stored(board._id).projectIds).toEqual([String(gamma._id)]);
    });

    it('lets a member who can open every project replace the whole selection', async () => {
        const res = await update(OPENS_ALL, { projectIds: [String(alpha._id)] });
        expect(res.body.data.projectIds).toEqual([String(alpha._id)]);
        expect(stored(board._id).projectIds).toEqual([String(alpha._id)]);
    });

    it.each([
        ['a member who sees it through one of its projects', OPENS_SOME],
        ['a member who can open all of its projects', OPENS_ALL],
    ])('is not removed by %s, who can still edit it', async (_who, uid) => {
        expect((await remove(uid)).statusCode).toBe(403);
        expect(stored(board._id).deletedStatusKey).toBe(0);
        expect((await listFor(uid))[0].canDelete).toBe(false);
        expect((await update(uid, { name: 'Renamed' })).statusCode).toBe(200);
    });

    it.each([
        ['its creator', CREATOR],
        ['an owner', OWNER],
        ['an admin', ADMIN],
    ])('is removed by %s', async (_who, uid) => {
        expect((await listFor(uid))[0].canDelete).toBe(true);
        expect((await remove(uid)).statusCode).toBe(200);
        expect(stored(board._id).deletedStatusKey).toBe(1);
    });

    it('answers 404 for a portfolio already deleted', async () => {
        await remove(OWNER);
        expect((await update(OWNER, { name: 'Back' })).statusCode).toBe(404);
        expect((await rollupFor(OWNER)).statusCode).toBe(404);
        expect(stored(board._id).name).toBe('Board pack');
    });

    it('creates a portfolio from the projects the creator can open', async () => {
        const res = await portfolio('POST /api/v1/portfolio', OPENS_SOME, { body: { name: 'Mine', projectIds: [String(alpha._id), String(beta._id)] } });
        expect(res.statusCode).toBe(201);
        expect(res.body.data.projectIds).toEqual([String(beta._id)]);
        expect(stored(res.body.data._id)).toMatchObject({ projectIds: [String(beta._id)], createdBy: OPENS_SOME });
    });
});

describe('one definition of a finished task', () => {
    it('gives the epic list and the portfolio rollup the same finished count', async () => {
        const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Mixed', isPrivateSpace: false, AssigneeUserId: [], status: 'active' });
        const epic = mockDb.seed(SCHEMA_TYPE.EPICS, { _id: oid(), name: 'Everything', ProjectID: String(project._id), deletedStatusKey: 0, createdAt: new Date() });
        ['close', 'done', 'default_close', 'active', 'default_active'].forEach((statusType) => seedTask(project, statusType, { epicId: String(epic._id) }));
        const pack = mockDb.seed(SCHEMA_TYPE.PORTFOLIOS, { _id: oid(), name: 'Mixed pack', projectIds: [String(project._id)], createdBy: OWNER, deletedStatusKey: 0 });

        const epics = await call('../Modules/Epics/routes', 'GET /api/v2/epics', OWNER, { query: { projectId: String(project._id) } });
        const rollup = await rollupFor(OWNER, pack._id);

        expect(epics.body.data[0]).toMatchObject({ taskCount: 5, completedCount: 3 });
        expect(rollup.body.data.projects[0]).toMatchObject({ total: 5, done: 3, progressPct: 60 });
    });
});
