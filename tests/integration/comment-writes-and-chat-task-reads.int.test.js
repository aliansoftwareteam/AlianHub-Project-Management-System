const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(120000);

let client;
let db;
let owner;
let admin;
let member;
let guest;
let everyone;
let open;
let closed;
let sharedPrivate;
let privateSprint;
let dm;
let channels;
let orphanTaskId;

const label = (what) => `${what} ${uniqueSuffix()}`;
const outcome = (res) => ({ status: res.status, ok: Boolean(res.body) && res.body.status === true });
const REFUSED = { status: 404, ok: false };
const ACCEPTED = { status: 200, ok: true };

const commentBody = (session, { projectId, sprintId, taskId }, message) => {
    const data = { objId: { projectId: String(projectId) }, project: true, message, type: 'text', userId: session.uid };
    if (taskId) {
        data.objId.sprintId = String(sprintId);
        data.project = false;
        if (taskId === 'default') data.taskId = 'default';
        else data.objId.taskId = String(taskId);
    }
    return { data };
};

const post = (session, where, message = label('comment')) => session.api.post('/api/v1/comments', commentBody(session, where, message));

async function posted(session, where) {
    const res = await post(session, where);
    expect(outcome(res)).toEqual(ACCEPTED);
    return String(res.body.data._id);
}

const edit = (session, id, data, extra = {}) => session.api.put('/api/v1/comments', { id, data, ...extra });
const pin = (session, id) => edit(session, id, { pinnedMessage: true }, { options: { timestamps: false } });
const react = (session, targetType, targetId) => session.api.post('/api/v2/reactions', {
    targetType, targetId: String(targetId), emoji: '👍', userData: { id: session.uid },
});
const readTask = (session, id) => session.api.get(`/api/v1/task/${id}`);

const storedComment = (id) => db.collection('comments').findOne({ _id: new ObjectId(String(id)) });
const countByMessage = (message) => db.collection('comments').countDocuments({ message });

async function projectWithTask(assignees, { isPrivate = false } = {}) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid, isPrivate });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    return { projectId: String(project._id), sprintId: task.sprintId, taskId: task._id };
}

const sprintChat = (thread) => ({ ...thread, taskId: 'default' });
const projectLevel = (thread) => ({ projectId: thread.projectId });

