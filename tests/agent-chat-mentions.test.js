/* Task 045 slice 13: an agent @named in chat answers in the conversation, and a person can message an agent
   directly. A channel reply uses only what every reader can open; a direct message uses what its one reader can. */
process.env.STORAGE_TYPE = 'server';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent-chat';

const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const CHAT_SPACE = '6a9954186dd786246031e47d';
const DM_SPRINT = '6a9954186dd786246031e47e';
const PEOPLE_DM = '6a9954186dd786246031e47f';
const CHANNEL_PROJECT = '6a9954186dd786246031e481';
const CHANNEL = '6a9954186dd786246031e483';
const PRIVATE_CHANNEL = '6a9954186dd786246031e482';
const WORK_PROJECT = '6a9954186dd786246031e490';
const HIDDEN_PROJECT = '6a9954186dd786246031e491';
const ALICE_PROJECT = '6a9954186dd786246031e492';
const WEB_TASK = '6a9954186dd786246031e4a1';
const ALPHA_TASK = '6a9954186dd786246031e4a2';
const ALICE = '6f0000000000000000000d01';
const BOB = '6f0000000000000000000d02';
const CAROL = '6f0000000000000000000d03';
const GUEST = '6f0000000000000000000d04';
const HELPER = '6f0000000000000000000a01';
const PAUSED = '6f0000000000000000000a02';
const ELSEWHERE = '6f0000000000000000000a03';
const CAPPED = '6f0000000000000000000a04';

const mockDbs = {};
const mockDbFor = (companyId) => {
    const key = String(companyId);
    if (!mockDbs[key]) mockDbs[key] = create();
    return mockDbs[key];
};
const mockChat = jest.fn();
const mockActor = { runId: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => mockDbFor(companyId).crud(companyId, ...rest),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (String(uid) === '6f0000000000000000000d04' ? 0 : 3)),
    isPrivileged: (role) => role === 1 || role === 2,
    evaluatePermission: jest.fn(async (companyId, uid) => String(uid) !== '6f0000000000000000000d03'),
    isWritable: (permission) => permission === true,
}));
jest.mock('../Config/projectAccess', () => ({
    canReadProject: jest.fn(async (companyId, uid, projectId) => (String(projectId) === '6a9954186dd786246031e481'
        ? { allowed: true }
        : { allowed: false, missing: true })),
}));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    ...jest.requireActual('../Modules/Sprints/helpers/sprintVisibility'),
    canSeeSprintById: jest.fn(async (companyId, uid, sprintId) => !(String(sprintId) === '6a9954186dd786246031e482' && String(uid) === '6f0000000000000000000d03')),
    hiddenSprintIds: jest.fn(async () => []),
    hiddenSprintFilter: jest.fn(async () => ({})),
}));
jest.mock('../utils/companyMembers', () => ({
    memberProfiles: jest.fn(async (companyId, ids) => [...new Set(ids.map(String))].map((id) => ({ _id: id, Employee_Name: { '6f0000000000000000000d01': 'Alice', '6f0000000000000000000d02': 'Bob', '6f0000000000000000000d03': 'Carol' }[id] }))),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjects: jest.fn(async (companyId, uid) => [
        { _id: '6a9954186dd786246031e490', ProjectName: 'Web' },
        ...(String(uid) === '6f0000000000000000000d01' ? [{ _id: '6a9954186dd786246031e492', ProjectName: 'Alice only' }] : []),
    ]),
    visibleProjectIds: jest.fn(async (companyId, uid) => ['6a9954186dd786246031e490', ...(String(uid) === '6f0000000000000000000d01' ? ['6a9954186dd786246031e492'] : [])]),
}));
jest.mock('../Modules/Agents/actor', () => ({
    ...jest.requireActual('../Modules/Agents/actor'),
    resolveActor: jest.fn(async (req) => ({ kind: 'human', userId: req.uid, runId: mockActor.runId })),
}));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ name: 'test', model: 'test-model', chat: (...args) => mockChat(...args) }),
}));
jest.mock('../Modules/AICore/usage', () => ({
    ...jest.requireActual('../Modules/AICore/usage'),
    checkConfiguredModelPriced: () => ({ ok: true, reason: '' }),
    summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 10, model: 'test-model', priced: true })),
}));
jest.mock('../Modules/Agents/budget', () => ({
    check: jest.fn(async () => ({ ok: true, reason: '' })),
    headroom: jest.fn(async () => ({ budgetUsd: 0, usedUsd: 0, reservedUsd: 0 })),
    alertIfCrossed: jest.fn(async () => null),
}));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publishGuideSaved: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { save } = require('../Modules/Comments/controller');
const chatAgents = require('../Modules/Agents/chatAgents');
const chatCtrl = require('../Modules/Agents/chatController');

