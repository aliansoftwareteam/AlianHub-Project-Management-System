/* Task 041 slice 1: the chat header's Summarize reads a conversation through the same thread rule
   the transcript itself is read with, so a summary can never show what the caller could not scroll to. */
const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const OTHER_COMPANY = '6a9954186dd786246031e400';
const CHAT_SPACE = '6a9954186dd786246031e47d';
const DM_SPRINT = '6a9954186dd786246031e47e';
const DM_TASK = '6a9954186dd786246031e47f';
const OTHER_DM_TASK = '6a9954186dd786246031e480';
const CHANNEL_PROJECT = '6a9954186dd786246031e481';
const PRIVATE_CHANNEL = '6a9954186dd786246031e482';
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
jest.mock('../Config/projectAccess', () => ({
    canReadProject: jest.fn(async (companyId, uid, projectId) => (String(projectId) === '6a9954186dd786246031e481'
        ? { allowed: true }
        : { allowed: false, missing: true })),
}));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    canSeeSprintById: jest.fn(async (companyId, uid, sprintId) => !(String(sprintId) === '6a9954186dd786246031e482' && String(uid) === '6f0000000000000000000d03')),
    hiddenSprintIds: jest.fn(async () => []),
}));
jest.mock('../utils/companyMembers', () => ({
    memberProfiles: jest.fn(async (companyId, ids) => [...new Set(ids.map(String))].map((id) => ({ _id: id, Employee_Name: { '6f0000000000000000000d01': 'Alice', '6f0000000000000000000d02': 'Bob', '6f0000000000000000000d03': 'Carol' }[id] }))),
}));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: (...args) => mockChat(...args) }),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { memberProfiles } = require('../utils/companyMembers');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { chatSummaryHandler } = require('../Modules/AI/chatSummary');

const oid = (id) => new mongoose.Types.ObjectId(id);
let seq = 0;
const at = () => new Date(Date.UTC(2026, 8, 28, 10, seq++));
const message = (companyDb, { projectId = CHAT_SPACE, sprintId = DM_SPRINT, taskId = DM_TASK, userId = ALICE, text, ...extra }) => companyDb.seed(SCHEMA_TYPE.COMMENTS, {
    projectId: oid(projectId), sprintId: oid(sprintId), taskId, userId, message: text, type: 'text', createdAt: at(), ...extra,
});

const respond = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.send = jest.fn(() => res);
    return res;
};
const statusOf = (res) => (res.status.mock.calls.length ? res.status.mock.calls[res.status.mock.calls.length - 1][0] : 200);
const bodyOf = (res) => {
    const calls = [...res.json.mock.calls, ...res.send.mock.calls];
    return calls.length ? calls[calls.length - 1][0] : undefined;
};

const summarize = async (uid, body, companyId = COMPANY) => {
    const res = respond();
    await chatSummaryHandler({ headers: companyId ? { companyid: companyId } : {}, uid, body }, res);
    return { status: statusOf(res), body: bodyOf(res) };
};

const promptSent = () => mockChat.mock.calls[0][0].messages[0].content;
const commentReads = () => Object.values(mockDbs).flatMap((db) => db.calls).filter((call) => call.type === SCHEMA_TYPE.COMMENTS);

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    mockChat.mockReset();
    mockChat.mockResolvedValue({ content: JSON.stringify({ summary: 'Alice will ship on Friday.', actionItems: [{ title: 'Ship the release', owner: 'Alice', due: 'Fri' }] }) });
    memberProfiles.mockClear();
    delete process.env.AI_ENABLED;
    aiSwitch.forget();

    const db = mockDbFor(COMPANY);
    db.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT_SPACE, default: true });
    db.seed(SCHEMA_TYPE.TASKS, { _id: DM_TASK, ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, BOB] });
    db.seed(SCHEMA_TYPE.TASKS, { _id: OTHER_DM_TASK, ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, CAROL] });
    message(db, { text: 'I will ship the release on Friday' });
    message(db, { userId: BOB, text: 'Great, &lt;b&gt;thanks&lt;/b&gt; [Alice](6f0000000000000000000d01)' });
    message(db, { userId: BOB, text: 'this was deleted', isDeleted: true });
    message(db, { userId: BOB, type: 'image', text: '', mediaURL: 'Project/x.png' });
    message(db, { taskId: OTHER_DM_TASK, userId: CAROL, text: 'a secret for Alice only' });
    message(db, { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default', userId: ALICE, text: 'private channel plans' });

    message(mockDbFor(OTHER_COMPANY), { userId: BOB, text: 'another workspace talking' });
});

