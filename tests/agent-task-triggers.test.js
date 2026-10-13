process.env.STORAGE_TYPE = 'server';

const mockStores = { a: require('./fixtures/fakeMongo').create(), b: require('./fixtures/fakeMongo').create() };
const mockState = { companyB: '', roles: {}, visible: {} };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => (String(companyId) === mockState.companyB ? mockStores.b : mockStores.a).crud(companyId, ...rest),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockState.roles ? mockState.roles[uid] : null)),
    isPrivileged: (r) => r === 1 || r === 2,
    evaluatePermission: jest.fn(),
    isWritable: () => true,
    isReadable: () => true,
}));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({
    commentThreadAccess: jest.fn(async (companyId, uid, { taskId }) => ((mockState.visible[uid] || []).includes(String(taskId)) ? { allowed: true, match: {} } : { allowed: false, statusCode: 404 })),
    refuseThread: (res) => res.status(404).json({ status: false }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({ resolveMentionIds: jest.fn(async () => []), deliverMentions: jest.fn(async () => []) }));
jest.mock('../Modules/AICore/aiSwitch', () => ({ AI_OFF: 'ai_off', allowed: jest.fn(async () => true), assertAllowed: jest.fn(async () => {}), isAiOff: () => false }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publishGuideSaved: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(async () => null) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const runs = require('../Modules/Agents/runs');
const agentsCtrl = require('../Modules/Agents/controller');
const commentsCtrl = require('../Modules/Comments/controller');
const actions = require('../Modules/Agents/actions');

const A = '6f0000000000000000000c01';
const B = '6f0000000000000000000c02';
const PROJECT = '6f00000000000000000000a1';
const OTHER_PROJECT = '6f00000000000000000000b2';
const OWNER = '6f0000000000000000000d01';
const MEMBER = '6f0000000000000000000d02';
const GUEST = '6f0000000000000000000d03';
const OUTSIDER = '6f0000000000000000000d04';
const TASK_ID = '6f0000000000000000000701';
const DM_ID = '6f0000000000000000000702';
const REVIEWER = '6f0000000000000000000a01';
const SCOPED_ELSEWHERE = '6f0000000000000000000a02';
const PAUSED = '6f0000000000000000000a03';
const IN_B = '6f0000000000000000000a04';

const task = (over = {}) => ({ _id: TASK_ID, CompanyId: A, ProjectID: PROJECT, TaskName: 'Review https://example.com', TaskKey: 'AR-1', AssigneeUserId: [MEMBER], ...over });
const agent = (over) => ({ autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [], skills: [{ key: 'qa-review', name: 'QA', enabled: true }], ...over });

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const runRows = (store = mockStores.a) => store.store[SCHEMA_TYPE.AGENT_RUNS] || [];
const mention = (id, name = 'Reviewer') => `@[${name}](agent_${id})`;

const postComment = async (uid, message, { companyId = A, taskId = TASK_ID, projectId = PROJECT, apiToken } = {}) => {
    const r = res();
    await commentsCtrl.save({ headers: { companyid: companyId }, uid, ...(apiToken ? { apiToken } : {}), body: { data: { objId: { projectId, taskId }, message, type: 'text', userId: uid } } }, r);
    await flush();
    return r;
};

const runnable = async (uid, taskId = TASK_ID) => {
    const r = res();
    await agentsCtrl.runnableAgents({ headers: { companyid: A }, uid, query: { taskId } }, r);
    return r;
};

const assign = async (uid, agentId = REVIEWER) => {
    const r = res();
    await agentsCtrl.startRun({ headers: { companyid: A }, uid, query: {}, params: {}, body: { agentId, taskId: TASK_ID, trigger: 'assignment' } }, r);
    await flush();
    return r;
};

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    Object.values(mockStores).forEach((db) => Object.keys(db.store).forEach((k) => { db.store[k].length = 0; }));
    jest.clearAllMocks();
    mockState.companyB = B;
    mockState.roles = { [OWNER]: 1, [MEMBER]: 3, [GUEST]: 0, [OUTSIDER]: 3 };
    mockState.visible = { [OWNER]: [TASK_ID, DM_ID], [MEMBER]: [TASK_ID, DM_ID], [GUEST]: [TASK_ID] };
    jest.spyOn(runs, 'executeSkill').mockResolvedValue({ status: 'done' });
    mockStores.a.seed(SCHEMA_TYPE.TASKS, task());
    mockStores.a.seed(SCHEMA_TYPE.TASKS, task({ _id: DM_ID, ProjectID: PROJECT, mainChat: true, TaskName: 'DM' }));
    mockStores.a.seed(SCHEMA_TYPE.AGENTS, agent({ _id: REVIEWER, name: 'Reviewer' }));
    mockStores.a.seed(SCHEMA_TYPE.AGENTS, agent({ _id: SCOPED_ELSEWHERE, name: 'Elsewhere', projectIds: [OTHER_PROJECT] }));
    mockStores.a.seed(SCHEMA_TYPE.AGENTS, agent({ _id: PAUSED, name: 'Paused', paused: true }));
    mockStores.b.seed(SCHEMA_TYPE.AGENTS, agent({ _id: IN_B, name: 'Other company' }));
});

afterEach(() => runs.executeSkill.mockRestore());

describe('GET /agents/runnable', () => {
    it('lists the live agents scoped to the task for a member who can open it', async () => {
        const r = await runnable(MEMBER);
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((a) => a.name)).toEqual(['Reviewer']);
        expect(Object.keys(r.body.data[0]).sort()).toEqual(['_id', 'autonomy', 'description', 'name']);
    });

    it.each([['a guest', GUEST], ['a member who cannot open the task', OUTSIDER], ['someone outside the company', '6f0000000000000000000d09']])('is empty for %s', async (label, uid) => {
        const r = await runnable(uid);
        expect(r.body).toEqual({ status: true, statusText: 'Agents fetched.', data: [] });
    });

    it('is empty on a chat conversation, which is no task an agent can work on', async () => {
        expect((await runnable(MEMBER, DM_ID)).body.data).toEqual([]);
    });
});

describe('@agent in a task comment', () => {
    it('posts the comment and starts a mention run with the comment as the brief', async () => {
        const r = await postComment(MEMBER, `${mention(REVIEWER)} please check the links`);
        expect(r.code).toBe(200);
        expect(mockStores.a.store[SCHEMA_TYPE.COMMENTS]).toHaveLength(1);
        const rows = runRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ agentId: REVIEWER, taskId: TASK_ID, trigger: 'mention', startedBy: MEMBER, viaAccount: 'workspace' });
        expect(rows[0].actions[0].note).toBe('@Reviewer please check the links');
        expect(runs.executeSkill).toHaveBeenCalledTimes(1);
    });

    it('starts nothing for a guest, though the comment is posted', async () => {
        const r = await postComment(GUEST, `${mention(REVIEWER)} go`);
        expect(r.code).toBe(200);
        expect(mockStores.a.store[SCHEMA_TYPE.COMMENTS]).toHaveLength(1);
        expect(runRows()).toHaveLength(0);
    });

    it('starts nothing for someone who cannot open the task', async () => {
        const r = await postComment(OUTSIDER, `${mention(REVIEWER)} go`);
        expect(r.code).toBe(404);
        expect(runRows()).toHaveLength(0);
    });

    it('starts no agent that is paused or scoped to another project', async () => {
        await postComment(MEMBER, `${mention(PAUSED, 'Paused')} ${mention(SCOPED_ELSEWHERE, 'Elsewhere')}`);
        expect(runRows()).toHaveLength(0);
    });

    it('never reaches an agent of another company', async () => {
        await postComment(MEMBER, `${mention(IN_B, 'Other company')} go`);
        expect(runRows()).toHaveLength(0);
        expect(runRows(mockStores.b)).toHaveLength(0);
    });

    it('starts nothing from a chat message, which has no task to work on', async () => {
        await postComment(MEMBER, `${mention(REVIEWER)} go`, { taskId: DM_ID });
        expect(runRows()).toHaveLength(0);
    });

    it('treats a comment without an agent mention as before', async () => {
        await postComment(MEMBER, 'plain text');
        expect(runRows()).toHaveLength(0);
    });

    it('follows the same rules for a comment posted with a personal API token', async () => {
        await postComment(MEMBER, `${mention(REVIEWER)} via token`, { apiToken: { _id: 't1', name: 'script' } });
        expect(runRows()).toHaveLength(1);
        expect(runRows()[0]).toMatchObject({ trigger: 'mention', startedBy: MEMBER });

        await postComment(GUEST, `${mention(REVIEWER)} via token`, { apiToken: { _id: 't2', name: 'script' } });
        expect(runRows()).toHaveLength(1);
    });

    it('starts nothing from a comment an agent run writes', async () => {
        const r = res();
        await commentsCtrl.save({ headers: { companyid: A }, uid: MEMBER, agentRun: { _id: '6f0000000000000000000f01', agentId: REVIEWER, agentName: 'Reviewer' }, body: { data: { objId: { projectId: PROJECT, taskId: TASK_ID }, message: `${mention(REVIEWER)} loop`, type: 'text' } } }, r);
        await flush();
        expect(runRows()).toHaveLength(0);
    });
});

