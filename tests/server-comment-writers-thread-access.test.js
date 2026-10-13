const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({
    forStatusChange: jest.fn(async () => null),
    recordWork: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => {
    const actual = jest.requireActual('../Modules/Comments/helpers/threadWriteAccess');
    return { ...actual, canPostToThread: jest.fn() };
});

process.env.MCP_TOOLS_DATA = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { canPostToThread } = require('../Modules/Comments/helpers/threadWriteAccess');
const actions = require('../Modules/Agents/actions');
const addCommentAction = require('../Modules/Automations/engine/actions/addComment');
const toolCall = require('../Modules/Workflows/stepTypes/toolCall');
const clientView = require('../Modules/Milestone/controller/clientView');

const CID = '6a8ee973d625fca52e519a12';
const PROJECT_ID = '6a9954186dd786246031e47b';
const SPRINT_ID = '6a9954186dd786246031e47f';
const OPEN_TASK = '6f0000000000000000000701';
const HIDDEN_TASK = '6f0000000000000000000702';
const PERSON = '6f0000000000000000000d01';
const RULE_AUTHOR = '6f0000000000000000000d02';
const STARTER = '6f0000000000000000000d03';
const RULE_ID = '6f0000000000000000000b01';
const AUTHORLESS_RULE_ID = '6f0000000000000000000b02';
const AGENT_ID = '6f0000000000000000000a01';
const HIDDEN_PROJECT = '6a9954186dd786246031e470';

const comments = () => mockDb.store[SCHEMA_TYPE.COMMENTS] || [];

/* Stands in for the thread rule the web app's comment routes apply: every identity can open
 * the open task's thread and none can open the hidden one's. */
const threadRule = async (companyId, uid, thread) => {
    if (!/^[a-f0-9]{24}$/i.test(String(uid || ''))) return { allowed: false, statusCode: 404 };
    if (thread.taskId === HIDDEN_TASK || thread.projectId === HIDDEN_PROJECT) return { allowed: false, statusCode: 404 };
    return { allowed: true, match: {} };
};

const askedFor = () => canPostToThread.mock.calls.map(([, uid, thread]) => ({ uid: String(uid), thread }));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    canPostToThread.mockImplementation(threadRule);
    [OPEN_TASK, HIDDEN_TASK].forEach((id) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: id, CompanyId: CID, ProjectID: PROJECT_ID, sprintId: SPRINT_ID, TaskName: `Task ${id}`, TaskKey: 'AC-1',
    }));
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE_ID, name: 'Nudge', createdBy: RULE_AUTHOR });
    mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: AUTHORLESS_RULE_ID, name: 'Orphan' });
});

describe('an agent comment follows the thread rule for the person behind the agent', () => {
    const actor = { kind: 'agent', userId: PERSON, agentId: AGENT_ID, agentName: 'Alian', runId: null, viaAccount: 'workspace' };
    const COMMENT_ACTIONS = ['task.comment', 'comment.create', 'chat.post'];

    it.each(COMMENT_ACTIONS)('%s into a thread the person cannot open is refused and writes nothing', async (action) => {
        await expect(actions.perform({ companyId: CID, actor, action, params: { taskId: HIDDEN_TASK, body: 'hello' } }))
            .rejects.toMatchObject({ name: 'RefusedError' });

        expect(comments()).toHaveLength(0);
        expect(askedFor()).toContainEqual({ uid: PERSON, thread: expect.objectContaining({ projectId: PROJECT_ID, taskId: HIDDEN_TASK }) });
    });

    it.each(COMMENT_ACTIONS)('%s into a thread the person can open is written', async (action) => {
        await actions.perform({ companyId: CID, actor, action, params: { taskId: OPEN_TASK, body: 'hello' } });

        expect(comments()).toHaveLength(1);
        expect(String(comments()[0].taskId)).toBe(OPEN_TASK);
    });
});

describe('an automation comment follows the thread rule for the rule author', () => {
    const run = (taskId, ruleId = RULE_ID) => addCommentAction.run({
        companyId: CID,
        entity: { kind: 'task', id: taskId },
        config: { body: 'Reminder' },
        context: { runId: 'r1', ruleId, ruleName: 'Nudge', depth: 0 },
    });

    it('a thread the author cannot open fails the step deterministically and writes nothing', async () => {
        await expect(run(HIDDEN_TASK)).rejects.toMatchObject({ deterministic: true });

        expect(comments()).toHaveLength(0);
        expect(askedFor()).toContainEqual({ uid: RULE_AUTHOR, thread: expect.objectContaining({ projectId: PROJECT_ID, sprintId: SPRINT_ID, taskId: HIDDEN_TASK }) });
    });

    it('a rule with no author to check fails the step and writes nothing', async () => {
        await expect(run(OPEN_TASK, AUTHORLESS_RULE_ID)).rejects.toMatchObject({ deterministic: true });

        expect(comments()).toHaveLength(0);
    });

    it('a thread the author can open is written', async () => {
        await expect(run(OPEN_TASK)).resolves.toMatchObject({ changed: true });

        expect(comments()).toHaveLength(1);
    });
});

describe('a workflow tool step comment follows the thread rule for the person who started the run', () => {
    const step = (taskId) => toolCall.execute({
        companyId: CID,
        run: { _id: '6f0000000000000000000e01', startedBy: STARTER, entity: { kind: 'task', id: taskId } },
        step: { stepId: 's1', config: { tool: 'add_comment', params: { body: 'From a workflow' } } },
        context: {},
    });

    it('a thread the starter cannot open fails the step and writes nothing', async () => {
        await expect(step(HIDDEN_TASK)).rejects.toMatchObject({ deterministic: true });

        expect(comments()).toHaveLength(0);
        expect(askedFor()).toContainEqual({ uid: STARTER, thread: expect.objectContaining({ taskId: HIDDEN_TASK }) });
    });

    it('a thread the starter can open is written', async () => {
        await expect(step(OPEN_TASK)).resolves.toMatchObject({ tool: 'add_comment' });

        expect(comments()).toHaveLength(1);
    });
});

describe('a client view message follows the thread rule for the sender', () => {
    const res = () => {
        const r = { code: 200, body: null };
        r.status = (c) => { r.code = c; return r; };
        r.json = (b) => { r.body = b; return r; };
        r.send = r.json;
        return r;
    };
    const send = async (projectId) => {
        const r = res();
        await clientView.postClientMessage({ headers: { companyid: CID }, query: {}, body: { projectId, message: 'Looks good' }, uid: PERSON, aud: CID }, r);
        return r;
    };

    it('a project thread the sender cannot open is refused and writes nothing', async () => {
        const r = await send(HIDDEN_PROJECT);

        expect(r.body).toMatchObject({ status: false });
        expect(comments()).toHaveLength(0);
        expect(askedFor()).toContainEqual({ uid: PERSON, thread: expect.objectContaining({ projectId: HIDDEN_PROJECT }) });
    });

    it('a project thread the sender can open is written', async () => {
        const r = await send(PROJECT_ID);

        expect(r.body).toMatchObject({ status: true });
        expect(comments()).toHaveLength(1);
    });
});
