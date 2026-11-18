const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => {
    const actual = jest.requireActual('../Modules/Comments/helpers/threadWriteAccess');
    return { ...actual, canPostToThread: jest.fn(async () => ({ allowed: true, match: {} })) };
});

process.env.MCP_TOOLS_DATA = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Automations/engine/tools');

const CID = '6a8ee973d625fca52e519a12';
const PROJECT_ID = '6a9954186dd786246031e47b';
const SPRINT_ID = '6a9954186dd786246031e47f';
const TASK_ID = '6f0000000000000000000701';
const PERSON = '6f0000000000000000000d01';
const RULE_ID = '6f0000000000000000000b01';

const panelRoomPrefix = `comments_${PROJECT_ID}_${SPRINT_ID}_${TASK_ID}`;
const insertsOf = () => socketEmitter.emit.mock.calls.filter(([name, payload]) => name === 'insert' && payload.module === 'comments').map(([, payload]) => payload);
const roomPrefixOf = ({ data }) => `comments_${data.projectId}_${data.sprintId}_${data.taskId}`;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, sprintId: SPRINT_ID, TaskName: 'Task', TaskKey: 'AC-1' });
});

describe('a comment written by the person\'s connected AI reaches the open task at once', () => {
    const connectedAi = { kind: 'agent', userId: PERSON, agentName: 'Claude Code', runId: null, viaAccount: 'external', delegatedBy: PERSON, onBehalfOf: PERSON };

    it.each(['task.comment', 'comment.create'])('%s announces the stored comment to the task\'s comment room', async (action) => {
        await actions.perform({ companyId: CID, actor: connectedAi, action, params: { taskId: TASK_ID, body: 'Done, see the PR' } });

        const stored = mockDb.store[SCHEMA_TYPE.COMMENTS];
        expect(stored).toHaveLength(1);
        const inserts = insertsOf();
        expect(inserts).toHaveLength(1);
        const [event] = inserts;
        expect(event).toMatchObject({ type: 'insert', companyId: CID, actor: { kind: 'agent', userId: PERSON } });
        expect(String(event.data._id)).toBe(String(stored[0]._id));
        expect(event.data).toMatchObject({ userId: PERSON, isAgent: true, actorType: 'agent', viaAccount: 'external' });
        expect(roomPrefixOf(event)).toBe(panelRoomPrefix);
        expect(event.depth).toBeGreaterThanOrEqual(1);
    });
});

describe('an automation comment is announced too, marked as an automation one hop deeper', () => {
    it('carries no person as its actor', async () => {
        await tools.addComment(CID, TASK_ID, 'Reminder', { ruleId: RULE_ID, ruleName: 'Nudge', actingUserId: PERSON, depth: 2 });

        const [event] = insertsOf();
        expect(event).toMatchObject({ companyId: CID, actor: { kind: 'automation', userId: null }, depth: 3 });
        expect(roomPrefixOf(event)).toBe(panelRoomPrefix);
    });
});
