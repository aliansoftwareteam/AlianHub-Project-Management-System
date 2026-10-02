/* A decision on what an agent asks for is made by a person signed in to AlianHub. */
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
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/AI/feedback', () => ({ fromDecline: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/service.js', () => mockStub());
jest.mock('../Modules/Workflows/queue', () => ({ dispatch: jest.fn(async () => true) }));

process.env.WORKFLOW_ENGINE = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const standing = require('../Modules/Agents/standingApprovals');
const server = require('../Modules/Mcp/server');
const tools = require('../Modules/Mcp/tools');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, TOKEN, P_OPEN, TASKS_GRANT, settle, ctx } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const DAY = 24 * 60 * 60 * 1000;
const RUN_ID = '6f0000000000000000000a92';
const AGENT_ID = '6f0000000000000000000a91';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} };
['Agents', 'Pto', 'Workflows'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const APPROVE = 'POST /api/v2/agents/proposals/:id/approve';
const DECLINE = 'POST /api/v2/agents/proposals/:id/decline';
const UNDO = 'POST /api/v2/agents/proposals/:id/undo';
const END_STANDING = 'DELETE /api/v2/agents/standing-approvals/:projectId/:id';
const TIME_OFF = 'PUT /api/v1/pto/:id/status';
const WORKFLOW_STEP = 'POST /api/v2/workflows/runs/:id/steps/:stepId/decide';
const WORKFLOW_RUN = '6f0000000000000000000b81';
const STEP = 'sAsk';

const send = async (route, caller, params, body = {}) => {
    const [method, path] = route.split(' ');
    const url = Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), path);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = { ...caller, method, originalUrl: url, url, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    for (const handler of routes[route]) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    await settle();
    return { code: res.statusCode, body: res.body };
};

const SESSION = { uid: OWNER };
const PERSONAL = { uid: OWNER, apiToken: { _id: TOKEN, userId: OWNER, name: 'A script', scopes: ['read', 'write'] } };
const AGENT = { uid: OWNER, apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'Claude', scopes: ['read', 'write'] } };
const OAUTH_APP = { uid: OWNER, mcp: true };
const RUN = { uid: OWNER, agentRun: { _id: RUN_ID, agentId: AGENT_ID, agentName: 'Triage' } };

/* [who, the request's identity, whether an agent's attempt is recorded] */
const REFUSED = [
    ['a person\'s own API token', PERSONAL, false],
    ['an agent\'s token', AGENT, true],
    ['a connected app\'s token', OAUTH_APP, false],
    ['an agent\'s run', RUN, true],
];

const proposalRows = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS);
const proposal = (id) => proposalRows().find((row) => String(row._id) === String(id));
const standingRows = () => rows(SCHEMA_TYPE.AGENT_STANDING_APPROVALS);
const comments = () => rows(SCHEMA_TYPE.COMMENTS);
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');

let fx;

const filedComment = async (body = 'Looks ready') => {
    const reply = await rpc(ctx(OWNER), 'task.comment', { taskId: fx.top._id, body });
    expect(reply).toMatchObject({ pending: true });
    return reply.proposalId;
};
const approved = async () => {
    const id = await filedComment();
    expect((await send(APPROVE, SESSION, { id })).code).toBe(200);
    return id;
};
const standingOne = async () => {
    const out = await standing.approveAlways(CID, await filedComment(), { decider: { kind: 'human', userId: MEMBER }, isPrivileged: false, ip: '' });
    expect(out.error).toBeUndefined();
    return out.standing.id;
};

/* [what is decided, the route, how the proposal is prepared, the body, the status a session leaves] */
const DECISIONS = [
    ['approving a proposal', APPROVE, filedComment, {}, 'approved'],
    ['approving a proposal for every time', APPROVE, filedComment, { always: true }, 'approved'],
    ['approving a proposal with a change to it', APPROVE, filedComment, { changes: [{ action: 'task.comment', params: { body: 'Edited' } }] }, null],
    ['declining a proposal', DECLINE, filedComment, { reason: 'Not now' }, 'declined'],
    ['undoing an approval', UNDO, approved, {}, 'undone'],
];

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
    mockDb.store[SCHEMA_TYPE.AGENT_STANDING_APPROVALS] = [];
    mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] = [];
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN).agentPolicy = { done: projectPolicy.DONE.YES, connected: projectPolicy.CONNECTED.PROPOSE_ALL };
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING', 'WORKFLOW_ENGINE'].forEach((key) => { delete process.env[key]; }); });

