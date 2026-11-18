const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(120000);

let client;
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

const refused = (res) => res.status === 404 && Boolean(res.body) && res.body.status === false;
const messagesOf = (res) => ((res.body && res.body.data) || []).map((c) => c.message);
const label = (what) => `${what} ${uniqueSuffix()}`;

async function postComment(session, { projectId, sprintId, taskId, message }) {
    const data = { objId: { projectId: String(projectId) }, project: true, message, type: 'text', userId: session.uid };
    if (taskId) {
        data.objId.sprintId = String(sprintId);
        data.project = false;
        if (taskId === 'default') data.taskId = 'default';
        else data.objId.taskId = String(taskId);
    }
    const res = await session.api.post('/api/v1/comments', { data });
    expect(res.status).toBe(200);
    return message;
}

async function projectWithComments(assignees, { isPrivate = false } = {}) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid, isPrivate });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    const where = { projectId: String(project._id), sprintId: task.sprintId, taskId: task._id };
    return {
        ...where,
        taskMessage: await postComment(owner, { ...where, message: label('task comment') }),
        sprintMessage: await postComment(owner, { ...where, taskId: 'default', message: label('sprint chat') }),
        projectMessage: await postComment(owner, { projectId: where.projectId, message: label('project comment') }),
    };
}

const pageTask = (session, t) => session.api.get('/api/v1/comments/get-paginated-messages', {
    query: { projectId: t.projectId, sprintId: t.sprintId, taskId: t.taskId, isDefault: false, mainChat: false, skipValue: 0, batchLimit: 25 },
});
const pageSprint = (session, t) => session.api.get('/api/v1/comments/get-paginated-messages', {
    query: { projectId: t.projectId, sprintId: t.sprintId, taskId: 'default', isDefault: false, mainChat: true, skipValue: 0, batchLimit: 25 },
});
const pageProject = (session, t) => session.api.get('/api/v1/comments/get-paginated-messages', {
    query: { projectId: t.projectId, skipValue: 0, batchLimit: 25 },
});
const pageChannels = (session, projectId) => session.api.get('/api/v1/comments/get-paginated-messages', {
    query: { projectId, mainChat: true, skipValue: 0, batchLimit: 100 },
});
const searchTask = (session, t, extra = {}) => session.api.get('/api/v1/comments/get-searched-messages', {
    query: { searchText: '', projectId: t.projectId, sprintId: t.sprintId, taskId: t.taskId, sort: 'desc', skip: 0, limit: 25, ...extra },
});
const searchProject = (session, t) => session.api.get('/api/v1/comments/get-searched-messages', {
    query: { searchText: 'project comment', projectId: t.projectId, skip: 0, limit: 25 },
});
const globalSearch = (session, pids) => session.api.post('/api/v1/advance/filter/search/comments', { searchText: '', pids, batchSize: 100 });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    [owner, admin, member, guest] = await Promise.all(['owner', 'admin', 'member', 'guest'].map((role) => loginAs(role)));
    everyone = [owner, admin, member, guest];

    open = await projectWithComments(everyone);
    closed = await projectWithComments([owner], { isPrivate: true });
    sharedPrivate = await projectWithComments([owner, member], { isPrivate: true });

    privateSprint = await projectWithComments(everyone);
    const sprint = await firstSprint(owner.api, privateSprint.projectId);
    const shared = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: privateSprint.projectId,
        updateObject: { $set: { private: true, AssigneeUserId: [owner.uid] } },
    });
    expect(shared.body.status).toBe(true);

    const chats = await owner.api.get('/api/v1/main-chats');
    const rows = Array.isArray(chats.body) ? chats.body : (chats.body && chats.body.data) || [];
    const dmSpace = rows.find((row) => row.default === true);
    const channelSpace = rows.find((row) => row.default !== true);
    expect(dmSpace && channelSpace).toBeTruthy();

    const db = client.db(String(state.companyId));
    const dmSprint = await db.collection('sprints').findOne({ projectId: new ObjectId(String(dmSpace._id)) });
    const dmTaskId = new ObjectId();
    await db.collection('tasks').insertOne({
        _id: dmTaskId,
        TaskName: 'Chat',
        ProjectID: new ObjectId(String(dmSpace._id)),
        sprintId: dmSprint ? dmSprint._id : new ObjectId(),
        mainChat: true,
        AssigneeUserId: [admin.uid, member.uid],
        deletedStatusKey: 0,
        isParentTask: true,
    });
    dm = { projectId: String(dmSpace._id), sprintId: String(dmSprint ? dmSprint._id : ''), taskId: String(dmTaskId) };
    dm.taskMessage = await postComment(admin, { ...dm, message: label('direct message') });

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
        const id = String((res.body.data && res.body.data._id) || (channel && channel._id));
        const where = { projectId: String(channelSpace._id), sprintId: id, taskId: 'default' };
        return { ...where, taskMessage: await postComment(owner, { ...where, message: label(isPrivate ? 'private channel' : 'public channel') }) };
    };
    channels = {
        projectId: String(channelSpace._id),
        public: await addChannel(false, everyone),
        private: await addChannel(true, [owner, admin]),
    };
});

afterAll(async () => {
    if (client) await client.close();
});

