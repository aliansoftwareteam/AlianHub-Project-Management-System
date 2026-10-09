const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, INSIDER, T_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const PREFIX = '/api/v2/goals';
const TARGET = { name: 'New customers', kind: 'number', start: 0, target: 10, current: 3, unit: 'customers' };

const routes = {};
const mounted = [];
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Goals/routes').init({
    get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'),
    use: (routePath, ...handlers) => mounted.push({ routePath, handlers }),
});

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });

const urlOf = (routePath, params) => routePath.replace(/:(\w+)/g, (match, name) => params[name]);

/* What is mounted on the prefix runs first, then the route's own handlers, as the app runs them. `handlers` is
 * given for a path the module has no route for. */
const send = (route, caller, body = {}, params = {}, handlers = routes[route]) => new Promise((resolve) => {
    const [method, routePath] = route.split(' ');
    const url = urlOf(routePath, params);
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url: url.slice(PREFIX.length) || '/', baseUrl: PREFIX, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const chain = [...mounted.filter((entry) => url.startsWith(entry.routePath)).flatMap((entry) => entry.handlers), ...handlers];
    const step = (at) => Promise.resolve(chain[at](req, res, () => step(at + 1)));
    step(0);
}).then(async (result) => { await settle(); return result; });

const goals = () => rows(SCHEMA_TYPE.GOALS);
const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);
const agentAudits = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => String(row.action).startsWith('agent.'));

let goal;
let targetId;

/* [route, body, params, the action the refusal names] */
const WRITES = {
    'making a goal': () => ['POST /api/v2/goals', { name: 'Another' }, {}, 'goal.create'],
    'changing a goal': () => ['PATCH /api/v2/goals/:id', { name: 'Renamed' }, { id: goal }, 'goal.update'],
    'archiving a goal': () => ['POST /api/v2/goals/:id/archive', {}, { id: goal }, 'goal.archive'],
    'restoring a goal': () => ['POST /api/v2/goals/:id/restore', {}, { id: goal }, 'goal.restore'],
    'adding a target': () => ['POST /api/v2/goals/:id/targets', { name: 'Launched', kind: 'boolean' }, { id: goal }, 'goal.target.add'],
    'changing a target': () => ['PATCH /api/v2/goals/:id/targets/:targetId', { name: 'Won' }, { id: goal, targetId }, 'goal.target.edit'],
    'changing what a target counts': () => ['PATCH /api/v2/goals/:id/targets/:targetId', { sources: { sprintIds: [], taskIds: [T_OPEN] } }, { id: goal, targetId }, 'goal.target.sources.add'],
    'reporting a target\'s value': () => ['PUT /api/v2/goals/:id/targets/:targetId/value', { current: 9 }, { id: goal, targetId }, 'goal.target.set'],
    'removing a target': () => ['DELETE /api/v2/goals/:id/targets/:targetId', {}, { id: goal, targetId }, 'goal.target.remove'],
};
/* The writes a person's request completes on this goal; the others are answered by the handler's own rules. */
const COMPLETES = ['making a goal', 'changing a goal', 'archiving a goal', 'restoring a goal', 'adding a target', 'changing a target', 'reporting a target\'s value', 'removing a target'];

beforeEach(async () => {
    seed();
    const made = (await send('POST /api/v2/goals', session(INSIDER), { name: 'Grow revenue', visibility: 'workspace', targets: [TARGET] })).body.data;
    goal = made._id;
    targetId = made.targets[0].id;
});
afterEach(() => { process.env.MCP_TOOLS_WORK = 'off'; });