describe('a decision on a proposal', () => {
    it.each(DECISIONS.filter(([, , , , left]) => left))('%s is a signed-in person\'s', async (_what, route, prepare, body, left) => {
        const id = await prepare();
        expect(await send(route, SESSION, { id }, body)).toMatchObject({ code: 200, body: { status: true } });
        expect(proposal(id).status).toBe(left);
    });

    it('approving a proposal with a change to it reaches the rule for that proposal when a signed-in person asks', async () => {
        const id = await filedComment();
        expect(await send(APPROVE, SESSION, { id }, DECISIONS[2][3])).toMatchObject({ code: 409, body: { status: false } });
    });

    it.each(DECISIONS.flatMap(([what, route, prepare, body]) => REFUSED.map(([who, caller, recorded]) => [what, who, route, prepare, body, caller, recorded])))(
        '%s is refused to %s',
        async (_what, _who, route, prepare, body, caller, recorded) => {
            const id = await prepare();
            const was = { status: proposal(id).status, comments: comments().length };
            const out = await send(route, caller, { id }, body);
            expect(out).toMatchObject({ code: 403, body: { status: false } });
            expect({ status: proposal(id).status, comments: comments().length }).toEqual(was);
            expect(standingRows()).toHaveLength(0);
            expect(refusals()).toHaveLength(recorded ? 1 : 0);
        },
    );

    it('a token still reads the proposals its person may see', async () => {
        await filedComment();
        const out = await send('GET /api/v2/agents/proposals', PERSONAL, {});
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        expect(out.body.data).toHaveLength(1);
    });
});

describe('a standing approval', () => {
    it('is ended by a signed-in person', async () => {
        const id = await standingOne();
        expect(await send(END_STANDING, SESSION, { projectId: P_OPEN, id })).toMatchObject({ code: 200, body: { status: true } });
        expect(standingRows()[0].status).toBe('ended');
    });

    it.each(REFUSED)('is not ended by %s', async (_who, caller) => {
        const id = await standingOne();
        expect(await send(END_STANDING, caller, { projectId: P_OPEN, id })).toMatchObject({ code: 403, body: { status: false } });
        expect(standingRows()[0].status).toBe('active');
    });
});

describe('the other requests that wait for a person', () => {
    const timeOff = () => {
        mockDb.store[SCHEMA_TYPE.PTO_ENTRIES] = [];
        const entry = mockDb.seed(SCHEMA_TYPE.PTO_ENTRIES, { userId: MEMBER, type: 'vacation', status: 'pending', startDate: new Date(), endDate: new Date() });
        return { params: { id: String(entry._id) }, body: { status: 'approved' }, status: () => rows(SCHEMA_TYPE.PTO_ENTRIES)[0].status };
    };
    const workflowStep = () => {
        [SCHEMA_TYPE.WORKFLOW_APPROVALS, SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS].forEach((type) => { mockDb.store[type] = []; });
        mockDb.seed(SCHEMA_TYPE.WORKFLOW_RUNS, { _id: WORKFLOW_RUN, status: 'running', startedBy: OWNER });
        mockDb.seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, { runId: WORKFLOW_RUN, stepId: STEP, type: 'approval', status: 'waiting' });
        mockDb.seed(SCHEMA_TYPE.WORKFLOW_APPROVALS, { runId: WORKFLOW_RUN, stepId: STEP, status: 'pending', ownerUserId: OWNER, owners: [OWNER], title: 'Ship it?' });
        return { params: { id: WORKFLOW_RUN, stepId: STEP }, body: { decision: 'approved' }, status: () => rows(SCHEMA_TYPE.WORKFLOW_APPROVALS)[0].status };
    };
    const WAITING = [['a time-off request', TIME_OFF, timeOff], ['a workflow\'s approval step', WORKFLOW_STEP, workflowStep]];

    it.each(WAITING)('%s is decided by a signed-in person', async (_what, route, prepare) => {
        const waiting = prepare();
        expect(await send(route, SESSION, waiting.params, waiting.body)).toMatchObject({ code: 200, body: { status: true } });
        expect(waiting.status()).toBe('approved');
    });

    it.each(WAITING.flatMap(([what, route, prepare]) => REFUSED.map(([who, caller, recorded]) => [what, who, route, prepare, caller, recorded])))(
        '%s is not decided by %s',
        async (_what, _who, route, prepare, caller, recorded) => {
            const waiting = prepare();
            expect(await send(route, caller, waiting.params, waiting.body)).toMatchObject({ code: 403, body: { status: false } });
            expect(waiting.status()).toBe('pending');
            expect(refusals()).toHaveLength(recorded ? 1 : 0);
        },
    );
});

describe('what a connected agent is offered', () => {
    it('holds no tool that decides a proposal or keeps a standing approval', () => {
        ['on', 'off'].forEach((flag) => {
            ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { process.env[key] = flag; });
            const names = tools.manifest().map((tool) => tool.name);
            expect(names.length).toBeGreaterThan(0);
            expect(names.filter((name) => /approv|declin|decid|standing|undo/i.test(name))).toEqual([]);
        });
    });
});
