const crypto = require('crypto');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => (uid === 'member1' ? 3 : 1)), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/pageAudit', () => ({ ...jest.requireActual('../Modules/Agents/engine/pageAudit'), audit: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ DECLINE_REASON_TEXT: { too_many_changes: 'x' }, contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const logger = require('../Config/loggerConfig');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { metered } = require('../Modules/AICore/spend');
const { FEATURES } = require('../Modules/AICore/features');
const replay = require('../Modules/AICore/replay');
const telemetry = require('../Config/telemetry');
const pageAudit = require('../Modules/Agents/engine/pageAudit');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const persistence = require('../Modules/AICore/persistence');
const runs = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/controller');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const MODEL = 'gpt-4.1';
const DAY_MS = 86400000;
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review https://example.com', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };
const answer = { summary: 'one issue', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }] };

const reply = (over = {}) => ({ content: JSON.stringify(answer), inputTokens: 1000, outputTokens: 500, model: MODEL, ...over });
const chat = jest.fn();
const vendor = { name: 'openai', model: MODEL, isConfigured: true, chat };
const deps = () => ({ proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) }, actions: { perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }, actor });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const replays = () => mockDb.store[SCHEMA_TYPE.AI_REPLAYS] || [];
const start = (over = {}) => runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', ...over });
const execute = (run) => runs.executeSkill(C, run, agent(), TASK, deps());
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: 'owner1', ip: '1.1.1.1', ...over });