describe('@agent in a comment made over MCP', () => {
    const mcpActor = (userId, over = {}) => ({ kind: 'agent', userId, agentId: null, agentName: 'MCP', runId: null, viaAccount: 'personal', tokenId: 't1', ...over });

    it('starts the run for the person behind the call, under the same rules', async () => {
        await actions.executors['task.comment']({ companyId: A, actor: mcpActor(MEMBER), params: { taskId: TASK_ID, body: `${mention(REVIEWER)} from MCP` }, depth: 0 });
        await flush();
        expect(runRows()).toHaveLength(1);
        expect(runRows()[0]).toMatchObject({ trigger: 'mention', startedBy: MEMBER, triggerDepth: 1 });
    });

    it('starts nothing for a guest or from inside an agent run', async () => {
        await actions.executors['task.comment']({ companyId: A, actor: mcpActor(GUEST), params: { taskId: TASK_ID, body: `${mention(REVIEWER)} go` }, depth: 0 });
        await actions.executors['task.comment']({ companyId: A, actor: mcpActor(MEMBER, { runId: '6f0000000000000000000f01', agentId: REVIEWER }), params: { taskId: TASK_ID, body: `${mention(REVIEWER)} go` }, depth: 0 });
        await flush();
        expect(runRows()).toHaveLength(0);
    });
});