// chatAgents loads these on first use; loading them here keeps that cost out of the first test's timeout.
['../Modules/Agents/runs', '../Modules/Agents/actions', '../Modules/Agents/proposals', '../Modules/AI/ask', '../Modules/AI/aiMention', '../Modules/AICore/modelCall', '../Modules/Agents/skillRecord']
    .forEach((path) => require(path));

const oid = (id) => new mongoose.Types.ObjectId(id);
let seq = 0;
const at = () => new Date(Date.UTC(2026, 8, 30, 10, seq++));

const respond = () => {
    const r = { code: 200, body: undefined };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { body = {}, query = {} } = {}) => {
    const r = respond();
    await handler({ headers: { companyid: COMPANY }, uid, body, query, params: {} }, r);
    return r;
};

const db = () => mockDbFor(COMPANY);
const rows = (type) => db().store[type] || [];
const agentReplies = () => rows(SCHEMA_TYPE.COMMENTS).filter((c) => c.actorType === 'agent');
const chatRuns = () => rows(SCHEMA_TYPE.AGENT_RUNS);
const promptSent = (n = 0) => mockChat.mock.calls[n][0].messages.map((m) => m.content).join('\n');
const mention = (id, name = 'Helper') => `@[${name}](agent_${id})`;

const seedMessage = ({ projectId, sprintId, taskId, userId, text }) => db().seed(SCHEMA_TYPE.COMMENTS, {
    projectId: oid(projectId), sprintId: oid(sprintId), taskId, userId, message: text, type: 'text', project: false, createdAt: at(),
});

