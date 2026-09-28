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
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const memory = require('../Modules/Agents/memory');
const proposals = require('../Modules/Agents/proposals');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const RUN = '6f00000000000000000000b1';
const DECIDER = '6f0000000000000000000011';
const opts = { decider: { kind: 'human', userId: DECIDER }, isPrivileged: true, ip: '' };
const changes = [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' }];
const pending = () => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Reviewer', runId: RUN, taskId: 't1', projectId: 'p1', status: 'pending', gate: null, changes });
const feedbackRows = () => mockDb.store[SCHEMA_TYPE.AI_FEEDBACK] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jest.spyOn(memory, 'preferenceCandidate').mockResolvedValue(null);
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', allowedActions: ['task.get', 'task.comment'], deletedStatusKey: 0 });
});

describe('declining a proposal', () => {
    it('counts as a thumbs down from the decider that reuses the decline reason', async () => {
        const p = pending();
        await proposals.decline(C, p._id, { ...opts, reason: 'too_many_changes' });
        expect(feedbackRows()).toHaveLength(1);
        expect(feedbackRows()[0]).toMatchObject({
            userId: DECIDER, feature: 'agent_run', kind: 'proposal', itemId: String(p._id), runId: RUN, rating: 'down', note: 'too_many_changes', via: 'decline',
        });
    });

    it('still records the thumbs down when no reason was given', async () => {
        const p = pending();
        await proposals.decline(C, p._id, opts);
        expect(feedbackRows()[0]).toMatchObject({ rating: 'down', note: '', via: 'decline' });
    });
});
