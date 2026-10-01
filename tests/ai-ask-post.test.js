process.env.STORAGE_TYPE = 'server';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ask-post';

const mockDb = require('./fixtures/fakeMongo').create();
const mockChat = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (role) => role === 1 || role === 2 }));
jest.mock('../Config/projectAccess', () => ({ canReadProject: jest.fn(async () => ({ allowed: false, missing: true })) }));
jest.mock('../Modules/Sprints/helpers/sprintVisibility', () => ({
    ...jest.requireActual('../Modules/Sprints/helpers/sprintVisibility'),
    canSeeSprintById: jest.fn(async (companyId, uid, sprintId) => !(String(sprintId) === '6a9954186dd786246031e482' && String(uid) !== '6f0000000000000000000d03')),
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
    visibleProjectIds: jest.fn(async () => ['6a9954186dd786246031e490']),
}));
jest.mock('../Modules/AICore/llmProvider', () => ({ isAnyProviderConfigured: () => true, getProvider: () => ({ chat: (...args) => mockChat(...args) }) }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/askSources', () => ({ askSources: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const askPost = require('../Modules/AI/askPost');
const { ask } = require('../Modules/AI/ask');
const { ASK_ANSWER, shareTokenFor } = require('../Modules/AI/shareToken');

/* An Ask answer goes into a conversation only as far as everyone reading that conversation could have read its sources. */

const COMPANY = '6a9954186dd786246031e47b';
const DM_SPACE = '6a9954186dd786246031e47d';
const DM_SPRINT = '6a9954186dd786246031e47e';
const DM_TASK = '6a9954186dd786246031e47f';
const CAROLS_DM = '6a9954186dd786246031e480';
const AGENT_DM = '6a9954186dd786246031e484';
const CHANNEL_SPACE = '6a9954186dd786246031e481';
const CHANNEL = '6a9954186dd786246031e483';
const PRIVATE_CHANNEL = '6a9954186dd786246031e482';
const WEB = '6a9954186dd786246031e490';
const ALICE_ONLY = '6a9954186dd786246031e492';
const WEB_TASK = '6a9954186dd786246031e4a1';
const ALICE_TASK = '6a9954186dd786246031e4a2';
const ALICE = '6f0000000000000000000d01';
const BOB = '6f0000000000000000000d02';
const CAROL = '6f0000000000000000000d03';

const oid = (id) => new mongoose.Types.ObjectId(id);
const channel = { projectId: CHANNEL_SPACE, sprintId: CHANNEL, taskId: 'default' };
const dm = { projectId: DM_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK };
const SHARED = { kind: 'task', id: WEB_TASK, ref: 'WEB-7', title: 'Launch pricing page', project: 'Web', projectId: WEB };
const PRIVATE = { kind: 'task', id: ALICE_TASK, ref: 'ALP-1', title: 'Alpha acquisition plan', project: 'Alice only', projectId: ALICE_ONLY };
const QUESTION = 'What is happening this week?';
const BOTH = ['Here is the week.', '- Pricing launches on Friday [WEB-7].', '- The alpha acquisition is on track [ALP-1].', '- Legal reviews both [WEB-7] [ALP-1].'].join('\n');

const respond = () => {
    const r = { code: 200, body: undefined };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, body = {}, extra = {}) => {
    const r = respond();
    await handler({ headers: { companyid: COMPANY }, uid, body, query: {}, params: {}, ...extra }, r);
    return r;
};

/* What the ask route hands back with an answer: the answer, what it cites, and a token over every source it was built from. */
const answered = ({ uid = ALICE, question = QUESTION, answer, cited, used = cited, issuedAt = Date.now() }) => ({
    question,
    answer,
    cited,
    shareToken: shareTokenFor({ companyId: COMPANY, uid, thread: ASK_ANSWER, question, answer, cited, used: used.map((s) => [s.kind, s.id]), issuedAt }),
});
const postTo = (thread, given, uid = ALICE, extra = {}) => call(askPost.post, uid, { ...thread, ...given, ...extra });

const comments = () => mockDb.store[SCHEMA_TYPE.COMMENTS] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, default: true, ProjectName: 'Direct messages' });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHANNEL_SPACE, default: false, ProjectName: 'Team' });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: DM_SPRINT, projectId: oid(DM_SPACE), name: 'dm', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, projectId: oid(CHANNEL_SPACE), name: 'general', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_CHANNEL, projectId: oid(CHANNEL_SPACE), name: 'leads', private: true, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM_TASK, ProjectID: DM_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, BOB], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: CAROLS_DM, ProjectID: DM_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [BOB, CAROL], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: AGENT_DM, ProjectID: DM_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE], agentId: '6f0000000000000000000a07', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(WEB_TASK), ProjectID: WEB, TaskName: 'Launch pricing page', TaskKey: 'WEB-7', deletedStatusKey: 0, updatedAt: new Date() });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(ALICE_TASK), ProjectID: ALICE_ONLY, TaskName: 'Alpha acquisition plan', TaskKey: 'ALP-1', deletedStatusKey: 0, updatedAt: new Date() });
    [ALICE, BOB, CAROL].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, roleType: 3 }));
});