const channel = { projectId: CHANNEL_PROJECT, sprintId: CHANNEL, taskId: 'default' };
const privateChannel = { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default' };

const post = async (uid, message, thread) => {
    const r = await call(save, uid, { body: { data: {
        message, type: 'text', project: false,
        ...(thread.taskId === 'default' ? { taskId: 'default' } : {}),
        objId: { projectId: thread.projectId, sprintId: thread.sprintId, ...(thread.taskId === 'default' ? {} : { taskId: thread.taskId }) },
    } } });
    await chatAgents.settled();
    return r;
};

const reply = (content) => ({ content: JSON.stringify(content), model: 'test-model', inputTokens: 5, outputTokens: 5 });

const agentRow = (over) => ({
    autonomy: 1, allowedActions: [], account: 'workspace', spendCapUsd: 10, paused: false, deletedStatusKey: 0, projectIds: [],
    skills: [{ key: 'qa-review', name: 'QA', enabled: true }], description: 'Answers questions about the web launch.', ...over,
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    mockChat.mockReset();
    mockChat.mockResolvedValue(reply({ reply: 'We launch on Friday [WEB-7].', changes: [] }));
    jest.clearAllMocks();
    mockActor.runId = null;
    delete process.env.AI_ENABLED;
    aiSwitch.forget();

    const d = db();
    d.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT_SPACE, default: true, ProjectName: 'Direct', ProjectCode: 'DM', taskStatusData: [{ name: 'Open', key: 1, value: 'open', type: 'default_active' }], taskTypeCounts: [{ value: 'Task', key: 1 }] });
    d.seed(SCHEMA_TYPE.SPRINTS, { _id: DM_SPRINT, projectId: oid(CHAT_SPACE), name: 'Direct' });
    d.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, projectId: oid(CHANNEL_PROJECT) });
    d.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_CHANNEL, projectId: oid(CHANNEL_PROJECT) });
    d.seed(SCHEMA_TYPE.TASKS, { _id: PEOPLE_DM, ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, BOB] });
    d.seed(SCHEMA_TYPE.TASKS, { _id: WEB_TASK, ProjectID: WORK_PROJECT, TaskName: 'Launch pricing page', TaskKey: 'WEB-7', deletedStatusKey: 0, updatedAt: new Date() });
    d.seed(SCHEMA_TYPE.TASKS, { ProjectID: HIDDEN_PROJECT, TaskName: 'Launch merger secretly', TaskKey: 'SEC-1', deletedStatusKey: 0, updatedAt: new Date() });
    d.seed(SCHEMA_TYPE.TASKS, { _id: ALPHA_TASK, ProjectID: ALICE_PROJECT, TaskName: 'Alpha acquisition plan', TaskKey: 'ALP-1', deletedStatusKey: 0, updatedAt: new Date() });
    [ALICE, BOB, CAROL].forEach((userId) => d.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, roleType: 3 }));

    d.seed(SCHEMA_TYPE.AGENTS, { _id: HELPER, name: 'Helper', ...agentRow({}) });
    d.seed(SCHEMA_TYPE.AGENTS, { _id: PAUSED, name: 'Sleeper', ...agentRow({ paused: true }) });
    d.seed(SCHEMA_TYPE.AGENTS, { _id: ELSEWHERE, name: 'Hidden helper', ...agentRow({ projectIds: [HIDDEN_PROJECT] }) });
    d.seed(SCHEMA_TYPE.AGENTS, { _id: CAPPED, name: 'Spent', ...agentRow({ spendCapUsd: 1, spendMonth: { month: new Date().toISOString().slice(0, 7), usd: 1 } }) });

    seedMessage({ ...channel, userId: BOB, text: 'We agreed to launch pricing on Friday' });
    seedMessage({ ...privateChannel, userId: CAROL, text: 'private channel plans' });
});

describe('the chat mention picker', () => {
    it('lists only the agents the person may use in that conversation', async () => {
        const r = await call(chatCtrl.usableAgents, ALICE, { query: channel });
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((a) => a.name)).toEqual(['Helper', 'Spent']);
        expect(r.body.data[0]).toEqual({ _id: HELPER, name: 'Helper', description: 'Answers questions about the web launch.', autonomy: 1 });
    });

    it('lists nothing for a guest, a conversation the person cannot open, or while AI is off', async () => {
        expect((await call(chatCtrl.usableAgents, GUEST, { query: channel })).body.data).toEqual([]);
        expect((await call(chatCtrl.usableAgents, CAROL, { query: privateChannel })).body.data).toEqual([]);
        process.env.AI_ENABLED = 'false';
        aiSwitch.forget();
        expect((await call(chatCtrl.usableAgents, ALICE, { query: channel })).body.data).toEqual([]);
    });
});

