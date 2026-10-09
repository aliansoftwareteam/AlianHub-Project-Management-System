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
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));

process.env.MCP_TOOLS_DATA = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { SEAT_ACTIVE } = require('../Config/seatStatus');
const socketEmitter = require('../event/socketEventEmitter');
const { resolveMentionIds, deliverMentions } = require('../Modules/Comments/helpers/commentNotifications');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Automations/engine/tools');

const CID = '6a8ee973d625fca52e519a12';
const PROJECT_ID = '6a9954186dd786246031e47b';
const SPRINT_ID = '6a9954186dd786246031e47f';
const TASK_ID = '6f0000000000000000000701';
const PERSON = '6f0000000000000000000d01';
const OWNER = '6f0000000000000000000d02';
const WATCHER = '6f0000000000000000000d03';
const OUTSIDER = '6f0000000000000000000d04';
const RULE_ID = '6f0000000000000000000b01';

const taskKey = `task_${PROJECT_ID}_${SPRINT_ID}_${TASK_ID}_comments`;
const countOf = (userId) => {
    const row = mockDb.store[SCHEMA_TYPE.USERID].find((r) => String(r.userId) === userId);
    return row ? row[taskKey] : undefined;
};
const liveCountsFor = (userId) => socketEmitter.emit.mock.calls
    .filter(([name, payload]) => name === 'update' && payload.module === 'userIdNotification' && String(payload.data.userId) === userId)
    .map(([, payload]) => payload);

const connectedAi = { kind: 'agent', userId: PERSON, agentName: 'Claude Code', runId: null, viaAccount: 'external', delegatedBy: PERSON, onBehalfOf: PERSON };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT_ID, CompanyId: CID, watchers: {} });
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, sprintId: SPRINT_ID, TaskName: 'Task', TaskKey: 'AC-1',
        watchers: [PERSON, OWNER, WATCHER], AssigneeUserId: [PERSON],
    });
    [PERSON, OWNER, WATCHER, OUTSIDER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: SEAT_ACTIVE }));
});

describe('a comment from a connected AI counts as unread on the task', () => {
    it.each(['task.comment', 'comment.create'])('%s raises the count of everyone on the task but its author', async (action) => {
        await actions.perform({ companyId: CID, actor: connectedAi, action, params: { taskId: TASK_ID, body: 'Done, see the PR', notifyMentions: true } });

        expect(countOf(OWNER)).toBe(1);
        expect(countOf(WATCHER)).toBe(1);
        expect(countOf(PERSON)).toBeUndefined();
        expect(countOf(OUTSIDER)).toBeUndefined();
    });

    it('sends each raised count to its person live', async () => {
        await actions.perform({ companyId: CID, actor: connectedAi, action: 'task.comment', params: { taskId: TASK_ID, body: 'Done', notifyMentions: true } });

        const [owners] = liveCountsFor(OWNER);
        expect(owners).toMatchObject({ type: 'update', companyId: CID });
        expect(owners.data[taskKey]).toBe(1);
        expect(liveCountsFor(PERSON)).toHaveLength(0);
    });

    it('stores the people it names, counts their mention, and tells them with the stored comment', async () => {
        resolveMentionIds.mockResolvedValueOnce([OUTSIDER]);
        const answer = await actions.perform({ companyId: CID, actor: connectedAi, action: 'task.comment', params: { taskId: TASK_ID, body: 'Over to you', notifyMentions: true } });

        const [stored] = mockDb.store[SCHEMA_TYPE.COMMENTS];
        expect(stored.mentionIds).toEqual([OUTSIDER]);
        expect(countOf(OUTSIDER)).toBe(1);
        const outsider = mockDb.store[SCHEMA_TYPE.USERID].find((r) => String(r.userId) === OUTSIDER);
        expect(outsider.mention_counts).toBeGreaterThan(0);
        expect(deliverMentions).toHaveBeenCalledTimes(1);
        const [, delivered, ids] = deliverMentions.mock.calls[0];
        expect(String(delivered._id)).toBe(String(stored._id));
        expect(String(delivered.taskId)).toBe(TASK_ID);
        expect(ids).toEqual([OUTSIDER]);
        expect(JSON.stringify(answer)).toContain(OUTSIDER);
    });

    it('raises no count for a reply, which its thread announces instead', async () => {
        const root = await tools.addComment(CID, TASK_ID, 'Root', { userId: OWNER, actingUserId: OWNER });
        mockDb.store[SCHEMA_TYPE.USERID].length = 0;

        await tools.addComment(CID, TASK_ID, 'Reply', { userId: PERSON, actingUserId: PERSON, actorType: 'agent' }, { replyTo: root.commentId });

        expect(mockDb.store[SCHEMA_TYPE.USERID]).toHaveLength(0);
    });

    it('counts an automation comment for everyone on the task', async () => {
        await tools.addComment(CID, TASK_ID, 'Reminder', { ruleId: RULE_ID, ruleName: 'Nudge', actingUserId: PERSON });

        expect([PERSON, OWNER, WATCHER].map(countOf)).toEqual([1, 1, 1]);
    });
});
