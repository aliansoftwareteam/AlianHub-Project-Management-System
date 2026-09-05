const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ run: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/usage', () => ({ summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const memory = require('../Modules/Agents/engine/findingMemory');
const { summarize } = require('../Modules/AIProjectGenerator/usage');
const runs = require('../Modules/Agents/runs');
const { rating } = require('../Modules/Agents/actions');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review https://example.com', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 2, allowedActions: [], projectIds: [], account: 'workspace', spendCapUsd: 10, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };

const comment = (body) => ({ action: 'task.comment', label: `Comment: ${body}`, reversible: true, params: { taskId: TASK._id, body } });
const subtask = (title) => ({ action: 'subtask.create', label: `Subtask: ${title}`, reversible: true, params: { taskId: TASK._id, title } });
const newTask = (title) => ({ action: 'task.create', label: `Task: ${title}`, reversible: true, params: { projectId: 'p1', title } });
const post = (body) => ({ action: 'chat.post', label: 'Post', reversible: false, params: { taskId: TASK._id, body } });

/* The stand-in for actions.perform behaves like the real one on a policy refusal:
 * it throws a RefusedError with the policy's reason and an audit id. */
const deps = () => ({
    proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) },
    actions: {
        perform: jest.fn(async ({ action, decision }) => {
            if (decision && decision.decision === 'refuse') { const e = new Error(decision.reason); e.name = 'RefusedError'; e.auditId = `ref-${action}`; throw e; }
            return { auditId: `aud-${action}`, result: { subtaskId: 'st1' } };
        }),
    },
    actor,
});

const skillResult = (changes) => orchestrator.run.mockResolvedValue({ status: 'success', skill: 'plan', changes, summary: 'planned', usage: { totalTokens: 100 }, model: 'm' });
const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const decisionsOf = (id) => runRow(id).decisions.map(({ action, decision, reason, rating: r }) => ({ action, decision, reason, rating: r }));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    summarize.mockReturnValue({ costUsd: 0, totalTokens: 0, model: 'm' });
    memory.load.mockResolvedValue(new Map());
    memory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, ...agent() });
});

