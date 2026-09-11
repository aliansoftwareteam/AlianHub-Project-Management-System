const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ gather: jest.fn(async () => ({ status: 'gathered', context: { projectName: 'Launch' } })), analyse: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({
    DECLINE_REASON_TEXT: { too_many_changes: 'x', wrong_tone: 'x', needs_person: 'x', not_now: 'x' },
    contextFor: jest.fn(async () => ''),
    recordEpisode: jest.fn(async () => null),
    preferenceCandidate: jest.fn(async () => null),
    rememberApprovedChanges: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/actions', () => {
    const actual = jest.requireActual('../Modules/Agents/actions');
    return { rating: actual.rating, perform: jest.fn(async () => ({ auditId: 'aud1', result: { subtaskId: 'st1' } })) };
});
jest.mock('../Modules/Agents/agentAudit', () => ({ ACTION_DONE: 'agent.action', STATE: { PENDING: 'pending', APPLIED: 'applied', FAILED: 'failed' }, recordProposalDecision: jest.fn(async () => 'dec1'), recordRunReverted: jest.fn(async () => 'rev1'), findById: jest.fn() }));
jest.mock('../Modules/Agents/undo', () => ({ undoAuditRow: jest.fn(async () => ({ ok: true })), REASON: {} }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['p1']) }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), unpricedMessage: (m) => `No price on file for ${m}`, UNPRICED_MODEL: 'unpriced_model', summarize: jest.fn(() => ({ costUsd: 0.01, totalTokens: 100, model: 'm' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const telemetry = require('../Config/telemetry');
const persistence = require('../Modules/AICore/persistence');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const actions = require('../Modules/Agents/actions');
const agentAudit = require('../Modules/Agents/agentAudit');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');

const C = '6f0000000000000000000c01';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Plan the launch', TaskKey: 'AR-1', ProjectID: 'p1' };
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Planner', autonomy: 1, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 10, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Planner', runId: null, viaAccount: 'workspace', tokenId: null };
const subtask = (title) => ({ action: 'subtask.create', label: `Subtask: ${title}`, reversible: true, params: { taskId: TASK._id, title } });
const planned = (changes) => orchestrator.analyse.mockResolvedValue({ status: 'success', skill: 'plan', changes, summary: 'planned', usage: { totalTokens: 100 }, model: 'm' });
const start = (a, over = {}) => runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan', startedBy: 'u1', ...over });
const execute = (run, a = agent()) => runs.executeSkill(C, run, a, TASK, { proposals, actions, actor });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const nodes = (row) => (row.steps || []).map((s) => `${s.node}:${s.status}`);

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    findingMemory.load.mockResolvedValue(new Map());
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('a run is traced', () => {
    it('records its trace id and one step per executed node with durations, tokens and cost', async () => {
        planned([subtask('One')]);
        const run = await start(agent());
        await execute(run);

        const row = runRow(run._id);
        expect(row.traceId).toMatch(TRACE_ID);
        expect(nodes(row)).toEqual(['gather:ok', 'analyse:ok', 'review:ok', 'propose:ok', 'hold:interrupted']);
        for (const step of row.steps) {
            expect(step).toMatchObject({ spanId: expect.stringMatching(SPAN_ID), traceId: row.traceId, startedAt: expect.any(Date), endedAt: expect.any(Date) });
            expect(step.durationMs).toBe(step.endedAt.getTime() - step.startedAt.getTime());
        }
        expect(row.steps.find((s) => s.node === 'analyse')).toMatchObject({ tokens: 100, costUsd: 0.01 });
        expect(row.steps.find((s) => s.node === 'gather')).toMatchObject({ tokens: 0, costUsd: 0 });

        const proposalId = row.proposals[0];
        await proposals.approve(C, proposalId, { decider: { kind: 'human', userId: 'u9' }, isPrivileged: true, ip: '' });
        const after = runRow(run._id);
        expect(nodes(after)).toEqual(['gather:ok', 'analyse:ok', 'review:ok', 'propose:ok', 'hold:interrupted', 'hold:ok', 'remember:ok']);
        expect(new Set(after.steps.map((s) => s.traceId))).toEqual(new Set([row.traceId]));
    });

    it('keeps a trace id it was started with, as a rule-triggered run is', async () => {
        planned([subtask('One')]);
        const traceId = telemetry.newTraceId();
        const run = await start(agent(), { trigger: 'rule', traceId });
        await execute(run);
        expect(runRow(run._id).traceId).toBe(traceId);
        expect(runRow(run._id).steps.every((s) => s.traceId === traceId)).toBe(true);
    });

    it('a node that throws records an error step', async () => {
        orchestrator.analyse.mockRejectedValue(new Error('provider down'));
        const run = await start(agent());
        expect(await execute(run)).toMatchObject({ status: 'failed', error: 'provider down' });
        expect(nodes(runRow(run._id))).toEqual(['gather:ok', 'analyse:error']);
    });

    it('actions the run performs see its trace id', async () => {
        planned([subtask('One')]);
        const seen = [];
        actions.perform.mockImplementation(async () => { seen.push(telemetry.traceIdNow()); return { auditId: 'aud1', result: {} }; });
        const acting = agent({ autonomy: 2 });
        const run = await start(acting);
        await execute(run, acting);
        expect(seen).toEqual([runRow(run._id).traceId]);
    });

    it('approved changes and the decision row carry the run trace id on their actors', async () => {
        planned([subtask('One')]);
        const proposing = await start(agent());
        await execute(proposing);
        const traceId = runRow(proposing._id).traceId;
        await proposals.approve(C, runRow(proposing._id).proposals[0], { decider: { kind: 'human', userId: 'u9' }, isPrivileged: true, ip: '' });
        expect(actions.perform).toHaveBeenLastCalledWith(expect.objectContaining({ actor: expect.objectContaining({ runId: String(proposing._id), traceId }) }));
        expect(agentAudit.recordProposalDecision).toHaveBeenCalledWith(C, expect.objectContaining({ userId: 'u9', traceId }), expect.any(Object));
    });
});
