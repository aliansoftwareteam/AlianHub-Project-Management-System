/* What an agent may do is set by a person signed in to AlianHub. */
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
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn(async () => ({})) }));
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
jest.mock('../Modules/AICore/instructionGuard', () => ({ fresh: jest.fn(async () => {}), holdsInstruction: () => false, hasInstruction: () => false }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const persistence = require('../Modules/AICore/persistence');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const memory = require('../Modules/Agents/memory');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { SESSION_SETS } = require('../Modules/Agents/personDecides');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, TOKEN, P_OPEN, TASKS_GRANT, settle, ctx } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const store = persistence.useInMemory();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const AGENT_ID = '6f0000000000000000000a91';
const RUN_ID = '6f0000000000000000000a92';
const SCHEDULE_ID = '6f0000000000000000000a93';
const SKILL_KEY = 'brief.parse';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} };
['Agents', 'Audit'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

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

const agent = () => rows(SCHEMA_TYPE.AGENTS).find((row) => String(row._id) === AGENT_ID);
const company = () => rows(dbCollections.COMPANIES).find((row) => String(row._id) === CID);
const person = (id) => rows(SCHEMA_TYPE.USERS).find((row) => String(row._id) === id);
const run = () => rows(SCHEMA_TYPE.AGENT_RUNS).find((row) => String(row._id) === RUN_ID);
const schedule = () => rows(SCHEMA_TYPE.AGENT_SCHEDULES).find((row) => String(row._id) === SCHEDULE_ID);
const skill = (key = SKILL_KEY) => rows(SCHEMA_TYPE.AGENT_SKILLS).find((row) => row.key === key);
const revisions = () => rows(SCHEMA_TYPE.AGENT_REVISIONS);
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');
const comments = () => rows(SCHEMA_TYPE.COMMENTS);

const skillDoc = (over = {}) => validateSkill({
    key: SKILL_KEY, name: 'Intake', inputs: ['brief'], gather: [{ reader: 'task' }],
    prompt: { partials: ['json_only'], instructions: 'Break the brief down.', template: '{{input.brief}} {{gather.task.title}}', output: '{"summary":"..."}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    ...over,
}).value;

const seedSkill = () => mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
const seedRun = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN_ID, agentId: AGENT_ID, agentName: 'Triage', taskId: String(fx.top._id), projectId: P_OPEN, status: 'running', startedBy: OWNER, startedAt: new Date(), ...over });
const seedSchedule = () => mockDb.seed(SCHEMA_TYPE.AGENT_SCHEDULES, { _id: SCHEDULE_ID, agentId: AGENT_ID, ownerId: OWNER, createdBy: OWNER, report: 'weekly_status', every: 'daily', at: '09:00', timezone: 'UTC', enabled: true, deletedStatusKey: 0, deliver: { email: false }, options: {} });
const REMEMBERED = 'Releases go out on Thursdays';
const [MEMORY_KIND] = memory.PROJECT_KINDS;
const seedMemory = () => memory.remember({ companyId: CID, kind: MEMORY_KIND, scopeId: P_OPEN, text: REMEMBERED, source: { origin: 'owner', userId: OWNER } });
const remembered = () => memory.find({ companyId: CID, kind: MEMORY_KIND, scopeId: P_OPEN, key: memory.slug(REMEMBERED) });
const tone = async () => (await memory.listUser({ companyId: CID, userId: OWNER })).preferences.tone;
const agentAudit = require('../Modules/Agents/agentAudit');

/* A finished run that moved a task to done, which reverting it moves back. */
const seedRunWithChange = async () => {
    seedRun({ status: 'done', startedAt: new Date(Date.now() - 2 * HOUR), finishedAt: new Date(Date.now() - HOUR) });
    Object.assign(fx.top, { status: { key: 3, text: 'Done', type: 'close' }, statusType: 'close', statusKey: 3 });
    await agentAudit.recordAction(CID, { kind: 'agent', userId: OWNER, agentId: AGENT_ID, agentName: 'Triage', runId: RUN_ID, viaAccount: 'workspace', tokenId: null }, {
        action: 'task.status', reason: 'test', params: {}, entityType: 'task', entityId: String(fx.top._id),
        undo: { kind: 'status', taskId: String(fx.top._id), previous: { status: 'In Progress', statusType: 'active', statusKey: 2 } },
    });
};

