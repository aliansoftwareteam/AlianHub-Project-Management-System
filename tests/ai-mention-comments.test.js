/* Task 043 slice 7: @ai in a task comment answers once, as a reply in that comment's thread, from what
   the asker can open, and the AI actor never starts anything or becomes someone a comment is assigned to. */
process.env.STORAGE_TYPE = 'server';

const mockDb = require('./fixtures/fakeMongo').create();
const mockChat = jest.fn();
const mockState = { configured: true };
const mockIds = {
    company: '6f0000000000000000000c01',
    project: '6f0000000000000000000701',
    hiddenProject: '6f0000000000000000000702',
    sprint: '6f0000000000000000000801',
    task: '6f0000000000000000000b01',
    hiddenTask: '6f0000000000000000000b02',
    author: '6f0000000000000000000a01',
    member: '6f0000000000000000000a02',
    outsider: '6f0000000000000000000a04',
    agent: '6f0000000000000000000a07',
};
const mockReaders = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 3),
    isPrivileged: (role) => role === 1 || role === 2,
}));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadAccess'),
    commentThreadAccess: jest.fn(async (companyId, uid, thread) => (
        String(companyId) === mockIds.company && (mockReaders[String(thread && thread.taskId)] || []).includes(String(uid))
            ? { allowed: true, match: {} }
            : { allowed: false, statusCode: 404 })),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjects: jest.fn(async () => [{ _id: '6f0000000000000000000701', ProjectName: 'Web' }]),
}));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ userId: req.uid, runId: req.agentRun ? 'run-1' : null })) }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => []) }));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => mockState.configured,
    getProvider: () => ({ chat: (...args) => mockChat(...args) }),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const triggers = require('../Modules/Agents/triggers');
const { save, update } = require('../Modules/Comments/controller');
const threads = require('../Modules/Comments/threads');
const T = require('../Modules/Comments/helpers/commentThreads');
const aiMention = require('../Modules/AI/aiMention');

const C = mockIds.company;
const oid = (id) => new mongoose.Types.ObjectId(id);

const res = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { body, query, companyId = C, extra = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: companyId }, uid, body: body || {}, query: query || {}, params: {}, ...extra }, r);
    return r;
};

const comments = () => mockDb.store[SCHEMA_TYPE.COMMENTS] || [];
const commentById = (id) => comments().find((c) => String(c._id) === String(id));
const repliesTo = (id) => comments().filter((c) => c.parentId && String(c.parentId) === String(id));
const aiRows = () => comments().filter((c) => c.actorType === 'ai');
const promptSent = (n = 0) => mockChat.mock.calls[n][0].messages.map((m) => m.content).join('\n');

const commentBody = (message, extra = {}) => ({ body: {
    data: {
        message,
        type: 'text',
        project: false,
        objId: { projectId: mockIds.project, sprintId: mockIds.sprint, taskId: mockIds.task },
        ...extra,
    },
} });
const ask = async (uid, question, extra) => {
    const r = await call(save, uid, { ...commentBody(`@[AI](ai_ask) ${question}`), ...(extra || {}) });
    await aiMention.settled();
    return r;
};

const ANSWER = 'The pricing page ships on Friday [WEB-7]. See also [SEC-1]. @ai again? @[Reviewer](agent_6f0000000000000000000a09)';

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.AI_ENABLED;
    aiSwitch.forget();
    aiMention.resetLimits();
    mockState.configured = true;
    mockChat.mockReset();
    mockChat.mockResolvedValue({ content: ANSWER, model: 'test-model', totalTokens: 42 });
    mockReaders[mockIds.task] = [mockIds.author, mockIds.member];
    mockReaders[mockIds.hiddenTask] = [mockIds.author];
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: mockIds.sprint, projectId: oid(mockIds.project) });
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: mockIds.task, ProjectID: mockIds.project, sprintId: mockIds.sprint, TaskName: 'Launch pricing page', TaskKey: 'WEB-7',
        rawDescription: 'Ship the new pricing tiers', statusType: 'active', deletedStatusKey: 0, updatedAt: new Date(),
    });
    mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id: mockIds.hiddenTask, ProjectID: mockIds.hiddenProject, TaskName: 'Pricing merger secret', TaskKey: 'SEC-1',
        rawDescription: 'Confidential pricing merger', deletedStatusKey: 0, updatedAt: new Date(),
    });
});

