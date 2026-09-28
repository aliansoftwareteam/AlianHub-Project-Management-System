/* Task 043 slice 7: @ai in a chat message answers in the conversation from its own messages and what the asker
   can open, and "Ask about this channel" answers the asker alone unless they choose to post it. */
process.env.STORAGE_TYPE = 'server';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-chat-ask';

const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const OTHER_COMPANY = '6a9954186dd786246031e400';
const CHAT_SPACE = '6a9954186dd786246031e47d';
const DM_SPRINT = '6a9954186dd786246031e47e';
const DM_TASK = '6a9954186dd786246031e47f';
const OTHER_DM_TASK = '6a9954186dd786246031e480';
const CHANNEL_PROJECT = '6a9954186dd786246031e481';
const CHANNEL = '6a9954186dd786246031e483';
const PRIVATE_CHANNEL = '6a9954186dd786246031e482';
const WORK_PROJECT = '6a9954186dd786246031e490';
const HIDDEN_PROJECT = '6a9954186dd786246031e491';
const ALICE_PROJECT = '6a9954186dd786246031e492';
const ALICE = '6f0000000000000000000d01';
const BOB = '6f0000000000000000000d02';
const CAROL = '6f0000000000000000000d03';

const mockDbs = {};
const mockDbFor = (companyId) => {
    const key = String(companyId);
    if (!mockDbs[key]) mockDbs[key] = create();
    return mockDbs[key];
};
const mockChat = jest.fn();

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
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (role) => role === 1 || role === 2 }));
jest.mock('../Config/projectAccess', () => ({
    canReadProject: jest.fn(async (companyId, uid, projectId) => (String(projectId) === '6a9954186dd786246031e481'
        ? { allowed: true }
        : { allowed: false, missing: true })),
}));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    ...jest.requireActual('../Modules/Sprints/helpers/sprintVisibility'),
    canSeeSprintById: jest.fn(async (companyId, uid, sprintId) => !(String(sprintId) === '6a9954186dd786246031e482' && String(uid) === '6f0000000000000000000d03')),
    hiddenSprintIds: jest.fn(async () => []),
}));
jest.mock('../utils/companyMembers', () => ({
    memberProfiles: jest.fn(async (companyId, ids) => [...new Set(ids.map(String))].map((id) => ({ _id: id, Employee_Name: { '6f0000000000000000000d01': 'Alice', '6f0000000000000000000d02': 'Bob', '6f0000000000000000000d03': 'Carol' }[id] }))),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjects: jest.fn(async (companyId, uid) => [
        { _id: '6a9954186dd786246031e490', ProjectName: 'Web' },
        ...(String(uid) === '6f0000000000000000000d01' ? [{ _id: '6a9954186dd786246031e492', ProjectName: 'Alice only' }] : []),
    ]),
}));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ userId: req.uid, runId: null })) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: (...args) => mockChat(...args) }),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { save } = require('../Modules/Comments/controller');
const aiMention = require('../Modules/AI/aiMention');
const { chatAskHandler, chatAskPostHandler } = require('../Modules/AI/chatAsk');

const oid = (id) => new mongoose.Types.ObjectId(id);
let seq = 0;
const at = () => new Date(Date.UTC(2026, 8, 28, 10, seq++));

const respond = () => {
    const r = { code: 200, body: undefined };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, body, companyId = COMPANY) => {
    const r = respond();
    await handler({ headers: { companyid: companyId }, uid, body, query: {}, params: {} }, r);
    return r;
};

const db = () => mockDbFor(COMPANY);
const comments = () => db().store[SCHEMA_TYPE.COMMENTS] || [];
const aiRows = () => comments().filter((c) => c.actorType === 'ai');
const promptSent = (n = 0) => mockChat.mock.calls[n][0].messages.map((m) => m.content).join('\n');

const seedMessage = (companyDb, { projectId, sprintId, taskId, userId, text }) => companyDb.seed(SCHEMA_TYPE.COMMENTS, {
    projectId: oid(projectId), sprintId: oid(sprintId), taskId, userId, message: text, type: 'text', project: false, createdAt: at(),
});

const channel = { projectId: CHANNEL_PROJECT, sprintId: CHANNEL, taskId: 'default' };
const dm = { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK };

const post = async (uid, message, thread) => {
    const r = await call(save, uid, { data: {
        message, type: 'text', project: false,
        ...(thread.taskId === 'default' ? { taskId: 'default' } : {}),
        objId: { projectId: thread.projectId, sprintId: thread.sprintId, ...(thread.taskId === 'default' ? {} : { taskId: thread.taskId }) },
    } });
    await aiMention.settled();
    return r;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    mockChat.mockReset();
    mockChat.mockResolvedValue({ content: 'We launch on Friday, as Bob said [WEB-7].', model: 'test-model', totalTokens: 12 });
    jest.clearAllMocks();
    delete process.env.AI_ENABLED;
    aiSwitch.forget();
    aiMention.resetLimits();

    const d = db();
    d.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT_SPACE, default: true });
    d.seed(SCHEMA_TYPE.SPRINTS, { _id: DM_SPRINT, projectId: oid(CHAT_SPACE) });
    d.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, projectId: oid(CHANNEL_PROJECT) });
    d.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_CHANNEL, projectId: oid(CHANNEL_PROJECT) });
    d.seed(SCHEMA_TYPE.TASKS, { _id: DM_TASK, ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, BOB] });
    d.seed(SCHEMA_TYPE.TASKS, { _id: OTHER_DM_TASK, ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, CAROL] });
    d.seed(SCHEMA_TYPE.TASKS, { ProjectID: WORK_PROJECT, TaskName: 'Launch pricing page', TaskKey: 'WEB-7', deletedStatusKey: 0, updatedAt: new Date() });
    d.seed(SCHEMA_TYPE.TASKS, { ProjectID: HIDDEN_PROJECT, TaskName: 'Launch merger secretly', TaskKey: 'SEC-1', deletedStatusKey: 0, updatedAt: new Date() });
    d.seed(SCHEMA_TYPE.TASKS, { ProjectID: ALICE_PROJECT, TaskName: 'Alpha acquisition plan', TaskKey: 'ALP-1', deletedStatusKey: 0, updatedAt: new Date() });
    [ALICE, BOB, CAROL].forEach((userId) => d.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, roleType: 3 }));

    seedMessage(d, { ...channel, userId: BOB, text: 'We agreed to launch pricing on Friday' });
    seedMessage(d, { ...dm, userId: BOB, text: 'The DM launch note' });
    seedMessage(d, { ...dm, taskId: OTHER_DM_TASK, userId: CAROL, text: 'a secret for Alice only' });
    seedMessage(d, { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default', userId: CAROL, text: 'private channel plans' });
    seedMessage(mockDbFor(OTHER_COMPANY), { ...channel, userId: BOB, text: 'another workspace launch' });
});

describe('@ai in a chat message', () => {
    it('answers a channel message with a following AI message that quotes it', async () => {
        const r = await post(ALICE, '@[AI](ai_ask) when do we launch?', channel);

        expect(r.code).toBe(200);
        expect(r.body.ai).toEqual({ queued: true });
        const [answer] = aiRows();
        expect(answer).toMatchObject({
            userId: 'ai', actorType: 'ai', aiAskerId: ALICE, aiQuestionId: String(r.body.data._id),
            taskId: 'default', hasReply: true, reply_id: String(r.body.data._id), reply_userId: ALICE, type: 'text',
        });
        expect(answer.parentId).toBeUndefined();
        expect(String(answer.projectId)).toBe(CHANNEL_PROJECT);
        expect(String(answer.sprintId)).toBe(CHANNEL);
        expect(answer.aiCitations).toEqual([expect.objectContaining({ kind: 'task', ref: 'WEB-7', projectId: WORK_PROJECT })]);

        const prompt = promptSent();
        expect(prompt).toContain('Bob: We agreed to launch pricing on Friday');
        expect(prompt).toContain('Launch pricing page');
        expect(prompt).not.toMatch(/DM launch note|secret for Alice|private channel plans|another workspace|SEC-1|merger/);
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'comments', companyId: COMPANY, data: expect.objectContaining({ actorType: 'ai' }) }));
    });

    it('never reads the asker\'s private AI profile for an answer the channel reads', async () => {
        db().seed(SCHEMA_TYPE.AI_PROFILES, { ownerId: ALICE, enabled: true, nickname: 'Captain Zed', facts: [{ id: 'f1', text: 'I am interviewing elsewhere', source: 'manual' }] });
        await post(ALICE, '@ai when do we launch?', channel);

        expect(promptSent()).not.toMatch(/Captain Zed|interviewing|ABOUT THE PERSON ASKING/);
    });

    it('never uses a project some channel members cannot open, even when the asker can', async () => {
        mockChat.mockImplementation(async (args) => ({ content: args.messages[0].content, model: 'echo' }));
        await post(ALICE, '@ai what about the alpha acquisition?', channel);

        const [answer] = aiRows();
        expect(answer).toBeTruthy();
        expect(answer.message).not.toMatch(/ALP-1|Alpha acquisition plan/);
        expect(promptSent()).not.toMatch(/ALP-1|Alpha acquisition/);
    });

    it('uses only what both people in a direct message can open', async () => {
        mockChat.mockImplementation(async (args) => ({ content: args.messages[0].content, model: 'echo' }));
        await post(ALICE, '@ai alpha acquisition or pricing launch?', dm);

        expect(promptSent()).toContain('WEB-7');
        expect(promptSent()).not.toMatch(/ALP-1|Alpha acquisition plan/);
        expect(aiRows()[0].message).not.toMatch(/ALP-1/);
    });

    it('answers in a direct message from that conversation only', async () => {
        await post(ALICE, '@ai what did Bob say about the launch?', dm);

        const [answer] = aiRows();
        expect(String(answer.taskId)).toBe(DM_TASK);
        expect(promptSent()).toContain('Bob: The DM launch note');
        expect(promptSent()).not.toMatch(/secret for Alice|We agreed to launch/);
    });

    it('never answers for someone outside the conversation', async () => {
        const r = await post(CAROL, '@ai what did they say?', dm);
        expect(r.code).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
        expect(aiRows()).toHaveLength(0);
    });
});