async function makeSprintPrivate(thread, assignees) {
    const res = await owner.api.patch(`/api/v1/sprint/${thread.sprintId}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: thread.projectId,
        updateObject: { $set: { private: true, AssigneeUserId: assignees.map((s) => s.uid) } },
    });
    expect(res.body.status).toBe(true);
}

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(String(state.companyId));
    [owner, admin, member, guest] = await Promise.all(['owner', 'admin', 'member', 'guest'].map((role) => loginAs(role)));
    everyone = [owner, admin, member, guest];

    open = await projectWithTask(everyone);
    closed = await projectWithTask([owner], { isPrivate: true });
    sharedPrivate = await projectWithTask([owner, member], { isPrivate: true });
    privateSprint = await projectWithTask(everyone);
    await makeSprintPrivate(privateSprint, [owner]);

    const chats = await owner.api.get('/api/v1/main-chats');
    const rows = Array.isArray(chats.body) ? chats.body : (chats.body && chats.body.data) || [];
    const dmSpace = rows.find((row) => row.default === true);
    const channelSpace = rows.find((row) => row.default !== true);
    expect(dmSpace && channelSpace).toBeTruthy();

    const dmSpaceId = new ObjectId(String(dmSpace._id));
    const dmSprint = await db.collection('sprints').findOne({ projectId: dmSpaceId });
    const dmTaskId = new ObjectId();
    await db.collection('tasks').insertOne({
        _id: dmTaskId,
        TaskName: 'Chat',
        ProjectID: dmSpaceId,
        sprintId: dmSprint ? dmSprint._id : new ObjectId(),
        mainChat: true,
        AssigneeUserId: [admin.uid, member.uid],
        watchers: [admin.uid, member.uid],
        deletedStatusKey: 0,
        isParentTask: true,
    });
    dm = { projectId: String(dmSpaceId), sprintId: String(dmSprint ? dmSprint._id : ''), taskId: String(dmTaskId) };

    orphanTaskId = new ObjectId();
    await db.collection('tasks').insertOne({
        _id: orphanTaskId,
        TaskName: 'No project',
        ProjectID: new ObjectId(),
        sprintId: new ObjectId(),
        AssigneeUserId: [member.uid],
        deletedStatusKey: 0,
        isParentTask: true,
    });

    const addChannel = async (isPrivate, assignees) => {
        const res = await owner.api.post('/api/v1/sprint', {
            companyId: state.companyId,
            projectId: String(channelSpace._id),
            sprintName: label('channel'),
            projectName: 'CHANNELS',
            userData: { id: owner.uid, Employee_Name: 'Owner' },
            mainChat: true,
            private: isPrivate,
            sendMessage: false,
            AssigneeUserId: assignees.map((s) => s.uid),
            icon: {},
            folder: null,
        });
        expect(res.status).toBe(200);
        const channel = await db.collection('sprints').findOne({ projectId: new ObjectId(String(channelSpace._id)), name: res.body.data && res.body.data.name });
        return { projectId: String(channelSpace._id), sprintId: String((res.body.data && res.body.data._id) || (channel && channel._id)), taskId: 'default' };
    };
    channels = { public: await addChannel(false, everyone), private: await addChannel(true, [owner, admin]) };
});

afterAll(async () => {
    if (client) await client.close();
});

describe('posting a comment follows thread visibility', () => {
    it('refuses a member and a guest on every thread of a private project they are not on, and stores nothing', async () => {
        for (const session of [member, guest]) {
            for (const where of [closed, sprintChat(closed), projectLevel(closed)]) {
                const message = label('outsider');
                expect(outcome(await post(session, where, message))).toEqual(REFUSED);
                expect(await countByMessage(message)).toBe(0);
            }
        }
    });

    it('refuses a task of a private project named under a project the caller can read', async () => {
        expect(outcome(await post(member, { ...closed, projectId: open.projectId }))).toEqual(REFUSED);
    });

    it('refuses a sprint of another project named under a project the caller can read', async () => {
        expect(outcome(await post(member, { projectId: open.projectId, sprintId: closed.sprintId, taskId: 'default' }))).toEqual(REFUSED);
    });

    it('refuses a member on a private sprint they are not on', async () => {
        expect(outcome(await post(member, privateSprint))).toEqual(REFUSED);
        expect(outcome(await post(member, sprintChat(privateSprint)))).toEqual(REFUSED);
    });

    it('lets a member post on every thread of a private project they are on', async () => {
        for (const where of [sharedPrivate, sprintChat(sharedPrivate), projectLevel(sharedPrivate)]) {
            expect(outcome(await post(member, where))).toEqual(ACCEPTED);
        }
    });

    it('lets every role post on a public project', async () => {
        for (const session of everyone) expect(outcome(await post(session, open))).toEqual(ACCEPTED);
    });

    it('lets owners and admins post on a private project and a private sprint they are not on', async () => {
        for (const session of [owner, admin]) {
            expect(outcome(await post(session, closed))).toEqual(ACCEPTED);
            expect(outcome(await post(session, privateSprint))).toEqual(ACCEPTED);
        }
    });

    it('keeps a direct message to its participants, the owner included', async () => {
        for (const session of [owner, guest]) expect(outcome(await post(session, dm))).toEqual(REFUSED);
        for (const session of [admin, member]) expect(outcome(await post(session, dm))).toEqual(ACCEPTED);
    });

    it('refuses the direct-message space without a conversation', async () => {
        expect(outcome(await post(member, projectLevel(dm)))).toEqual(REFUSED);
        expect(outcome(await post(member, sprintChat(dm)))).toEqual(REFUSED);
    });

    it('keeps a private channel to its members plus owners and admins', async () => {
        for (const session of [member, guest]) expect(outcome(await post(session, channels.private))).toEqual(REFUSED);
        for (const session of [owner, admin]) expect(outcome(await post(session, channels.private))).toEqual(ACCEPTED);
        for (const session of everyone) expect(outcome(await post(session, channels.public))).toEqual(ACCEPTED);
    });
});

describe('changing a comment follows thread visibility', () => {
    it('refuses a pin on a thread the caller cannot read', async () => {
        const inClosed = await posted(owner, closed);
        const inPrivateSprint = await posted(owner, privateSprint);
        const inDm = await posted(admin, dm);
        const inPrivateChannel = await posted(owner, channels.private);
        for (const id of [inClosed, inPrivateSprint, inPrivateChannel]) {
            expect(outcome(await pin(member, id))).toEqual(REFUSED);
            expect((await storedComment(id)).pinnedMessage).not.toBe(true);
        }
        expect(outcome(await pin(owner, inDm))).toEqual(REFUSED);
        expect(outcome(await pin(guest, inDm))).toEqual(REFUSED);
        expect((await storedComment(inDm)).pinnedMessage).not.toBe(true);
    });

    it('refuses the author an edit or delete once the thread is out of their sight', async () => {
        const thread = await projectWithTask(everyone);
        const mine = await posted(member, thread);
        await makeSprintPrivate(thread, [owner]);

        expect(outcome(await edit(member, mine, { message: 'changed' }))).toEqual(REFUSED);
        expect(outcome(await edit(member, mine, { isDeleted: true }))).toEqual(REFUSED);
        const stored = await storedComment(mine);
        expect(stored.message).not.toBe('changed');
        expect(stored.isDeleted).not.toBe(true);
    });

    it('refuses moving a comment to another thread or author', async () => {
        const mine = await posted(member, open);
        const moves = [
            { projectId: closed.projectId },
            { sprintId: closed.sprintId },
            { taskId: closed.taskId },
            { projectId: closed.projectId, sprintId: closed.sprintId, taskId: closed.taskId },
            { userId: owner.uid },
        ];
        for (const move of moves) {
            const res = await edit(member, mine, { message: 'moved', ...move });
            expect(res.status).toBe(400);
        }
        const stored = await storedComment(mine);
        expect(String(stored.projectId)).toBe(open.projectId);
        expect(String(stored.taskId)).toBe(open.taskId);
        expect(String(stored.userId)).toBe(member.uid);
        expect(stored.message).not.toBe('moved');
    });

    it('still serves edits, deletes and pins on a thread the caller can read', async () => {
        const mine = await posted(member, sharedPrivate);
        expect(outcome(await edit(member, mine, { message: 'edited', projectId: sharedPrivate.projectId, taskId: sharedPrivate.taskId }))).toEqual(ACCEPTED);
        expect((await storedComment(mine)).message).toBe('edited');

        const theirs = await posted(owner, sharedPrivate);
        expect(outcome(await pin(member, theirs))).toEqual(ACCEPTED);
        expect(outcome(await edit(admin, mine, { isDeleted: true }))).toEqual(ACCEPTED);

        const sprintMessage = await posted(member, sprintChat(sharedPrivate));
        expect(outcome(await edit(member, sprintMessage, { message: 'sprint edit', taskId: 'default' }))).toEqual(ACCEPTED);

        const inDm = await posted(admin, dm);
        expect(outcome(await pin(member, inDm))).toEqual(ACCEPTED);
    });

    it('keeps the author rule on a readable thread', async () => {
        const theirs = await posted(owner, open);
        const res = await edit(member, theirs, { message: 'not mine' });
        expect(res.status).toBe(403);
    });
});

describe('reactions follow the same visibility', () => {
    it('refuses a reaction on a comment in a thread the caller cannot read', async () => {
        const inClosed = await posted(owner, closed);
        const inDm = await posted(admin, dm);
        expect(outcome(await react(member, 'comment', inClosed))).toEqual(REFUSED);
        expect(outcome(await react(owner, 'comment', inDm))).toEqual(REFUSED);
        expect(((await storedComment(inClosed)).reactions || []).length).toBe(0);
    });

    it('refuses a reaction on a task the caller cannot read', async () => {
        expect(outcome(await react(member, 'task', closed.taskId))).toEqual(REFUSED);
        expect(outcome(await react(guest, 'task', dm.taskId))).toEqual(REFUSED);
    });

    it('serves reactions where the caller can read', async () => {
        const inOpen = await posted(owner, open);
        const res = await react(member, 'comment', inOpen);
        expect(res.body.status).toBe(true);
        expect((await storedComment(inOpen)).reactions.map((r) => r.userId)).toContain(member.uid);
        expect((await react(member, 'task', open.taskId)).body.status).toBe(true);
    });

    it('records the caller as the reactor', async () => {
        const inOpen = await posted(owner, open);
        await member.api.post('/api/v2/reactions', { targetType: 'comment', targetId: inOpen, emoji: '🎉', userData: { id: admin.uid } });
        const reactors = (await storedComment(inOpen)).reactions.map((r) => r.userId);
        expect(reactors).toContain(member.uid);
        expect(reactors).not.toContain(admin.uid);
    });
});

describe('a task record outside a project is read by its participants only', () => {
    it('refuses a direct-message record to everyone outside it, the owner included', async () => {
        for (const session of [owner, guest]) expect(outcome(await readTask(session, dm.taskId))).toEqual(REFUSED);
    });

    it('serves a direct-message record to its participants', async () => {
        for (const session of [admin, member]) {
            const res = await readTask(session, dm.taskId);
            expect(res.status).toBe(200);
            expect(String(res.body._id)).toBe(dm.taskId);
        }
    });

    it('refuses a record whose project does not exist to every role', async () => {
        for (const session of everyone) expect(outcome(await readTask(session, orphanTaskId))).toEqual(REFUSED);
    });

    it('leaves project task reads as they were', async () => {
        for (const session of everyone) expect((await readTask(session, open.taskId)).status).toBe(200);
        for (const session of [member, guest]) expect(outcome(await readTask(session, closed.taskId))).toEqual(REFUSED);
        for (const session of [owner, admin]) expect((await readTask(session, closed.taskId)).status).toBe(200);
        expect((await readTask(member, sharedPrivate.taskId)).status).toBe(200);
        expect(outcome(await readTask(member, privateSprint.taskId))).toEqual(REFUSED);
        expect((await readTask(owner, privateSprint.taskId)).status).toBe(200);
    });
});