describe('@agent in a chat channel', () => {
    it('runs the agent on the message and replies in the channel, quoting it', async () => {
        const r = await post(ALICE, `${mention(HELPER)} when do we launch?`, channel);

        expect(r.code).toBe(200);
        expect(r.body.agents).toEqual([expect.objectContaining({ agentId: HELPER, started: true })]);
        const [run] = chatRuns();
        expect(run).toMatchObject({ agentId: HELPER, kind: 'chat', trigger: 'mention', startedBy: ALICE, status: 'done' });
        const [answer] = agentReplies();
        expect(answer).toMatchObject({
            actorType: 'agent', isAgent: true, agentId: HELPER, agentName: 'Helper', runId: String(run._id), userId: `agent_${HELPER}`,
            taskId: 'default', hasReply: true, reply_id: String(r.body.data._id), reply_userId: ALICE, type: 'text',
        });
        expect(String(answer.projectId)).toBe(CHANNEL_PROJECT);
        expect(String(answer.sprintId)).toBe(CHANNEL);
        expect(answer.message).toContain('We launch on Friday');
        expect(answer.agentCitations).toEqual([expect.objectContaining({ kind: 'task', ref: 'WEB-7', projectId: WORK_PROJECT })]);

        const question = rows(SCHEMA_TYPE.COMMENTS).find((c) => String(c._id) === String(r.body.data._id));
        expect(question.agentAsk).toMatchObject({ state: 'answered', agentIds: [HELPER] });

        const prompt = promptSent();
        expect(prompt).toContain('Bob: We agreed to launch pricing on Friday');
        expect(prompt).toContain('Launch pricing page');
        expect(mockChat.mock.calls[0][0].systemPrompt).toContain('Helper');
        expect(mockChat.mock.calls[0][0].spend).toEqual(expect.objectContaining({ feature: 'agent_run', companyId: COMPANY, runId: String(run._id), agentId: HELPER }));
    });

    it('never uses what one channel member cannot open, even when the asker can', async () => {
        mockChat.mockImplementation(async (args) => reply({ reply: args.messages[0].content.slice(0, 4000), changes: [] }));
        await post(ALICE, `${mention(HELPER)} how is the alpha acquisition going?`, channel);

        expect(promptSent()).not.toMatch(/ALP-1|Alpha acquisition plan|SEC-1|merger/);
        const [answer] = agentReplies();
        expect(answer).toBeTruthy();
        expect(answer.message).not.toMatch(/ALP-1|Alpha acquisition plan/);
    });

    it('does not start an agent the person may not use, a paused one, or one past its spend cap', async () => {
        const r = await post(ALICE, `${mention(ELSEWHERE, 'Hidden helper')} ${mention(PAUSED, 'Sleeper')} ${mention(CAPPED, 'Spent')} status?`, channel);

        expect(r.body.agents).toEqual([expect.objectContaining({ agentId: CAPPED, started: false })]);
        expect(chatRuns()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
        expect(agentReplies()).toHaveLength(0);
    });

    it('never answers for a guest or someone outside the channel', async () => {
        await post(GUEST, `${mention(HELPER)} when do we launch?`, channel);
        const outside = await post(CAROL, `${mention(HELPER)} what are the plans?`, privateChannel);

        expect(outside.code).toBe(404);
        expect(chatRuns()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('never triggers on an agent\'s own message or another agent\'s', async () => {
        mockActor.runId = '6f0000000000000000000e01';
        await post(ALICE, `${mention(HELPER)} ping`, channel);
        expect(chatRuns()).toHaveLength(0);

        mockActor.runId = null;
        mockChat.mockResolvedValue(reply({ reply: `Asking ${mention(HELPER)} again`, changes: [] }));
        await post(ALICE, `${mention(HELPER)} ping`, channel);
        const [answer] = agentReplies();
        expect(await chatAgents.fromChatMessage({ headers: {}, uid: ALICE }, COMPANY, answer)).toBeNull();
        await chatAgents.settled();
        expect(chatRuns()).toHaveLength(1);
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('proposes the changes it suggests below L2 instead of making them', async () => {
        db().store[SCHEMA_TYPE.AGENTS].find((a) => String(a._id) === HELPER).projectIds = [WORK_PROJECT];
        mockChat.mockResolvedValue(reply({
            reply: 'I can add a check for the pricing copy [WEB-7].',
            changes: [
                { action: 'subtask.create', label: 'Check the pricing copy', params: { taskId: WEB_TASK, title: 'Check the pricing copy' } },
                { action: 'subtask.create', label: 'Plan the alpha', params: { taskId: ALPHA_TASK, title: 'Plan the alpha' } },
                { action: 'task.status.set', label: 'Close it', params: { taskId: WEB_TASK, status: { name: 'Done', statusType: 'close' } } },
            ],
        }));
        await post(ALICE, `${mention(HELPER)} can you add a copy check to the launch?`, channel);

        const proposals = rows(SCHEMA_TYPE.AGENT_PROPOSALS);
        expect(proposals).toHaveLength(1);
        expect(proposals[0]).toMatchObject({ agentId: HELPER, projectId: WORK_PROJECT, status: 'pending' });
        expect(proposals[0].changes).toEqual([expect.objectContaining({ action: 'subtask.create', params: { taskId: WEB_TASK, title: 'Check the pricing copy' } })]);
        expect(rows(SCHEMA_TYPE.TASKS).filter((t) => t.TaskName === 'Check the pricing copy')).toHaveLength(0);
        const [run] = chatRuns();
        expect(run.status).toBe('waiting_approval');
        expect(run.proposals).toEqual([String(proposals[0]._id)]);
        expect(agentReplies()[0].agentChanges).toEqual([{ action: 'subtask.create', label: 'Check the pricing copy', outcome: 'proposed', proposalId: String(proposals[0]._id) }]);
    });
});

describe('a direct message with an agent', () => {
    const openDirect = (uid, agentId) => call(chatCtrl.openDirect, uid, { body: { agentId } });

    it('opens one conversation per person and agent, read by that person alone', async () => {
        const first = await openDirect(ALICE, HELPER);
        const again = await openDirect(ALICE, HELPER);

        expect(first.body.status).toBe(true);
        expect(again.body.data._id).toBe(first.body.data._id);
        const conversation = rows(SCHEMA_TYPE.TASKS).find((t) => String(t._id) === String(first.body.data._id));
        expect(conversation).toMatchObject({ mainChat: true, agentId: HELPER, agentName: 'Helper', AssigneeUserId: [ALICE], ProjectID: CHAT_SPACE });
        expect(String(conversation.sprintId)).toBe(DM_SPRINT);
    });

    it('refuses an agent the person may not use, and anyone who may not send direct messages', async () => {
        expect((await openDirect(ALICE, ELSEWHERE)).code).toBe(404);
        expect((await openDirect(ALICE, PAUSED)).code).toBe(404);
        expect((await openDirect(GUEST, HELPER)).code).toBe(404);
        expect((await openDirect(CAROL, HELPER)).code).toBe(404);
    });

    it('runs the agent on every message, with what that person can open, and replies in the conversation', async () => {
        const { body: { data: conversation } } = await openDirect(ALICE, HELPER);
        const dm = { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: String(conversation._id) };
        mockChat.mockImplementation(async (args) => reply({ reply: 'The alpha plan is on track [ALP-1].', changes: [], echo: args.messages[0].content }));
        await post(ALICE, 'how is the alpha acquisition going?', dm);

        expect(promptSent()).toContain('ALP-1');
        const [run] = chatRuns();
        expect(run).toMatchObject({ agentId: HELPER, kind: 'chat', trigger: 'direct', startedBy: ALICE });
        const [answer] = agentReplies();
        expect(String(answer.taskId)).toBe(String(conversation._id));
        expect(answer.agentCitations).toEqual([expect.objectContaining({ ref: 'ALP-1' })]);
    });

    it('never answers in a conversation someone else also reads, however it names the agent', async () => {
        db().seed(SCHEMA_TYPE.TASKS, { _id: '6a9954186dd786246031e4f0', ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, BOB], agentId: HELPER });
        await post(ALICE, 'how is the alpha acquisition going?', { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: '6a9954186dd786246031e4f0' });

        expect(chatRuns()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('answers an @mention in a direct message between people with only what both can open', async () => {
        mockChat.mockImplementation(async (args) => reply({ reply: 'ok', changes: [], echo: args.messages[0].content }));
        await post(ALICE, `${mention(HELPER)} alpha acquisition or pricing launch?`, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: PEOPLE_DM });

        expect(promptSent()).toContain('WEB-7');
        expect(promptSent()).not.toMatch(/ALP-1|Alpha acquisition plan/);
    });
});