describe('an L2 run is reviewed per change by the policy', () => {
    it('3 safe + 1 risky: applies the 3, proposes the 1, waits for approval, and records all 4 decisions', async () => {
        const d = deps();
        skillResult([subtask('Fix alt text'), comment('Summary'), subtask('Add labels'), newTask('Audit the footer')]);
        const a = agent();
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, a, TASK, d);

        expect(out).toMatchObject({ status: 'waiting_approval', proposalId: 'prop1', refusals: 0, outcome: '3 change(s) applied, 1 proposed' });
        expect(d.actions.perform).toHaveBeenCalledTimes(3);
        expect(d.actions.perform.mock.calls.map(([args]) => args.action)).toEqual(['subtask.create', 'task.comment', 'subtask.create']);
        d.actions.perform.mock.calls.forEach(([args]) => {
            expect(args.allowedActions).toBe(a.allowedActions);
            expect(args.decision).toMatchObject({ decision: 'act' });
        });

        expect(d.proposals.create).toHaveBeenCalledTimes(1);
        const filed = d.proposals.create.mock.calls[0][1];
        expect(filed).toMatchObject({ runId: String(run._id), taskId: TASK._id, projectId: 'p1', what: 'plan: 1 change(s) on AR-1', why: 'planned' });
        expect(filed.changes).toEqual([{ ...newTask('Audit the footer'), rating: rating('task.create') }]);

        const row = runRow(run._id);
        expect(row).toMatchObject({ status: 'waiting_approval', proposals: ['prop1'], refusals: 0, outcome: '3 change(s) applied, 1 proposed' });
        expect(row.actions.map((x) => ({ action: x.action, ok: x.ok, auditId: x.auditId }))).toEqual([
            { action: 'subtask.create', ok: true, auditId: 'aud-subtask.create' },
            { action: 'task.comment', ok: true, auditId: 'aud-task.comment' },
            { action: 'subtask.create', ok: true, auditId: 'aud-subtask.create' },
        ]);
        expect(decisionsOf(run._id)).toEqual([
            { action: 'subtask.create', decision: 'act', reason: 'subtask.create is a reversible task-scoped write with no money in it', rating: rating('subtask.create') },
            { action: 'task.comment', decision: 'act', reason: 'task.comment is a reversible task-scoped write with no money in it', rating: rating('task.comment') },
            { action: 'subtask.create', decision: 'act', reason: 'subtask.create is a reversible task-scoped write with no money in it', rating: rating('subtask.create') },
            { action: 'task.create', decision: 'propose', reason: 'task.create reaches the whole project', rating: rating('task.create') },
        ]);
        row.decisions.forEach((x) => expect(x.at).toBeInstanceOf(Date));
    });

    it('only safe changes: all applied, the run ends done, no proposal, every decision is act', async () => {
        const d = deps();
        skillResult([subtask('One'), comment('Two')]);
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out).toMatchObject({ status: 'done', outcome: '2 change(s) applied', refusals: 0 });
        expect(d.proposals.create).not.toHaveBeenCalled();
        expect(runRow(run._id)).toMatchObject({ status: 'done', proposals: [] });
        expect(decisionsOf(run._id).map((x) => x.decision)).toEqual(['act', 'act']);
    });

    it('an irreversible change is proposed, not applied', async () => {
        const d = deps();
        skillResult([post('hello'), subtask('One')]);
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out).toMatchObject({ status: 'waiting_approval', outcome: '1 change(s) applied, 1 proposed' });
        expect(d.actions.perform.mock.calls.map(([args]) => args.action)).toEqual(['subtask.create']);
        expect(decisionsOf(run._id)[0]).toMatchObject({ action: 'chat.post', decision: 'propose', reason: 'chat.post cannot be undone' });
    });

    it('a refused change does not abort the run: it is counted, audited and the rest still applies', async () => {
        const d = deps();
        skillResult([comment('Not allowed'), subtask('Allowed')]);
        const a = agent({ allowedActions: ['task.get', 'subtask.create'] });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, a, TASK, d);
        expect(out).toMatchObject({ status: 'done', refusals: 1, outcome: '1 change(s) applied, 1 refused' });
        expect(d.actions.perform).toHaveBeenCalledTimes(2);
        expect(d.actions.perform.mock.calls[0][0].decision).toMatchObject({ decision: 'refuse', reason: 'task.comment is outside this agent\'s allowed actions' });
        const row = runRow(run._id);
        expect(row.refusals).toBe(1);
        expect(row.actions.find((x) => x.ok === false)).toMatchObject({ action: 'task.comment', auditId: 'ref-task.comment', refused: 'task.comment is outside this agent\'s allowed actions' });
        expect(decisionsOf(run._id)).toEqual([
            { action: 'task.comment', decision: 'refuse', reason: 'task.comment is outside this agent\'s allowed actions', rating: rating('task.comment') },
            { action: 'subtask.create', decision: 'act', reason: 'subtask.create is a reversible task-scoped write with no money in it', rating: rating('subtask.create') },
        ]);
        expect(memory.record).not.toHaveBeenCalled();
    });

    it('a task outside the agent\'s projects has every change refused and the run fails with the count', async () => {
        const d = deps();
        skillResult([subtask('One'), comment('Two')]);
        const a = agent({ projectIds: ['p2'] });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, a, TASK, d);
        expect(out).toMatchObject({ status: 'failed', refusals: 2, outcome: '0 change(s) applied, 2 refused' });
        expect(d.proposals.create).not.toHaveBeenCalled();
        decisionsOf(run._id).forEach((x) => expect(x).toMatchObject({ decision: 'refuse', reason: 'project p1 is outside this agent\'s projects' }));
    });

    it('a never-list change is refused, the rest applies, and the refusal carries the never-list reason', async () => {
        const d = deps();
        skillResult([{ action: 'task.delete', label: 'Delete', params: { taskId: TASK._id } }, subtask('Keep')]);
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out).toMatchObject({ status: 'done', refusals: 1 });
        expect(decisionsOf(run._id)[0]).toEqual({ action: 'task.delete', decision: 'refuse', reason: 'task.delete is on the never-list', rating: null });
    });

    it('L3 goes through the same review', async () => {
        const d = deps();
        skillResult([subtask('One'), newTask('Two')]);
        const a = agent({ autonomy: 3 });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        expect((await runs.executeSkill(C, run, a, TASK, d)).status).toBe('waiting_approval');
        expect(decisionsOf(run._id).map((x) => x.decision)).toEqual(['act', 'propose']);
    });

    it('QA findings still file as subtasks through the policy and are remembered', async () => {
        const d = deps();
        orchestrator.run.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }], summary: 's', usage: {} });
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out).toMatchObject({ status: 'done', outcome: '2 change(s) applied' });
        expect(memory.record).toHaveBeenCalledWith(C, expect.objectContaining({ factId: 'f1', subtaskId: 'st1' }));
        expect(decisionsOf(run._id).map((x) => [x.action, x.decision])).toEqual([['subtask.create', 'act'], ['task.comment', 'act']]);
    });
});

