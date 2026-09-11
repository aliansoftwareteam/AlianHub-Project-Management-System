const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid })), isAgent: (a) => a.kind === 'agent' }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ gather: jest.fn(async () => ({ status: 'gathered', context: {} })), analyse: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ DECLINE_REASON_TEXT: { too_many_changes: 'x', wrong_tone: 'x', needs_person: 'x', not_now: 'x' }, contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null) }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), unpricedMessage: (m) => `No price on file for ${m}`, UNPRICED_MODEL: 'unpriced_model', summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'gpt-4.1' })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const persistence = require('../Modules/AICore/persistence');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const { AIProviderError } = require('../Modules/AICore/providerError');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Plan the launch', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = { _id: AGENT_ID, name: 'Planner', autonomy: 1, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 10 };
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Planner', runId: null, viaAccount: 'workspace', tokenId: null };
const deps = () => ({ proposals: { create: jest.fn() }, actions: { perform: jest.fn() }, actor });

const rateLimited = () => new AIProviderError({ provider: 'openai', model: 'gpt-4.1', status: 429, type: 'rate_limit', code: 'rate_limit_exceeded', requestId: 'req_rl1', retryAfterMs: 20000, raw: { type: 'tokens', code: 'rate_limit_exceeded', message: 'Rate limit reached' } });
const overloaded = () => new AIProviderError({ provider: 'anthropic', model: 'claude-sonnet-4-6', status: 529, type: 'overloaded', code: 'overloaded_error', requestId: 'req_011C' });

const start = () => runs.create(C, { agent, taskId: TASK._id, projectId: 'p1', skill: 'plan', startedBy: 'u1' });
const execute = (run) => runs.executeSkill(C, run, agent, TASK, deps());
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: 'u1', ...over });

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent);
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('a run that fails on a provider error keeps the cause', () => {
    it('stores failure with the group key when the model call came back failed', async () => {
        const error = rateLimited();
        orchestrator.analyse.mockResolvedValue({ status: 'failed', reason: `model call failed: ${error.message}`, error, skill: 'plan', usage: { totalTokens: 0 }, model: null });
        const run = await start();
        const out = await execute(run);
        expect(out.status).toBe('failed');
        expect(runRow(run._id).failure).toEqual({
            type: 'rate_limit', code: 'rate_limit_exceeded', provider: 'openai', model: 'gpt-4.1', status: 429,
            requestId: 'req_rl1', groupKey: 'openai:rate_limit:rate_limit_exceeded', message: error.message,
        });
    });

    it('stores failure when the provider error is thrown through the graph', async () => {
        orchestrator.analyse.mockRejectedValue(overloaded());
        const run = await start();
        const out = await execute(run);
        expect(out.status).toBe('failed');
        const row = runRow(run._id);
        expect(row.error).toBe(overloaded().message);
        expect(row.failure).toMatchObject({ type: 'overloaded', code: 'overloaded_error', provider: 'anthropic', requestId: 'req_011C', groupKey: 'anthropic:overloaded:overloaded_error' });
    });

    it('stores no failure for a run that failed on something other than a provider', async () => {
        orchestrator.analyse.mockRejectedValue(new Error('db blip'));
        const run = await start();
        await execute(run);
        expect(runRow(run._id).failure == null).toBe(true);
    });
});

describe('the runs API exposes the failure', () => {
    const seedFailed = async () => {
        orchestrator.analyse.mockRejectedValueOnce(rateLimited());
        const limited = await start();
        await execute(limited);
        orchestrator.analyse.mockRejectedValueOnce(overloaded());
        const busy = await runs.create(C, { agent, taskId: '6f0000000000000000000702', projectId: 'p1', skill: 'plan', startedBy: 'u1' });
        await runs.executeSkill(C, busy, agent, { ...TASK, _id: '6f0000000000000000000702' }, deps());
        return { limited, busy };
    };

    it('filters the run list by ?errorType=', async () => {
        const { limited, busy } = await seedFailed();
        const r = res();
        await ctrl.listRuns(req({ query: { errorType: 'rate_limit' } }), r);
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((x) => String(x._id))).toEqual([String(limited._id)]);

        const all = res();
        await ctrl.listRuns(req(), all);
        expect(all.body.data.map((x) => String(x._id)).sort()).toEqual([String(limited._id), String(busy._id)].sort());
    });

    it('refuses an error type outside the closed set', async () => {
        const r = res();
        await ctrl.listRuns(req({ query: { errorType: 'bogus' } }), r);
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
    });

    it('returns failure on the run detail payload', async () => {
        const { limited } = await seedFailed();
        const r = res();
        await ctrl.getRun(req({ params: { id: String(limited._id) } }), r);
        expect(r.body.status).toBe(true);
        expect(r.body.data.run.failure).toMatchObject({ type: 'rate_limit', groupKey: 'openai:rate_limit:rate_limit_exceeded', requestId: 'req_rl1' });
    });
});
