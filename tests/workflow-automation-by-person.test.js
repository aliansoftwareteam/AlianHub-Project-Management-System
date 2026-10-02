/* What runs with no person there is set by a person signed in to AlianHub. */
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
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/service.js', () => mockStub());
jest.mock('../Modules/Workflows/queue', () => ({ dispatch: jest.fn(async () => true) }));

process.env.WORKFLOW_ENGINE = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const agentAudit = require('../Modules/Agents/agentAudit');
const matcher = require('../Modules/Automations/engine/matcher');
const { SESSION_SETS } = require('../Modules/Agents/personDecides');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, TOKEN, P_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);
persistence.useInMemory();

const HOUR = 60 * 60 * 1000;
const AGENT_ID = '6f0000000000000000000a91';
const AGENT_RUN = '6f0000000000000000000a92';
const WORKFLOW = '6f0000000000000000000b80';
const WORKFLOW_RUN = '6f0000000000000000000b81';
const RULE = '6f0000000000000000000b90';
const STEP = 'sAsk';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} };
['Workflows', 'Automations'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const send = async (route, caller, params = {}, body = {}) => {
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
const MEMBER_SESSION = { uid: MEMBER };
const PERSONAL = { uid: OWNER, apiToken: { _id: TOKEN, userId: OWNER, name: 'A script', scopes: ['read', 'write'] } };
const AGENT = { uid: OWNER, apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'Claude', scopes: ['read', 'write'] } };

const definitions = () => rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS);
const step = () => rows(SCHEMA_TYPE.WORKFLOW_STEP_RUNS)[0];
const approval = () => rows(SCHEMA_TYPE.WORKFLOW_APPROVALS)[0];
const rules = () => rows(SCHEMA_TYPE.AUTOMATION_RULES);
const rule = () => rules().find((row) => String(row._id) === RULE);
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');

const STEPS = [{ id: STEP, type: 'human_approval', config: { prompt: 'Ship it?' } }];
const definitionBody = (over = {}) => ({ name: 'Ship it', steps: STEPS, ...over });
const seedDefinition = () => mockDb.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, { _id: WORKFLOW, name: 'Ship it', steps: STEPS, enabled: false, createdBy: OWNER, deletedStatusKey: 0 });
const seedStep = (over = {}) => {
    mockDb.seed(SCHEMA_TYPE.WORKFLOW_RUNS, { _id: WORKFLOW_RUN, status: 'failed', startedBy: OWNER });
    mockDb.seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, { runId: WORKFLOW_RUN, stepId: STEP, type: 'human_approval', status: 'failed', ...over });
    return { id: WORKFLOW_RUN, stepId: STEP };
};
const seedApproval = () => {
    const params = seedStep({ type: 'approval', status: 'waiting' });
    mockDb.seed(SCHEMA_TYPE.WORKFLOW_APPROVALS, { runId: WORKFLOW_RUN, stepId: STEP, status: 'pending', ownerUserId: OWNER, owners: [OWNER], title: 'Ship it?' });
    return params;
};

/* A step that ran an agent, whose run moved a task to done: compensating it moves the task back. */
const seedAgentStep = async (fx) => {
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: AGENT_RUN, agentId: AGENT_ID, agentName: 'Triage', taskId: String(fx.top._id), projectId: P_OPEN, status: 'done', startedBy: OWNER, startedAt: new Date(Date.now() - 2 * HOUR), finishedAt: new Date(Date.now() - HOUR) });
    Object.assign(fx.top, { status: { key: 3, text: 'Done', type: 'close' }, statusType: 'close', statusKey: 3 });
    await agentAudit.recordAction(CID, { kind: 'agent', userId: OWNER, agentId: AGENT_ID, agentName: 'Triage', runId: AGENT_RUN, viaAccount: 'workspace', tokenId: null }, {
        action: 'task.status', reason: 'test', params: {}, entityType: 'task', entityId: String(fx.top._id),
        undo: { kind: 'status', taskId: String(fx.top._id), previous: { status: 'In Progress', statusType: 'active', statusKey: 2 } },
    });
    return seedStep({ type: 'agent_run', status: 'succeeded', output: { agentRunId: AGENT_RUN } });
};

const v2Rule = (over = {}) => ({
    name: 'Escalate', trigger: { type: 'event', event: 'task.priority_changed' }, scope: { allProjects: false, projectIds: [P_OPEN] }, conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'hi' } }], ...over,
});
const v1Rule = (over = {}) => ({ name: 'Bump', conditions: { projectId: P_OPEN }, actions: [{ type: 'set_priority', value: 'HIGH' }], ...over });
const seedV2 = () => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE, ...v2Rule(), version: 2, enabled: false, deletedStatusKey: 0, createdBy: OWNER });
const seedV1 = () => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE, ...v1Rule(), enabled: false, deletedStatusKey: 0, createdBy: OWNER });

let fx;