describe('lifecycle guarantees hold on the reviewed path', () => {
    it('a run stopped while the skill ran files no proposal for the held changes and is not resurrected', async () => {
        const d = deps();
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        orchestrator.run.mockImplementation(async () => {
            await runs.stop(C, run._id, 'u2');
            return { status: 'success', skill: 'plan', changes: [newTask('Held')], summary: 's', usage: {}, model: 'm' };
        });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out.status).toBe('abandoned');
        expect(d.proposals.create).not.toHaveBeenCalled();
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'stopped by u2' });
    });

    it('a stopped run is not marked done by the applied changes either', async () => {
        const d = deps();
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        orchestrator.run.mockImplementation(async () => {
            await runs.stop(C, run._id, 'u2');
            return { status: 'success', skill: 'plan', changes: [subtask('Safe')], summary: 's', usage: {}, model: 'm' };
        });
        expect((await runs.executeSkill(C, run, agent(), TASK, d)).status).toBe('abandoned');
        expect(runRow(run._id).status).toBe('stopped');
    });

    it('the run spend cap still stops the run before any decision is made', async () => {
        const d = deps();
        skillResult([subtask('One')]);
        summarize.mockReturnValue({ costUsd: 0.02, totalTokens: 500, model: 'm' });
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan', spendCapUsd: 0.01 });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(out).toMatchObject({ status: 'stopped', outcome: 'Run spend cap reached ($0.02 of $0.01)' });
        expect(d.actions.perform).not.toHaveBeenCalled();
        expect(runRow(run._id).decisions).toEqual([]);
    });

    it('a new run starts with an empty decisions list', async () => {
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        expect(runRow(run._id).decisions).toEqual([]);
    });
});

describe('L1 is unchanged, except that its proposal now carries a rating per change', () => {
    it('proposes every change in one proposal, performs nothing, records no decisions', async () => {
        const d = deps();
        skillResult([subtask('One'), newTask('Two'), post('Three')]);
        const a = agent({ autonomy: 1 });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        const out = await runs.executeSkill(C, run, a, TASK, d);
        expect(out).toEqual({ status: 'waiting_approval', proposalId: 'prop1', refusals: 0 });
        expect(d.actions.perform).not.toHaveBeenCalled();
        const filed = d.proposals.create.mock.calls[0][1];
        expect(filed.what).toBe('plan: 3 change(s) on AR-1');
        expect(filed.changes.map((c) => [c.action, c.rating])).toEqual([
            ['subtask.create', rating('subtask.create')], ['task.create', rating('task.create')], ['chat.post', rating('chat.post')],
        ]);
        const row = runRow(run._id);
        expect(row).toMatchObject({ status: 'waiting_approval', proposals: ['prop1'], refusals: 0, decisions: [] });
        expect(row.outcome).toBeUndefined();
    });

    it('QA findings at L1 keep the "File N QA finding(s)" wording', async () => {
        const d = deps();
        orchestrator.run.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }], summary: 's', usage: {} });
        const a = agent({ autonomy: 1 });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        await runs.executeSkill(C, run, a, TASK, d);
        expect(d.proposals.create.mock.calls[0][1].what).toBe('File 1 QA finding(s) on AR-1');
    });

    it('L0 behaves like L1', async () => {
        const d = deps();
        skillResult([subtask('One')]);
        const a = agent({ autonomy: 0 });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'plan' });
        expect((await runs.executeSkill(C, run, a, TASK, d)).status).toBe('waiting_approval');
        expect(d.actions.perform).not.toHaveBeenCalled();
    });
});