const MESSAGES = [{ role: 'user', content: 'Plan the launch with ops@example.com' }];
const askChat = (over = {}) => metered(vendor).chat({ systemPrompt: 'You are a planner.', messages: MESSAGES, temperature: 0.4, maxTokens: 900, jsonMode: false, spend: { feature: FEATURES.ASK, companyId: C, userId: 'u1' }, ...over });

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.AI_REPLAY;
    delete process.env.AI_REPLAY_RETENTION_DAYS;
    mem = persistence.useInMemory();
    getProvider.mockReturnValue(metered(vendor));
    chat.mockResolvedValue(reply());
    pageAudit.audit.mockResolvedValue({ ok: true, facts: [{ id: 'f1', ok: false, detail: 'img without alt' }, { id: 'title', ok: true, detail: 'has title' }], blindSpots: [] });
    findingMemory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('an agent run keeps one replay record per model call', () => {
    it('records the prompt hash, the revisions, the parameters and the usage of the call', async () => {
        const run = await start();
        await execute(run);

        expect(chat).toHaveBeenCalledTimes(1);
        expect(replays()).toHaveLength(1);
        const request = chat.mock.calls[0][0];
        const row = replays()[0];
        const pinned = runRow(run._id);
        expect(row).toMatchObject({
            feature: 'agent_run', runId: String(run._id), agentId: AGENT_ID,
            agentRevision: pinned.agentRevision, skillRevision: pinned.skillRevision,
            model: MODEL, provider: 'openai',
            params: { temperature: request.temperature, maxTokens: request.maxTokens, jsonMode: true },
            promptHash: sha256(JSON.stringify({ system: request.systemPrompt, messages: request.messages })),
            retrievedChunkIds: [], response: JSON.stringify(answer),
            usage: { inputTokens: 1000, outputTokens: 500 }, costUsd: 0.006,
            status: 'ok', errorCode: null, traceId: pinned.traceId, truncated: false,
        });
        expect(row.skillRevision).toMatchObject({ key: 'qa-review' });
        expect(row.system).toEqual(expect.any(String));
        expect(row.messages).toHaveLength(1);
        expect(row.durationMs).toEqual(expect.any(Number));
        expect(mockDb.calls.find((c) => c.type === SCHEMA_TYPE.AI_REPLAYS).companyId).toBe(C);
    });

    it('writes one record for every call a run makes, in order', async () => {
        const spend = { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-9', agentId: AGENT_ID, agentRevision: 3, skillRevision: { key: 'plan', hash: null, n: 2 } };
        chat.mockResolvedValueOnce(reply({ content: 'first' })).mockResolvedValueOnce(reply({ content: 'second' }));
        await metered(vendor).chat({ messages: MESSAGES, spend });
        await metered(vendor).chat({ messages: MESSAGES, spend });
        expect(replays().map((r) => [r.runId, r.response, r.agentRevision, r.skillRevision.n])).toEqual([['run-9', 'first', 3, 2], ['run-9', 'second', 3, 2]]);
    });

    it('records a failed vendor call as an error with its code and rethrows it', async () => {
        chat.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { code: 'rate_limit_exceeded' }));
        await expect(metered(vendor).chat({ messages: MESSAGES, spend: { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-1' } })).rejects.toThrow('rate limited');
        expect(replays()).toHaveLength(1);
        expect(replays()[0]).toMatchObject({ status: 'error', errorCode: 'rate_limit_exceeded', response: null, usage: { inputTokens: 0, outputTokens: 0 } });
    });
});

describe('the replay record carries the trace id', () => {
    const TRACE_ID = /^[0-9a-f]{32}$/;
    const agentCall = () => metered(vendor).chat({ messages: MESSAGES, spend: { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-1' } });

    it('a record written inside a traced run carries the run trace id', async () => {
        const run = await start();
        await execute(run);
        const { traceId } = runRow(run._id);
        expect(traceId).toMatch(TRACE_ID);
        expect(replays()).toHaveLength(1);
        expect(replays()[0].traceId).toBe(traceId);
    });

    it('a call re-entering a trace records that trace id', async () => {
        const traceId = telemetry.newTraceId();
        await telemetry.withTrace(traceId, agentCall);
        expect(replays()[0].traceId).toBe(traceId);
    });

    it('a call outside any trace records null', async () => {
        await agentCall();
        expect(replays()[0].traceId).toBeNull();
    });

    it('a throwing telemetry module leaves null and the record is still written', async () => {
        const spy = jest.spyOn(telemetry, 'traceIdNow').mockImplementation(() => { throw new Error('tracer down'); });
        try {
            await telemetry.withTrace(telemetry.newTraceId(), agentCall);
        } finally { spy.mockRestore(); }
        expect(replays()).toHaveLength(1);
        expect(replays()[0].traceId).toBeNull();
    });

    it('a missing telemetry module leaves null', async () => {
        let isolated;
        jest.isolateModules(() => {
            jest.doMock('../Config/telemetry', () => { throw new Error("Cannot find module '../../Config/telemetry'"); });
            isolated = require('../Modules/AICore/replay');
        });
        await isolated.record({ context: { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-1' }, opts: { messages: MESSAGES }, adapter: vendor, result: reply(), durationMs: 5 });
        jest.dontMock('../Config/telemetry');
        expect(replays()).toHaveLength(1);
        expect(replays()[0].traceId).toBeNull();
    });
});

describe('the AI_REPLAY policy', () => {
    it('off writes nothing, even for an agent run', async () => {
        process.env.AI_REPLAY = 'off';
        const run = await start();
        await execute(run);
        expect(chat).toHaveBeenCalledTimes(1);
        expect(replays()).toHaveLength(0);
    });

    it('a non-agent feature writes nothing under the default and one record under all', async () => {
        await askChat();
        expect(replays()).toHaveLength(0);

        process.env.AI_REPLAY = 'all';
        await askChat();
        expect(replays()).toHaveLength(1);
        expect(replays()[0]).toMatchObject({ feature: 'ask', runId: null, agentId: null, agentRevision: null, skillRevision: null, params: { temperature: 0.4, maxTokens: 900, jsonMode: false } });
    });

    it('an unknown mode falls back to agent runs only', () => {
        process.env.AI_REPLAY = 'everything';
        expect(replay.mode()).toBe('agent');
        expect(replay.shouldRecord(FEATURES.AGENT_RUN)).toBe(true);
        expect(replay.shouldRecord(FEATURES.ASK)).toBe(false);
    });

    it('expires the record after the retention window, 30 days by default', async () => {
        process.env.AI_REPLAY = 'all';
        await askChat();
        const [first] = replays();
        expect(first.expiresAt.getTime() - first.createdAt.getTime()).toBe(30 * DAY_MS);

        process.env.AI_REPLAY_RETENTION_DAYS = '7';
        await askChat();
        const second = replays()[1];
        expect(second.expiresAt.getTime() - second.createdAt.getTime()).toBe(7 * DAY_MS);

        process.env.AI_REPLAY_RETENTION_DAYS = 'soon';
        expect(replay.retentionDays()).toBe(30);
    });
});

describe('redaction and caps', () => {
    it('masks secrets in the prompt and response while the hash is taken from the unredacted prompt', async () => {
        process.env.AI_REPLAY = 'all';
        const system = 'token ghp_1234567890abcdefghijABCDEFGHIJ123456';
        const secretPrompt = [{ role: 'user', content: '{"apiKey": "sk-live-0123456789abcdefghij", "owner": "ops@example.com"}' }];
        chat.mockResolvedValueOnce(reply({ content: 'Use Bearer abcdef1234567890XYZ to call back ops@example.com' }));
        await askChat({ systemPrompt: system, messages: secretPrompt });
        const row = replays()[0];
        const stored = JSON.stringify([row.system, row.messages, row.response]);
        ['sk-live-0123456789abcdefghij', 'ops@example.com', 'ghp_1234567890abcdefghijABCDEFGHIJ123456', 'abcdef1234567890XYZ'].forEach((secret) => expect(stored).not.toContain(secret));
        expect(row.promptHash).toBe(sha256(JSON.stringify({ system, messages: secretPrompt })));
        expect(row.promptHash).toBe(replay.promptHashOf({ systemPrompt: system, messages: secretPrompt }));
    });

    it('cuts the prompt and the response at 200 KB each and says so', async () => {
        process.env.AI_REPLAY = 'all';
        const big = 'a '.repeat(150 * 1024);
        chat.mockResolvedValueOnce(reply({ content: 'b '.repeat(150 * 1024) }));
        await askChat({ systemPrompt: big, messages: [{ role: 'user', content: big }, { role: 'user', content: 'tail' }] });
        const row = replays()[0];
        const promptBytes = Buffer.byteLength(row.system) + row.messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
        expect(promptBytes).toBeLessThanOrEqual(replay.MAX_BYTES);
        expect(Buffer.byteLength(row.response)).toBeLessThanOrEqual(replay.MAX_BYTES);
        expect(row.messages).toHaveLength(2);
        expect(row.truncated).toBe(true);
    });
});

describe('a replay write never fails the call', () => {
    it('a failed write logs one warning and the run still finishes', async () => {
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (query.type === SCHEMA_TYPE.AI_REPLAYS) throw new Error('replay store down');
            return real(companyId, query, method);
        });
        let run;
        try {
            run = await start();
            await execute(run);
        } finally { mockDb.crud.mockImplementation(real); }
        expect(runRow(run._id).status).not.toBe('failed');
        expect(runRow(run._id).finishedAt || runRow(run._id).status === 'waiting_approval').toBeTruthy();
        const warnings = logger.warn.mock.calls.filter(([m]) => String(m).includes('replay store down'));
        expect(warnings).toHaveLength(1);
        expect(replays()).toHaveLength(0);
    });
});

describe('GET /api/v2/agents/runs/:id/replay', () => {
    const seedRun = async () => {
        const run = await start();
        await execute(run);
        return run;
    };

    it('returns the run records in order to an owner', async () => {
        const run = await seedRun();
        mockDb.seed(SCHEMA_TYPE.AI_REPLAYS, { feature: 'agent_run', runId: String(run._id), response: 'later', createdAt: new Date(Date.now() + 60000) });
        mockDb.seed(SCHEMA_TYPE.AI_REPLAYS, { feature: 'agent_run', runId: 'other-run', response: 'elsewhere', createdAt: new Date() });
        const r = res();
        await ctrl.getRunReplay(req({ params: { id: String(run._id) } }), r);
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((row) => row.response)).toEqual([JSON.stringify(answer), 'later']);
    });

    it('refuses a member with 403', async () => {
        const run = await seedRun();
        const r = res();
        await ctrl.getRunReplay(req({ uid: 'member1', params: { id: String(run._id) } }), r);
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
    });

    it('answers 404 for a run that is not in the workspace', async () => {
        const r = res();
        await ctrl.getRunReplay(req({ params: { id: '6f00000000000000000000ff' } }), r);
        expect(r.code).toBe(404);
    });

    it('the run detail carries replayId when records exist', async () => {
        const run = await seedRun();
        const r = res();
        await ctrl.getRun(req({ params: { id: String(run._id) } }), r);
        expect(r.body.data.run.replayId).toBe(String(replays()[0]._id));

        process.env.AI_REPLAY = 'off';
        const quiet = await start({ taskId: '6f0000000000000000000702' });
        await runs.executeSkill(C, quiet, agent(), { ...TASK, _id: '6f0000000000000000000702' }, deps());
        const r2 = res();
        await ctrl.getRun(req({ params: { id: String(quiet._id) } }), r2);
        expect(r2.body.data.run.replayId).toBeUndefined();
    });
});