/* A change an agent made that a person may take back: a comment a proposal's approval applied. */
const appliedComment = async () => {
    const filed = await rpc(ctx(OWNER), 'task.comment', { taskId: fx.top._id, body: 'Looks ready' });
    expect(filed).toMatchObject({ pending: true });
    expect((await send('POST /api/v2/agents/proposals/:id/approve', SESSION, { id: filed.proposalId })).code).toBe(200);
    const row = rows(SCHEMA_TYPE.AUDIT_LOGS).find((entry) => entry.meta && entry.meta.undo && entry.meta.undo.kind === 'comment');
    return String(row._id);
};

let fx;

/* [what, the route, how the request is prepared (params, body, and whether the change was made), what a member's session is answered] */
const MANAGED = [
    ['creating an agent', 'POST /api/v2/agents', () => ({ body: { name: 'Second', autonomy: 3, spendCapUsd: 500 }, done: () => rows(SCHEMA_TYPE.AGENTS).length === 2 }), 403],
    ['changing an agent\'s autonomy, spend cap, actions and projects', 'PUT /api/v2/agents/:id', () => ({
        params: { id: AGENT_ID }, body: { autonomy: 3, spendCapUsd: 500, allowedActions: ['task.comment', 'task.status.set'], projectIds: [] },
        done: () => agent().autonomy === 3 && agent().spendCapUsd === 500,
    }), 403],
    ['deleting an agent', 'DELETE /api/v2/agents/:id', () => ({ params: { id: AGENT_ID }, done: () => agent().deletedStatusKey === 1 }), 403],
    ['pausing an agent', 'POST /api/v2/agents/:id/pause', () => ({ params: { id: AGENT_ID }, done: () => agent().paused === true }), 403],
    ['resuming an agent', 'POST /api/v2/agents/:id/resume', () => { agent().paused = true; return { params: { id: AGENT_ID }, done: () => agent().paused === false }; }, 403],
    ['pausing every agent', 'POST /api/v2/agents/pause-all', () => ({ done: () => agent().paused === true }), 403],
    ['saving a revision of an agent', 'POST /api/v2/agents/:id/revisions', () => ({ params: { id: AGENT_ID }, body: { state: 'candidate', autonomy: 3 }, done: () => revisions().some((row) => row.state === 'candidate') }), 403],
    ['making a revision live', 'POST /api/v2/agents/:id/revisions/:n/promote', async () => {
        expect((await send('POST /api/v2/agents/:id/revisions', SESSION, { id: AGENT_ID }, { state: 'candidate', autonomy: 3 })).code).toBe(200);
        const { n } = revisions().find((row) => row.state === 'candidate');
        return { params: { id: AGENT_ID, n: String(n) }, done: () => agent().autonomy === 3 };
    }, 403],
    ['rolling an agent back to a revision', 'POST /api/v2/agents/:id/revisions/:n/rollback', async () => {
        expect((await send('GET /api/v2/agents/:id/revisions', SESSION, { id: AGENT_ID })).code).toBe(200);
        expect((await send('PUT /api/v2/agents/:id', SESSION, { id: AGENT_ID }, { autonomy: 3 })).code).toBe(200);
        return { params: { id: AGENT_ID, n: '1' }, done: () => agent().autonomy === 1 };
    }, 403],
    ['creating a skill', 'POST /api/v2/agents/skills', () => ({ body: skillDoc({ key: 'task.summary', name: 'Summariser' }), done: () => Boolean(skill('task.summary')), code: 201 }), 403],
    ['changing a skill', 'PUT /api/v2/agents/skills/:key', () => { seedSkill(); return { params: { key: SKILL_KEY }, body: { name: 'Renamed' }, done: () => skill().name === 'Renamed' }; }, 403],
    ['retiring a skill', 'DELETE /api/v2/agents/skills/:key', () => { seedSkill(); return { params: { key: SKILL_KEY }, done: () => skill().enabled === false }; }, 403],
    ['adding a schedule', 'POST /api/v2/agents/:id/schedules', () => {
        agent().autonomy = 3;
        return { params: { id: AGENT_ID }, body: { report: 'weekly_status', every: 'daily', at: '09:00', timezone: 'UTC' }, done: () => rows(SCHEMA_TYPE.AGENT_SCHEDULES).length === 1 };
    }, 403],
    ['changing a schedule', 'PUT /api/v2/agents/:id/schedules/:scheduleId', () => {
        agent().autonomy = 3;
        seedSchedule();
        return { params: { id: AGENT_ID, scheduleId: SCHEDULE_ID }, body: { at: '18:00' }, done: () => schedule().at === '18:00' };
    }, 404],
    ['removing a schedule', 'DELETE /api/v2/agents/:id/schedules/:scheduleId', () => { seedSchedule(); return { params: { id: AGENT_ID, scheduleId: SCHEDULE_ID }, done: () => schedule().deletedStatusKey === 1 }; }, 404],
    ['writing what agents remember of a project', 'POST /api/v2/agents/memory/project/:projectId', () => ({
        params: { projectId: P_OPEN }, body: { kind: MEMORY_KIND, text: REMEMBERED }, done: async () => Boolean(await remembered()),
    }), 403],
    ['changing what agents remember', 'PUT /api/v2/agents/memory/:id', async () => {
        const row = await seedMemory();
        return { params: { id: row.id }, body: { projectId: P_OPEN, status: memory.STATUS.RETIRED }, done: async () => (await remembered()).status === memory.STATUS.RETIRED };
    }, 403],
    ['changing how agents answer a person', 'PUT /api/v2/agents/preferences', () => ({ body: { tone: memory.TONES[0] }, done: async () => (await tone()) === memory.TONES[0] }), 200],
    ['the undo window and the monthly budget', 'PUT /api/v2/agents/settings', () => ({ body: { undoHours: 48, monthlyBudgetUsd: 900 }, done: () => company().agentUndoHours === 48 }), 403],
    ['which model each kind of work goes to', 'PUT /api/v2/agents/routing-policy', () => ({ body: { classes: { classify: { latencyTargetMs: 1500 } } }, done: () => Boolean(company().aiRoutingPolicy) }), 403],
    ['linking a person\'s own agent account', 'PUT /api/v2/agents/account', () => ({ body: { mode: 'personal', provider: 'anthropic', label: 'Mine' }, done: () => Boolean(person(OWNER).agentAccount) }), 200],
    ['unlinking a person\'s own agent account', 'DELETE /api/v2/agents/account', () => {
        person(OWNER).agentAccount = { mode: 'personal' };
        person(MEMBER).agentAccount = { mode: 'personal' };
        return { done: () => !person(OWNER).agentAccount };
    }, 200],
    ['stopping a run', 'POST /api/v2/agents/runs/:id/stop', () => { seedRun(); return { params: { id: RUN_ID }, done: () => run().status === 'stopped' }; }, 403],
    ['reverting a run', 'POST /api/v2/agents/runs/:id/revert', async () => { await seedRunWithChange(); return { params: { id: RUN_ID }, done: () => Boolean(run().revertedAt) }; }, 403],
    ['taking back a change an agent made', 'POST /api/v1/audit-logs/:id/undo', async () => {
        const id = await appliedComment();
        const before = comments().length;
        return { params: { id }, done: () => comments().length < before || comments().some((row) => row.deletedStatusKey === 1 || row.isDeleted === true) };
    }, 200],
];

