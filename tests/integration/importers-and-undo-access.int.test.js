const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { generateToken, hashToken, tokenPrefixOf } = require('../../Modules/ApiTokens/helpers/apiTokenRules');

const state = readState();

jest.setTimeout(120000);

let client;
let db;
let owner;
let admin;
let member;
let open;
let privateSprint;
let dm;
const agentIds = [];

const label = (what) => `[QA imports undo] ${what} ${uniqueSuffix()}`;
const idOf = (session) => String(session.uid || session.userId);
const tasksNamed = (name) => db.collection('tasks').find({ TaskName: name }).toArray();

async function projectWithTask(assignees) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map(idOf), createdBy: idOf(owner) });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: idOf(owner) });
    return { projectId: String(project._id), sprintId: String(task.sprintId), taskId: String(task._id) };
}

async function makeSprintPrivate(thread, assignees) {
    const res = await owner.api.patch(`/api/v1/sprint/${thread.sprintId}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: thread.projectId,
        updateObject: { $set: { private: true, AssigneeUserId: assignees.map(idOf) } },
    });
    expect(res.body.status).toBe(true);
}

const csvImport = (session, target, name, userData = { id: idOf(session) }) => session.api.post('/api/v2/imports/csv', {
    rows: [{ 'Task Name': name }],
    projectId: target.projectId,
    sprintId: target.sprintId,
    userData,
});

const trelloImport = (session, target, { card, comment, author, userData }) => session.api.post('/api/v2/imports/trello', {
    board: {
        name: 'board',
        lists: [{ id: 'l1', name: 'To Do', closed: false }],
        cards: [{ id: 'c1', name: card, idList: 'l1', closed: false }],
        actions: [{ type: 'commentCard', data: { card: { id: 'c1' }, text: comment }, memberCreator: { fullName: author } }],
    },
    projectId: target.projectId,
    sprintId: target.sprintId,
    userData,
});

/* The API mints no token bound to a workspace agent, so the test writes that row itself. */
async function agentClient(agentId) {
    const raw = generateToken();
    await db.collection('apiTokens').insertOne({
        name: label('agent token'), tokenHash: hashToken(raw), prefix: tokenPrefixOf(raw), scopes: ['read', 'write'],
        userId: idOf(owner), active: true, kind: 'agent', agentId: String(agentId), projectIds: [], createdAt: new Date(), updatedAt: new Date(),
    });
    return createApiClient({ baseURL: state.baseURL, accessToken: raw, companyId: state.companyId });
}

/* Files an agent proposal and has `approver` approve it, so the action runs and leaves an undoable audit row. */
async function approvedAction(approver, thread, change) {
    const created = await admin.api.post('/api/v2/agents', {
        name: label('agent'), description: 'imports and undo', autonomy: 1, spendCapUsd: 1,
        projectIds: [], skills: [], allowedActions: [change.action],
    });
    expect(created.body.status).toBe(true);
    const agentId = created.body.data._id;
    agentIds.push(agentId);
    const api = await agentClient(agentId);
    const filed = await api.post('/api/v2/agents/proposals', {
        agentId, taskId: thread.taskId, projectId: thread.projectId, what: label('proposal'), why: 'integration',
        changes: [{ ...change, label: 'Change' }],
    });
    expect(filed.body.status).toBe(true);
    const approved = await approver.api.post(`/api/v2/agents/proposals/${filed.body.data._id}/approve`);
    expect(approved.body.data.applied).toEqual([expect.objectContaining({ ok: true })]);
    const [auditId] = approved.body.data.proposal.auditIds;
    expect(auditId).toBeTruthy();
    const row = await db.collection('audit_logs').findOne({ _id: new ObjectId(String(auditId)) });
    return { auditId: String(auditId), undo: row.meta.undo };
}

const undoAs = (session, auditId) => session.api.post(`/api/v1/audit-logs/${auditId}/undo`, {});
const commentOf = (id) => db.collection('comments').findOne({ _id: new ObjectId(String(id)) });
const linksOf = async (taskId) => ((await db.collection('tasks').findOne({ _id: new ObjectId(taskId) })).links || []).map((link) => String(link._id));

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(String(state.companyId));
    [owner, admin, member] = await Promise.all(['owner', 'admin', 'member'].map((role) => loginAs(role)));

    open = await projectWithTask([owner, admin, member]);
    privateSprint = await projectWithTask([owner, admin, member]);
    await makeSprintPrivate(privateSprint, [owner]);

    const chats = await owner.api.get('/api/v1/main-chats');
    const rows = Array.isArray(chats.body) ? chats.body : (chats.body && chats.body.data) || [];
    const dmSpace = rows.find((row) => row.default === true);
    expect(dmSpace).toBeTruthy();
    const dmSprint = await db.collection('sprints').findOne({ projectId: new ObjectId(String(dmSpace._id)) });
    const dmTaskId = new ObjectId();
    await db.collection('tasks').insertOne({
        _id: dmTaskId,
        TaskName: 'Chat',
        CompanyId: String(state.companyId),
        ProjectID: new ObjectId(String(dmSpace._id)),
        sprintId: dmSprint ? dmSprint._id : new ObjectId(),
        mainChat: true,
        AssigneeUserId: [idOf(member), idOf(admin)],
        watchers: [idOf(member), idOf(admin)],
        deletedStatusKey: 0,
        isParentTask: true,
    });
    dm = { projectId: String(dmSpace._id), taskId: String(dmTaskId) };
});

afterAll(async () => {
    for (const id of agentIds) await admin.api.delete(`/api/v2/agents/${id}`).catch(() => {});
    if (client) await client.close();
});

describe('an import needs the same project access as creating a task', () => {
    it('refuses a member a private project they are not in, and creates nothing', async () => {
        const [sprint] = await listSprints(owner.api, state.projects.restricted._id);
        const name = label('into restricted');
        const res = await csvImport(member, { projectId: state.projects.restricted._id, sprintId: String(sprint._id || sprint.id) }, name);

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.status).toBe(false);
        expect(await tasksNamed(name)).toHaveLength(0);
    });

    it('refuses a member a private sprint they are not on, and creates nothing', async () => {
        const name = label('into private sprint');
        const res = await csvImport(member, privateSprint, name);

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.status).toBe(false);
        expect(await tasksNamed(name)).toHaveLength(0);
    });

    it('refuses a sprint of another project named beside a project the member may write to', async () => {
        const name = label('sprint of another project');
        const res = await csvImport(member, { projectId: open.projectId, sprintId: privateSprint.sprintId }, name);

        expect(res.body.status).toBe(false);
        expect(await tasksNamed(name)).toHaveLength(0);
    });

    it('still imports into a project and sprint the member can use, as the member', async () => {
        const name = label('into open');
        const res = await csvImport(member, open, name, { id: idOf(owner), Employee_Name: 'Someone Else' });

        expect(res.body.status).toBe(true);
        const [task] = await tasksNamed(name);
        expect(task).toBeTruthy();
        expect(String(task.sprintId)).toBe(open.sprintId);
        expect(String(task.createdBy || task.Task_Leader)).toBe(idOf(member));
    });

    it('authors imported comments as the importing user, keeping the source author as text', async () => {
        const card = label('trello card');
        const comment = label('trello comment');
        const res = await trelloImport(member, open, { card, comment, author: 'Trello Person', userData: { id: idOf(owner) } });

        expect(res.body.status).toBe(true);
        const [task] = await tasksNamed(card);
        expect(task).toBeTruthy();
        const stored = await db.collection('comments').find({ taskId: task._id }).toArray();
        expect(stored).toHaveLength(1);
        expect(String(stored[0].userId)).toBe(idOf(member));
        expect(stored[0].message).toContain('Trello Person');
        expect(stored[0].message).toContain(comment);
    });
});

describe('undo follows task and thread visibility', () => {
    it('refuses a member undoing a link on a task in a private sprint they are not on', async () => {
        const { auditId, undo } = await approvedAction(owner, privateSprint, {
            action: 'task.link', params: { taskId: privateSprint.taskId, url: `https://example.test/${uniqueSuffix()}` },
        });
        const res = await undoAs(member, auditId);

        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(await linksOf(privateSprint.taskId)).toContain(String(undo.linkId));
    });

    it('refuses a member undoing a comment in a private sprint they are not on', async () => {
        const { auditId, undo } = await approvedAction(owner, privateSprint, {
            action: 'task.comment', params: { taskId: privateSprint.taskId, body: label('private sprint comment') },
        });
        const res = await undoAs(member, auditId);

        expect(res.status).toBe(403);
        expect((await commentOf(undo.commentId)).isDeleted).not.toBe(true);
    });

    it('refuses the owner undoing a comment in a direct message they are not in, whatever project the action names', async () => {
        const { auditId, undo } = await approvedAction(member, { ...dm, projectId: open.projectId }, {
            action: 'task.comment', params: { taskId: dm.taskId, projectId: open.projectId, body: label('dm comment') },
        });
        const res = await undoAs(owner, auditId);

        expect(res.status).toBe(403);
        expect((await commentOf(undo.commentId)).isDeleted).not.toBe(true);
    });

    it('still undoes a link and a comment on a task the member can open', async () => {
        const link = await approvedAction(owner, open, { action: 'task.link', params: { taskId: open.taskId, url: `https://example.test/${uniqueSuffix()}` } });
        const linkUndo = await undoAs(member, link.auditId);
        expect(linkUndo.body.status).toBe(true);
        expect(await linksOf(open.taskId)).not.toContain(String(link.undo.linkId));

        const comment = await approvedAction(owner, open, { action: 'task.comment', params: { taskId: open.taskId, body: label('open comment') } });
        const commentUndo = await undoAs(member, comment.auditId);
        expect(commentUndo.body.status).toBe(true);
        expect((await commentOf(comment.undo.commentId)).isDeleted).toBe(true);
    });
});
