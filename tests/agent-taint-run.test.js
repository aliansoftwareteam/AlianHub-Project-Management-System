const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/engine/pageAudit', () => ({ ...jest.requireActual('../Modules/Agents/engine/pageAudit'), audit: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({ DECLINE_REASON_TEXT: { too_many_changes: 'x' }, contextFor: jest.fn(async () => ''), recordEpisode: jest.fn(async () => null), rememberApprovedChanges: jest.fn(async () => null), preferenceCandidate: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { getProvider } = require('../Modules/AICore/llmProvider');
const { metered } = require('../Modules/AICore/spend');
const { FEATURES } = require('../Modules/AICore/features');
const persistence = require('../Modules/AICore/persistence');
const pageAudit = require('../Modules/Agents/engine/pageAudit');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const runs = require('../Modules/Agents/runs');
const agentAudit = require('../Modules/Agents/agentAudit');
const taint = require('../Modules/Agents/taint');

/* Sprint 8 slice 6, through the real orchestrator, meter and audit writer: a page audit fetches a
 * page, and what that leaves on the run, the replay row and the audit rows depends only on
 * AGENT_TAINT_ROUTING. With the flag off every record is what beta wrote. */

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const MODEL = 'gpt-4.1';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review https://example.com/pricing', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 2, allowedActions: [], projectIds: ['p1'], account: 'workspace', spendCapUsd: 0, paused: false, deletedStatusKey: 0, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };
const answer = { summary: 'one issue', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }] };
const chat = jest.fn();
const vendor = { name: 'openai', model: MODEL, isConfigured: true, chat };
const perform = jest.fn(async () => ({ auditId: 'aud1', result: {} }));
const deps = () => ({ proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) }, actions: { perform }, actor });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const replays = () => mockDb.store[SCHEMA_TYPE.AI_REPLAYS] || [];
const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];
const start = (over = {}) => runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review', startedBy: 'u1', ...over });
const execute = (run) => runs.executeSkill(C, run, agent(), TASK, deps());

const BETA_RUN_KEYS = ['_id', 'actions', 'agentId', 'agentName', 'agentRevision', 'createdAt', 'decisions', 'elapsedMs', 'episode', 'error', 'expiresAt', 'finishedAt', 'notifyMe', 'outcome', 'projectId', 'proposals', 'refusals', 'reservedUsd', 'skill', 'skillRevision', 'spend', 'startedAt', 'startedBy', 'status', 'steps', 'taskId', 'threadId', 'traceId', 'trigger', 'triggerDepth', 'triggerEventId', 'viaAccount'];
const BETA_REPLAY_KEYS = ['_id', 'agentId', 'agentRevision', 'costUsd', 'createdAt', 'decision', 'durationMs', 'errorCode', 'expiresAt', 'feature', 'messages', 'model', 'params', 'promptHash', 'provider', 'response', 'retrievedChunkIds', 'runId', 'skillRevision', 'status', 'system', 'traceId', 'truncated', 'usage'];
const BETA_ACTION_META_KEYS = ['action', 'actorType', 'agentId', 'agentName', 'cost', 'onBehalfOf', 'params', 'reason', 'runId', 'state', 'tokenId', 'traceId', 'undo', 'undoable', 'undoneAt', 'undoneBy', 'viaAccount'];
const BETA_REFUSAL_META_KEYS = ['action', 'actorType', 'agentId', 'agentName', 'onBehalfOf', 'params', 'path', 'ran', 'reason', 'runId', 'tokenId', 'traceId', 'viaAccount'];

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.AGENT_TAINT_ROUTING;
    delete process.env.AI_REPLAY;
    delete process.env.AUDIT_CHAIN;
    mem = persistence.useInMemory();
    getProvider.mockReturnValue(metered(vendor));
    chat.mockResolvedValue({ content: JSON.stringify(answer), inputTokens: 1000, outputTokens: 500, model: MODEL });
    pageAudit.audit.mockResolvedValue({ ok: true, facts: [{ id: 'f1', ok: false, detail: 'img without alt' }, { id: 'title', ok: true, detail: 'has title' }], blindSpots: [] });
    findingMemory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
    mockDb.seed(dbCollections.COMPANIES, { _id: C });
});
afterEach(() => { mem.reset(); persistence.useMongo(); delete process.env.AGENT_TAINT_ROUTING; });