/* [what, the route, how the request is prepared (params, body, and whether the change was made)] */
const SET_BY_A_PERSON = [
    ['saving a workflow', 'POST /api/v2/workflows/definitions', () => ({ body: definitionBody(), done: () => definitions().length === 1 })],
    ['changing a workflow', 'PUT /api/v2/workflows/definitions/:id', () => { seedDefinition(); return { params: { id: WORKFLOW }, body: definitionBody({ name: 'Renamed' }), done: () => definitions()[0].name === 'Renamed' }; }],
    ['turning a workflow on', 'PATCH /api/v2/workflows/definitions/:id/enabled', () => { seedDefinition(); return { params: { id: WORKFLOW }, body: { enabled: true }, done: () => definitions()[0].enabled === true }; }],
    ['removing a workflow', 'DELETE /api/v2/workflows/definitions/:id', () => { seedDefinition(); return { params: { id: WORKFLOW }, done: () => definitions()[0].deletedStatusKey === 1 }; }],
    ['running a failed step again', 'POST /api/v2/workflows/runs/:id/steps/:stepId/retry', () => ({ params: seedStep(), done: () => step().status === 'pending' })],
    ['skipping a step', 'POST /api/v2/workflows/runs/:id/steps/:stepId/skip', () => ({ params: seedStep(), done: () => step().status === 'skipped' })],
    ['carrying a step on', 'POST /api/v2/workflows/runs/:id/steps/:stepId/resume', () => ({ params: seedStep(), done: () => step().status === 'pending' })],
    ['taking back what a step\'s agent did', 'POST /api/v2/workflows/runs/:id/steps/:stepId/compensate', async () => ({ params: await seedAgentStep(fx), done: () => Boolean(step().compensation) })],
    ['handing an approval to someone else', 'POST /api/v2/workflows/runs/:id/steps/:stepId/reassign', () => ({ params: seedApproval(), body: { toUserId: MEMBER }, done: () => approval().ownerUserId === MEMBER })],
    ['saving an automation', 'POST /api/v2/automations', () => ({ body: v2Rule(), done: () => rules().length === 1 })],
    ['changing an automation', 'PUT /api/v2/automations/:id', () => { seedV2(); return { params: { id: RULE }, body: v2Rule({ name: 'Renamed' }), done: () => rule().name === 'Renamed' }; }],
    ['turning an automation on', 'PATCH /api/v2/automations/:id/enabled', () => { seedV2(); return { params: { id: RULE }, body: { enabled: true }, done: () => rule().enabled === true }; }],
    ['removing an automation', 'DELETE /api/v2/automations/:id', () => { seedV2(); return { params: { id: RULE }, done: () => rule().deletedStatusKey === 1 }; }],
    ['saving an automation of the first kind', 'POST /api/v1/automations', () => ({ body: v1Rule(), done: () => rules().length === 1 })],
    ['changing an automation of the first kind', 'PUT /api/v1/automations/:id', () => { seedV1(); return { params: { id: RULE }, body: { enabled: true }, done: () => rule().enabled === true }; }],
    ['removing an automation of the first kind', 'DELETE /api/v1/automations/:id', () => { seedV1(); return { params: { id: RULE }, done: () => rule().deletedStatusKey === 1 }; }],
];

const prepared = async (prepare) => ({ params: {}, body: {}, ...(await prepare()) });

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    [SCHEMA_TYPE.WORKFLOW_DEFINITIONS, SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.WORKFLOW_APPROVALS, SCHEMA_TYPE.AUTOMATION_RULES,
        SCHEMA_TYPE.AGENT_RUNS].forEach((type) => { mockDb.store[type] = []; });
    matcher.invalidateAll();
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'WORKFLOW_ENGINE'].forEach((key) => { delete process.env[key]; }); });

describe('what sets the work that runs with no person there', () => {
    it.each(SET_BY_A_PERSON)('%s is a signed-in person\'s', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        expect(request.done()).toBe(false);
        expect(await send(route, SESSION, request.params, request.body)).toMatchObject({ code: 200, body: { status: true } });
        expect(request.done()).toBe(true);
    });

    it.each(SET_BY_A_PERSON)('%s is refused to a person\'s own API token', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        expect(await send(route, PERSONAL, request.params, request.body)).toMatchObject({ code: 403, body: { status: false, statusText: SESSION_SETS } });
        expect(request.done()).toBe(false);
        expect(refusals()).toHaveLength(0);
    });

    it.each(SET_BY_A_PERSON)('%s is refused to an agent\'s token, and the attempt is recorded', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        const out = await send(route, AGENT, request.params, request.body);
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(out.body.auditId).toBeTruthy();
        expect(request.done()).toBe(false);
        expect(refusals()).toHaveLength(1);
    });

    it.each(SET_BY_A_PERSON)('%s is refused to a member\'s session by the route\'s own rule', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        const out = await send(route, MEMBER_SESSION, request.params, request.body);
        expect(out.code).toBe(403);
        expect(out.body.statusText).not.toBe(SESSION_SETS);
        expect(request.done()).toBe(false);
        expect(refusals()).toHaveLength(0);
    });
});