describe('comment pages follow project visibility', () => {
    it('refuses a member and a guest outside a private project on every page of it', async () => {
        for (const session of [member, guest]) {
            expect(refused(await pageTask(session, closed))).toBe(true);
            expect(refused(await pageSprint(session, closed))).toBe(true);
            expect(refused(await pageProject(session, closed))).toBe(true);
        }
    });

    it('refuses a task of a private project named under a project the caller can read', async () => {
        const res = await pageTask(member, { ...closed, projectId: open.projectId });
        expect(refused(res)).toBe(true);
    });

    it('serves every page to a member of the private project', async () => {
        expect(messagesOf(await pageTask(member, sharedPrivate))).toContain(sharedPrivate.taskMessage);
        expect(messagesOf(await pageSprint(member, sharedPrivate))).toContain(sharedPrivate.sprintMessage);
        expect(messagesOf(await pageProject(member, sharedPrivate))).toContain(sharedPrivate.projectMessage);
    });

    it('serves a public project to every role', async () => {
        for (const session of everyone) {
            expect(messagesOf(await pageTask(session, open))).toContain(open.taskMessage);
        }
    });

    it('serves an owner and an admin a private project they are not on', async () => {
        for (const session of [owner, admin]) {
            expect(messagesOf(await pageTask(session, closed))).toContain(closed.taskMessage);
            expect(messagesOf(await pageProject(session, closed))).toContain(closed.projectMessage);
        }
    });
});

describe('comment pages follow private sprints', () => {
    it('refuses a member who is not on the sprint', async () => {
        expect(refused(await pageTask(member, privateSprint))).toBe(true);
        expect(refused(await pageSprint(member, privateSprint))).toBe(true);
    });

    it('leaves the private sprint out of a page that names no sprint', async () => {
        const res = await member.api.get('/api/v1/comments/get-paginated-messages', {
            query: { projectId: privateSprint.projectId, mainChat: true, skipValue: 0, batchLimit: 100 },
        });
        expect(res.status).toBe(200);
        expect(messagesOf(res)).not.toContain(privateSprint.sprintMessage);
    });

    it('serves the owner and the admin', async () => {
        for (const session of [owner, admin]) {
            expect(messagesOf(await pageTask(session, privateSprint))).toContain(privateSprint.taskMessage);
            expect(messagesOf(await pageSprint(session, privateSprint))).toContain(privateSprint.sprintMessage);
        }
    });
});

describe('comment search follows the same visibility', () => {
    it('refuses a member searching a private project or sprint they are not on', async () => {
        expect(refused(await searchTask(member, closed))).toBe(true);
        expect(refused(await searchProject(member, closed))).toBe(true);
        expect(refused(await searchTask(member, privateSprint))).toBe(true);
        expect(refused(await searchTask(member, privateSprint, { isPinnedMessage: 'true' }))).toBe(true);
    });

    it('serves a member of the project', async () => {
        expect(messagesOf(await searchTask(member, sharedPrivate))).toContain(sharedPrivate.taskMessage);
        expect(messagesOf(await searchTask(member, { ...sharedPrivate, taskId: 'default' }))).toContain(sharedPrivate.sprintMessage);
    });

    it('serves an owner and an admin', async () => {
        for (const session of [owner, admin]) {
            expect(messagesOf(await searchTask(session, closed))).toContain(closed.taskMessage);
        }
    });

    it('drops a private project from the global comment search for a member outside it', async () => {
        const asMember = messagesOf(await globalSearch(member, [closed.projectId, open.projectId]));
        expect(asMember).not.toContain(closed.taskMessage);
        expect(asMember).toContain(open.taskMessage);
        const asCommaList = messagesOf(await globalSearch(member, `${closed.projectId},${open.projectId}`));
        expect(asCommaList).not.toContain(closed.taskMessage);
        expect(messagesOf(await globalSearch(owner, [closed.projectId]))).toContain(closed.taskMessage);
    });
});

describe('main chat comments are for the people in the chat', () => {
    it('serves a direct message to its participants', async () => {
        for (const session of [admin, member]) {
            expect(messagesOf(await pageTask(session, dm))).toContain(dm.taskMessage);
            expect(messagesOf(await searchTask(session, dm))).toContain(dm.taskMessage);
        }
    });

    it('refuses a direct message to everyone else, the owner included', async () => {
        for (const session of [owner, guest]) {
            expect(refused(await pageTask(session, dm))).toBe(true);
            expect(refused(await searchTask(session, dm))).toBe(true);
        }
    });

    it('refuses the direct-message space without a conversation', async () => {
        expect(refused(await pageChannels(guest, dm.projectId))).toBe(true);
        expect(refused(await pageProject(guest, dm))).toBe(true);
    });

    it('serves a public channel to every member', async () => {
        for (const session of everyone) {
            expect(messagesOf(await pageSprint(session, channels.public))).toContain(channels.public.taskMessage);
        }
    });

    it('refuses a private channel to a member who is not on it', async () => {
        expect(refused(await pageSprint(member, channels.private))).toBe(true);
        expect(refused(await searchTask(member, channels.private))).toBe(true);
        const everything = messagesOf(await pageChannels(member, channels.projectId));
        expect(everything).toContain(channels.public.taskMessage);
        expect(everything).not.toContain(channels.private.taskMessage);
    });

    it('serves a private channel to the people on it', async () => {
        for (const session of [owner, admin]) {
            expect(messagesOf(await pageSprint(session, channels.private))).toContain(channels.private.taskMessage);
        }
    });
});
