/* A workflow approval is owned and decided by a member of the workspace, and steps written into a request are a signed-in person's. */
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
const approvalStep = require('../Modules/Workflows/stepTypes/approval');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OUTSIDER, TOKEN, settle } = world;
const { seed, rows } = world.create(mockDb);
persistence.useInMemory();

const GUEST = OUTSIDER;
const WORKFLOW = '6f0000000000000000000b80';
const WORKFLOW_RUN = '6f0000000000000000000b81';
const STEP = 'sAsk';
const GUEST_NAMED = /guest/i;

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
require('../Modules/Workflows/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} });

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
const PERSONAL = { uid: OWNER, apiToken: { _id: TOKEN, userId: OWNER, name: 'A script', scopes: ['read', 'write'] } };
const AGENT = { uid: OWNER, apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'Claude', scopes: ['read', 'write'] } };

const START = 'POST /api/v2/workflows/runs';
const SAVE = 'POST /api/v2/workflows/definitions';
const CHANGE = 'PUT /api/v2/workflows/definitions/:id';
const TURN_ON = 'PATCH /api/v2/workflows/definitions/:id/enabled';
const REASSIGN = 'POST /api/v2/workflows/runs/:id/steps/:stepId/reassign';
const DECIDE = 'POST /api/v2/workflows/runs/:id/steps/:stepId/decide';
const APPROVALS = 'GET /api/v2/workflows/approvals';

const definitions = () => rows(SCHEMA_TYPE.WORKFLOW_DEFINITIONS);
const runs = () => rows(SCHEMA_TYPE.WORKFLOW_RUNS);
const approval = () => rows(SCHEMA_TYPE.WORKFLOW_APPROVALS)[0];

const stepsOwnedBy = (field, userId) => [{ id: STEP, type: 'human_approval', config: { prompt: 'Ship it?', [field]: userId } }];
const STEPS = stepsOwnedBy('ownerUserId', MEMBER);
const seedDefinition = (over = {}) => mockDb.seed(SCHEMA_TYPE.WORKFLOW_DEFINITIONS, { _id: WORKFLOW, name: 'Ship it', steps: STEPS, enabled: true, createdBy: OWNER, deletedStatusKey: 0, ...over });
const seedApproval = (ownerUserId) => {
    mockDb.seed(SCHEMA_TYPE.WORKFLOW_RUNS, { _id: WORKFLOW_RUN, status: 'running', startedBy: OWNER });
    mockDb.seed(SCHEMA_TYPE.WORKFLOW_STEP_RUNS, { runId: WORKFLOW_RUN, stepId: STEP, type: 'human_approval', status: 'waiting' });
    mockDb.seed(SCHEMA_TYPE.WORKFLOW_APPROVALS, { runId: WORKFLOW_RUN, stepId: STEP, status: 'pending', ownerUserId, owners: [ownerUserId], title: 'Ship it?' });
    return { id: WORKFLOW_RUN, stepId: STEP };
};

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    [SCHEMA_TYPE.WORKFLOW_DEFINITIONS, SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.WORKFLOW_APPROVALS].forEach((type) => { mockDb.store[type] = []; });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'WORKFLOW_ENGINE'].forEach((key) => { delete process.env[key]; }); });

describe('starting a run', () => {
    const saved = () => { seedDefinition(); return { definitionId: WORKFLOW }; };
    const written = () => ({ name: 'Ship it', steps: STEPS });

    /* [who, what is started, the request's identity, the body, the answer, whether a run starts] */
    it.each([
        ['a signed-in person', 'a saved workflow', SESSION, saved, 200, true],
        ['a signed-in person', 'steps written into the request', SESSION, written, 200, true],
        ['a person\'s own API token', 'a saved workflow', PERSONAL, saved, 200, true],
        ['a person\'s own API token', 'steps written into the request', PERSONAL, written, 403, false],
        ['an agent\'s token', 'a saved workflow', AGENT, saved, 403, false],
        ['an agent\'s token', 'steps written into the request', AGENT, written, 403, false],
    ])('%s and %s', async (_who, _what, caller, body, code, starts) => {
        const out = await send(START, caller, {}, body());
        expect(out).toMatchObject({ code, body: { status: starts } });
        expect(runs()).toHaveLength(starts ? 1 : 0);
    });

    it('a token that names a saved workflow runs the saved steps, whatever steps it sends along', async () => {
        const out = await send(START, PERSONAL, {}, { ...saved(), steps: [{ id: 'sOther', type: 'human_approval', config: { prompt: 'Something else' } }] });
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        expect(out.body.data.steps.map((step) => step.stepId)).toEqual([STEP]);
    });
});