describe('posting an Ask answer to a conversation', () => {
    it('posts an answer built only from what every reader can open, for the person who asked, as an AI message with its sources', async () => {
        const given = answered({ answer: 'Pricing launches on Friday [WEB-7].', cited: [SHARED] });
        const r = await postTo(channel, given);

        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: true, data: { trimmed: false } });
        expect(comments()).toHaveLength(1);
        const [posted] = comments();
        expect(posted).toMatchObject({
            userId: 'ai', actorType: 'ai', aiAskerId: ALICE, taskId: 'default', type: 'text', message: 'Pricing launches on Friday [WEB-7].',
            hasReply: true, reply_userId: ALICE, reply_message: QUESTION,
        });
        expect(String(posted.projectId)).toBe(CHANNEL_SPACE);
        expect(String(posted.sprintId)).toBe(CHANNEL);
        expect(posted.aiCitations).toEqual([{ kind: 'task', id: WEB_TASK, ref: 'WEB-7', projectId: WEB }]);
        expect(r.body.data.id).toBe(String(posted._id));
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'comments', companyId: COMPANY, data: expect.objectContaining({ actorType: 'ai' }) }));
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('posts nothing and says so when the answer was built with something a reader cannot open', async () => {
        const r = await postTo(channel, answered({ answer: BOTH, cited: [SHARED, PRIVATE] }));

        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: false, code: 'not_shared', data: { unshared: 1, unsharedCited: ['ALP-1'], postable: true } });
        expect(comments()).toHaveLength(0);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('posts only the lines that rest on shared sources when the person chooses to', async () => {
        const r = await postTo(channel, answered({ answer: BOTH, cited: [SHARED, PRIVATE] }), ALICE, { onlyShared: true });

        expect(r.body).toMatchObject({ status: true, data: { trimmed: true } });
        const [posted] = comments();
        expect(posted.message).toBe('- Pricing launches on Friday [WEB-7].');
        expect(JSON.stringify(posted)).not.toMatch(/ALP-1|alpha|acquisition|Legal|Here is the week/i);
        expect(posted.aiCitations).toEqual([{ kind: 'task', id: WEB_TASK, ref: 'WEB-7', projectId: WEB }]);
    });

    it('holds back an answer that cites only shared sources but was built with others, and then posts the cited lines alone', async () => {
        const answer = ['All is on track.', 'Pricing launches on Friday [WEB-7].'].join('\n');
        const given = answered({ answer, cited: [SHARED], used: [SHARED, PRIVATE] });

        const held = await postTo(channel, given);
        expect(held.body).toMatchObject({ status: false, code: 'not_shared', data: { unshared: 1, unsharedCited: [], postable: true } });
        expect(comments()).toHaveLength(0);

        await postTo(channel, given, ALICE, { onlyShared: true });
        expect(comments()[0].message).toBe('Pricing launches on Friday [WEB-7].');
    });

    it('posts nothing at all when no line rests on shared sources', async () => {
        const given = answered({ answer: 'The alpha acquisition is on track [ALP-1].', cited: [PRIVATE] });
        expect((await postTo(channel, given)).body).toMatchObject({ status: false, code: 'not_shared', data: { postable: false } });
        expect((await postTo(channel, given, ALICE, { onlyShared: true })).body).toMatchObject({ status: false, code: 'nothing_shared' });
        expect(comments()).toHaveLength(0);
    });

    it('never treats a comment, a call note or a file as shared', async () => {
        const note = { kind: 'transcript', id: '6a9954186dd786246031e4b1', ref: 'transcript:e4b1aa', projectId: WEB };
        const r = await postTo(channel, answered({ answer: 'The call agreed on Friday [transcript:e4b1aa].', cited: [note] }));
        expect(r.body).toMatchObject({ status: false, code: 'not_shared', data: { unsharedCited: ['transcript:e4b1aa'], postable: false } });
    });

    it('judges a direct message by its two people', async () => {
        const both = await postTo(dm, answered({ answer: 'Pricing launches on Friday [WEB-7].', cited: [SHARED] }));
        expect(both.body.status).toBe(true);
        expect(comments()[0]).toMatchObject({ aiAskerId: ALICE, actorType: 'ai' });
        expect(String(comments()[0].taskId)).toBe(DM_TASK);

        const held = await postTo(dm, answered({ answer: 'The alpha acquisition is on track [ALP-1].', cited: [PRIVATE] }));
        expect(held.body.code).toBe('not_shared');
        expect(comments()).toHaveLength(1);
    });

    it('takes only an answer the ask route gave to this person, unchanged and recent', async () => {
        const given = answered({ answer: 'Pricing launches on Friday [WEB-7].', cited: [SHARED] });
        const refused = [
            await postTo(channel, { ...given, answer: 'Pricing launches tomorrow, trust me [WEB-7].' }),
            await postTo(channel, { ...given, question: 'Something else?' }),
            await postTo(channel, { ...given, cited: [] }),
            await postTo(channel, { ...given, cited: [{ ...SHARED, id: ALICE_TASK }] }),
            await postTo(channel, given, BOB),
            await postTo(channel, { ...given, shareToken: '' }),
            await postTo(channel, { ...given, shareToken: 'not.a.token' }),
            await postTo(channel, answered({ answer: given.answer, cited: [SHARED], issuedAt: Date.now() - 31 * 60 * 1000 })),
        ];
        refused.forEach((r) => {
            expect(r.code).toBe(403);
            expect(r.body.code).toBe('share_refused');
        });
        expect(comments()).toHaveLength(0);
    });

    it('does not take a token made for a conversation, nor let an Ask token stand in for one', async () => {
        const fields = { companyId: COMPANY, uid: ALICE, question: QUESTION, answer: 'Pricing launches on Friday [WEB-7].', cited: [SHARED], used: [['task', WEB_TASK]], issuedAt: Date.now() };
        const fromChannel = shareTokenFor({ ...fields, thread: channel });
        const r = await postTo(channel, { question: QUESTION, answer: fields.answer, cited: [SHARED], shareToken: fromChannel });
        expect(r.code).toBe(403);
        expect(comments()).toHaveLength(0);
    });

    it('answers "not found" for a conversation the caller cannot post in, and for a thread that is not a conversation', async () => {
        const given = answered({ answer: 'Pricing launches on Friday [WEB-7].', cited: [SHARED] });
        const privateChannel = await postTo({ projectId: CHANNEL_SPACE, sprintId: PRIVATE_CHANNEL, taskId: 'default' }, given);
        const someoneElsesDm = await postTo({ projectId: DM_SPACE, sprintId: DM_SPRINT, taskId: CAROLS_DM }, given);
        const projectTask = await postTo({ projectId: WEB, sprintId: CHANNEL, taskId: WEB_TASK }, given);
        const wrongSpace = await postTo({ projectId: DM_SPACE, sprintId: CHANNEL, taskId: 'default' }, given);
        [privateChannel, someoneElsesDm, projectTask, wrongSpace].forEach((r) => expect(r.code).toBe(404));
        expect((await postTo({ projectId: 'nope', sprintId: CHANNEL, taskId: 'default' }, given)).code).toBe(400);
        expect(comments()).toHaveLength(0);
    });

    it('refuses a token limited to some projects, and a caller who is not signed in', async () => {
        const given = answered({ answer: 'Pricing launches on Friday [WEB-7].', cited: [SHARED] });
        expect((await call(askPost.post, ALICE, { ...channel, ...given }, { apiToken: { projectIds: [WEB] } })).code).toBe(403);
        expect((await call(askPost.post, '', { ...channel, ...given })).code).toBe(401);
        expect(comments()).toHaveLength(0);
    });

    it('accepts the token the ask route gives with its answer', async () => {
        mockChat.mockResolvedValue({ content: 'Pricing launches on Friday [WEB-7].', model: 'test-model', totalTokens: 9 });
        const asked = await call(ask, BOB, { question: 'When does pricing launch?' });
        expect(asked.body.data.shareToken).toEqual(expect.any(String));

        const r = await postTo(channel, { question: 'When does pricing launch?', answer: asked.body.data.answer, cited: asked.body.data.cited, shareToken: asked.body.data.shareToken }, BOB);
        expect(r.body.status).toBe(true);
        expect(comments()[0]).toMatchObject({ aiAskerId: BOB, message: 'Pricing launches on Friday [WEB-7].' });
        expect(mockChat).toHaveBeenCalledTimes(1);
    });
});