describe('a token created for an agent, on the goal routes', () => {
    it.each(Object.keys(WRITES))('%s is refused and recorded, and nothing is written', async (name) => {
        const [route, body, params, action] = WRITES[name]();
        const before = JSON.stringify(goals());

        const answer = await send(route, agentToken(INSIDER), body, params);

        expect(answer.code).toBe(403);
        expect(answer.body).toMatchObject({ status: false, statusText: expect.stringMatching(/^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)/), auditId: expect.anything() });
        expect(JSON.stringify(goals())).toBe(before);
        expect(audits('agent.action')).toHaveLength(0);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ action, ran: false, path: `${route.split(' ')[0]} ${urlOf(route.split(' ')[1], params)}`, onBehalfOf: INSIDER });
    });

    it.each(Object.keys(WRITES))('%s stays refused when the goal tools are switched on, and for an owner\'s agent', async (name) => {
        process.env.MCP_TOOLS_WORK = 'on';
        const [route, body, params] = WRITES[name]();
        const before = JSON.stringify(goals());

        expect((await send(route, agentToken(OWNER, { grants: ['goals:manage'] }), body, params)).code).toBe(403);
        expect(JSON.stringify(goals())).toBe(before);
    });

    it('is refused a goal write the routes do not list, before any handler runs', async () => {
        const reached = jest.fn((req, res) => res.json({ status: true }));
        const unlisted = [
            ['POST /api/v2/goals/:id/summary', 'goal.summary'],
            ['POST /api/v2/goals/:id/targets/:targetId/anything', 'goal.anything'],
            ['PUT /api/v2/goals/:id', 'goal.write'],
        ];
        for (const [route, action] of unlisted) {
            const answer = await send(route, agentToken(INSIDER), {}, { id: goal, targetId }, [reached]);
            expect(answer.code).toBe(403);
            expect(audits('agent.action_refused').pop().meta).toMatchObject({ action, ran: false });
        }
        expect(reached).not.toHaveBeenCalled();
    });

    it('reads the goals its person reads, and no record is kept of a read', async () => {
        const list = await send('GET /api/v2/goals', agentToken(INSIDER));
        const one = await send('GET /api/v2/goals/:id', agentToken(INSIDER), {}, { id: goal });
        const forTask = await send('GET /api/v2/goals/for-task/:taskId', agentToken(INSIDER), {}, { taskId: T_OPEN });

        expect(list.body.data.map((row) => row._id)).toEqual([goal]);
        expect(one.body.data).toMatchObject({ _id: goal, name: 'Grow revenue' });
        expect(forTask.code).toBe(200);
        expect(agentAudits()).toEqual([]);
    });
});

describe('the goal routes on a running app', () => {
    let server;
    const reached = jest.fn((req, res) => res.json({ status: true }));
    const ask = (method, path) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { companyid: CID, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });

    beforeAll(async () => {
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { Object.assign(req, agentToken(INSIDER), { aud: CID }); next(); });
        require('../Modules/Goals/routes').init(app);
        app.post(`${PREFIX}/:id/summary`, reached);
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => { server.once('listening', resolve); });
    });
    afterAll(() => new Promise((resolve) => { server.close(resolve); }));

    it('refuse an agent token a goal write registered after them, and still answer its reads', async () => {
        const write = await ask('POST', `${PREFIX}/${goal}/summary`);
        const archived = await ask('POST', `${PREFIX}/${goal}/archive?now=1`);
        const read = await ask('GET', `${PREFIX}/${goal}`);
        await settle();

        expect([write.status, archived.status, read.status]).toEqual([403, 403, 200]);
        expect((await read.json()).data).toMatchObject({ _id: goal, archived: false });
        expect(reached).not.toHaveBeenCalled();
        expect(audits('agent.action_refused').map((row) => [row.meta.action, row.meta.path])).toEqual([
            ['goal.summary', `POST ${PREFIX}/${goal}/summary`],
            ['goal.archive', `POST ${PREFIX}/${goal}/archive`],
        ]);
    });
});

describe('a person, on the goal routes', () => {
    it.each([['signed in', session], ['with a personal token', personalToken]])('%s writes as before, with no agent record', async (label, caller) => {
        for (const name of Object.keys(WRITES)) {
            const [route, body, params] = WRITES[name]();
            const answer = await send(route, caller(INSIDER), body, params);
            expect(String(answer.body.statusText)).not.toMatch(/^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)/);
            if (COMPLETES.includes(name)) expect({ name, code: answer.code, status: answer.body.status }).toEqual({ name, code: 200, status: true });
        }
        expect(agentAudits()).toEqual([]);
    });
});
