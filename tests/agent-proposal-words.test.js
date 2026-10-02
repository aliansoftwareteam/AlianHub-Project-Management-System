const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })), personRefusal: jest.fn(async () => ''), rating: jest.fn(() => null) }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordProposalDecision: jest.fn(async () => 'dec1'), findById: jest.fn() }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const proposals = require('../Modules/Agents/proposals');
const proposalText = require('../Modules/Agents/proposalText');

const C = 'c1';
const AGENT_ID = '6f0000000000000000000a01';
const NOT_WORDS = [undefined, null, 'undefined', 'null', ' Undefined ', '[object Object]', '   ', '', {}, ['x'], 7];
const comment = (label) => [{ action: 'task.comment', params: { taskId: 't1', body: 'hi' }, ...(label === undefined ? {} : { label }) }];
const file = (over = {}) => proposals.create(C, { agent: { _id: AGENT_ID, name: 'Reviewer' }, taskId: 't1', projectId: 'p1', what: 'Ask for an update', why: 'It is quiet', changes: comment('Comment on AP-1'), ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
});

describe('the words a proposal is filed with', () => {
    it.each(NOT_WORDS)('takes the first change\'s label for a title of %p', async (what) => {
        expect((await file({ what })).what).toBe('Comment on AP-1');
    });

    it('takes the action\'s own label when the change has no words either', async () => {
        expect((await file({ what: 'undefined', changes: comment('null') })).what).toBe('Comment on a task');
        expect((await file({ what: null, changes: comment() })).what).toBe('Comment on a task');
    });

    it('keeps a real title, trimmed', async () => {
        expect((await file({ what: '  Ask for an update ' })).what).toBe('Ask for an update');
    });

    it.each(NOT_WORDS)('stores no reason for %p', async (why) => {
        expect((await file({ why })).why).toBe('');
    });

    it.each(NOT_WORDS)('stores no agent name for %p', async (name) => {
        expect((await file({ agent: { _id: AGENT_ID, name } })).agentName).toBe('');
    });

    it('never stores a change label that is not words', async () => {
        const saved = await file({ changes: comment('[object Object]') });
        expect(saved.changes[0].label).toBe('task.comment');
    });

    it('files a change a standing approval applied with a real name or none', async () => {
        const rule = { _id: 'r1', agentId: AGENT_ID, agentName: undefined, projectId: 'p1', madeBy: 'u1', requestedBy: 'u1', tokenId: 'tok1' };
        const saved = await proposals.fileApplied(C, { rule, action: 'task.comment', params: { taskId: 't1', body: 'hi' }, auditId: 'aud1', why: 'undefined' });
        expect(saved).toMatchObject({ what: 'Comment on a task', why: '', agentName: '' });
    });
});

describe('a proposal stored before its words were checked', () => {
    it('is listed with the first change\'s label, no reason and no name', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, { agentId: AGENT_ID, agentName: 'undefined', taskId: 't1', projectId: 'p1', what: 'undefined', why: 'null', status: 'declined', changes: comment('Comment on AP-1') });
        const { proposals: listed } = await proposals.list(C, { status: 'declined' });
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ what: 'Comment on AP-1', why: '', agentName: '' });
    });
});

describe('words joined into one title', () => {
    it('leaves out a part that is not words', () => {
        expect(proposalText.joined([undefined, '2 change(s) asked for in chat'])).toBe('2 change(s) asked for in chat');
        expect(proposalText.joined(['Reviewer', '2 change(s) asked for in chat'])).toBe('Reviewer: 2 change(s) asked for in chat');
        expect(proposalText.joined(['task.comment', 'undefined'])).toBe('task.comment');
        expect(proposalText.joined([null, {}])).toBe('');
    });
});
