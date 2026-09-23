const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canPostToThread: jest.fn(async () => ({ allowed: true, match: {} })),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({
    forStatusChange: jest.fn(async () => null),
    recordWork: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Automations/engine/tools');

const CID = '6a8ee973d625fca52e519a12';
const TASK_ID = '6f0000000000000000000701';
const AGENT_ID = '6f0000000000000000000a01';
const RUN_ID = '6f0000000000000000000c01';
const PERSON_ID = '6f0000000000000000000d01';
const PROJECT_ID = '6a9954186dd786246031e47b';

const comments = () => mockDb.store[SCHEMA_TYPE.COMMENTS] || [];
const onlyComment = () => {
    expect(comments()).toHaveLength(1);
    return comments()[0];
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, TaskName: 'What exists?', TaskKey: 'AC-1' });
});

// The thread resolves userId against the member list; an agent's reply must
// carry its own name, or it renders as the "Ghost User" placeholder.
describe('an agent reply in a task thread is stored as the agent', () => {
    const unattended = { kind: 'agent', userId: '', agentId: AGENT_ID, agentName: 'Alian', runId: RUN_ID, viaAccount: 'workspace' };
    const onBehalf = { ...unattended, userId: PERSON_ID };

    it.each([
        ['task.comment', unattended],
        ['chat.post', unattended],
        ['task.comment', onBehalf],
    ])('%s names the agent on the row', async (action, actor) => {
        await actions.perform({ companyId: CID, actor, action, params: { taskId: TASK_ID, body: 'There are two pages [page:6a8ef8f37a685406dbc572a1]' } });

        expect(onlyComment()).toMatchObject({ actorType: 'agent', agentId: AGENT_ID, isAgent: true, agentName: 'Alian' });
    });

    it('a rule comment with no agent is not marked as an agent', async () => {
        await tools.addComment(CID, TASK_ID, 'Reminder', { ruleId: '6f0000000000000000000b01', ruleName: 'Nudge', runId: 'r1', depth: 0 });

        const row = onlyComment();
        expect(row.isAgent).toBeUndefined();
        expect(row.agentName).toBeUndefined();
    });
});
