const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/engine/orchestrator', () => ({ run: jest.fn() }));
jest.mock('../Modules/Agents/engine/findingMemory', () => ({ load: jest.fn(async () => new Map()), decide: jest.fn(), record: jest.fn(), touch: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const orchestrator = require('../Modules/Agents/engine/orchestrator');
const memory = require('../Modules/Agents/engine/findingMemory');
const runs = require('../Modules/Agents/runs');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const TASK = { _id: '6f0000000000000000000701', TaskName: 'Review https://example.com', TaskKey: 'AR-1', ProjectID: 'p1' };
const agent = (over = {}) => ({ _id: AGENT_ID, name: 'Reviewer', autonomy: 2, allowedActions: [], account: 'workspace', spendCapUsd: 10, ...over });
const actor = { kind: 'agent', userId: 'u1', agentId: AGENT_ID, agentName: 'Reviewer', runId: null, viaAccount: 'workspace', tokenId: null };

const deps = () => ({
    proposals: { create: jest.fn(async () => ({ _id: 'prop1' })) },
    actions: { perform: jest.fn(async () => ({ auditId: 'aud1', result: { subtaskId: 'st1' } })) },
    actor,
});

const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    memory.load.mockResolvedValue(new Map());
    memory.decide.mockImplementation(async (companyId, taskId, findings) => findings.map((f) => ({ finding: f, action: 'file', reason: 'new' })));
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, ...agent() });
});

describe('#8 rateLimitPerDay is enforced in canStart', () => {
    it('refuses once the agent has used its daily runs, with the count in the reason', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date() });
        const out = await runs.canStart(agent({ rateLimitPerDay: 2 }), { companyId: C });
        expect(out).toEqual({ ok: false, reason: 'Daily run limit reached (2 of 2 today).' });
    });

    it('does not count yesterday, another agent, or apply without a limit', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: 'other', status: 'done', startedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', startedAt: new Date() });
        expect((await runs.canStart(agent({ rateLimitPerDay: 2 }), { companyId: C })).ok).toBe(true);
        expect((await runs.canStart(agent({ rateLimitPerDay: 0 }), { companyId: C })).ok).toBe(true);
        expect((await runs.canStart(agent({ rateLimitPerDay: 1 }), { companyId: C })).ok).toBe(false);
    });

    it('still refuses a paused agent and a reached spend cap first', async () => {
        expect((await runs.canStart(agent({ paused: true, pausedReason: 'pause_all' }), { companyId: C })).reason).toBe('Agent is paused (pause_all).');
        expect((await runs.canStart(agent({ spendCapUsd: 1, spendMonth: { month: runs.monthKey(), usd: 1.5 } }), { companyId: C })).reason).toMatch(/Spend cap reached/);
    });
});

describe('#10 skipped is its own status', () => {
    it('a skill that declines its input ends the run skipped with the reason as the outcome', async () => {
        orchestrator.run.mockResolvedValue({ status: 'skipped', reason: 'no pull request or branch link on this task', skill: 'pr.summary', usage: {} });
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'pr.summary' });
        const out = await runs.executeSkill(C, run, agent(), TASK, deps());
        expect(out.status).toBe('skipped');
        expect(runRow(run._id)).toMatchObject({ status: 'skipped', outcome: 'no pull request or branch link on this task' });
        expect(runs.STATUS.SKIPPED).toBe('skipped');
        expect(runs.TERMINAL).toContain('skipped');
    });

    it('countsByStatus reports every status including skipped', async () => {
        ['done', 'skipped', 'skipped', 'failed', 'running'].forEach((status) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status, projectId: 'p1' }));
        mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'skipped', projectId: 'p2' });
        expect(await runs.countsByStatus(C, { projectId: 'p1' })).toEqual({ queued: 0, running: 1, waiting_approval: 0, done: 1, skipped: 2, failed: 1, stopped: 0 });
    });
});