describe('@ai in a task comment', () => {
    it('saves the comment, then answers it once as a reply in its thread, authored by the AI for the asker', async () => {
        const r = await ask(mockIds.member, 'what is left on pricing?');

        expect(r.code).toBe(200);
        expect(r.body.ai).toEqual({ queued: true });
        const question = commentById(r.body.data._id);
        expect(question.userId).toBe(mockIds.member);

        const replies = repliesTo(question._id);
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({
            userId: 'ai', actorType: 'ai', aiAskerId: mockIds.member, aiQuestionId: String(question._id), type: 'text',
        });
        expect(String(replies[0].projectId)).toBe(mockIds.project);
        expect(String(replies[0].sprintId)).toBe(mockIds.sprint);
        expect(String(replies[0].taskId)).toBe(mockIds.task);
        expect(replies[0].message).toContain('[WEB-7]');
        expect(commentById(question._id).aiAsk).toMatchObject({ state: 'answered', askerId: mockIds.member, answerId: String(replies[0]._id) });

        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(mockChat.mock.calls[0][0].spend).toEqual(expect.objectContaining({ feature: 'ask', companyId: C, userId: mockIds.member }));
        expect(promptSent()).toContain('what is left on pricing?');
        expect(promptSent()).toContain('Launch pricing page');
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({
            module: 'comments', companyId: C, data: expect.objectContaining({ actorType: 'ai' }), actor: expect.objectContaining({ kind: 'system' }),
        }));
    });

    it('cites only sources the asker can open, as links, and never a ref it was not given', async () => {
        await ask(mockIds.member, 'pricing merger?');

        expect(promptSent()).not.toMatch(/SEC-1|merger secret|Confidential/);
        const [reply] = aiRows();
        expect(reply.aiCitations).toEqual([{ kind: 'task', id: mockIds.task, ref: 'WEB-7', projectId: mockIds.project }]);
    });

    it('never puts the asker\'s private AI profile into a reply others read', async () => {
        mockDb.seed(SCHEMA_TYPE.AI_PROFILES, {
            ownerId: mockIds.member, enabled: true, nickname: 'Captain Zed', preferences: 'Answer in haiku',
            facts: [{ id: 'f1', text: 'I am interviewing elsewhere', source: 'manual' }],
        });
        await ask(mockIds.member, 'what is left on pricing?');

        expect(promptSent()).not.toMatch(/Captain Zed|haiku|interviewing|ABOUT THE PERSON ASKING/);
        expect(aiRows()[0].message).not.toMatch(/Captain Zed|interviewing/);
    });

    it('leaves private-sprint work out of a reply, even in the task\'s own project', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: '6f0000000000000000000809', projectId: oid(mockIds.project), private: true, AssigneeUserId: [mockIds.member] });
        mockDb.seed(SCHEMA_TYPE.TASKS, {
            ProjectID: mockIds.project, sprintId: oid('6f0000000000000000000809'), TaskName: 'Pricing bonus pool', TaskKey: 'WEB-9',
            deletedStatusKey: 0, updatedAt: new Date(),
        });
        mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: mockIds.project, title: 'Pricing salary notes', visibility: 'private', createdBy: mockIds.member, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: mockIds.project, title: 'Pricing FAQ', visibility: 'project', deletedStatusKey: 0 });
        mockChat.mockImplementation(async (args) => ({ content: args.messages[0].content, model: 'echo' }));

        await ask(mockIds.member, 'pricing bonus?');

        expect(promptSent()).toContain('Pricing FAQ');
        expect(promptSent()).not.toMatch(/WEB-9|bonus pool|salary notes/);
        expect(aiRows()[0].message).not.toMatch(/WEB-9|bonus pool|salary notes/);
    });

    it('answers a comment only once, and an edit never asks again', async () => {
        const r = await ask(mockIds.member, 'what is left on pricing?');
        const saved = commentById(r.body.data._id);

        expect(await aiMention.acceptFromComment({ uid: mockIds.member, headers: { companyid: C } }, C, saved)).toBeNull();
        await aiMention.settled();

        const edited = await call(update, mockIds.member, { body: { id: String(saved._id), data: { message: '@[AI](ai_ask) and what about the docs?' } } });
        expect(edited.code).toBe(200);
        await aiMention.settled();

        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(aiRows()).toHaveLength(1);
    });

    it('does not start agents or another answer from what the AI wrote', async () => {
        await ask(mockIds.member, 'what is left on pricing?');

        expect(aiRows()[0].message).toContain('agent_6f0000000000000000000a09');
        expect(triggers.fromComment).not.toHaveBeenCalled();
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(aiRows()).toHaveLength(1);
    });

    it('is not answered for a comment an agent run posts', async () => {
        const r = await ask(mockIds.member, 'what is left?', { extra: { agentRun: { _id: 'run-1' } } });
        expect(r.code).toBe(200);
        expect(r.body.ai).toBeUndefined();
        expect(mockChat).not.toHaveBeenCalled();
        expect(aiRows()).toHaveLength(0);
    });

    it('re-checks the asker\'s access before answering', async () => {
        const r = await call(save, mockIds.member, commentBody('@[AI](ai_ask) what is left?'));
        expect(r.body.ai).toEqual({ queued: true });
        mockReaders[mockIds.task] = [mockIds.author];
        await aiMention.settled();

        expect(mockChat).not.toHaveBeenCalled();
        expect(aiRows()).toHaveLength(0);
        expect(commentById(r.body.data._id).aiAsk).toMatchObject({ state: 'failed' });
    });

    it('limits how often one person can ask', async () => {
        for (let i = 0; i < aiMention.AI_MENTION_LIMIT; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            expect((await ask(mockIds.member, `question ${i} on pricing`)).body.ai).toEqual({ queued: true });
        }
        const limited = await ask(mockIds.member, 'one more on pricing');
        expect(limited.code).toBe(200);
        expect(limited.body.ai).toEqual({ code: 'rate_limited' });
        expect(mockChat).toHaveBeenCalledTimes(aiMention.AI_MENTION_LIMIT);

        expect((await ask(mockIds.author, 'mine on pricing')).body.ai).toEqual({ queued: true });
    });

    it('posts nothing and calls no model while AI is off, and tells the asker', async () => {
        process.env.AI_ENABLED = 'false';
        const r = await ask(mockIds.member, 'what is left?');

        expect(r.code).toBe(200);
        expect(r.body.ai).toEqual({ code: 'ai_off' });
        expect(comments()).toHaveLength(1);
        expect(commentById(r.body.data._id).aiAsk).toBeUndefined();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('calls no model when none is configured', async () => {
        mockState.configured = false;
        const r = await ask(mockIds.member, 'what is left?');
        expect(r.body.ai).toEqual({ code: 'unconfigured' });
        expect(mockChat).not.toHaveBeenCalled();
        expect(aiRows()).toHaveLength(0);
    });

    it('ignores a comment that does not mention the AI', async () => {
        const r = await call(save, mockIds.member, commentBody('email me at me@ai.example or ping @aiden'));
        await aiMention.settled();
        expect(r.body.ai).toBeUndefined();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('answers a typed @ai as well as the picked mention', async () => {
        const r = await call(save, mockIds.member, commentBody('@ai what is left on pricing?'));
        await aiMention.settled();
        expect(r.body.ai).toEqual({ queued: true });
        expect(repliesTo(r.body.data._id)).toHaveLength(1);
    });

    it('keeps every read and write inside the asker\'s workspace', async () => {
        await ask(mockIds.member, 'what is left on pricing?');
        const scoped = mockDb.calls.filter((c) => [SCHEMA_TYPE.COMMENTS, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.PAGES].includes(c.type));
        expect(scoped.length).toBeGreaterThan(0);
        expect(scoped.every((c) => c.companyId === C)).toBe(true);
    });
});

describe('the AI actor', () => {
    it('can never be assigned a comment', async () => {
        await ask(mockIds.member, 'what is left on pricing?');
        const [reply] = aiRows();

        expect(await T.canBeAssigned(C, 'ai', reply)).toBe(false);
        const r = await call(threads.assign, mockIds.member, { body: { id: String(reply._id), assigneeId: 'ai' } });
        expect(r.code).toBe(400);
        expect(commentById(reply._id).assigneeId).toBeUndefined();
    });

    it('cannot be claimed by a client posting or editing a comment', async () => {
        const forged = { actorType: 'ai', aiAskerId: mockIds.author, aiQuestionId: 'x', aiCitations: [{ kind: 'task', id: mockIds.hiddenTask, ref: 'SEC-1' }], aiAsk: { state: 'answered' } };
        const r = await call(save, mockIds.member, commentBody('plain words', forged));
        const stored = commentById(r.body.data._id);
        ['aiAskerId', 'aiQuestionId', 'aiCitations', 'aiAsk'].forEach((field) => expect(stored[field]).toBeUndefined());
        expect(stored.actorType).not.toBe('ai');

        await call(update, mockIds.member, { body: { id: String(stored._id), data: forged } });
        const edited = commentById(stored._id);
        ['aiAskerId', 'aiQuestionId', 'aiCitations', 'aiAsk'].forEach((field) => expect(edited[field]).toBeUndefined());
        expect(edited.actorType).not.toBe('ai');
    });
});
