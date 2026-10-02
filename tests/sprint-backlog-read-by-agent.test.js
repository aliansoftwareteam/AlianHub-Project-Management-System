/* The backlog of a project is made the first time it is read. An agent reads the one a project keeps, and makes none. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Sprints/burndown', () => ({}));
jest.mock('../Modules/Sprints/hours', () => ({}));
jest.mock('../Modules/Sprints/controller', () => ({
    addSprintFun: jest.fn(async ({ body }) => ({ status: true, data: mockDb.seed('sprints', { name: body.sprintName, projectId: body.projectId, deletedStatusKey: 0 }) })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { addSprintFun } = require('../Modules/Sprints/controller');

const { CID, OWNER, INSIDER, P_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const BACKLOG = 'POST /api/v2/sprints/backlog';
const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
require('../Modules/Sprints/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} });

const read = async (caller, projectId = P_OPEN) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { ...caller, method: 'POST', originalUrl: '/api/v2/sprints/backlog', url: '/api/v2/sprints/backlog', query: {}, params: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body: { projectId } };
    for (const handler of routes[BACKLOG]) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};

const session = (uid) => ({ uid });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });
const agentToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });
const agentRun = (uid) => ({ uid, agentRun: { _id: '6f0000000000000000000103', agentId: '6f0000000000000000000104', agentName: 'Triage' } });

const backlogs = () => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.isBacklog && String(row.projectId) === P_OPEN);
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');

beforeEach(() => {
    jest.clearAllMocks();
    seed();
});
afterEach(settle);

describe('the backlog of a project that has none yet', () => {
    it.each([['a signed-in person', session(OWNER)], ['a member', session(INSIDER)], ['a person\'s own token', personalToken(INSIDER)]])('is made for %s', async (_who, caller) => {
        expect(await read(caller)).toMatchObject({ code: 200, body: { status: true, data: { name: 'Backlog' } } });
        expect(backlogs()).toHaveLength(1);
        expect(refusals()).toHaveLength(0);
    });

    it.each([['a token created for an agent', agentToken(OWNER)], ['an agent run', agentRun(OWNER)]])('is not made for %s, and that is recorded as a list it may not add', async (_who, caller) => {
        const answer = await read(caller);

        expect(answer).toMatchObject({ code: 403, body: { status: false, statusText: expect.stringContaining('(sprint.create)') } });
        expect(addSprintFun).not.toHaveBeenCalled();
        expect(backlogs()).toHaveLength(0);
        expect(refusals().map((row) => [row.meta.action, row.meta.path, row.meta.onBehalfOf])).toEqual([['sprint.create', BACKLOG, OWNER]]);
    });

    it('is not made for an agent when the one it was told of is gone by the time the request is handled', async () => {
        const kept = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Backlog', projectId: P_OPEN, isBacklog: true, deletedStatusKey: 0 });
        const handler = routes[BACKLOG][routes[BACKLOG].length - 1];
        routes[BACKLOG][routes[BACKLOG].length - 1] = (req, res) => { kept.deletedStatusKey = 1; return handler(req, res); };

        const answer = await read(agentToken(OWNER));
        routes[BACKLOG][routes[BACKLOG].length - 1] = handler;

        expect(answer.code).toBe(403);
        expect(addSprintFun).not.toHaveBeenCalled();
    });
});

describe('the backlog a project keeps', () => {
    beforeEach(() => { mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'Backlog', projectId: P_OPEN, isBacklog: true, deletedStatusKey: 0 }); });

    it.each([['a token created for an agent', agentToken(OWNER)], ['an agent run', agentRun(OWNER)], ['a signed-in person', session(OWNER)]])('is read by %s, and that leaves no record', async (_who, caller) => {
        expect(await read(caller)).toMatchObject({ code: 200, body: { status: true, data: { name: 'Backlog' } } });
        expect(addSprintFun).not.toHaveBeenCalled();
        expect(backlogs()).toHaveLength(1);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS)).toHaveLength(0);
    });
});

describe('what stands in front of the backlog route', () => {
    it('has the agent\'s part first, in front of the project\'s own guard', () => {
        expect(routes[BACKLOG][0].refusesAs).toBe('sprint.create');
        expect(routes[BACKLOG].filter((handler) => handler.refusesAs)).toHaveLength(1);
    });
});
