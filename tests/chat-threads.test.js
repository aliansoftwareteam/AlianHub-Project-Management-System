/* Task 046, track A3: a chat message takes thread replies, stored with the parent field task-comment threads use. */
process.env.STORAGE_TYPE = 'server';

const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const CHAT_SPACE = '6a9954186dd786246031e47d';
const DM_SPRINT = '6a9954186dd786246031e47e';
const DM_TASK = '6a9954186dd786246031e47f';
const CHANNEL_PROJECT = '6a9954186dd786246031e481';
const CHANNEL = '6a9954186dd786246031e483';
const PRIVATE_CHANNEL = '6a9954186dd786246031e482';
const ALICE = '6f0000000000000000000d01';
const BOB = '6f0000000000000000000d02';
const CAROL = '6f0000000000000000000d03';
const DAVE = '6f0000000000000000000d04';

const mockDb = create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));
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
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ userId: req.uid, runId: null })) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const { updateUnReadCommentsCountFun } = require('../Modules/notification-count/controller');
const { resolveMentionIds } = require('../Modules/Comments/helpers/commentNotifications');
const { save, update, getPaginatedMessages, searchMessageFromMainChat } = require('../Modules/Comments/controller');
const threads = require('../Modules/Comments/threads');
const { forgetHealed } = require('../Modules/Comments/helpers/noticeItems');
const { chatThreadPath } = require('../Modules/Comments/helpers/chatThreads');
const createSchema = require('../utils/mongo-handler/createSchema');
const { upsertRoom, removeRoom } = require('../socket/helper');
require('../socket/controller/commentSocket');

const relays = Object.fromEntries(socketEmitter.on.mock.calls);

const oid = (id) => new mongoose.Types.ObjectId(id);
let seq = 0;
const at = () => new Date(Date.UTC(2026, 9, 1, 10, seq++));

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
const settle = () => new Promise((resolve) => setImmediate(resolve));

const channel = { projectId: CHANNEL_PROJECT, sprintId: CHANNEL, taskId: 'default' };
const privateChannel = { projectId: CHANNEL_PROJECT, sprintId: PRIVATE_CHANNEL, taskId: 'default' };
const dm = { projectId: CHAT_SPACE, sprintId: DM_SPRINT, taskId: DM_TASK };

const comments = () => mockDb.store[SCHEMA_TYPE.COMMENTS] || [];
const stored = (id) => comments().find((c) => String(c._id) === String(id));
const notices = () => handleNotificationtFun.mock.calls.map(([{ body }]) => body);
const threadEvents = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'comments_thread').map(([type, payload]) => ({ type, ...payload }));

const seedMessage = ({ projectId, sprintId, taskId, userId, text, ...extra }) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    projectId: oid(projectId), sprintId: oid(sprintId), taskId: taskId === 'default' ? taskId : oid(taskId), userId, message: text, type: 'text', project: false, createdAt: at(), ...extra,
});

const envelope = (thread) => ({
    project: false,
    ...(thread.taskId === 'default' ? { taskId: 'default' } : {}),
    objId: { projectId: thread.projectId, sprintId: thread.sprintId, ...(thread.taskId === 'default' ? {} : { taskId: thread.taskId }) },
});
const reply = async (uid, parentId, message, thread = channel) => {
    const r = await call(save, uid, { body: { data: { parentId: String(parentId), message, type: 'text', ...envelope(thread) } } });
    await settle();
    return r;
};
const remove = (uid, id) => call(update, uid, { body: { id: String(id), data: { isDeleted: true } } });
const listOf = (uid, thread = channel) => call(getPaginatedMessages, uid, { query: { ...thread, mainChat: 'true', isDefault: String(thread === dm) } });
const repliesOf = (uid, parentId) => call(threads.listReplies, uid, { query: { parentId: String(parentId) } });

let root;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    mockDb.calls.length = 0;
    socketEmitter.emit.mockClear();
    handleNotificationtFun.mockClear();
    updateUnReadCommentsCountFun.mockClear();
    resolveMentionIds.mockClear();
    forgetHealed();

    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHAT_SPACE, default: true });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHANNEL_PROJECT, default: false });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: DM_SPRINT, projectId: oid(CHAT_SPACE) });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: CHANNEL, projectId: oid(CHANNEL_PROJECT) });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_CHANNEL, projectId: oid(CHANNEL_PROJECT), private: true, AssigneeUserId: [ALICE, BOB] });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DM_TASK, ProjectID: CHAT_SPACE, sprintId: DM_SPRINT, mainChat: true, AssigneeUserId: [ALICE, BOB] });
    [ALICE, BOB, CAROL, DAVE].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, roleType: 3 }));

    root = seedMessage({ ...channel, userId: ALICE, text: 'Shall we ship on Friday?' });
});

