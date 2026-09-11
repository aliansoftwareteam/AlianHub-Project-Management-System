const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordProposalDecision: jest.fn(async () => 'dec1'), findById: jest.fn() }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const audit = require('../Modules/Agents/agentAudit');
const proposals = require('../Modules/Agents/proposals');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const TEN_MINUTES = 10 * 60 * 1000;
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000);
const applying = (decidedAt, over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: AGENT_ID, agentName: 'Reviewer', runId: null, status: 'applying', decidedBy: 'u1', decidedAt,
    changes: [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' }], ...over,
});
const row = (id) => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].find((r) => String(r._id) === String(id));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', allowedActions: ['task.comment'], deletedStatusKey: 0 });
});

describe('reapStuck: proposals left in applying', () => {
    it('fails a proposal stuck past the threshold with a reason, audits it and never re-applies', async () => {
        const stale = applying(minutesAgo(30));
        const out = await proposals.reapStuck(C, { olderThanMs: TEN_MINUTES });
        expect(out).toEqual({ reaped: 1 });
        expect(row(stale._id)).toMatchObject({ status: 'failed', failedReason: expect.stringMatching(/applying for more than 10 minutes/) });
        expect(row(stale._id).failedAt).toBeInstanceOf(Date);
        expect(actions.perform).not.toHaveBeenCalled();
        expect(audit.recordProposalDecision).toHaveBeenCalledWith(C, expect.objectContaining({ userId: 'system' }), expect.objectContaining({ proposalId: String(stale._id), decision: expect.stringMatching(/^failed:/), agentName: 'Reviewer' }));
    });

    it('leaves a fresh applying proposal and decided ones alone', async () => {
        const fresh = applying(minutesAgo(2));
        const done = applying(minutesAgo(60), { status: 'approved' });
        const out = await proposals.reapStuck(C, { olderThanMs: TEN_MINUTES });
        expect(out).toEqual({ reaped: 0 });
        expect(row(fresh._id).status).toBe('applying');
        expect(row(done._id).status).toBe('approved');
        expect(audit.recordProposalDecision).not.toHaveBeenCalled();
    });

    it('closes the run that was waiting on the stuck proposal', async () => {
        const run = mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { agentId: AGENT_ID, status: 'waiting_approval', startedAt: minutesAgo(40) });
        applying(minutesAgo(30), { runId: String(run._id) });
        await proposals.reapStuck(C, { olderThanMs: TEN_MINUTES });
        const closed = mockDb.store[SCHEMA_TYPE.AGENT_RUNS].find((r) => String(r._id) === String(run._id));
        expect(closed.status).toBe('failed');
        expect(closed.outcome).toMatch(/proposal/);
    });

    it('a reaped proposal cannot be approved or declined afterwards', async () => {
        const stale = applying(minutesAgo(30));
        await proposals.reapStuck(C, { olderThanMs: TEN_MINUTES });
        const decider = { kind: 'human', userId: 'u1' };
        expect(await proposals.approve(C, stale._id, { decider, isPrivileged: true, ip: '' })).toMatchObject({ status: 409 });
        expect(await proposals.decline(C, stale._id, { decider, ip: '' })).toMatchObject({ status: 409 });
        expect(actions.perform).not.toHaveBeenCalled();
    });

    it('the default threshold comes from AGENT_PROPOSAL_STUCK_MINUTES', () => {
        expect(proposals.stuckThresholdMs()).toBe(TEN_MINUTES);
        process.env.AGENT_PROPOSAL_STUCK_MINUTES = '3';
        expect(proposals.stuckThresholdMs()).toBe(3 * 60 * 1000);
        delete process.env.AGENT_PROPOSAL_STUCK_MINUTES;
    });
});