describe('POST /api/v1/ai/chat-summary', () => {
    test('a participant gets a summary built from that conversation only', async () => {
        const { status, body } = await summarize(ALICE, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK });

        expect(status).toBe(200);
        expect(body.status).toBe(true);
        expect(body.data.summary).toBe('Alice will ship on Friday.');
        expect(body.data.actionItems).toEqual([expect.objectContaining({ title: 'Ship the release', owner: 'Alice', due: 'Fri' })]);
        expect(body.data.messageCount).toBe(2);

        const prompt = promptSent();
        expect(prompt).toContain('Alice: I will ship the release on Friday');
        expect(prompt).toContain('Bob: Great, <b>thanks</b> @Alice');
        expect(prompt).not.toMatch(/deleted|secret|another workspace|private channel/);
        expect(mockChat.mock.calls[0][0].spend).toEqual(expect.objectContaining({ companyId: COMPANY, userId: ALICE }));
    });

    test('every read stays inside the caller\'s workspace', async () => {
        await summarize(ALICE, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK });

        expect(commentReads().length).toBeGreaterThan(0);
        expect(commentReads().every((call) => call.companyId === COMPANY)).toBe(true);
        expect(mockDbFor(OTHER_COMPANY).calls).toHaveLength(0);
        expect(memberProfiles.mock.calls.every(([companyId]) => companyId === COMPANY)).toBe(true);
    });

    test('someone outside a direct message is refused and nothing is read or sent', async () => {
        const { status, body } = await summarize(CAROL, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK });

        expect(status).toBe(404);
        expect(body.status).toBe(false);
        expect(commentReads()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('a private channel the caller cannot see is refused', async () => {
        const { status } = await summarize(CAROL, { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default' });

        expect(status).toBe(404);
        expect(commentReads()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('a channel member gets the channel thread', async () => {
        const { status, body } = await summarize(ALICE, { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default' });

        expect(status).toBe(200);
        expect(body.data.messageCount).toBe(1);
        expect(promptSent()).toContain('Alice: private channel plans');
    });

    test('AI turned off for the instance stops the call before any message is read', async () => {
        process.env.AI_ENABLED = 'false';
        const { status, body } = await summarize(ALICE, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK });

        expect(status).toBe(403);
        expect(body).toEqual(expect.objectContaining({ status: false, code: aiSwitch.AI_OFF }));
        expect(commentReads()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('an empty conversation answers without calling a model', async () => {
        mockDbFor(COMPANY).store[SCHEMA_TYPE.COMMENTS].length = 0;
        const empty = await summarize(ALICE, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK });
        expect(empty.status).toBe(200);
        expect(empty.body.data).toEqual(expect.objectContaining({ summary: '', actionItems: [], messageCount: 0 }));
        expect(mockChat).not.toHaveBeenCalled();
    });

    test.each([
        ['no sprint', { projectId: CHAT_SPACE, taskId: DM_TASK }],
        ['no conversation', { projectId: CHAT_SPACE, sprintId: DM_SPRINT }],
        ['a made-up conversation id', { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: 'everything' }],
        ['an object as the project id', { projectId: { $ne: null }, sprintId: DM_SPRINT, taskId: DM_TASK }],
    ])('%s is a bad request', async (label, body) => {
        const result = await summarize(ALICE, body);
        expect(result.status).toBe(400);
        expect(commentReads()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('a request without a workspace is refused', async () => {
        const result = await summarize(ALICE, { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK }, '');
        expect(result.status).toBe(400);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('the route is registered on the AI module', () => {
        const routes = [];
        const app = {};
        ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((method) => {
            app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
        });
        require('../Modules/AI/routes').init(app);
        const route = routes.find((r) => r.method === 'post' && r.path === '/api/v1/ai/chat-summary');
        expect(route).toBeDefined();
        expect(route.handlers).toContain(chatSummaryHandler);
    });
});
