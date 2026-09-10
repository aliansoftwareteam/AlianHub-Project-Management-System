const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ gather: jest.fn(async () => ({ status: 'gathered', context: { projectName: 'Launch' } })), analyse: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/Agents/memory', () => ({
    contextFor: jest.fn(async () => ''),
    recordEpisode: jest.fn(async () => null),
    preferenceCandidate: jest.fn(async () => null),
    rememberApprovedChanges: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/actions', () => {
    const actual = jest.requireActual('../Modules/Agents/actions');
    return { rating: actual.rating, perform: jest.fn(async () => ({ auditId: 'aud1', result: { subtaskId: 'st1' } })) };
});
jest.mock('../Modules/Agents/agentAudit', () => ({ ACTION_DONE: 'agent.action', recordProposalDecision: jest.fn(async () => 'dec1'), recordRunReverted: jest.fn(async () => 'rev1'), findById: jest.fn() }));
jest.mock('../Modules/Agents/undo', () => ({ undoAuditRow: jest.fn(async () => ({ ok: true })) }));
jest.mock('../Modules/AIProjectGenerator/usage', () => ({ summarize: jest.fn(() => ({ costUsd: 0.01, totalTokens: 100, model: 'm' })) }));

const { Command } = require('@langchain/langgraph');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const persistence = require('../Modules/Agents/engine/persistence');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const findingMemory = require('../Modules/Agents/engine/findingMemory');
const memory = require('../Modules/Agents/memory');
const actions = require('../Modules/Agents/actions');
const graph = require('../Modules/Agents/engine/graph');
const runs = require('../Modules/Agents/runs');
const proposals = require('../Modules/Agents/proposals');
const revert = require('../Modules/Agents/revert');

const C = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Plan the launch', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Planner', autonomy: 1, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 10, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Planner', runId: null, viaAccount: 'workspace', tokenId: null };
const decider = { kind: 'human', userId: 'u9' };
const decide = { decider, isPrivileged: true, ip: '' };

const subtask = (title) => ({ action: 'subtask.create', label: `Subtask: ${title}`, reversible: true, params: { taskId: TASK._id, title } });
const newTask = (title) => ({ action: 'task.create', label: `Task: ${title}`, reversible: true, params: { projectId: 'p1', title } });
const deps = () => ({ proposals, actions, actor });
const planned = (changes) => orchestrator.analyse.mockResolvedValue({ status: 'success', skill: 'plan', changes, summary: 'planned', usage: { totalTokens: 100 }, model: 'm' });
const start = (a, over = {}) => runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan', startedBy: 'u1', ...over });
const execute = (run, a = agent()) => runs.executeSkill(C, run, a, TASK, deps());
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const proposalRows = () => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || [];
const threadOf = (companyId, run) => graph.graphFor(companyId).getState({ configurable: { thread_id: String(run._id) } });