describe('with AGENT_TAINT_ROUTING off, a run that fetched a page leaves beta\'s records', () => {
    it('the run document, its decisions and the replay row carry no taint and the same fields as before', async () => {
        const run = await start();
        const out = await execute(run);
        expect(out).toEqual({ status: 'done', outcome: '2 change(s) applied', refusals: 0 });
        expect(pageAudit.audit).toHaveBeenCalledWith('https://example.com/pricing');

        const row = runRow(run._id);
        expect(Object.keys(row).sort()).toEqual(BETA_RUN_KEYS);
        expect(row.decisions.map((d) => [d.decision, d.reason])).toEqual([
            ['act', 'subtask.create is a reversible task-scoped write with no money in it'],
            ['act', 'task.comment is a reversible task-scoped write with no money in it'],
        ]);
        expect(replays()).toHaveLength(1);
        expect(Object.keys(replays()[0]).sort()).toEqual(BETA_REPLAY_KEYS);
        expect(perform).toHaveBeenCalledTimes(2);
        perform.mock.calls.forEach(([args]) => expect(args).not.toHaveProperty('taint'));
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS)).toEqual([]);
    });

    it('action and refusal audit rows carry beta\'s meta fields, whatever perform is told', async () => {
        const applied = await agentAudit.openAction(C, actor, { action: 'task.comment', reason: 'r', params: { taskId: TASK._id }, entityId: TASK._id });
        await agentAudit.recordRefusal(C, actor, { action: 'task.update', reason: 'no', params: { taskId: TASK._id } });
        const [action, refusal] = auditRows();
        expect(String(action._id)).toBe(applied);
        expect(Object.keys(action.meta).sort()).toEqual(BETA_ACTION_META_KEYS);
        expect(Object.keys(refusal.meta).sort()).toEqual(BETA_REFUSAL_META_KEYS);
    });
});

describe('with AGENT_TAINT_ROUTING on', () => {
    beforeEach(() => { process.env.AGENT_TAINT_ROUTING = 'on'; });

    it('the fetch taints the run before the model call, so the run and the replay row both carry the marker', async () => {
        const run = await start();
        const out = await execute(run);
        expect(out).toEqual({ status: 'done', outcome: '2 change(s) applied', refusals: 0 });

        const row = runRow(run._id);
        expect(row).toMatchObject({ tainted: true, taintSources: [{ kind: 'fetch', ref: 'example.com', at: expect.any(Date) }] });
        expect(row.decisions.map((d) => d.decision)).toEqual(['act', 'act']);
        expect(replays()).toHaveLength(1);
        expect(replays()[0]).toMatchObject({ runId: String(run._id), tainted: true, taintSources: [{ kind: 'fetch', ref: 'example.com', at: expect.any(Date) }] });
        expect(JSON.stringify(replays()[0].taintSources)).not.toContain('/pricing');
        perform.mock.calls.forEach(([args]) => expect(args.taint).toEqual({ tainted: true, taintSources: [expect.objectContaining({ kind: 'fetch', ref: 'example.com' })] }));
    });

    it('a model call from a run that read nothing external leaves the replay row untouched', async () => {
        await metered(vendor).chat({ messages: [{ role: 'user', content: 'hi' }], spend: { feature: FEATURES.AGENT_RUN, companyId: C, runId: 'run-1' } });
        expect(replays()[0]).not.toHaveProperty('tainted');
        expect(replays()[0]).not.toHaveProperty('taintSources');
    });

    it('a fetch that fails taints nothing: no content was taken in', async () => {
        pageAudit.audit.mockRejectedValue(new Error('ECONNRESET'));
        const run = await start();
        expect(await execute(run)).toMatchObject({ status: 'failed' });
        expect(runRow(run._id)).not.toHaveProperty('tainted');
    });

    it('the action and refusal audit rows of a tainted run carry the marker and the sources', async () => {
        const marker = taint.record({ tainted: true, taintSources: [taint.fetched('https://example.com/pricing')] });
        const applied = await agentAudit.openAction(C, actor, { action: 'task.comment', reason: 'r', params: { taskId: TASK._id }, entityId: TASK._id, taint: marker });
        await agentAudit.recordRefusal(C, actor, { action: 'task.update', reason: 'no', params: { taskId: TASK._id }, taint: marker });
        const [action, refusal] = auditRows();
        expect(String(action._id)).toBe(applied);
        expect(action.meta).toMatchObject({ tainted: true, taintSources: [{ kind: 'fetch', ref: 'example.com', at: expect.any(Date) }] });
        expect(refusal.meta).toMatchObject({ tainted: true, taintSources: [{ kind: 'fetch', ref: 'example.com', at: expect.any(Date) }] });
        expect(JSON.stringify(auditRows())).not.toContain('/pricing');
    });
});