describe('a reply in a channel thread', () => {
    it('is stored under the message with the channel\'s ids, whatever thread the caller names', async () => {
        const r = await reply(BOB, root._id, 'Yes, Friday works', privateChannel);

        expect(r.code).toBe(200);
        const row = stored(r.body.data._id);
        expect(String(row.parentId)).toBe(String(root._id));
        expect(String(row.projectId)).toBe(CHANNEL_PROJECT);
        expect(String(row.sprintId)).toBe(CHANNEL);
        expect(row.taskId).toBe('default');
        expect(row.userId).toBe(BOB);
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', expect.objectContaining({ module: 'comments', companyId: COMPANY, data: expect.objectContaining({ _id: row._id }) }));
    });

    it('joins the same thread when it answers a reply', async () => {
        const first = await reply(BOB, root._id, 'Yes');
        const nested = await reply(CAROL, first.body.data._id, 'Agreed');

        expect(String(stored(nested.body.data._id).parentId)).toBe(String(root._id));
    });

    it('is written and read only by the people who can open the channel', async () => {
        const hidden = seedMessage({ ...privateChannel, userId: ALICE, text: 'Private plans' });
        const before = comments().length;

        expect((await reply(CAROL, hidden._id, 'Let me in', channel)).code).toBe(404);
        expect(comments()).toHaveLength(before);

        await reply(BOB, hidden._id, 'Noted', privateChannel);
        expect((await repliesOf(ALICE, hidden._id)).body.data.map((row) => row.message)).toEqual(['Noted']);
        const refused = await repliesOf(CAROL, hidden._id);
        expect(refused.code).toBe(404);
        expect(refused.body.data).toBeUndefined();
        expect(refused.body.root).toBeUndefined();
    });

    it('stays out of the channel, whose message carries the count, the last repliers and the last reply time', async () => {
        const first = await reply(BOB, root._id, 'Yes');
        const last = await reply(CAROL, root._id, 'Agreed');
        stored(first.body.data._id).createdAt = new Date('2026-10-01T11:00:00Z');
        stored(last.body.data._id).createdAt = new Date('2026-10-01T12:00:00Z');

        const r = await listOf(DAVE);

        expect(r.code).toBe(200);
        expect(r.body.data).toHaveLength(1);
        expect(r.body.data[0]).toMatchObject({ message: 'Shall we ship on Friday?', replyCount: 2, replierIds: [CAROL, BOB] });
        expect(new Date(r.body.data[0].lastReplyAt).toISOString()).toBe('2026-10-01T12:00:00.000Z');
        expect(r.body.data[0].replyRows).toBeUndefined();
    });

    it('opens with its root message and replies, oldest first', async () => {
        await reply(BOB, root._id, 'first');
        await reply(CAROL, root._id, 'second');

        const r = await repliesOf(DAVE, root._id);

        expect(r.code).toBe(200);
        expect(r.body.root).toMatchObject({ message: 'Shall we ship on Friday?', userId: ALICE });
        expect(r.body.data.map((row) => row.message)).toEqual(['first', 'second']);
    });

    it('sends the channel the new count on its own event, which no webhook reads as an edited comment', async () => {
        await reply(BOB, root._id, 'Yes');

        expect(threadEvents()).toEqual([expect.objectContaining({
            type: 'update', companyId: COMPANY,
            data: expect.objectContaining({ _id: root._id, taskId: 'default', replyCount: 1, replierIds: [BOB] }),
        })]);
        const edits = socketEmitter.emit.mock.calls.filter(([type, payload]) => type === 'update' && payload.module === 'comments');
        expect(edits).toEqual([]);
    });

    it('does not raise the channel\'s unread count, which a message in the channel does', async () => {
        await reply(BOB, root._id, 'Yes');
        expect(updateUnReadCommentsCountFun).not.toHaveBeenCalled();

        await call(save, BOB, { body: { data: { message: 'A new topic', type: 'text', ...envelope(channel) } } });
        await settle();
        expect(updateUnReadCommentsCountFun).toHaveBeenCalledWith({ body: expect.objectContaining({ key: 2, sprintId: CHANNEL, taskId: 'default' }) });
    });

    it('notifies the root author and earlier repliers who can still open the channel, with a link to the thread', async () => {
        await reply(BOB, root._id, 'Yes');
        await reply(CAROL, root._id, 'Agreed');
        handleNotificationtFun.mockClear();

        const r = await reply(DAVE, root._id, 'Shipping it');

        const sent = notices().filter((n) => n.key === 'comment_reply');
        expect(sent).toHaveLength(1);
        expect([...sent[0].assigneeUsers].sort()).toEqual([ALICE, BOB, CAROL]);
        expect(sent[0]).toMatchObject({
            type: 'tasks', companyId: COMPANY, userId: DAVE, projectId: CHANNEL_PROJECT, sprintId: CHANNEL, taskId: CHANNEL,
            changeType: 'chat_thread_reply', changeData: { threadId: String(root._id), commentId: String(r.body.data._id) },
            comments_id: String(r.body.data._id),
        });
    });

    it('leaves the people it mentions to the mention notice, and never notifies its own author', async () => {
        await reply(BOB, root._id, 'Yes');
        handleNotificationtFun.mockClear();
        resolveMentionIds.mockResolvedValueOnce([ALICE]);

        await reply(BOB, root._id, `@[Alice](${ALICE}) one more thing`);

        expect(notices().filter((n) => n.key === 'comment_reply')).toEqual([]);
    });

    it('cannot be moved to another thread, or made a top-level message, by an edit', async () => {
        const other = seedMessage({ ...channel, userId: ALICE, text: 'Another topic' });
        const r = await reply(BOB, root._id, 'Yes');

        await call(update, BOB, { body: { id: String(r.body.data._id), data: { message: 'Yes!', parentId: String(other._id), replyCount: 9 } } });
        expect(stored(r.body.data._id)).toMatchObject({ message: 'Yes!' });
        expect(String(stored(r.body.data._id).parentId)).toBe(String(root._id));
        expect(stored(r.body.data._id).replyCount).toBeUndefined();
    });
});