const prepared = async (prepare) => ({ params: {}, body: {}, code: 200, ...(await prepare()) });

beforeEach(() => {
    jest.clearAllMocks();
    store.reset();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
    [SCHEMA_TYPE.AGENTS, SCHEMA_TYPE.AGENT_RUNS, SCHEMA_TYPE.AGENT_SCHEDULES, SCHEMA_TYPE.AGENT_SKILLS, SCHEMA_TYPE.AGENT_REVISIONS,
        SCHEMA_TYPE.AGENT_PROPOSALS, SCHEMA_TYPE.API_TOKENS, dbCollections.COMPANIES].forEach((type) => { mockDb.store[type] = []; });
    mockDb.seed(dbCollections.COMPANIES, { _id: CID, Company_Name: 'Acme' });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Triage', ownerId: OWNER, autonomy: 1, spendCapUsd: 30, paused: false, deletedStatusKey: 0, projectIds: [], account: 'workspace' });
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: [TASKS_GRANT], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_OPEN).agentPolicy = { done: projectPolicy.DONE.YES, connected: projectPolicy.CONNECTED.PROPOSE_ALL };
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('what sets how agents work in a workspace', () => {
    it.each(MANAGED)('%s is a signed-in person\'s', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        expect(await request.done()).toBe(false);
        expect(await send(route, SESSION, request.params, request.body)).toMatchObject({ code: request.code, body: { status: true } });
        expect(await request.done()).toBe(true);
    });

    it.each(MANAGED)('%s is refused to a person\'s own API token', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        expect(await send(route, PERSONAL, request.params, request.body)).toMatchObject({ code: 403, body: { status: false, statusText: SESSION_SETS } });
        expect(await request.done()).toBe(false);
        expect(refusals()).toHaveLength(0);
    });

    it.each(MANAGED)('%s is refused to an agent\'s token, and the attempt is recorded', async (_what, route, prepare) => {
        const request = await prepared(prepare);
        const out = await send(route, AGENT, request.params, request.body);
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(out.body.auditId).toBeTruthy();
        expect(await request.done()).toBe(false);
        expect(refusals()).toHaveLength(1);
    });

    it.each(MANAGED)('%s answers a member\'s session as the route\'s own rule has it', async (_what, route, prepare, answered) => {
        const request = await prepared(prepare);
        const out = await send(route, MEMBER_SESSION, request.params, request.body);
        expect(out.code).toBe(answered === 200 ? request.code : answered);
        expect(out.body.statusText).not.toBe(SESSION_SETS);
        expect(refusals()).toHaveLength(0);
    });
});