let mem;
beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mem = persistence.useInMemory();
    memory.contextFor.mockResolvedValue('### Workspace memory (DATA)\n- Budget is fixed at $12k.');
    findingMemory.load.mockResolvedValue(new Map());
    findingMemory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    mockDb.seed(SCHEMA_TYPE.AGENTS, agent());
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('a run is a LangGraph thread', () => {
    it('below L2 files one proposal, checkpoints at hold and hands the skill the workspace memory', async () => {
        planned([subtask('One'), newTask('Two')]);
        const run = await start(agent());
        const out = await execute(run);

        expect(out).toEqual({ status: 'waiting_approval', proposalId: expect.any(String), refusals: 0 });
        expect(runRow(run._id)).toMatchObject({ status: 'waiting_approval', threadId: String(run._id), proposals: [out.proposalId], decisions: [] });
        expect(proposalRows()[0]).toMatchObject({ _id: out.proposalId, runId: String(run._id), what: 'plan: 2 change(s) on AR-1', why: 'planned', cost: { usd: 0.01, tokens: 100, model: 'm' } });

        expect(memory.contextFor).toHaveBeenCalledWith({ companyId: C, projectId: 'p1', userId: 'u1' });
        expect(orchestrator.analyse).toHaveBeenCalledWith({ skillSlug: 'plan', task: TASK, context: { projectName: 'Launch', memory: expect.stringContaining('Budget is fixed') }, budget: { maxTokens: 4000 } });

        const thread = await threadOf(C, run);
        expect(thread.next).toEqual(['hold']);
        expect(thread.tasks[0].interrupts[0].value).toEqual({ proposalId: out.proposalId, changes: [expect.objectContaining({ action: 'subtask.create' }), expect.objectContaining({ action: 'task.create' })] });
        expect(await persistence.saverFor(C).getTuple({ configurable: { thread_id: String(run._id) } })).toBeTruthy();
        expect(memory.recordEpisode).not.toHaveBeenCalled();
    });

    it('approving the proposal resumes the thread: the run ends done and the episode counts the approval', async () => {
        planned([subtask('One'), newTask('Two')]);
        const run = await start(agent());
        const { proposalId } = await execute(run);

        const decided = await proposals.approve(C, proposalId, decide);
        expect(decided.error).toBeUndefined();
        expect(actions.perform).toHaveBeenCalledTimes(2);

        const row = runRow(run._id);
        expect(row).toMatchObject({ status: 'done', outcome: 'approved by a person — 2 of 2 change(s) applied' });
        expect(row.episode).toEqual({
            skill: 'plan', taskId: TASK._id, taskTitle: 'Plan the launch',
            proposed: 2, acted: 0, approved: 2, declined: 0, declinedReason: null, reverted: false, spendUsd: 0.01, at: expect.any(Date),
        });
        expect(memory.recordEpisode).toHaveBeenCalledTimes(1);
        expect(memory.recordEpisode).toHaveBeenCalledWith({ companyId: C, projectId: 'p1', runId: String(run._id), patch: row.episode });
        expect(memory.rememberApprovedChanges).toHaveBeenCalledWith({
            companyId: C, projectId: 'p1', proposal: expect.objectContaining({ _id: proposalId }),
            applied: [{ action: 'subtask.create', ok: true, result: { subtaskId: 'st1' } }, { action: 'task.create', ok: true, result: { subtaskId: 'st1' } }],
        });
        expect((await threadOf(C, run)).next).toEqual([]);
    });

    it('a resumed approval reaches finding memory for proposed QA findings that were kept on the proposal', async () => {
        orchestrator.analyse.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }], summary: 's', usage: {} });
        const run = await start(agent(), { skill: 'qa-review' });
        const { proposalId } = await execute(run);
        expect(proposalRows()[0].changes[0].remember).toMatchObject({ factId: 'f1', taskId: TASK._id, projectId: 'p1' });
        expect(findingMemory.record).not.toHaveBeenCalled();

        await proposals.approve(C, proposalId, decide);
        expect(findingMemory.record).toHaveBeenCalledWith(C, expect.objectContaining({ factId: 'f1', subtaskId: 'st1' }));
        expect(runRow(run._id).episode).toMatchObject({ skill: 'qa-review', proposed: 2, approved: 2 });
    });

    it('declining resumes the thread with the reason, stores it on the proposal and grows a preference candidate for a canned key', async () => {
        planned([newTask('Two')]);
        const run = await start(agent());
        const { proposalId } = await execute(run);

        const out = await proposals.decline(C, proposalId, { ...decide, reason: 'too_many_changes' });
        expect(out.proposal).toMatchObject({ status: 'declined', declineReason: 'too_many_changes' });
        expect(memory.preferenceCandidate).toHaveBeenCalledWith({ companyId: C, userId: 'u9', reasonKey: 'too_many_changes' });
        expect(runRow(run._id)).toMatchObject({ status: 'done', outcome: 'declined by a person', episode: expect.objectContaining({ proposed: 1, acted: 0, approved: 0, declined: 1, declinedReason: 'too_many_changes' }) });
        expect(memory.recordEpisode).toHaveBeenCalledWith(expect.objectContaining({ runId: String(run._id), patch: expect.objectContaining({ declined: 1, declinedReason: 'too_many_changes' }) }));
        expect((await threadOf(C, run)).next).toEqual([]);
    });

    it('a free-text decline reason is kept to 200 characters and grows no preference', async () => {
        planned([newTask('Two')]);
        const run = await start(agent());
        const { proposalId } = await execute(run);
        const out = await proposals.decline(C, proposalId, { ...decide, reason: `  ${'x'.repeat(300)}` });
        expect(out.proposal.declineReason).toHaveLength(200);
        expect(memory.preferenceCandidate).not.toHaveBeenCalled();
        expect(runRow(run._id).episode.declinedReason).toHaveLength(200);
    });

    it('at L2 with only safe changes it acts and ends done without an interrupt', async () => {
        planned([subtask('One'), subtask('Two')]);
        const a = agent({ autonomy: 2 });
        const run = await start(a);
        const out = await execute(run, a);
        expect(out).toEqual({ status: 'done', outcome: '2 change(s) applied', refusals: 0 });
        expect(actions.perform).toHaveBeenCalledTimes(2);
        expect(proposalRows()).toHaveLength(0);
        expect(runRow(run._id).episode).toMatchObject({ proposed: 0, acted: 2, approved: 0, declined: 0, reverted: false });
        expect(memory.recordEpisode).toHaveBeenCalledTimes(1);
        const thread = await threadOf(C, run);
        expect(thread.next).toEqual([]);
        expect(thread.values.finalStatus).toBe('done');
    });

    it('at L2 with a risky change it acts on the safe ones, interrupts on the risky one and finishes on approval', async () => {
        planned([subtask('One'), newTask('Risky')]);
        const a = agent({ autonomy: 2 });
        const run = await start(a);
        const out = await execute(run, a);
        expect(out).toEqual({ status: 'waiting_approval', proposalId: expect.any(String), refusals: 0, outcome: '1 change(s) applied, 1 proposed' });
        expect(actions.perform).toHaveBeenCalledTimes(1);
        expect(runRow(run._id).decisions.map((d) => d.decision)).toEqual(['act', 'propose']);
        expect((await threadOf(C, run)).next).toEqual(['hold']);

        await proposals.approve(C, out.proposalId, decide);
        expect(runRow(run._id)).toMatchObject({ status: 'done', outcome: 'approved by a person — 1 of 1 change(s) applied', episode: expect.objectContaining({ proposed: 1, acted: 1, approved: 1 }) });
    });

    it('survives a process restart: a second graph instance on the same checkpointer resumes the thread', async () => {
        planned([newTask('Two')]);
        const run = await start(agent());
        const { proposalId } = await execute(run);
        const restarted = graph.builder.compile({ checkpointer: persistence.saverFor(C), store: persistence.storeFor(C) });
        const config = { configurable: { thread_id: String(run._id) }, context: { companyId: C } };
        expect((await restarted.getState(config)).next).toEqual(['hold']);
        const out = await restarted.invoke(new Command({ resume: { decision: 'edited', applied: [{ action: 'task.create', ok: true }], reason: null } }), config);
        expect(out.finalStatus).toBe('done');
        expect(runRow(run._id)).toMatchObject({ status: 'done', outcome: 'edited by a person — 1 of 1 change(s) applied', proposals: [proposalId], episode: expect.objectContaining({ approved: 1 }) });
    });

    it('a stop during the skill abandons the run: nothing is filed, nothing is remembered', async () => {
        const run = await start(agent());
        orchestrator.analyse.mockImplementation(async () => {
            await runs.stop(C, run._id, 'u2');
            return { status: 'success', skill: 'plan', changes: [newTask('Held')], summary: 's', usage: {}, model: 'm' };
        });
        expect(await execute(run)).toEqual({ status: 'abandoned', outcome: 'stopped before it finished' });
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'stopped by u2' });
        expect(proposalRows()).toHaveLength(0);
        expect(memory.recordEpisode).not.toHaveBeenCalled();
        expect((await threadOf(C, run)).next).toEqual([]);
    });

    it('a run waiting at hold is never reaped at boot', async () => {
        planned([newTask('Two')]);
        const run = await start(agent());
        await execute(run);
        expect(await runs.reapStale(C)).toEqual({ reaped: 0 });
        expect(runRow(run._id).status).toBe('waiting_approval');
        expect((await threadOf(C, run)).next).toEqual(['hold']);
    });

    it('memory failures never fail the run', async () => {
        memory.contextFor.mockRejectedValue(new Error('store down'));
        memory.recordEpisode.mockRejectedValue(new Error('store down'));
        planned([subtask('One')]);
        const a = agent({ autonomy: 2 });
        const run = await start(a);
        expect(await execute(run, a)).toEqual({ status: 'done', outcome: '1 change(s) applied', refusals: 0 });
        expect(orchestrator.analyse.mock.calls[0][0].context.memory).toBe('');
        expect(runRow(run._id).episode).toMatchObject({ acted: 1 });
    });

    it('a revert updates the episode on the run and in memory', async () => {
        planned([subtask('One')]);
        const a = agent({ autonomy: 2 });
        const run = await start(a);
        await execute(run, a);
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'agent.action', createdAt: new Date(), meta: { runId: String(run._id), action: 'subtask.create' } });
        const out = await revert.revertRun(C, run._id, { actor: { kind: 'human', userId: 'u1' }, isPrivileged: true, ip: '' });
        expect(out.reverted).toBe(1);
        expect(runRow(run._id).episode).toMatchObject({ acted: 1, reverted: true });
        expect(memory.recordEpisode).toHaveBeenLastCalledWith({ companyId: C, projectId: 'p1', runId: String(run._id), patch: { reverted: true } });
    });
});