describe('deleting in a channel thread', () => {
    it('keeps the replies under a blank placeholder when the root message is deleted', async () => {
        await reply(BOB, root._id, 'Yes');
        expect((await remove(ALICE, root._id)).code).toBe(200);

        const listed = (await listOf(DAVE)).body.data;
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ _id: root._id, isDeleted: true, message: '', replyCount: 1, userId: ALICE });
        expect(JSON.stringify(listed[0])).not.toContain('Friday');

        const opened = await repliesOf(DAVE, root._id);
        expect(opened.code).toBe(200);
        expect(opened.body.root).toMatchObject({ isDeleted: true, message: '' });
        expect(opened.body.data.map((row) => row.message)).toEqual(['Yes']);

        expect((await reply(CAROL, root._id, 'Still on for Friday')).code).toBe(200);
    });

    it('leaves nothing behind when the deleted message had no replies', async () => {
        await remove(ALICE, root._id);

        expect((await listOf(DAVE)).body.data).toEqual([]);
        expect((await repliesOf(DAVE, root._id)).code).toBe(404);
        expect((await reply(BOB, root._id, 'Too late')).code).toBe(404);
    });

    it('lowers the count for everyone when a reply is deleted, and drops a placeholder with no replies left', async () => {
        const only = await reply(BOB, root._id, 'Yes');
        await remove(ALICE, root._id);
        socketEmitter.emit.mockClear();

        expect((await remove(BOB, only.body.data._id)).code).toBe(200);
        await settle();

        expect(threadEvents()).toEqual([expect.objectContaining({ data: expect.objectContaining({ _id: root._id, replyCount: 0 }) })]);
        expect((await listOf(DAVE)).body.data).toEqual([]);
    });
});

describe('search in a conversation', () => {
    it('finds a thread reply and says which thread it is in', async () => {
        const r = await reply(BOB, root._id, 'The pricing page is ready');

        const found = await call(searchMessageFromMainChat, DAVE, { query: { ...channel, searchText: 'pricing' } });

        expect(found.code).toBe(200);
        expect(found.body.data).toHaveLength(1);
        expect(String(found.body.data[0]._id)).toBe(String(r.body.data._id));
        expect(String(found.body.data[0].parentId)).toBe(String(root._id));
    });
});