describe('Ask about this channel', () => {
    const askChannel = (uid, question, thread = channel, companyId = COMPANY) => call(chatAskHandler, uid, { ...thread, question }, companyId);

    it('answers the asker privately and writes nothing to the channel', async () => {
        const before = comments().length;
        const r = await askChannel(ALICE, 'when do we launch?');

        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(r.body.data.answer).toContain('Friday');
        expect(r.body.data.cited).toEqual([expect.objectContaining({ kind: 'task', ref: 'WEB-7' })]);
        expect(r.body.data.shareToken).toEqual(expect.any(String));
        expect(comments()).toHaveLength(before);
        expect(socketEmitter.emit).not.toHaveBeenCalledWith('insert', expect.anything());
        expect(promptSent()).toContain('Bob: We agreed to launch pricing on Friday');
        expect(promptSent()).not.toMatch(/private channel plans|another workspace|SEC-1/);
        expect(mockChat.mock.calls[0][0].spend).toEqual(expect.objectContaining({ feature: 'ask', companyId: COMPANY, userId: ALICE }));
    });

    it('shapes the private answer with the asker\'s own AI profile', async () => {
        db().seed(SCHEMA_TYPE.AI_PROFILES, { ownerId: ALICE, enabled: true, nickname: 'Captain Zed', facts: [] });
        await askChannel(ALICE, 'when do we launch?');
        expect(promptSent()).toContain('Captain Zed');
    });

    it('posts the same answer to the channel only when the asker chooses to', async () => {
        const { body: { data } } = await askChannel(ALICE, 'when do we launch?');
        const r = await call(chatAskPostHandler, ALICE, { ...channel, question: data.question, answer: data.answer, cited: data.cited, shareToken: data.shareToken });

        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        const [answer] = aiRows();
        expect(answer).toMatchObject({ userId: 'ai', actorType: 'ai', aiAskerId: ALICE, taskId: 'default', message: data.answer });
        expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('refuses to post a private answer built from items some members cannot see', async () => {
        mockChat.mockResolvedValue({ content: 'The alpha acquisition is on track [ALP-1].', model: 'test-model' });
        const { body: { data } } = await askChannel(ALICE, 'how is the alpha acquisition?');
        expect(promptSent()).toContain('ALP-1');
        expect(data.cited).toEqual([expect.objectContaining({ ref: 'ALP-1' })]);

        const r = await call(chatAskPostHandler, ALICE, { ...channel, question: data.question, answer: data.answer, cited: data.cited, shareToken: data.shareToken });
        expect(r.code).toBe(403);
        expect(r.body.code).toBe('not_shared');
        expect(r.body.statusText).toBe("This answer uses items some members can't see.");
        expect(aiRows()).toHaveLength(0);
    });

    it('refuses to post an answer that was changed, or someone else\'s', async () => {
        const { body: { data } } = await askChannel(ALICE, 'when do we launch?');
        const payload = { ...channel, question: data.question, answer: data.answer, cited: data.cited, shareToken: data.shareToken };

        const tampered = await call(chatAskPostHandler, ALICE, { ...payload, answer: 'We launch tomorrow, trust me.' });
        expect(tampered.code).toBe(403);
        const borrowed = await call(chatAskPostHandler, BOB, payload);
        expect(borrowed.code).toBe(403);
        const recited = await call(chatAskPostHandler, ALICE, { ...payload, cited: [{ kind: 'task', id: '6a9954186dd786246031e4ff', ref: 'SEC-1', projectId: HIDDEN_PROJECT }] });
        expect(recited.code).toBe(403);
        expect(aiRows()).toHaveLength(0);
    });

    it('refuses a channel the caller cannot see, before reading or calling anything', async () => {
        const r = await askChannel(CAROL, 'what are the plans?', { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default' });
        expect(r.code).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('refuses someone outside a direct message', async () => {
        const r = await askChannel(CAROL, 'what did they say?', dm);
        expect(r.code).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('calls no model while AI is off', async () => {
        process.env.AI_ENABLED = 'false';
        const r = await askChannel(ALICE, 'when do we launch?');
        expect(r.code).toBe(403);
        expect(r.body.code).toBe('ai_off');
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('stays inside the caller\'s workspace', async () => {
        await askChannel(ALICE, 'when do we launch?');
        const reads = db().calls.filter((c) => [SCHEMA_TYPE.COMMENTS, SCHEMA_TYPE.TASKS].includes(c.type));
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((c) => c.companyId === COMPANY)).toBe(true);
        expect(mockDbFor(OTHER_COMPANY).calls).toHaveLength(0);
    });

    it('needs a question', async () => {
        const r = await askChannel(ALICE, '   ');
        expect(r.code).toBe(400);
        expect(mockChat).not.toHaveBeenCalled();
    });
});