describe('assigning an agent from the task', () => {
    it('starts an assignment run and leaves the human assignees alone', async () => {
        const r = await assign(MEMBER);
        expect(r.body.status).toBe(true);
        expect(runRows()).toHaveLength(1);
        expect(runRows()[0]).toMatchObject({ agentId: REVIEWER, taskId: TASK_ID, trigger: 'assignment', startedBy: MEMBER });
        const stored = mockStores.a.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === TASK_ID);
        expect(stored.AssigneeUserId).toEqual([MEMBER]);
        expect(runs.executeSkill).toHaveBeenCalledTimes(1);
    });

    it.each([['a guest', GUEST], ['a member who cannot open the task', OUTSIDER]])('is refused for %s without saying why', async (label, uid) => {
        const r = await assign(uid);
        expect(r.code).toBe(404);
        expect(r.body.statusText).toBe('Task not found.');
        expect(runRows()).toHaveLength(0);
    });

    it('cannot start an agent of another company', async () => {
        const r = await assign(MEMBER, IN_B);
        expect(r.body.status).toBe(false);
        expect(runRows()).toHaveLength(0);
        expect(runRows(mockStores.b)).toHaveLength(0);
    });
});

describe('starting a run without a task', () => {
    it('says how a run can be started', async () => {
        const r = res();
        await agentsCtrl.startRun({ headers: { companyid: A }, uid: MEMBER, query: {}, params: {}, body: { agentId: REVIEWER } }, r);
        expect(r.code).toBe(400);
        expect(r.body.statusText).toMatch(/Assign the agent to a task, @mention it in a task comment/);
        expect(r.body.statusText).not.toMatch(/mention the agent in a comment\./);
    });
});