describe('#7 a stopped run is never resurrected', () => {
    it('does not overwrite stopped with done, and files no proposal, when stop() raced the skill', async () => {
        const d = deps();
        const run = await runs.create(C, { agent: agent({ autonomy: 1 }), taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        orchestrator.run.mockImplementation(async () => {
            await runs.stop(C, run._id, 'u2');
            return { status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }], summary: 'one issue', usage: {} };
        });
        const out = await runs.executeSkill(C, run, agent({ autonomy: 1 }), TASK, d);
        expect(out.status).toBe('abandoned');
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'stopped by u2' });
        expect(d.proposals.create).not.toHaveBeenCalled();
    });

    it('does not overwrite a pause-all stop with failed either', async () => {
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        orchestrator.run.mockImplementation(async () => { await runs.pauseAll(C, 'pause all by u2'); throw new Error('boom'); });
        const out = await runs.executeSkill(C, run, agent(), TASK, deps());
        expect(out.status).toBe('abandoned');
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'pause all' });
    });

    it('reapStale marks runs left running by a previous process as failed, and nothing else', async () => {
        const stale = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'running', startedAt: new Date(Date.now() - 60000) });
        const waiting = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'waiting_approval' });
        const done = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'done', outcome: 'x' });
        expect(await runs.reapStale(C)).toEqual({ reaped: 1 });
        expect(runRow(stale._id)).toMatchObject({ status: 'failed', outcome: 'server restarted' });
        expect(runRow(waiting._id).status).toBe('waiting_approval');
        expect(runRow(done._id)).toMatchObject({ status: 'done', outcome: 'x' });
    });
});

describe('#9/#17 direct runs pass allowedActions and count refusals as a number', () => {
    it('applies within allowedActions and records each refusal on the run', async () => {
        const d = deps();
        d.actions.perform.mockImplementation(async ({ action }) => {
            if (action === 'task.comment') { const e = new Error('task.comment is outside this agent\'s allowed actions'); e.name = 'RefusedError'; e.auditId = 'ref1'; throw e; }
            return { auditId: 'aud1', result: { subtaskId: 'st1' } };
        });
        orchestrator.run.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }], summary: 's', usage: {} });
        const a = agent({ autonomy: 2, allowedActions: ['task.get', 'subtask.create'] });
        const run = await runs.create(C, { agent: a, taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        const out = await runs.executeSkill(C, run, a, TASK, d);
        expect(d.actions.perform.mock.calls.every(([args]) => args.allowedActions === a.allowedActions)).toBe(true);
        expect(out).toMatchObject({ status: 'done', refusals: 1, outcome: '1 change(s) applied, 1 refused' });
        const row = runRow(run._id);
        expect(row.refusals).toBe(1);
        expect(typeof row.refusals).toBe('number');
        expect(row.actions.find((x) => x.ok === false)).toMatchObject({ action: 'task.comment', auditId: 'ref1' });
        expect(memory.record).toHaveBeenCalledWith(C, expect.objectContaining({ factId: 'f1', subtaskId: 'st1' }));
    });

    it('a review-mode agent files one proposal and the run waits', async () => {
        const d = deps();
        orchestrator.run.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high', why: 'w' }], summary: 's', usage: {} });
        const run = await runs.create(C, { agent: agent({ autonomy: 1 }), taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        const out = await runs.executeSkill(C, run, agent({ autonomy: 1 }), TASK, d);
        expect(out).toMatchObject({ status: 'waiting_approval', proposalId: 'prop1' });
        expect(runRow(run._id)).toMatchObject({ status: 'waiting_approval', proposals: ['prop1'], refusals: 0 });
    });

    it('findings already tracked by memory are not filed again', async () => {
        const d = deps();
        memory.decide.mockResolvedValue([{ finding: { factId: 'f1', title: 'Missing alt', severity: 'high' }, action: 'skip', reason: 'already filed and still open', prior: { _id: 'm1' } }]);
        orchestrator.run.mockResolvedValue({ status: 'success', skill: 'qa-review', findings: [{ factId: 'f1', title: 'Missing alt', severity: 'high' }], summary: 's', usage: {} });
        const run = await runs.create(C, { agent: agent(), taskId: TASK._id, projectId: 'p1', skill: 'qa-review' });
        const out = await runs.executeSkill(C, run, agent(), TASK, d);
        expect(d.actions.perform).not.toHaveBeenCalled();
        expect(memory.touch).toHaveBeenCalledWith(C, { _id: 'm1' });
        expect(out).toMatchObject({ status: 'done', outcome: 'nothing new to file — 1 finding(s) already tracked' });
    });
});
