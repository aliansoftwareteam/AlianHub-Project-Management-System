/* An approval with edited changes is held to the changes it would run. */
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
const actions = require('../Modules/Agents/actions');
const memory = require('../Modules/Agents/memory');
const proposals = require('../Modules/Agents/proposals');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const decider = { kind: 'human', userId: 'u1' };

const COMMENT = { action: 'task.comment', params: { taskId: 't1', body: 'hi' }, label: 'Comment' };
const DEPLOY = { action: 'deploy.staging', params: { taskId: 't1' }, label: 'Deploy' };

const pending = (changes, gate = null) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'Reviewer', runId: null, status: 'pending', gate, changes });
const stored = (id) => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].find((row) => String(row._id) === String(id));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Reviewer', allowedActions: [], deletedStatusKey: 0 });
});

describe('who may approve a proposal with edited changes', () => {
    it.each([
        ['a change only an owner or admin approves, added by the edit', [COMMENT], null, [COMMENT, DEPLOY]],
        ['a change only an owner or admin approves, put in place of the one filed', [COMMENT], null, [DEPLOY]],
        ['a proposal filed for an owner or admin, with that change edited out', [COMMENT, DEPLOY], 'owner_admin', [COMMENT]],
    ])('needs an owner or admin: %s', async (_what, filed, gate, edited) => {
        const p = pending(filed, gate);
        expect(await proposals.approve(C, p._id, { decider, isPrivileged: false, changes: edited, ip: '' })).toEqual({ error: 'This proposal needs an Owner or Admin.', status: 403 });
        expect(stored(p._id).status).toBe('pending');
        expect(actions.perform).not.toHaveBeenCalled();

        const out = await proposals.approve(C, p._id, { decider, isPrivileged: true, changes: edited, ip: '' });
        expect(out.error).toBeUndefined();
        expect(stored(p._id).status).toBe('edited');
        expect(actions.perform.mock.calls.map(([call]) => call.action)).toEqual(edited.map((change) => change.action));
    });

    it('a member approves an edit that holds no such change', async () => {
        const p = pending([COMMENT, { ...COMMENT, params: { taskId: 't1', body: 'again' } }]);
        const out = await proposals.approve(C, p._id, { decider, isPrivileged: false, changes: [COMMENT], ip: '' });
        expect(out.error).toBeUndefined();
        expect(stored(p._id)).toMatchObject({ status: 'edited', changes: [expect.objectContaining({ action: 'task.comment' })] });
        expect(actions.perform).toHaveBeenCalledTimes(1);
    });
});