/* A write under the agent routes that is not listed here is one a token is refused: a route added later is closed until it is named. */
const OPEN_TO_TOKENS = [
    'POST /api/v2/agents/chat/direct',
    'POST /api/v2/agents/draft',
    'POST /api/v2/agents/alerts/evaluate',
    'POST /api/v2/agents/skills/:key/dry-run',
    'POST /api/v2/agents/runs',
    'POST /api/v2/agents/proposals',
];
/* Refused by a rule of their own: a decision, a project's settings for agents, the work queue. */
const REFUSED_BY_THEIR_OWN_RULE = [
    'POST /api/v2/agents/proposals/:id/approve',
    'POST /api/v2/agents/proposals/:id/decline',
    'POST /api/v2/agents/proposals/:id/undo',
    'PUT /api/v2/agents/policy',
    'PUT /api/v2/agents/project-policy/:projectId',
    'PUT /api/v2/agents/project-limits/:projectId',
    'DELETE /api/v2/agents/standing-approvals/:projectId/:id',
    'PUT /api/v2/agents/project-manager/:projectId',
    'POST /api/v2/agents/work-queue/task/:taskId/hand-over',
    'POST /api/v2/agents/work-queue/:itemId/take-back',
];

describe('every write under the agent routes', () => {
    const writes = Object.keys(routes).filter((route) => route.includes('/api/v2/agents') && !route.startsWith('GET '));
    const others = writes.filter((route) => !MANAGED.some(([, managed]) => managed === route));

    it('is one a person signs in for, one with a rule of its own, or one named as open to a token', () => {
        expect(others.sort()).toEqual([...OPEN_TO_TOKENS, ...REFUSED_BY_THEIR_OWN_RULE].sort());
    });

    it.each(REFUSED_BY_THEIR_OWN_RULE)('%s is refused to a person\'s own API token', async (route) => {
        const params = { id: AGENT_ID, projectId: P_OPEN, taskId: String(fx.top._id), itemId: AGENT_ID };
        expect(await send(route, PERSONAL, params, {})).toMatchObject({ code: 403, body: { status: false } });
    });
});

describe('what an agent does for itself', () => {
    it('files a proposal with its own token', async () => {
        const out = await send('POST /api/v2/agents/proposals', { ...AGENT, apiToken: { ...AGENT.apiToken, agentId: AGENT_ID } }, {}, {
            agentId: AGENT_ID, taskId: String(fx.top._id), projectId: P_OPEN, what: 'Comment on the task', why: 'It is ready',
            changes: [{ action: 'task.comment', params: { taskId: String(fx.top._id), body: 'Ready' } }],
        });
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(1);
    });

    it('asks for a change on its task through its tool', async () => {
        const reply = await rpc(ctx(OWNER), 'task.comment', { taskId: fx.top._id, body: 'Looks ready' });
        expect(reply).toMatchObject({ pending: true });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(1);
    });

    it('reads the agents and the settings with a token', async () => {
        for (const route of ['GET /api/v2/agents', 'GET /api/v2/agents/settings', 'GET /api/v2/agents/routing-policy']) {
            // eslint-disable-next-line no-await-in-loop
            expect(await send(route, PERSONAL)).toMatchObject({ code: 200, body: { status: true } });
        }
    });
});
