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
const memory = require('../Modules/Agents/memory');
const proposals = require('../Modules/Agents/proposals');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const opts = { decider: { kind: 'human', userId: 'u1' }, isPrivileged: true, ip: '' };
const GONE_RUN = '6f00000000000000000000ff';
const changes = [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' }];
const pendingFor = (runId) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Reviewer', runId, taskId: 't1', projectId: 'p1', status: 'pending', gate: null, changes });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    jest.spyOn(memory, 'preferenceCandidate').mockResolvedValue(null);
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', allowedActions: ['task.get', 'task.comment'], deletedStatusKey: 0 });
});

describe('#16 a proposal whose run is gone', () => {
    it('is refused on approve with run_missing and applies nothing', async () => {
        const p = pendingFor(GONE_RUN);
        const out = await proposals.approve(C, p._id, opts);
        expect(out).toMatchObject({ status: 409, reason: proposals.REASON.RUN_MISSING });
        expect(out.error).toMatch(/no longer exists/);
        expect(actions.perform).not.toHaveBeenCalled();
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0].status).toBe('pending');
    });

    it('can still be declined so the Inbox is not stuck with it', async () => {
        const p = pendingFor(GONE_RUN);
        const out = await proposals.decline(C, p._id, { ...opts, reason: 'stale' });
        expect(out.error).toBeUndefined();
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0].status).toBe('declined');
    });

    it('still approves a proposal with no run behind it at all', async () => {
        const p = pendingFor(null);
        const out = await proposals.approve(C, p._id, opts);
        expect(out.error).toBeUndefined();
        expect(actions.perform).toHaveBeenCalledTimes(1);
    });
});
