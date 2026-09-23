const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const MENTIONED = "comments_I'm_@mentioned_in";
const DEADLINE_MS = 10000;

jest.setTimeout(60000);

let client;
let owner;
let admin;
let member;
let guest;
let thread;

const db = () => client.db(state.companyId);
const mention = (session, name) => `@[${name}](${session.uid})`;

const commentBody = (session, { projectId, sprintId, taskId }, message) => ({
    data: {
        objId: { projectId, sprintId, taskId },
        project: false,
        message,
        type: 'text',
        userId: session.uid,
        mentionIds: [],
    },
});

async function comment(session, message) {
    const res = await session.api.post('/api/v1/comments', commentBody(session, thread, message));
    expect([res.status, res.body && res.body.status]).toEqual([200, true]);
    return String(res.body.data._id);
}

const stored = (id) => db().collection('comments').findOne({ _id: new ObjectId(id) });
const mentionRecords = (id) => db().collection('mentions').find({ comment_id: id }).toArray();
const pushNotices = (id, uid) => db().collection('notifications')
    .find({ comments_id: id, key: MENTIONED, receiverID: uid, notificationType: 'push' }).toArray();

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};
const noticesOnceSent = (id, uid) => waitFor(async () => { const rows = await pushNotices(id, uid); return rows.length ? rows : null; }, `the mention notice to ${uid}`);
const recordOnceSaved = (id) => waitFor(async () => { const rows = await mentionRecords(id); return rows.length ? rows : null; }, 'the mention record');
const quiet = () => new Promise((resolve) => setTimeout(resolve, 1500));

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    [owner, admin, member, guest] = await Promise.all(['owner', 'admin', 'member', 'guest'].map((role) => loginAs(role)));

    const project = await createProject(owner.api, { name: `Mention records ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid, isPrivate: true });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    thread = { projectId: String(project._id), sprintId: String(task.sprintId), taskId: String(task._id) };
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a mention in a task comment', () => {
    let commentId;

    beforeAll(async () => {
        commentId = await comment(member, `${mention(admin, 'Ada Admin')} please review`);
    });

    it('records one mention for the mentioned member, written from the saved comment', async () => {
        await recordOnceSaved(commentId);
        await quiet();
        const records = await mentionRecords(commentId);
        expect(records).toHaveLength(1);
        const [record] = records;
        expect({
            mentionIds: record.mentionIds.map(String),
            notSeen: record.notSeen.map(String),
            userId: String(record.userId),
            type: record.type,
            mainChat: record.mainChat,
            projectId: String(record.projectId),
            sprintId: String(record.sprintId),
            taskId: String(record.taskId),
            comment_message: record.comment_message,
        }).toEqual({
            mentionIds: [admin.uid],
            notSeen: [admin.uid],
            userId: member.uid,
            type: 'task',
            mainChat: false,
            ...thread,
            comment_message: (await stored(commentId)).message,
        });
    });

    it('sends the mention notice to a mentioned member who does not watch the task', async () => {
        const [notice] = await noticesOnceSent(commentId, admin.uid);
        expect({ type: notice.type, taskId: String(notice.taskId), userId: String(notice.userId) })
            .toEqual({ type: 'tasks', taskId: thread.taskId, userId: member.uid });
    });

    it('shows the mention in the member\'s inbox', async () => {
        await recordOnceSaved(commentId);
        const res = await admin.api.get('/api/v1/inbox', { query: { tab: 'mentions' } });
        expect(res.status).toBe(200);
        const item = res.body.data.items.find((row) => row.comment_id === commentId);
        expect(item).toEqual(expect.objectContaining({ sourceType: 'mention', mainChat: false, taskId: thread.taskId, unread: true }));
    });

    it('does not notify or record the author', async () => {
        const id = await comment(member, `${mention(member, 'Me')} ${mention(admin, 'Ada Admin')} note to self`);
        await recordOnceSaved(id);
        await noticesOnceSent(id, admin.uid);
        await quiet();
        expect((await stored(id)).mentionIds.map(String)).toEqual([admin.uid]);
        const [record] = await mentionRecords(id);
        expect(record.mentionIds.map(String)).not.toContain(member.uid);
        expect(await pushNotices(id, member.uid)).toEqual([]);
    });

    it('sends a mentioned watcher one notice, not two', async () => {
        const id = await comment(member, `${mention(owner, 'Olivia Owner')} ship it`);
        await noticesOnceSent(id, owner.uid);
        await quiet();
        expect(await pushNotices(id, owner.uid)).toHaveLength(1);
    });
});

describe('mention records come only from the server', () => {
    it('a caller cannot store a mention record of its own', async () => {
        const forgedId = new ObjectId().toHexString();
        const res = await member.api.post('/api/v1/app-notification/comment', {
            data: {
                comment_id: forgedId,
                comment_message: 'forged',
                comment_type: 'text',
                mentionIds: [guest.uid],
                notSeen: [guest.uid],
                userId: owner.uid,
                type: 'task',
                ...thread,
            },
        });
        expect(res.body && res.body.status).not.toBe(true);
        await quiet();
        expect(await mentionRecords(forgedId)).toEqual([]);
    });
});

describe('marking a mention read', () => {
    let commentId;
    let recordId;

    const stillUnreadFor = async (uid) => {
        const record = await db().collection('mentions').findOne({ _id: new ObjectId(recordId) });
        return record.notSeen.map(String).includes(uid);
    };

    beforeAll(async () => {
        commentId = await comment(member, `${mention(admin, 'Ada Admin')} read me ${uniqueSuffix()}`);
        const [record] = await recordOnceSaved(commentId);
        recordId = String(record._id);
    });

    it('leaves another member\'s mention untouched', async () => {
        await member.api.put('/api/v1/app-notification/mark-read', { key: 'mentions', id: recordId });
        await guest.api.put('/api/v1/app-notification/mark-read', { key: 'mentions', id: recordId });
        await guest.api.put('/api/v1/app-notification/mark-read', { key: 'mentions', isClickPush: true, commentsId: commentId });
        await guest.api.put('/api/v1/app-notification/mark-all-read', { key: 'mentions' });
        const refused = await guest.api.put('/api/v1/app-notification/mark-read', { key: 'mentions', id: recordId, userId: admin.uid });
        expect(refused.status).toBe(403);
        expect(await stillUnreadFor(admin.uid)).toBe(true);
    });

    it('clears the caller\'s own mention', async () => {
        const res = await admin.api.put('/api/v1/app-notification/mark-read', { key: 'mentions', id: recordId });
        expect(res.body.status).toBe(true);
        expect(await stillUnreadFor(admin.uid)).toBe(false);
    });
});

describe('editing a comment', () => {
    it('stores only the mentions of active members who can see the thread, never the author', async () => {
        const id = await comment(member, `${mention(admin, 'Ada Admin')} first draft`);
        await recordOnceSaved(id);
        const stranger = new ObjectId().toHexString();

        const res = await member.api.put('/api/v1/comments', {
            id,
            data: { message: `${mention(owner, 'Olivia Owner')} ${mention(guest, 'Gus Guest')} ${mention(member, 'Me')} @[Someone](${stranger}) second draft` },
        });
        expect(res.body.status).toBe(true);
        expect((await stored(id)).mentionIds.map(String)).toEqual([owner.uid]);

        const forged = await member.api.put('/api/v1/comments', { id, data: { mentionIds: [guest.uid] } });
        expect(forged.body.status).toBe(true);
        expect((await stored(id)).mentionIds.map(String)).toEqual([owner.uid]);

        await quiet();
        expect(await mentionRecords(id)).toHaveLength(1);
        expect(await pushNotices(id, owner.uid)).toEqual([]);
    });
});