describe('the conversations an answer can be posted to', () => {
    const targets = (uid) => call(askPost.targets, uid);

    it('lists the channels the caller can post in and their direct messages with people, by name', async () => {
        const alice = (await targets(ALICE)).body.data;
        expect(alice.channels).toEqual([{ projectId: CHANNEL_SPACE, sprintId: CHANNEL, taskId: 'default', name: 'general', space: 'Team' }]);
        expect(alice.directs).toEqual([{ projectId: DM_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK, name: 'Bob' }]);

        const carol = (await targets(CAROL)).body.data;
        expect(carol.channels.map((c) => c.name)).toEqual(['general', 'leads']);
        expect(carol.directs).toEqual([{ projectId: DM_SPACE, sprintId: DM_SPRINT, taskId: CAROLS_DM, name: 'Bob' }]);
    });

    it('leaves out a channel in the trash and a direct message with someone who has left', async () => {
        mockDb.store[SCHEMA_TYPE.SPRINTS].find((s) => s._id === CHANNEL).deletedStatusKey = 1;
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((seat) => seat.userId === BOB).status = 3;
        expect((await targets(ALICE)).body.data).toEqual({ channels: [], directs: [] });
    });

    it('refuses a token limited to some projects', async () => {
        expect((await call(askPost.targets, ALICE, {}, { apiToken: { projectIds: [WEB] } })).code).toBe(403);
    });
});

describe('what is left of an answer for everyone', () => {
    const cites = [{ kind: 'task', id: 'a', ref: 'WEB-7' }, { kind: 'task', id: 'b', ref: 'ALP-1' }];
    const shared = new Set(['task:a']);

    it('keeps a line when everything it cites is shared, and drops a line that cites nothing or cites anything else', () => {
        const out = askPost.onlyShared(['Intro.', '', 'One [WEB-7].', '', '', 'Two [ALP-1].', 'Three [WEB-7] and [ALP-1].', 'A [link](https://x.test) only.'].join('\n'), cites, shared);
        expect(out.text).toBe('One [WEB-7].');
        expect(out.cited).toEqual([cites[0]]);
    });

    it('is empty when nothing is shared', () => {
        expect(askPost.onlyShared('Two [ALP-1].', cites, new Set())).toEqual({ text: '', cited: [] });
    });
});