describe('who an approval is given to', () => {
    /* [what, the route, how the request is prepared, whether anything was written for the person named] */
    const NAMING = [
        ['saving a workflow', SAVE, (steps) => ({ body: { name: 'Ship it', steps } }), () => definitions().length === 1],
        ['changing a workflow', CHANGE, (steps) => { seedDefinition({ enabled: false }); return { params: { id: WORKFLOW }, body: { name: 'Renamed', steps } }; }, () => definitions()[0].name === 'Renamed'],
        ['turning on a workflow saved before', TURN_ON, (steps) => { seedDefinition({ enabled: false, steps }); return { params: { id: WORKFLOW }, body: { enabled: true } }; }, () => definitions()[0].enabled === true],
        ['starting steps written into the request', START, (steps) => ({ body: { name: 'Ship it', steps } }), () => runs().length === 1],
        ['starting a workflow saved before', START, (steps) => { seedDefinition({ steps }); return { body: { definitionId: WORKFLOW } }; }, () => runs().length === 1],
    ];
    const FIELDS = ['ownerUserId', 'escalateToUserId'];
    const cases = NAMING.flatMap(([what, route, prepare, done]) => FIELDS.map((field) => [what, field, route, prepare, done]));

    it.each(cases)('%s with a member as %s goes through', async (_what, field, route, prepare, done) => {
        const { params = {}, body } = prepare(stepsOwnedBy(field, MEMBER));
        expect(await send(route, SESSION, params, body)).toMatchObject({ code: 200, body: { status: true } });
        expect(done()).toBe(true);
    });

    it.each(cases)('%s with a guest as %s is refused, and says so', async (_what, field, route, prepare, done) => {
        const { params = {}, body } = prepare(stepsOwnedBy(field, GUEST));
        const out = await send(route, SESSION, params, body);
        expect(out.code).toBeGreaterThanOrEqual(400);
        expect(out.body.status).toBe(false);
        expect(JSON.stringify(out.body)).toMatch(GUEST_NAMED);
        expect(done()).toBe(false);
    });

    it.each(FIELDS)('a step that reaches a guest named as %s before does not open the approval', async (field) => {
        const run = { _id: WORKFLOW_RUN, workflowId: WORKFLOW, name: 'Ship it' };
        const step = { stepId: STEP, config: { prompt: 'Ship it?', ownerUserId: MEMBER, [field]: GUEST } };
        await expect(approvalStep.execute({ companyId: CID, run, step })).rejects.toThrow(GUEST_NAMED);
        expect(rows(SCHEMA_TYPE.WORKFLOW_APPROVALS)).toHaveLength(0);
    });

    it.each([['a member', MEMBER, 200, MEMBER], ['a guest', GUEST, 400, OWNER]])('handing an approval to %s', async (_who, toUserId, code, ownerAfter) => {
        const out = await send(REASSIGN, SESSION, seedApproval(OWNER), { toUserId });
        expect(out.code).toBe(code);
        expect(approval().ownerUserId).toBe(ownerAfter);
    });
});

describe('who decides an approval', () => {
    /* [who, the caller, who the approval names, whether they decide it] */
    it.each([
        ['the member it names', MEMBER, MEMBER, true],
        ['an owner, whoever it names', OWNER, MEMBER, true],
        ['a guest it was given to before', GUEST, GUEST, false],
        ['a member it does not name', MEMBER, OWNER, false],
    ])('%s', async (_who, uid, ownerUserId, decides) => {
        const params = seedApproval(ownerUserId);
        const out = await send(DECIDE, { uid }, params, { decision: 'approved' });
        expect(out).toMatchObject({ code: decides ? 200 : 403, body: { status: decides } });
        expect(approval().status).toBe(decides ? 'approved' : 'pending');
    });

    it('a guest reads the approval that names them as one they cannot decide', async () => {
        seedApproval(GUEST);
        const out = await send(APPROVALS, { uid: GUEST });
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        expect(out.body.data.map((row) => row.canDecide)).toEqual([false]);
    });
});