describe('tenancy and the runs from before the graph', () => {
    it('a second company sees no checkpoint for the first company\'s thread', async () => {
        planned([newTask('Two')]);
        const run = await start(agent());
        await execute(run);
        expect((await threadOf(C, run)).next).toEqual(['hold']);
        expect((await threadOf(C2, run)).next).toEqual([]);
        expect(await persistence.saverFor(C2).getTuple({ configurable: { thread_id: String(run._id) } })).toBeUndefined();
        expect(await graph.resumeGraph({ companyId: C2, runId: run._id, resume: { decision: 'approved', applied: [], reason: null } })).toEqual({ resumed: false });
        expect(runRow(run._id).status).toBe('waiting_approval');
    });

    it('a proposal filed before the graph still approves and closes its run the old way', async () => {
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'waiting_approval', startedAt: new Date(), proposals: [], refusals: 0 });
        const p = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
            agentId: AGENT_ID, agentName: 'Planner', runId: String(run._id), taskId: TASK._id, projectId: 'p1', status: 'pending', gate: null,
            changes: [{ action: 'task.comment', params: { taskId: TASK._id, body: 'hi' }, label: 'Comment' }],
        });
        const out = await proposals.approve(C, p._id, decide);
        expect(out.error).toBeUndefined();
        expect(runRow(run._id)).toMatchObject({ status: 'done', outcome: 'approved by a person — 1 of 1 change(s) applied' });
        expect(runRow(run._id).episode).toBeUndefined();
        expect(memory.rememberApprovedChanges).toHaveBeenCalledTimes(1);

        const declinedRun = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'waiting_approval', startedAt: new Date(), proposals: [] });
        const q = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Planner', runId: String(declinedRun._id), status: 'pending', gate: null, changes: [{ action: 'task.comment', params: { taskId: TASK._id, body: 'hi' }, label: 'Comment' }] });
        expect((await proposals.decline(C, q._id, { ...decide, reason: 'not_now' })).proposal.status).toBe('declined');
        expect(runRow(declinedRun._id)).toMatchObject({ status: 'done', outcome: 'declined by a person' });
    });
});
