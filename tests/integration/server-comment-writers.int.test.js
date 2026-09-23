const { MongoClient, ObjectId } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { generateToken, hashToken, tokenPrefixOf } = require('../../Modules/ApiTokens/helpers/apiTokenRules');

const state = readState();

jest.setTimeout(120000);

let client;
let db;
let owner;
let admin;
let member;
let guest;
let open;
let privateSprint;
let dm;
let dmSpaceId;
const tokenIds = [];
const agentIds = [];

const label = (what) => `[QA server comments] ${what} ${uniqueSuffix()}`;
const countByMessage = (message) => db.collection('comments').countDocuments({ message });

async function projectWithTask(assignees) {
    const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    return { projectId: String(project._id), sprintId: String(task.sprintId), taskId: String(task._id) };
}

async function makeSprintPrivate(thread, assignees) {
    const res = await owner.api.patch(`/api/v1/sprint/${thread.sprintId}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: thread.projectId,
        updateObject: { $set: { private: true, AssigneeUserId: assignees.map((s) => s.uid) } },
    });
    expect(res.body.status).toBe(true);
}

const mcpClientFor = async (session) => {
    const res = await session.api.post('/api/v2/api-tokens', { name: label('mcp token'), scopes: ['read', 'write'], expiresInDays: 1 });
    expect(res.body.status).toBe(true);
    tokenIds.push({ session, id: res.body.data._id });
    return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
};

const mcpComment = (mcp, taskId, body) => mcp.post('/mcp', {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task.comment', arguments: { taskId, body } },
});

/* The API mints no token bound to a workspace agent, so the test writes that row itself. */
async function agentClient(agentId) {
    const raw = generateToken();
    await db.collection('apiTokens').insertOne({
        name: label('agent token'), tokenHash: hashToken(raw), prefix: tokenPrefixOf(raw), scopes: ['read', 'write'],
        userId: owner.uid, active: true, kind: 'agent', agentId: String(agentId), projectIds: [], createdAt: new Date(), updatedAt: new Date(),
    });
    return createApiClient({ baseURL: state.baseURL, accessToken: raw, companyId: state.companyId });
}

async function proposalToComment(thread, body) {
    const created = await admin.api.post('/api/v2/agents', {
        name: label('agent'), description: 'server comment writers', autonomy: 1, spendCapUsd: 1,
        projectIds: [], skills: [], allowedActions: ['task.comment'],
    });
    expect(created.body.status).toBe(true);
    const agentId = created.body.data._id;
    agentIds.push(agentId);
    const api = await agentClient(agentId);
    const res = await api.post('/api/v2/agents/proposals', {
        agentId, taskId: thread.taskId, projectId: thread.projectId, what: label('proposal'), why: 'integration',
        changes: [{ action: 'task.comment', params: { taskId: thread.taskId, body }, label: 'Comment' }],
    });
    expect(res.body.status).toBe(true);
    return res.body.data._id;
}

const clientMessage = (session, projectId, message) => session.api.post('/api/v2/billing/client-view/message', { projectId, message });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(String(state.companyId));
    [owner, admin, member, guest] = await Promise.all(['owner', 'admin', 'member', 'guest'].map((role) => loginAs(role)));

    open = await projectWithTask([owner, admin, member, guest]);
    privateSprint = await projectWithTask([owner, admin, member, guest]);
    await makeSprintPrivate(privateSprint, [owner]);

    const chats = await owner.api.get('/api/v1/main-chats');
    const rows = Array.isArray(chats.body) ? chats.body : (chats.body && chats.body.data) || [];
    const dmSpace = rows.find((row) => row.default === true);
    expect(dmSpace).toBeTruthy();
    dmSpaceId = String(dmSpace._id);
    const dmSprint = await db.collection('sprints').findOne({ projectId: new ObjectId(dmSpaceId) });
    const dmTaskId = new ObjectId();
    await db.collection('tasks').insertOne({
        _id: dmTaskId,
        TaskName: 'Chat',
        CompanyId: String(state.companyId),
        ProjectID: new ObjectId(dmSpaceId),
        sprintId: dmSprint ? dmSprint._id : new ObjectId(),
        mainChat: true,
        AssigneeUserId: [member.uid, guest.uid],
        watchers: [member.uid, guest.uid],
        deletedStatusKey: 0,
        isParentTask: true,
    });
    dm = { projectId: dmSpaceId, taskId: String(dmTaskId) };
});

afterAll(async () => {
    for (const { session, id } of tokenIds) await session.api.delete(`/api/v2/api-tokens/${id}`).catch(() => {});
    for (const id of agentIds) await admin.api.delete(`/api/v2/agents/${id}`).catch(() => {});
    if (client) await client.close();
});

describe('a comment written through an MCP token follows thread visibility', () => {
    it('refuses the owner a direct message they are not in, and stores nothing', async () => {
        const mcp = await mcpClientFor(owner);
        const message = label('mcp into dm');
        const res = await mcpComment(mcp, dm.taskId, message);

        expect(res.body.result.isError).toBe(true);
        expect(JSON.parse(res.body.result.content[0].text)).toMatchObject({ refused: true, action: 'task.comment' });
        expect(await countByMessage(message)).toBe(0);
    });

    it('refuses a member a private sprint they are not on, and stores nothing', async () => {
        const mcp = await mcpClientFor(member);
        const message = label('mcp into private sprint');
        const res = await mcpComment(mcp, privateSprint.taskId, message);

        expect(res.body.result.isError).toBe(true);
        expect(await countByMessage(message)).toBe(0);
    });

    it('still posts on a task the token holder can open', async () => {
        const mcp = await mcpClientFor(member);
        const message = label('mcp into open');
        const res = await mcpComment(mcp, open.taskId, message);

        expect(res.body.result.isError).toBeFalsy();
        expect(await countByMessage(message)).toBe(1);
    });
});

describe('a comment an approved agent proposal writes follows thread visibility for the approver', () => {
    it('does not apply a comment on a private sprint the approving member is not on', async () => {
        const message = label('proposal into private sprint');
        const proposalId = await proposalToComment(privateSprint, message);
        const res = await member.api.post(`/api/v2/agents/proposals/${proposalId}/approve`);

        expect(res.body.data.applied).toEqual([expect.objectContaining({ action: 'task.comment', ok: false })]);
        expect(await countByMessage(message)).toBe(0);
    });

    it('does not apply a comment on a direct message the approving admin is not in', async () => {
        const message = label('proposal into dm');
        const proposalId = await proposalToComment(dm, message);
        const res = await admin.api.post(`/api/v2/agents/proposals/${proposalId}/approve`);

        expect(res.body.data.applied).toEqual([expect.objectContaining({ action: 'task.comment', ok: false })]);
        expect(await countByMessage(message)).toBe(0);
    });

    it('still applies a comment on a task the approver can open', async () => {
        const message = label('proposal into open');
        const proposalId = await proposalToComment(open, message);
        const res = await member.api.post(`/api/v2/agents/proposals/${proposalId}/approve`);

        expect(res.body.data.applied).toEqual([expect.objectContaining({ action: 'task.comment', ok: true })]);
        expect(await countByMessage(message)).toBe(1);
    });
});

describe('a client view message follows thread visibility', () => {
    it('refuses an id that is a chat space, not a project, and stores nothing', async () => {
        const message = label('client into dm space');
        const res = await clientMessage(member, dmSpaceId, message);

        expect(res.body.status).toBe(false);
        expect(await countByMessage(message)).toBe(0);
    });

    it('refuses an id with nothing behind it, and stores nothing', async () => {
        const message = label('client into nothing');
        const res = await clientMessage(member, String(new ObjectId()), message);

        expect(res.body.status).toBe(false);
        expect(await countByMessage(message)).toBe(0);
    });

    it('still posts into a project the sender can open', async () => {
        const message = label('client into open');
        const res = await clientMessage(member, open.projectId, message);

        expect(res.body.status).toBe(true);
        expect(await countByMessage(message)).toBe(1);
    });
});
