const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 111: a comment's mention notifications are decided by the server from the stored thread. */

const state = readState();
const MENTIONED = "comments_I'm_@mentioned_in";
const DEADLINE_MS = 10000;

jest.setTimeout(60000);

let client;
let owner;
let admin;
let member;
let guest;
let privateProject;
let taskThread;

const db = () => client.db(state.companyId);
const mention = (session, name) => `@[${name}](${session.uid})`;
const ALL = '@[All](everyone)';

const commentBody = (session, { projectId, sprintId, taskId }, message) => {
    const data = { objId: { projectId: String(projectId) }, project: true, message, type: 'text', userId: session.uid, mentionIds: [] };
    if (taskId) {
        data.objId.sprintId = String(sprintId);
        data.project = false;
        if (taskId === 'default') data.taskId = 'default';
        else data.objId.taskId = String(taskId);
    }
    return { data };
};

async function comment(session, thread, message) {
    const res = await session.api.post('/api/v1/comments', commentBody(session, thread, message));
    expect([res.status, res.body && res.body.status]).toEqual([200, true]);
    return String(res.body.data._id);
}

const stored = (id) => db().collection('comments').findOne({ _id: new ObjectId(id) });
const notifiedFor = async (id) => (await db().collection('notifications').find({ comments_id: id, key: MENTIONED }).toArray()).map((row) => String(row.receiverID));
const recordedMentions = async (id) => (await db().collection('mentions').find({ comment_id: id }).toArray()).flatMap((row) => row.mentionIds.map(String));

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};
const receiversOnceNotified = (id, uid) => waitFor(async () => { const found = await notifiedFor(id); return found.includes(uid) ? found : null; }, `the notice to ${uid}`);
const quiet = () => new Promise((resolve) => setTimeout(resolve, 1500));

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    [owner, admin, member, guest] = await Promise.all(['owner', 'admin', 'member', 'guest'].map((role) => loginAs(role)));

    const closed = await createProject(owner.api, { name: `FU111 comments ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid, isPrivate: true });
    privateProject = { projectId: String(closed._id) };
    await db().collection('projects').updateOne(
        { _id: new ObjectId(privateProject.projectId) },
        { $set: { watchers: { [admin.uid]: 'participating_mentions', [guest.uid]: 'all_activity' } } },
    );

    const open = await createProject(owner.api, { name: `FU111 task comments ${uniqueSuffix()}`, assigneeIds: [owner.uid, admin.uid, member.uid, guest.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project: open, user: state.users.owner, companyOwnerId: owner.uid });
    taskThread = { projectId: String(open._id), sprintId: task.sprintId, taskId: task._id };
    const res = await owner.api.patch(`/api/v1/sprint/${taskThread.sprintId}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: taskThread.projectId,
        updateObject: { $set: { private: true, AssigneeUserId: [owner.uid, member.uid] } },
    });
    expect(res.body.status).toBe(true);
    await db().collection('tasks').updateOne({ _id: new ObjectId(task._id) }, { $set: { watchers: [owner.uid, member.uid, guest.uid] } });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a mention in a project comment', () => {
    it('notifies the mentioned member who can see the project, and not one who cannot', async () => {
        const id = await comment(member, privateProject, `${mention(admin, 'Ada Admin')} ${mention(guest, 'Gus Guest')} please look`);

        expect((await stored(id)).mentionIds.map(String)).toEqual([admin.uid]);
        await receiversOnceNotified(id, admin.uid);
        await quiet();
        const receivers = await notifiedFor(id);
        expect(receivers).toEqual(expect.arrayContaining([admin.uid, owner.uid]));
        expect(receivers).not.toContain(guest.uid);
        expect(await recordedMentions(id)).not.toContain(guest.uid);
    });

    it('"everyone" reaches only the members who can see the project', async () => {
        const id = await comment(member, privateProject, `${ALL} standup moved`);

        const mentioned = (await stored(id)).mentionIds.map(String);
        expect(mentioned).toEqual(expect.arrayContaining([owner.uid, admin.uid]));
        expect(mentioned).not.toContain(guest.uid);
        expect(mentioned).not.toContain(member.uid);

        await receiversOnceNotified(id, admin.uid);
        await quiet();
        expect(await notifiedFor(id)).not.toContain(guest.uid);
        expect(await recordedMentions(id)).not.toContain(guest.uid);
    });

    it('ignores an id that is not a member of the company', async () => {
        const stranger = new ObjectId().toHexString();
        const id = await comment(member, privateProject, `@[Someone](${stranger}) ${mention(admin, 'Ada Admin')}`);
        expect((await stored(id)).mentionIds.map(String)).toEqual([admin.uid]);
    });

    it('a comment without a mention notifies nobody', async () => {
        const id = await comment(member, privateProject, `plain ${uniqueSuffix()}`);
        expect((await stored(id)).mentionIds || []).toEqual([]);
        await quiet();
        expect(await notifiedFor(id)).toEqual([]);
    });
});

describe('a mention in a task comment', () => {
    it('notifies the task watchers who can see the thread', async () => {
        const id = await comment(member, taskThread, `${mention(owner, 'Olivia Owner')} ${mention(guest, 'Gus Guest')} done`);

        expect((await stored(id)).mentionIds.map(String)).toEqual([owner.uid]);
        await receiversOnceNotified(id, owner.uid);
        await quiet();
        const receivers = await notifiedFor(id);
        expect(receivers).not.toContain(guest.uid);
        expect(receivers).not.toContain(member.uid);
        const [row] = await db().collection('notifications').find({ comments_id: id, receiverID: owner.uid }).toArray();
        expect({ type: row.type, taskId: String(row.taskId), message: row.message }).toEqual({
            type: 'tasks', taskId: taskThread.taskId, message: (await stored(id)).message,
        });
    });

    it('"everyone" leaves out the people outside the private sprint', async () => {
        const id = await comment(owner, taskThread, `${ALL} release today`);
        const mentioned = (await stored(id)).mentionIds.map(String);
        expect(mentioned).toContain(member.uid);
        expect(mentioned).not.toContain(guest.uid);
        await receiversOnceNotified(id, member.uid);
        await quiet();
        expect(await notifiedFor(id)).not.toContain(guest.uid);
    });
});