describe('a thread in a direct message', () => {
    it('belongs to its two people only', async () => {
        const message = seedMessage({ ...dm, userId: ALICE, text: 'Lunch?' });

        const r = await reply(BOB, message._id, 'Sure', dm);
        expect(r.code).toBe(200);
        expect(String(stored(r.body.data._id).taskId)).toBe(DM_TASK);
        expect((await listOf(ALICE, dm)).body.data).toEqual([expect.objectContaining({ message: 'Lunch?', replyCount: 1 })]);
        expect(threadEvents()).toHaveLength(1);
        expect(notices().filter((n) => n.key === 'comment_reply')[0]).toMatchObject({ assigneeUsers: [ALICE], taskId: DM_TASK, changeType: 'chat_thread_reply' });

        expect((await reply(CAROL, message._id, 'Me too', dm)).code).toBe(404);
        expect((await repliesOf(CAROL, message._id)).code).toBe(404);
    });
});

describe('a thread reply notice', () => {
    it('opens the conversation with the thread beside it', () => {
        expect(chatThreadPath({ companyId: COMPANY, projectId: CHANNEL_PROJECT, taskId: CHANNEL, changeData: { threadId: 'a b' } }))
            .toBe(`${COMPANY}/chat/${CHANNEL_PROJECT}/${CHANNEL}?thread=a%20b`);
    });

    it('keeps its thread through the strict notification schema', async () => {
        await reply(BOB, root._id, 'Yes');
        const [sent] = notices().filter((n) => n.key === 'comment_reply');
        const Notice = mongoose.models.ChatThreadNoticeProbe || mongoose.model('ChatThreadNoticeProbe', createSchema.notificationsSchema);

        const row = new Notice({ ...sent, receiverID: ALICE, uniqueId: 'n1' });

        expect(row.validateSync()).toBeUndefined();
        expect(row.toObject()).toMatchObject({ changeType: 'chat_thread_reply', changeData: { threadId: String(root._id) }, taskId: CHANNEL });
    });
});

describe('a mention in a thread reply', () => {
    it('is recorded with the thread it was made in, which the strict mention schema keeps', async () => {
        const { deliverMentions } = jest.requireActual('../Modules/Comments/helpers/commentNotifications');
        const r = await reply(BOB, root._id, `@[Alice](${ALICE}) see this`);

        await deliverMentions(COMPANY, stored(r.body.data._id), [ALICE]);

        const [record] = mockDb.store[SCHEMA_TYPE.MENTIONS];
        expect(record).toMatchObject({ comment_id: String(r.body.data._id), comment_parentId: String(root._id), mainChat: true, mentionIds: [ALICE] });
        const Mention = mongoose.models.ChatThreadMentionProbe || mongoose.model('ChatThreadMentionProbe', createSchema.mentionsSchema);
        expect(new Mention(record).toObject().comment_parentId).toBe(String(root._id));
    });
});

describe('the thread count event', () => {
    it('reaches the sockets in the channel\'s room as a comment update', () => {
        const relay = relays['comments_thread:update'];
        expect(relay).toEqual(expect.any(Function));

        const sent = [];
        const inChannel = { id: 's1', rooms: new Set() };
        const elsewhere = { id: 's2', rooms: new Set() };
        const join = (socket, prefix) => {
            const roomName = `${prefix}**${socket.id}`;
            socket.rooms.add(roomName);
            upsertRoom({ roomName, socketId: socket.id, socket, namespace: { to: (room) => ({ emit: (event, payload) => sent.push({ room, event, payload }) }) } });
            return roomName;
        };
        const rooms = [
            join(inChannel, `comments_${CHANNEL_PROJECT}_${CHANNEL}_default`),
            join(elsewhere, `comments_${CHANNEL_PROJECT}_${PRIVATE_CHANNEL}_default`),
        ];

        relay({ type: 'update', module: 'comments_thread', companyId: COMPANY, data: { _id: 'm1', projectId: CHANNEL_PROJECT, sprintId: CHANNEL, taskId: 'default', replyCount: 3 } });

        expect(sent).toEqual([{ room: rooms[0], event: 'commentUpdate', payload: expect.objectContaining({ fullDocument: expect.objectContaining({ _id: 'm1', replyCount: 3 }) }) }]);
        rooms.forEach(removeRoom);
    });
});
