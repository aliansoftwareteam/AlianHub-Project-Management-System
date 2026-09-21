const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// MCP_TOOLS_V2 against a real MongoDB, in a tenant database of its own: a list
// walked over two pages with names resolved from the real collections, and a
// destructive call that files a proposal, changes nothing, and applies as the
// token's user once a person approves it.

const ENV_KEYS = ['MONGODB_URL', 'MCP_TOOLS_V2', 'MCP_CURSOR_SECRET', 'JWT_SECRET'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.MONGODB_URL = resolveMongoUrl();
process.env.MCP_TOOLS_V2 = 'on';
process.env.MCP_CURSOR_SECRET = crypto.randomBytes(16).toString('hex');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'mcp-tools-v2-integration-secret';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoConnections = require('../../middlewares/mongoConnector/helper');
const actions = require('../../Modules/Agents/actions');
const proposals = require('../../Modules/Agents/proposals');
const tools = require('../../Modules/Mcp/tools');

jest.setTimeout(60000);

const COMPANY = crypto.randomBytes(12).toString('hex');
const OTHER_COMPANY = crypto.randomBytes(12).toString('hex');
const OWNER = new ObjectId();
const MATE = new ObjectId();
const ADMIN = new ObjectId();
const PROJECT = new ObjectId();
const SPRINT = new ObjectId();
const TOKEN = String(new ObjectId());
const TASKS = 32;

const ctx = () => ({
    companyId: COMPANY, userId: String(OWNER), ip: '127.0.0.1', projectIds: [], canWrite: true,
    token: { _id: TOKEN, userId: String(OWNER), scopes: ['read', 'write'], active: true },
    actor: { kind: 'agent', userId: String(OWNER), agentId: null, agentName: 'Laptop', tokenId: TOKEN, viaAccount: 'personal', personName: 'Olive Owner' },
});

let client;
let taskIds;

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db(COMPANY);
    await client.db('global').collection('users').insertMany([
        { _id: OWNER, Employee_Name: 'Olive Owner' },
        { _id: MATE, Employee_Name: 'Mateo Mate' },
    ]);
    await db.collection('company_users').insertMany([
        { userId: String(OWNER), roleType: 1, status: 2 },
        { userId: String(MATE), roleType: 3, status: 2 },
        { userId: String(ADMIN), roleType: 2, status: 2 },
    ]);
    await db.collection('apiTokens').insertOne({ _id: new ObjectId(TOKEN), userId: String(OWNER), name: 'Laptop', active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000) });
    await client.db(OTHER_COMPANY).collection('company_users').insertOne({ userId: String(OWNER), roleType: 1, status: 2 });
    await db.collection('projects').insertOne({ _id: PROJECT, ProjectName: 'Orbit', isPrivateSpace: false, deletedStatusKey: 0, taskTypeCounts: [{ key: 1, name: 'Task' }] });
    await db.collection('sprints').insertOne({ _id: SPRINT, name: 'Launch', projectId: PROJECT, deletedStatusKey: 0 });
    const rows = Array.from({ length: TASKS }, (_, i) => ({
        _id: new ObjectId(), TaskName: `Orbit task ${i}`, TaskKey: `OR-${i}`, CompanyId: new ObjectId(COMPANY), ProjectID: PROJECT, sprintId: SPRINT,
        status: { text: 'To do', type: 'default_active', key: 1 }, statusType: 'default_active', Task_Priority: 'LOW', TaskType: 'Task', TaskTypeKey: 1,
        AssigneeUserId: [String(MATE)], deletedStatusKey: 0, updatedAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
    }));
    await db.collection('tasks').insertMany(rows);
    taskIds = rows.map((r) => String(r._id));
});

afterAll(async () => {
    if (client) {
        await client.db('global').collection('users').deleteMany({ _id: { $in: [OWNER, MATE] } }).catch(() => {});
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.db(OTHER_COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    // The name lookup opens the shared 'global' connection too; one left open keeps jest from exiting.
    [...mongoConnections.connections].forEach((c) => mongoConnections.closeConnection(c.db));
    ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
});

describe('MCP_TOOLS_V2 over a real database', () => {
    it('walks a list over two pages with names resolved and every row once', async () => {
        const first = await tools.call(ctx(), 'tasks.search', { query: 'Orbit' });
        expect(first.tasks).toHaveLength(25);
        expect(first.nextCursor).toEqual(expect.any(String));
        expect(first.tasks[0]).toMatchObject({
            ref: expect.stringMatching(/^task:[0-9a-f]{24}$/),
            project: { id: String(PROJECT), name: 'Orbit' },
            sprint: { id: String(SPRINT), name: 'Launch' },
            assignees: [{ id: String(MATE), name: 'Mateo Mate' }],
            priorityName: 'Low',
            taskType: { key: 1, name: 'Task' },
        });
        const second = await tools.call(ctx(), 'tasks.search', { query: 'Orbit', cursor: first.nextCursor });
        expect(second.tasks).toHaveLength(TASKS - 25);
        expect(second.nextCursor).toBeUndefined();
        expect([...first.tasks, ...second.tasks].map((t) => t.taskId).sort()).toEqual([...taskIds].sort());
        await expect(tools.call({ ...ctx(), companyId: OTHER_COMPANY }, 'tasks.search', { query: 'Orbit', cursor: first.nextCursor }))
            .rejects.toMatchObject({ code: -32602 });
    });

    it('files a proposal for a destructive call, changes nothing, and applies it as the token user once approved', async () => {
        const real = actions.rating;
        const spy = jest.spyOn(actions, 'rating').mockImplementation((k) => (k === 'task.comment' ? { ...real(k), reversible: false } : real(k)));
        const out = await tools.call(ctx(), 'task.comment', { taskId: taskIds[0], body: 'Retire this task' });
        spy.mockRestore();

        expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending', proposalRef: expect.stringMatching(/^proposal:/) });
        const comments = await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.COMMENTS, data: [{}] }, 'find');
        expect(comments).toHaveLength(0);

        const filed = await proposals.get(COMPANY, out.proposalId);
        expect(filed).toMatchObject({ status: 'pending', source: 'mcp', requestedBy: String(OWNER), tokenId: TOKEN, taskId: taskIds[0], projectId: String(PROJECT) });
        expect(filed.changes).toEqual([expect.objectContaining({ action: 'task.comment', params: { taskId: taskIds[0], body: 'Retire this task' } })]);
        const inbox = await proposals.list(COMPANY, { status: 'pending', projectIds: [String(PROJECT)] });
        expect(inbox.proposals.map((p) => String(p._id))).toContain(out.proposalId);

        const edited = await proposals.approve(COMPANY, out.proposalId, { decider: { kind: 'human', userId: String(ADMIN) }, isPrivileged: true, ip: '', changes: [{ action: 'task.comment', params: { taskId: taskIds[1], body: 'Other' } }] });
        expect(edited).toMatchObject({ status: 409 });
        const decided = await proposals.approve(COMPANY, out.proposalId, { decider: { kind: 'human', userId: String(ADMIN) }, isPrivileged: true, ip: '' });
        expect(decided.error).toBeUndefined();
        expect(decided.applied).toEqual([expect.objectContaining({ action: 'task.comment', ok: true })]);
        const written = await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.COMMENTS, data: [{}] }, 'find');
        expect(written).toHaveLength(1);
        expect(written[0]).toMatchObject({ message: 'Retire this task', userId: String(OWNER), actorType: 'agent' });
    });
});
