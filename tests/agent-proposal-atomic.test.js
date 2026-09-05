const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordProposalDecision: jest.fn(async () => 'dec1'), findById: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const decider = { kind: 'human', userId: 'u1' };
const opts = { decider, isPrivileged: true, ip: '' };

const pending = () => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT_ID, agentName: 'Reviewer', runId: null, status: 'pending', gate: null,
    changes: [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' }],
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
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