describe('running an automation on the tasks it matches', () => {
    const APPLY = 'POST /api/v1/automations/:id/apply';
    const prepare = () => { seedV1(); return { id: RULE }; };
    const bumped = () => rows(SCHEMA_TYPE.TASKS).some((task) => task.Task_Priority === 'HIGH');

    it.each([['a signed-in person', SESSION], ['a person\'s own API token', PERSONAL]])('is done by %s as that person may', async (_who, caller) => {
        expect(await send(APPLY, caller, prepare())).toMatchObject({ code: 200, body: { status: true } });
        expect(bumped()).toBe(true);
    });

    it('is refused to an agent\'s token, and the attempt is recorded', async () => {
        const out = await send(APPLY, AGENT, prepare());
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(bumped()).toBe(false);
        expect(refusals()).toHaveLength(1);
    });
});

describe('starting a workflow', () => {
    const START = 'POST /api/v2/workflows/runs';
    const AGENT_RUN_CALLER = { uid: OWNER, agentRun: { _id: AGENT_RUN, agentId: AGENT_ID, agentName: 'Triage' } };
    const saved = () => { mockDb.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, { _id: WORKFLOW, name: 'Ship it', steps: STEPS, enabled: true, createdBy: OWNER, deletedStatusKey: 0 }); return { definitionId: WORKFLOW }; };
    const runs = () => rows(SCHEMA_TYPE.WORKFLOW_RUNS);

    it.each([['a signed-in person', SESSION], ['a person\'s own API token', PERSONAL]])('is done by %s, and the run is theirs', async (_who, caller) => {
        expect(await send(START, caller, {}, saved())).toMatchObject({ code: 200, body: { status: true } });
        expect(runs().map((run) => String(run.startedBy))).toEqual([OWNER]);
        expect(refusals()).toHaveLength(0);
    });

    it.each([['an agent\'s token', AGENT], ['an agent run', AGENT_RUN_CALLER]])('is refused to %s by the route, and the attempt is recorded as the agent\'s', async (_who, caller) => {
        const out = await send(START, caller, {}, saved());

        expect(out).toMatchObject({ code: 403, body: { status: false, statusText: expect.stringContaining('(workflow.run.start)') } });
        expect(runs()).toHaveLength(0);
        expect(refusals().map((row) => [row.meta.action, row.meta.onBehalfOf, row.meta.path])).toEqual([['workflow.run.start', OWNER, START]]);
    });

    it('has the refusal of an agent in front of everything else on the route', () => {
        expect(routes[START][0].refusesAs).toBe('workflow.run.start');
    });
});

describe('a step of a workflow that runs an agent', () => {
    const workflowAgent = require('../Modules/Workflows/agentRun');
    const step = (taskId) => ({ companyId: CID, workflowRunId: WORKFLOW_RUN, stepId: 'sAgent', agentId: AGENT_ID, taskId, startedBy: OWNER, depth: 0 });

    it('starts no run on a task of a project where agents are paused', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Triage', account: 'workspace', projectIds: [], skills: [], deletedStatusKey: 0 });
        rows(SCHEMA_TYPE.PROJECTS).find((project) => String(project._id) === P_OPEN).agentLimits = { paused: true };

        await expect(workflowAgent.runAgent(step(String(fx.top._id)))).rejects.toMatchObject({ deterministic: true, message: expect.stringContaining('Agents are paused in this project') });
        expect(rows(SCHEMA_TYPE.AGENT_RUNS)).toHaveLength(0);
    });
});

/* A write under these routes that is not listed is one a token is refused: a route added later is closed until it is named. */
const OPEN_TO_TOKENS = [
    'POST /api/v2/workflows/dry-run',
    'POST /api/v2/workflows/runs',
    'POST /api/v2/automations/compile',
    'POST /api/v2/automations/draft',
    'POST /api/v2/automations/backtest',
    'POST /api/v2/automations/:id/dry-run',
    'POST /api/v1/automations/preview',
    'POST /api/v1/automations/:id/apply',
];
const DECIDED_BY_A_PERSON = ['POST /api/v2/workflows/runs/:id/steps/:stepId/decide'];

describe('every write under the workflow and automation routes', () => {
    it('is one a person signs in for, a decision, or one named as open to a token', () => {
        const others = Object.keys(routes).filter((route) => !route.startsWith('GET ') && !SET_BY_A_PERSON.some(([, set]) => set === route));
        expect(others.sort()).toEqual([...OPEN_TO_TOKENS, ...DECIDED_BY_A_PERSON].sort());
    });

    it('still lets a token read the workflows and the automations', async () => {
        seedDefinition();
        for (const route of ['GET /api/v2/workflows/definitions', 'GET /api/v2/automations']) {
            // eslint-disable-next-line no-await-in-loop
            expect(await send(route, PERSONAL)).toMatchObject({ code: 200, body: { status: true } });
        }
    });
});
