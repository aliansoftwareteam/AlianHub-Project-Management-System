/* Task 047: a change an agent token makes through the web app's task route is named and counted as the same
   change made over MCP. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
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
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));

const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const domainEventBus = require('../event/domainEventBus');
const matcher = require('../Modules/Automations/engine/matcher');
const actingAgent = require('../Modules/Agents/actingAgent');
const { attribution, resolveActor } = require('../Modules/Agents/actor');
const taskRequests = require('../Modules/Agents/taskRequests');
const { agentPerimeter } = require('../Modules/Agents/guard');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, TOKEN, settle } = world;
const { seed, rows } = world.create(mockDb);

const PATCH = 'PATCH /api/v2/tasks';
const WINDOW_MS = 2500;
const AGENT_FIELDS = ['actorType', 'agentName', 'actedFor'];
const plainRule = { reactToAutomation: false };
const optedIn = { reactToAutomation: true };

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
require('../Modules/Tasks/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const session = (uid) => ({ uid });
const agentToken = (uid) => ({ uid, apiToken: { _id: TOKEN, kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });
/* The actor the MCP server resolves for the same token (Modules/Mcp/server.js). */
const overMcp = () => resolveActor({ ...agentToken(OWNER), mcp: true });

/* What stands in front of every route, then the route's own guards and handler, as the server runs them. */
const send = (route, caller, body) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, path: url, baseUrl: '', route: { path: url }, query: {}, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body, get: () => '' };
    const handlers = [agentPerimeter, ...routes[route]];
    const step = (at) => Promise.resolve(handlers[at](req, res, () => step(at + 1)));
    step(0);
});

let fx;
let published = [];
const onEnvelope = (envelope) => published.push(envelope);
const afterWindow = async () => { await settle(); await jest.advanceTimersByTimeAsync(WINDOW_MS); await settle(); };
const priorityEvents = () => published.filter((envelope) => envelope.type === 'task.priority_changed' && envelope.entity.id === String(fx.top._id));
const history = () => rows(SCHEMA_TYPE.HISTORY).filter((entry) => String(entry.TaskId) === String(fx.top._id) && entry.Type === 'task');
const raise = (caller) => send(PATCH, caller, {
    action: 'updatePriority', firebaseObj: { Task_Priority: 'HIGH' }, projectData: {}, taskData: { _id: String(fx.top._id) },
    priorityObj: { priorityName: 'Medium', newPriorityName: 'High' }, isUpdateTask: true,
});

beforeAll(() => {
    domainEventBus.start();
    domainEventBus.bus.on('domain.event', onEnvelope);
});
afterAll(() => domainEventBus.bus.off('domain.event', onEnvelope));

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    jest.clearAllMocks();
    published = [];
    fx = seed();
});
afterEach(async () => {
    await afterWindow();
    jest.useRealTimers();
});

describe('a change an agent token makes through the web task route', () => {
    it('is stored in history as the agent\'s, for its person, worded as over MCP', async () => {
        const answer = await raise(agentToken(OWNER));
        await afterWindow();

        expect(answer).toMatchObject({ code: 200, body: { status: true } });
        expect(history()).toHaveLength(1);
        expect(history()[0]).toMatchObject({ UserId: OWNER, actorType: 'agent', agentName: 'Claude', actedFor: OWNER });
        expect(history()[0].Message).toMatch(/^<b>Claude, for Olivia Owner<\/b>/);
    });

    it('is recorded in the audit log under the label the MCP road gives it', async () => {
        await raise(agentToken(OWNER));
        await afterWindow();

        const [row] = rows(SCHEMA_TYPE.AUDIT_LOGS).filter((entry) => entry.action === 'agent.action');
        expect(row).toMatchObject({ actorName: attribution(await overMcp()).label, meta: expect.objectContaining({ state: 'applied', reason: 'via REST', onBehalfOf: OWNER }) });
    });

    it('is published as the agent\'s at depth 1, and wakes only a rule that opted in', async () => {
        await raise(agentToken(OWNER));
        await afterWindow();

        expect(priorityEvents()).toHaveLength(1);
        const [envelope] = priorityEvents();
        expect(envelope).toMatchObject({ companyId: CID, actor: { kind: 'agent', userId: OWNER }, depth: 1 });
        expect(matcher.acceptsActor(plainRule, envelope)).toBe(false);
        expect(matcher.acceptsActor(optedIn, envelope)).toBe(true);
    });

    it('is published and stored as the same change made over MCP', async () => {
        await raise(agentToken(OWNER));
        await afterWindow();
        const web = { event: priorityEvents()[0], entry: history()[0] };

        fx = seed();
        published = [];
        await taskRequests.executors['task.edit']({ companyId: CID, actor: await overMcp(), params: { taskId: String(fx.top._id), fields: { Task_Priority: 'HIGH' } }, depth: 0 });
        await afterWindow();
        const mcp = { event: priorityEvents()[0], entry: history()[0] };

        expect(web.event.actor).toEqual(mcp.event.actor);
        expect(web.event.depth).toBe(mcp.event.depth);
        AGENT_FIELDS.forEach((field) => expect(web.entry[field]).toBe(mcp.entry[field]));
        expect(web.entry.Message).toBe(mcp.entry.Message);
    });

    it('does not leave its mark on what runs after the request', async () => {
        await raise(agentToken(OWNER));
        await afterWindow();

        expect(actingAgent.current()).toBeNull();
    });
});

describe('a person\'s own change through the same route', () => {
    it('is stored and published as it always was', async () => {
        const answer = await raise(session(OWNER));
        await afterWindow();

        expect(answer).toMatchObject({ code: 200, body: { status: true } });
        expect(history()).toHaveLength(1);
        expect(history()[0].Message).toMatch(/^<b>Olivia Owner<\/b>/);
        AGENT_FIELDS.forEach((field) => expect(history()[0]).not.toHaveProperty(field));
        expect(priorityEvents()).toHaveLength(1);
        expect(priorityEvents()[0]).toMatchObject({ actor: { kind: 'system', userId: null }, depth: 0 });
        expect(matcher.acceptsActor(plainRule, priorityEvents()[0])).toBe(true);
    });
});
