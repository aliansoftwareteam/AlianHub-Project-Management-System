const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/pageAudit', () => ({ ...jest.requireActual('../Modules/Agents/engine/pageAudit'), audit: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { estimateCall } = require('../Modules/AICore/estimate');
const pageAudit = require('../Modules/Agents/engine/pageAudit');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const persistence = require('../Modules/Agents/engine/persistence');
const runs = require('../Modules/Agents/runs');
const spendGuard = require('../Modules/Agents/spendGuard');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const MODEL = 'gpt-4.1';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review https://example.com', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 1, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };
const answer = { summary: 'one issue', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }] };

const reply = (over = {}) => ({ content: JSON.stringify(answer), inputTokens: 1000, outputTokens: 500, model: MODEL, ...over });
const chat = jest.fn();
const provider = { name: 'openai', model: MODEL, isConfigured: true, chat };
const deps = () => ({ proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) }, actions: { perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }, actor });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const refusalRows = () => (mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((r) => r.action === 'agent.action_refused');
const start = (over = {}) => runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', ...over });
const execute = (run) => runs.executeSkill(C, run, agent(), TASK, deps());
const money = (n) => Math.round(n * 10000) / 10000;

/* The first (and only) request the fake vendor received, priced the way the guard priced it. */
const estimateOfRequest = () => estimateCall({ ...chat.mock.calls[0][0], model: MODEL });

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    getProvider.mockReturnValue(provider);
    chat.mockResolvedValue(reply());
    pageAudit.audit.mockResolvedValue({ ok: true, facts: [{ id: 'f1', ok: false, detail: 'img without alt' }, { id: 'title', ok: true, detail: 'has title' }], blindSpots: [] });
    findingMemory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('the run spend cap is checked before the model call (defect 15)', () => {
    it('a call estimated over the run cap never reaches the vendor and the run stops as spend_cap_exceeded', async () => {
        const run = await start({ spendCapUsd: 0.01 });
        const out = await execute(run);

        expect(chat).not.toHaveBeenCalled();
        expect(out.status).toBe('stopped');
        expect(out.outcome).toMatch(/^spend_cap_exceeded: the next call is estimated at \$0\.0\d{3} \(\d+ tokens\) but the run cap of \$0\.0100 has \$0\.0100 left$/);

        const row = runRow(run._id);
        expect(row).toMatchObject({ status: 'stopped', outcome: out.outcome, reservedUsd: 0, spend: { usd: 0, tokens: 0 } });
        expect(row.finishedAt).toBeInstanceOf(Date);
        expect(row.expiresAt).toBeInstanceOf(Date);

        expect(refusalRows()).toHaveLength(1);
        expect(refusalRows()[0]).toMatchObject({
            actorId: AGENT_ID, entityType: 'agent_run', entityId: String(run._id),
            meta: { actorType: 'agent', agentId: AGENT_ID, action: 'model.call', reason: out.outcome, ran: false, params: { cap: 'run', limitUsd: 0.01, remainingUsd: 0.01, model: MODEL, estimatedTokens: expect.any(Number), estimatedUsd: expect.any(Number) } },
        });
        expect(refusalRows()[0].meta.params.estimatedUsd).toBeGreaterThan(0.01);
    });

    it('counts what the run already spent: a second call that would cross the cap is refused', async () => {
        const run = await start({ spendCapUsd: 0.05 });
        await runs.patch(C, run._id, { 'spend.usd': 0.03 });
        const out = await execute(run);
        expect(chat).not.toHaveBeenCalled();
        expect(out.outcome).toMatch(/the run cap of \$0\.0500 has \$0\.0200 left$/);
    });

    it('a call estimated over the company\'s remaining monthly budget is refused naming the company cap', async () => {
        mockDb.store[dbCollections.COMPANIES][0].agentMonthlyBudgetUsd = 0.05;
        mockDb.seed(SCHEMA_TYPE.AI_USAGE, { feature: 'agent_run', costUsd: 0.03, totalTokens: 10, priced: true, billedToWorkspace: true, at: new Date() });
        const run = await start();
        const out = await execute(run);

        expect(chat).not.toHaveBeenCalled();
        expect(out).toMatchObject({ status: 'stopped', outcome: expect.stringMatching(/the company cap of \$0\.0500 has \$0\.0200 left$/) });
        expect(refusalRows()[0].meta.params).toMatchObject({ cap: 'company', limitUsd: 0.05, remainingUsd: 0.02 });
        expect(runRow(run._id).reservedUsd).toBe(0);
    });

    it('a call that fits is made once, held for its estimate while in flight, then reconciled to the real cost', async () => {
        let heldDuringCall = null;
        const run = await start({ spendCapUsd: 1 });
        chat.mockImplementation(async () => { heldDuringCall = runRow(run._id).reservedUsd; return reply(); });

        const out = await execute(run);
        expect(chat).toHaveBeenCalledTimes(1);
        expect(chat.mock.calls[0][0]).toMatchObject({ maxTokens: 4000, jsonMode: true });
        expect(out.status).toBe('waiting_approval');

        const estimate = estimateOfRequest();
        expect(estimate.costUsd).toBeGreaterThan(0.032);
        expect(heldDuringCall).toBe(estimate.costUsd);
        expect(runRow(run._id)).toMatchObject({ reservedUsd: 0, spend: { usd: 0.006, tokens: 1500, model: MODEL } });
        expect(refusalRows()).toHaveLength(0);
    });

    it('a failed vendor call releases the reservation and books nothing', async () => {
        const run = await start({ spendCapUsd: 1 });
        chat.mockRejectedValue(new Error('upstream 503'));
        await execute(run);
        expect(chat).toHaveBeenCalledTimes(1);
        expect(runRow(run._id)).toMatchObject({ reservedUsd: 0, spend: { usd: 0, tokens: 0 } });
    });

    it('the post-call check stays: an under-estimated call still stops the run once the real cost is booked', async () => {
        const run = await start({ spendCapUsd: 0.05 });
        chat.mockResolvedValue(reply({ outputTokens: 20000 }));
        const out = await execute(run);
        expect(chat).toHaveBeenCalledTimes(1);
        expect(out).toMatchObject({ status: 'stopped', outcome: 'Run spend cap reached ($0.16 of $0.05)' });
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', reservedUsd: 0, spend: { usd: 0.162 } });
    });

    it('a run without a cap under a company without a budget is not gated', async () => {
        const run = await start();
        const out = await execute(run);
        expect(chat).toHaveBeenCalledTimes(1);
        expect(out.status).toBe('waiting_approval');
    });
});

describe('the reservation is atomic on the run row', () => {
    const estimate = { priced: true, costUsd: 0.03, totalTokens: 1234, model: MODEL, inputTokens: 234, outputTokens: 1000 };

    it('two concurrent calls inside one run cannot both fit the same remainder', async () => {
        const run = await start({ spendCapUsd: 0.05 });
        const guard = spendGuard.forRun({ companyId: C, run, actor });
        const [first, second] = await Promise.all([guard.reserve(estimate), guard.reserve(estimate)]);

        expect(first).toEqual({ ok: true, usd: 0.03, estimate });
        expect(second).toMatchObject({ ok: false, code: 'spend_cap_exceeded', cap: 'run', limit: 0.05, remaining: 0.02 });
        expect(second.reason).toBe('spend_cap_exceeded: the next call is estimated at $0.0300 (1234 tokens) but the run cap of $0.0500 has $0.0200 left');
        expect(runRow(run._id).reservedUsd).toBe(0.03);
        expect(refusalRows()).toHaveLength(1);
    });

    it('reconcile replaces the reservation with the actual cost; release drops it', async () => {
        const run = await start({ spendCapUsd: 0.05 });
        const guard = spendGuard.forRun({ companyId: C, run, actor });
        const ticket = await guard.reserve(estimate);
        expect(runRow(run._id).reservedUsd).toBe(0.03);

        await guard.reconcile(ticket, { inputTokens: 1000, outputTokens: 500 }, MODEL);
        expect(runRow(run._id)).toMatchObject({ reservedUsd: 0, spend: { usd: 0.006, tokens: 1500 } });

        const again = await guard.reserve(estimate);
        expect(again.ok).toBe(true);
        expect(runRow(run._id).reservedUsd).toBe(0.03);
        await guard.release(again);
        expect(runRow(run._id)).toMatchObject({ reservedUsd: 0, spend: { usd: 0.006 } });
    });

    it('a company budget counts other open runs\' reservations too', async () => {
        mockDb.store[dbCollections.COMPANIES][0].agentMonthlyBudgetUsd = 0.05;
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'running', startedAt: new Date(), viaAccount: 'workspace', spend: { usd: 0 }, reservedUsd: 0.03 });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date(), viaAccount: 'workspace', spend: { usd: 0 }, reservedUsd: 0.5 });
        const run = await start();
        const ticket = await spendGuard.forRun({ companyId: C, run, actor }).reserve(estimate);
        expect(ticket).toMatchObject({ ok: false, cap: 'company', limit: 0.05, remaining: money(0.02) });
        expect(runRow(run._id).reservedUsd).toBe(0);
    });

    it('an unpriced model is refused before any token is bought', async () => {
        const run = await start({ spendCapUsd: 1 });
        const ticket = await spendGuard.forRun({ companyId: C, run, actor }).reserve({ ...estimate, priced: false, costUsd: null, model: 'gpt-9-mystery' });
        expect(ticket).toMatchObject({ ok: false, code: 'unpriced_model', reason: expect.stringContaining('No price on file for gpt-9-mystery') });
        expect(refusalRows()).toHaveLength(1);
    });

    it('a personal or local run is not held against the workspace caps', async () => {
        const run = await start({ spendCapUsd: 0.001, viaAccount: 'personal' });
        const ticket = await spendGuard.forRun({ companyId: C, run, actor }).reserve(estimate);
        expect(ticket).toEqual({ ok: true, usd: 0, estimate });
        expect(runRow(run._id).reservedUsd).toBe(0);
    });
});
