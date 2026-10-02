/* A change made through MCP by a token held to some projects says so in its event, and a rule it wakes is held to
   the same projects where a step is judged for the rule's maker. What a rule does on the changed task itself, which
   is in the token's projects, is what it always did. */
process.env.STORAGE_TYPE = 'server';
process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
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
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/runs', () => ({
    ...jest.requireActual('../Modules/Agents/runs'),
    start: jest.fn(async (companyId, { agent, skill }) => ({ run: { _id: 'run-1', agentId: String(agent._id), skill, viaAccount: 'workspace', status: 'running' }, deduplicated: false })),
    executeSkill: jest.fn(async () => ({ status: 'done', outcome: 'ok', refusals: 0 })),
}));

const mockProbed = [];
jest.mock('../Modules/Automations/engine/registry', () => {
    const actual = jest.requireActual('../Modules/Automations/engine/registry');
    const probe = {
        key: 'probe',
        run: async ({ companyId, context }) => {
            const { canReadProject } = require('../Config/projectAccess');
            const maker = await require('../Modules/Automations/engine/tools').ruleOwner(companyId, context.ruleId);
            mockProbed.push({ maker, opensElsewhere: (await canReadProject(companyId, maker, require('./fixtures/mcpManageWorld').P_DEST)).allowed });
            return { ok: true };
        },
    };
    return { ...actual, getAction: (key) => (key === 'probe' ? probe : actual.getAction(key)) };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const domainEventBus = require('../event/domainEventBus');
const engine = require('../Modules/Automations/engine');
const matcher = require('../Modules/Automations/engine/matcher');
const taskRequests = require('../Modules/Agents/taskRequests');
const runs = require('../Modules/Agents/runs');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, P_OPEN, settle, ctx } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const WINDOW_MS = 2500;
const held = () => ctx(OWNER, { projectIds: [P_OPEN] });
const unheld = () => ctx(OWNER);
const person = { kind: 'human', userId: OWNER };

let fx;
let published = [];
const onEnvelope = (envelope) => published.push(envelope);
const afterWindow = async () => {
    for (let pass = 0; pass < 3; pass += 1) {
        await settle();
        await jest.advanceTimersByTimeAsync(WINDOW_MS);
    }
    await settle();
};
const renamed = () => published.filter((envelope) => envelope.type === 'task.renamed' && envelope.entity.id === String(fx.top._id));
const runsOf = (rule) => rows(SCHEMA_TYPE.AUTOMATION_RUNS).filter((run) => String(run.ruleId) === String(rule._id));

const seedRule = (steps, over = {}) => mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, {
    name: 'On rename', enabled: true, deletedStatusKey: 0, trigger: 'task.renamed', scope: { allProjects: true }, reactToAutomation: true, createdBy: OWNER,
    steps: steps.map((step, at) => ({ id: `s${at + 1}`, type: 'action', ...step })), ...over,
});

const renameThroughMcp = (caller, title) => rpc(caller, 'task.update', { taskId: fx.top._id, title });
const renameAsThePerson = (title) => taskRequests.executors['task.edit']({ companyId: CID, actor: person, params: { taskId: fx.top._id, fields: { TaskName: title } }, depth: 0 });

beforeAll(async () => {
    domainEventBus.start();
    domainEventBus.bus.on('domain.event', onEnvelope);
    await engine.start();
});
afterAll(async () => {
    domainEventBus.bus.off('domain.event', onEnvelope);
    await engine.stop();
    delete process.env.MCP_TOOLS_MANAGE;
});

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    jest.clearAllMocks();
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    matcher.invalidateAll();
    published = [];
    mockProbed.length = 0;
    fx = seed();
});
afterEach(async () => {
    await afterWindow();
    jest.useRealTimers();
});

describe('the event of a change made through MCP', () => {
    it('names the projects and the chat rule of a token held to some projects', async () => {
        expect(await renameThroughMcp(held(), 'Held')).toMatchObject({ ok: true });
        await afterWindow();

        expect(renamed()).toHaveLength(1);
        expect(renamed()[0]).toMatchObject({ actor: { kind: 'agent', userId: OWNER }, depth: 1, narrowing: { userId: OWNER, projectIds: [P_OPEN], chat: false } });
    });

    it('names no limits for a token held to no project, nor for the person', async () => {
        expect(await renameThroughMcp(unheld(), 'Unheld')).toMatchObject({ ok: true });
        await afterWindow();
        await renameAsThePerson('By hand');
        await afterWindow();

        expect(renamed().map((envelope) => [envelope.actor.kind, 'narrowing' in envelope])).toEqual([['agent', false], ['system', false]]);
    });
});

describe('a step judged for the rule\'s maker, about a project outside the token\'s', () => {
    it('is refused after the held token\'s change', async () => {
        seedRule([{ action: 'probe', config: {} }]);
        await renameThroughMcp(held(), 'Held');
        await afterWindow();

        expect(mockProbed).toEqual([{ maker: OWNER, opensElsewhere: false }]);
    });

    it('is done after the person\'s own change, and after a change by a token held to no project', async () => {
        seedRule([{ action: 'probe', config: {} }]);
        await renameAsThePerson('By hand');
        await afterWindow();
        await renameThroughMcp(unheld(), 'Unheld');
        await afterWindow();

        expect(mockProbed).toEqual([{ maker: OWNER, opensElsewhere: true }, { maker: OWNER, opensElsewhere: true }]);
    });
});

describe('what a rule does on the changed task after the held token\'s change', () => {
    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Reviewer', account: 'workspace', projectIds: [], deletedStatusKey: 0 });
    });

    it.each([
        ['set_priority', { priority: 'HIGH' }],
        ['set_status', { status: 'Done' }],
        ['assign', { mode: 'add', userIds: [MEMBER] }],
        ['add_comment', { body: 'Renamed.' }],
        ['create_subtask', { title: 'Check the new name' }],
        ['notify', { recipients: [MEMBER], message: 'Renamed.' }],
        ['run_agent', { agent: 'Reviewer', skill: 'qa-review' }],
    ])('%s still runs', async (action, config) => {
        const rule = seedRule([{ action, config }]);
        await renameThroughMcp(held(), 'Held');
        await afterWindow();

        expect(runsOf(rule).map((run) => [run.status, (run.steps || []).map((step) => step.error || null)])).toEqual([['success', [null]]]);
        if (action === 'run_agent') expect(runs.executeSkill).toHaveBeenCalledTimes(1);
    });

    it('the rule\'s own write says the same limits, so a rule it wakes in turn is held too', async () => {
        seedRule([{ action: 'set_priority', config: { priority: 'HIGH' } }]);
        await renameThroughMcp(held(), 'Held');
        await afterWindow();

        const ownWrite = published.filter((envelope) => envelope.type === 'task.priority_changed');
        expect(ownWrite).toEqual([expect.objectContaining({ actor: { kind: 'automation', userId: null }, depth: 2, narrowing: { userId: OWNER, projectIds: [P_OPEN], chat: false } })]);
    });
});
