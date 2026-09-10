const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordProposalDecision: jest.fn(async () => 'dec1'), findById: jest.fn() }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/Agents/engine/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const graph = require('../Modules/Agents/engine/graph');
const persistence = require('../Modules/Agents/engine/persistence');
const memory = require('../Modules/Agents/memory');
const proposals = require('../Modules/Agents/proposals');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const decider = { kind: 'human', userId: 'u1' };
const opts = { decider, isPrivileged: true, ip: '' };

const pending = () => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT_ID, agentName: 'Reviewer', runId: null, status: 'pending', gate: null,
    changes: [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' }],
});

const runRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(id));
const proposalRow = (id) => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].find((r) => String(r._id) === String(id));
const seedRun = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'waiting_approval', skill: 'plan', taskId: 't1', projectId: 'p1', startedAt: new Date(), spend: { usd: 0.02 }, actions: [{ action: 'task.comment', ok: true }, { action: 'task.comment', ok: false }], proposals: [], ...over });
const pendingFor = (run, changes) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Reviewer', runId: String(run._id), taskId: 't1', projectId: 'p1', status: 'pending', gate: null, changes });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    graph.resumeGraph.mockResolvedValue({ resumed: false });
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    jest.spyOn(memory, 'preferenceCandidate').mockResolvedValue(null);
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', allowedActions: ['task.get', 'task.comment'], deletedStatusKey: 0 });
});

describe('#5 approve and decline claim the proposal atomically', () => {
    it('claims with a status-conditioned update before performing anything', async () => {
        const p = pending();
        const order = [];
        mockDb.crud.mockImplementationOnce(async (...a) => { order.push('claim'); return mockDb.crud.getMockImplementation()(...a); });
        actions.perform.mockImplementationOnce(async () => { order.push('perform'); return { auditId: 'aud1', result: {} }; });
        const out = await proposals.approve(C, p._id, opts);
        expect(out.error).toBeUndefined();
        const claim = mockDb.calls.find((c) => c.method === 'findOneAndUpdate' && c.type === SCHEMA_TYPE.AGENT_PROPOSALS);
        expect(claim.data[0]).toEqual({ _id: expect.anything(), status: 'pending' });
        expect(claim.data[1].$set.status).toBe('applying');
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0].status).toBe('approved');
    });

    it('two concurrent approves apply the changes exactly once; the loser is told it is already approved', async () => {
        const p = pending();
        let release;
        actions.perform.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ auditId: 'aud1', result: {} }); }));
        const first = proposals.approve(C, p._id, opts);
        await new Promise((r) => setImmediate(r));
        const second = await proposals.approve(C, p._id, opts);
        expect(second).toEqual({ error: 'Proposal is being applied.', status: 409 });
        release();
        await first;
        expect(actions.perform).toHaveBeenCalledTimes(1);
        expect(await proposals.approve(C, p._id, opts)).toEqual({ error: 'Proposal is already approved.', status: 409 });
        expect(await proposals.decline(C, p._id, opts)).toEqual({ error: 'Proposal is already approved.', status: 409 });
    });

    it('decline is conditioned on pending too, so it cannot overwrite an approval', async () => {
        const p = pending();
        await proposals.approve(C, p._id, opts);
        const out = await proposals.decline(C, p._id, opts);
        expect(out.status).toBe(409);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0].status).toBe('approved');
    });

    it('the owner/admin gate is checked before the claim, so a refused member leaves it pending', async () => {
        const p = pending();
        mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0].gate = 'owner_admin';
        expect(await proposals.approve(C, p._id, { ...opts, isPrivileged: false })).toEqual({ error: 'This proposal needs an Owner or Admin.', status: 403 });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0].status).toBe('pending');
    });
});

describe('#9 approval performs inside the agent\'s allowedActions', () => {
    it('passes the agent\'s allowedActions to every perform', async () => {
        const p = pending();
        await proposals.approve(C, p._id, opts);
        expect(actions.perform).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.comment', allowedActions: ['task.get', 'task.comment'] }));
    });

    it('refuses to apply for an agent that was deleted since the proposal was filed', async () => {
        const p = pending();
        mockDb.store[SCHEMA_TYPE.AGENTS][0].deletedStatusKey = 1;
        expect(await proposals.approve(C, p._id, opts)).toEqual({ error: 'This agent was deleted — decline the proposal instead.', status: 409 });
        expect(actions.perform).not.toHaveBeenCalled();
        expect((await proposals.decline(C, p._id, opts)).proposal.status).toBe('declined');
    });
});

describe('what memory is told about an approval', () => {
    it('hands over the executed change list, so an edited approval remembers the edited labels', async () => {
        const p = mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
            agentId: AGENT_ID, agentName: 'Reviewer', runId: null, projectId: 'p1', status: 'pending', gate: null,
            changes: [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' }, { action: 'task.comment', params: { taskId: 't1', body: 'bye' }, label: 'Dropped' }],
        });
        const edited = [{ action: 'task.comment', params: { taskId: 't1', body: 'reworded' }, label: 'Reworded comment' }];
        const out = await proposals.approve(C, p._id, { ...opts, changes: edited });
        expect(out.proposal.status).toBe('edited');
        expect(memory.rememberApprovedChanges).toHaveBeenCalledTimes(1);
        const [{ proposal, applied, projectId }] = memory.rememberApprovedChanges.mock.calls[0];
        expect(projectId).toBe('p1');
        expect(proposal.changes).toEqual([{ action: 'task.comment', params: { taskId: 't1', body: 'reworded' }, label: 'Reworded comment' }]);
        expect(proposal.decidedBy).toBe('u1');
        expect(applied).toEqual([{ action: 'task.comment', ok: true, result: {} }]);
    });
});

describe('settling the run that filed the proposal', () => {
    const change = { action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' };

    it('refuses to approve once the run was stopped: nothing is performed and the proposal stays pending', async () => {
        const run = seedRun({ status: 'stopped', outcome: 'stopped by u1' });
        const p = pendingFor(run, [change]);
        expect(await proposals.approve(C, p._id, opts)).toEqual({ error: 'Run was stopped.', status: 409 });
        expect(actions.perform).not.toHaveBeenCalled();
        expect(proposalRow(p._id).status).toBe('pending');
        expect(runRow(run._id)).toMatchObject({ status: 'stopped', outcome: 'stopped by u1' });
        expect(graph.resumeGraph).not.toHaveBeenCalled();
    });

    it('declining after a stop leaves the run stopped and drops the parked thread', async () => {
        const run = seedRun({ status: 'stopped' });
        const p = pendingFor(run, [change]);
        expect((await proposals.decline(C, p._id, { ...opts, reason: 'not_now' })).proposal.status).toBe('declined');
        expect(runRow(run._id)).toMatchObject({ status: 'stopped' });
        expect(runRow(run._id).episode).toBeUndefined();
        expect(graph.resumeGraph).not.toHaveBeenCalled();
        expect(persistence.saverFor).toHaveBeenCalledWith(C);
        expect(persistence.deleteThread).toHaveBeenCalledWith(String(run._id));
    });

    it('resumes a waiting run, retrying once when the checkpointer throws', async () => {
        const run = seedRun();
        const p = pendingFor(run, [change]);
        graph.resumeGraph.mockRejectedValueOnce(new Error('checkpointer down')).mockResolvedValueOnce({ resumed: true, status: 'done' });
        expect((await proposals.approve(C, p._id, opts)).error).toBeUndefined();
        expect(graph.resumeGraph).toHaveBeenCalledTimes(2);
        expect(graph.resumeGraph).toHaveBeenLastCalledWith({ companyId: C, runId: String(run._id), resume: { decision: 'approved', applied: [{ action: 'task.comment', ok: true, result: {} }], reason: null } });
        expect(runRow(run._id).status).toBe('waiting_approval');
        expect(persistence.deleteThread).not.toHaveBeenCalled();
    });

    it('closes the run itself with an episode built from what is in hand when the resume throws twice', async () => {
        const run = seedRun();
        const p = pendingFor(run, [change, { ...change, label: 'Second' }]);
        graph.resumeGraph.mockRejectedValue(new Error('checkpointer down'));
        actions.perform.mockResolvedValueOnce({ auditId: 'aud1', result: {} }).mockRejectedValueOnce(new Error('refused'));
        expect((await proposals.approve(C, p._id, opts)).error).toBeUndefined();
        expect(graph.resumeGraph).toHaveBeenCalledTimes(2);
        expect(runRow(run._id)).toMatchObject({ status: 'done', outcome: 'approved by a person — 1 of 2 change(s) applied' });
        expect(runRow(run._id).episode).toMatchObject({ skill: 'plan', taskId: 't1', proposed: 2, acted: 1, approved: 1, declined: 0, declinedReason: null, reverted: false, spendUsd: 0.02 });
        expect(runRow(run._id).episode.at).toBeInstanceOf(Date);
        expect(persistence.deleteThread).toHaveBeenCalledWith(String(run._id));

        const run2 = seedRun();
        const q = pendingFor(run2, [change]);
        expect((await proposals.decline(C, q._id, { ...opts, reason: 'too_many_changes' })).proposal.status).toBe('declined');
        expect(runRow(run2._id)).toMatchObject({ status: 'done', outcome: 'declined by a person' });
        expect(runRow(run2._id).episode).toMatchObject({ proposed: 1, approved: 0, declined: 1, declinedReason: 'too_many_changes', acted: 1 });
    });

    it('a stop that lands while the changes are being applied is not overwritten by the fallback close', async () => {
        const run = seedRun();
        const p = pendingFor(run, [change]);
        actions.perform.mockImplementationOnce(async () => { runRow(run._id).status = 'stopped'; return { auditId: 'aud1', result: {} }; });
        expect((await proposals.approve(C, p._id, opts)).error).toBeUndefined();
        expect(runRow(run._id).status).toBe('stopped');
        expect(graph.resumeGraph).not.toHaveBeenCalled();
        expect(persistence.deleteThread).toHaveBeenCalledWith(String(run._id));
    });
});

describe('the decline reason', () => {
    it('is stored only when it is a string, and only a canned one grows into a preference', async () => {
        const first = pending();
        expect((await proposals.decline(C, first._id, { ...opts, reason: { $gt: '' } })).proposal.declineReason).toBeUndefined();
        expect(memory.preferenceCandidate).not.toHaveBeenCalled();
        const second = pending();
        expect((await proposals.decline(C, second._id, { ...opts, reason: '  the tone was off  ' })).proposal.declineReason).toBe('the tone was off');
        expect(memory.preferenceCandidate).not.toHaveBeenCalled();
        const third = pending();
        expect((await proposals.decline(C, third._id, { ...opts, reason: 'wrong_tone' })).proposal.declineReason).toBe('wrong_tone');
        expect(memory.preferenceCandidate).toHaveBeenCalledWith({ companyId: C, userId: 'u1', reasonKey: 'wrong_tone' });
        expect(proposals.DECLINE_REASONS).toEqual(Object.keys(memory.DECLINE_REASON_TEXT));
    });
});
