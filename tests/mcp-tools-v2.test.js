const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn() }));
jest.mock('../Modules/Agents/proposals', () => ({
    create: jest.fn(async (companyId, o) => mockDb.crud(companyId, {
        type: 'agent_proposals',
        data: { agentId: String(o.agent._id), agentName: o.agent.name, taskId: o.taskId || null, what: o.what, why: o.why, changes: o.changes, status: 'pending', source: o.source, requestedBy: o.requestedBy, tokenId: o.tokenId, tokenProjectIds: o.tokenProjectIds, allowedActions: o.allowedActions },
    }, 'save')),
}));
jest.mock('../Modules/Agents/actions', () => ({
    ...jest.requireActual('../Modules/Agents/actions'),
    authorizeRead: jest.fn(async () => true),
    perform: jest.fn(async ({ action }) => ({ auditId: 'audit-1', result: { action }, undo: { kind: 'x' } })),
    refusal: jest.fn(async (companyId, actor, { reason }) => Object.assign(new Error(reason), { name: 'RefusedError', refused: true })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { ROLE_OWNER, ROLE_MEMBER } = require('../Config/roleTypes');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const tools = require('../Modules/Mcp/tools');
const names = require('../Modules/Mcp/names');

const C = '6f0000000000000000000c01';
const OTHER_C = '6f0000000000000000000c02';
const USER = '6f0000000000000000000001';
const MATE = '6f0000000000000000000002';
const STRANGER = '6f0000000000000000000003';
const PROJECT = '6f00000000000000000000a1';
const SECRET_PROJECT = '6f00000000000000000000a2';
const SPRINT = '6f00000000000000000000b1';
const PRIVATE_SPRINT = '6f00000000000000000000b2';
const TOKEN = '6f0000000000000000000101';

const ctxFor = (over = {}) => ({
    companyId: C, userId: USER, actor: { kind: 'agent', userId: USER, agentName: 'Laptop', tokenId: TOKEN }, ip: '1.1.1.1', projectIds: [], canWrite: true,
    token: { _id: TOKEN, userId: USER, scopes: ['read', 'write'], active: true }, ...over,
});

let seq = 0;
const taskId = () => `6f00000000000000000${String(++seq).padStart(5, '0')}`;
const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: taskId(), TaskKey: `AP-${seq}`, TaskName: `Task ${seq}`, CompanyId: C, ProjectID: PROJECT, sprintId: SPRINT,
    status: { text: 'To do', type: 'default_active' }, statusType: 'default_active', Task_Priority: 'HIGH',
    AssigneeUserId: [USER, MATE], TaskType: 'Bug', TaskTypeKey: 2, updatedAt: new Date(Date.UTC(2026, 8, 1, 0, seq)), deletedStatusKey: 0,
    ...over,
});

const payload = (cursor) => JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString('utf8'));
const withPayload = (cursor, change) => {
    const [, sig] = cursor.split('.');
    return `${Buffer.from(JSON.stringify({ ...payload(cursor), ...change })).toString('base64url')}.${sig}`;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jest.restoreAllMocks();
    process.env.MCP_TOOLS_V2 = 'on';
    process.env.MCP_CURSOR_SECRET = 'unit-test-cursor-secret-of-32-chars-or-more';
    scope.visibleProjectIds.mockResolvedValue([PROJECT]);
    guard.getRoleType.mockResolvedValue(ROLE_MEMBER);
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Apollo', taskTypeCounts: [{ key: 1, name: 'Task' }, { key: 2, name: 'Bug' }] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SECRET_PROJECT, ProjectName: 'Skunkworks', isPrivateSpace: true });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, name: 'Hush sprint', projectId: PROJECT, private: true, AssigneeUserId: [MATE] });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: USER, roleType: 'member' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MATE, roleType: 'member' });
    mockDb.seed(dbCollections.USERS, { _id: USER, Employee_Name: 'Mevil B' });
    mockDb.seed(dbCollections.USERS, { _id: MATE, Employee_Name: 'Asha K' });
    mockDb.seed(dbCollections.USERS, { _id: STRANGER, Employee_Name: 'Outsider' });
});

afterAll(() => {
    delete process.env.MCP_TOOLS_V2;
    delete process.env.MCP_CURSOR_SECRET;
});

describe('names in results', () => {
    it('carries a ref and the human names of project, sprint, status, assignees, priority and task type', async () => {
        const t = seedTask();
        const { tasks } = await tools.call(ctxFor(), 'tasks.search', {});
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            ref: `task:${t._id}`,
            taskId: t._id,
            project: { id: PROJECT, name: 'Apollo' },
            sprint: { id: SPRINT, name: 'Sprint 1' },
            status: 'To do',
            statusType: 'default_active',
            priority: 'HIGH',
            priorityName: 'High',
            taskType: { key: 2, name: 'Bug' },
            assignees: [{ id: USER, name: 'Mevil B' }, { id: MATE, name: 'Asha K' }],
        });
    });

    it('leaves out tasks under a project the caller cannot open', async () => {
        seedTask({ ProjectID: SECRET_PROJECT, sprintId: null });
        const { tasks } = await tools.call(ctxFor(), 'tasks.search', {});
        expect(tasks).toEqual([]);
    });

    it('does not resolve names under a project the caller cannot open, even for a row handed to it', async () => {
        const t = seedTask({ ProjectID: SECRET_PROJECT, sprintId: null });
        const [row] = await names.forTasks(ctxFor(), [t], () => ({}));
        expect(row.project).toEqual({ id: SECRET_PROJECT, name: null });
        expect(row.assignees).toEqual([{ id: USER, name: null }, { id: MATE, name: null }]);
        expect(JSON.stringify(row)).not.toMatch(/Skunkworks|Asha/);
    });

    it('does not resolve a project the token is narrowed away from', async () => {
        seedTask();
        const { tasks } = await tools.call(ctxFor({ projectIds: [SECRET_PROJECT] }), 'tasks.search', {});
        expect(tasks).toHaveLength(0);
        seedTask({ ProjectID: SECRET_PROJECT });
        scope.visibleProjectIds.mockResolvedValue([PROJECT, SECRET_PROJECT]);
        const narrowed = await tools.call(ctxFor({ projectIds: [SECRET_PROJECT] }), 'tasks.search', {});
        expect(narrowed.tasks[0].project).toEqual({ id: SECRET_PROJECT, name: 'Skunkworks' });
        const other = await tools.call(ctxFor({ projectIds: [PROJECT] }), 'tasks.search', {});
        expect(other.tasks.every((row) => row.project.id === PROJECT)).toBe(true);
    });

    it('hides a private sprint\'s name from a member who is not on it, and shows it to an owner', async () => {
        const t = seedTask({ sprintId: PRIVATE_SPRINT });
        const member = await tools.call(ctxFor(), 'tasks.search', {});
        expect(member.tasks).toEqual([]);
        const [row] = await names.forTasks(ctxFor(), [t], () => ({}));
        expect(row.sprint).toEqual({ id: PRIVATE_SPRINT, name: null });
        guard.getRoleType.mockResolvedValue(ROLE_OWNER);
        const owner = await tools.call(ctxFor(), 'tasks.search', {});
        expect(owner.tasks[0].sprint).toEqual({ id: PRIVATE_SPRINT, name: 'Hush sprint' });
    });

    it('does not name an assignee who is not a member of this company', async () => {
        seedTask({ AssigneeUserId: [STRANGER] });
        const { tasks } = await tools.call(ctxFor(), 'tasks.search', {});
        expect(tasks[0].assignees).toEqual([{ id: STRANGER, name: null }]);
    });

    it('gives task.get a ref and the same visibility-checked names', async () => {
        const t = seedTask({ description: 'Goal: do it' });
        const brief = await tools.call(ctxFor(), 'task.get', { taskId: t._id });
        expect(brief).toMatchObject({
            ref: `task:${t._id}`, title: t.TaskName, project: { id: PROJECT, name: 'Apollo' }, sprint: { id: SPRINT, name: 'Sprint 1' },
            priorityName: 'High', taskType: { key: 2, name: 'Bug' }, assignees: [{ id: USER, name: 'Mevil B' }, { id: MATE, name: 'Asha K' }],
        });
        const hidden = seedTask({ sprintId: PRIVATE_SPRINT });
        expect(await tools.call(ctxFor(), 'task.get', { taskId: hidden._id })).toEqual({ error: 'task not found' });
    });

    it('gives docs.read a ref and the page\'s project name', async () => {
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Spec', rawText: 'Body', content: {}, ProjectID: PROJECT });
        const out = await tools.call(ctxFor(), 'docs.read', { pageId: page._id });
        expect(out).toMatchObject({ ref: `page:${page._id}`, pageId: page._id, title: 'Spec', project: { id: PROJECT, name: 'Apollo' } });
    });
});

describe('pagination by default', () => {
    it('pages tasks.search at 25 by default and walks every row once with the cursor', async () => {
        for (let i = 0; i < 30; i += 1) seedTask();
        const first = await tools.call(ctxFor(), 'tasks.search', {});
        expect(first.tasks).toHaveLength(25);
        expect(typeof first.nextCursor).toBe('string');
        const second = await tools.call(ctxFor(), 'tasks.search', { cursor: first.nextCursor });
        expect(second.tasks).toHaveLength(5);
        expect(second.nextCursor).toBeUndefined();
        const ids = [...first.tasks, ...second.tasks].map((row) => row.taskId);
        expect(new Set(ids).size).toBe(30);
    });

    it('caps a page at 100', async () => {
        for (let i = 0; i < 105; i += 1) seedTask();
        const out = await tools.call(ctxFor(), 'tasks.search', { limit: 500 });
        expect(out.tasks).toHaveLength(100);
        expect(out.nextCursor).toBeDefined();
    });

    it('pages tasks.next and leaves closed tasks out', async () => {
        for (let i = 0; i < 27; i += 1) seedTask({ AssigneeUserId: [USER] });
        seedTask({ AssigneeUserId: [USER], statusType: 'close' });
        const first = await tools.call(ctxFor(), 'tasks.next', {});
        expect(first.tasks).toHaveLength(25);
        const second = await tools.call(ctxFor(), 'tasks.next', { cursor: first.nextCursor });
        expect(second.tasks).toHaveLength(2);
        expect([...first.tasks, ...second.tasks].every((row) => row.statusType !== 'close')).toBe(true);
    });

    it('offers cursor and limit on every list tool', () => {
        const byName = Object.fromEntries(tools.manifest().map((t) => [t.name, t]));
        ['tasks.next', 'tasks.search'].forEach((name) => {
            expect(byName[name].inputSchema.properties).toMatchObject({ cursor: { type: 'string' }, limit: { type: 'integer' } });
        });
    });
});

describe('cursors are bound to the company, the caller and the query', () => {
    const firstCursor = async () => {
        for (let i = 0; i < 30; i += 1) seedTask();
        return (await tools.call(ctxFor(), 'tasks.search', {})).nextCursor;
    };
    const invalid = { code: -32602, message: expect.stringMatching(/cursor/i) };

    it('refuses a cursor whose payload was edited', async () => {
        const cursor = await firstCursor();
        await expect(tools.call(ctxFor(), 'tasks.search', { cursor: withPayload(cursor, { o: 0 }) })).rejects.toMatchObject(invalid);
    });

    it('refuses garbage', async () => {
        await expect(tools.call(ctxFor(), 'tasks.search', { cursor: 'not-a-cursor' })).rejects.toMatchObject(invalid);
    });

    it('refuses a cursor from another company', async () => {
        const cursor = await firstCursor();
        await expect(tools.call(ctxFor({ companyId: OTHER_C }), 'tasks.search', { cursor })).rejects.toMatchObject(invalid);
    });

    it('refuses a cursor issued to another caller or another token', async () => {
        const cursor = await firstCursor();
        await expect(tools.call(ctxFor({ userId: MATE, actor: { kind: 'agent', userId: MATE } }), 'tasks.search', { cursor })).rejects.toMatchObject(invalid);
        await expect(tools.call(ctxFor({ token: { _id: '6f0000000000000000000102', userId: USER, scopes: ['read'], active: true } }), 'tasks.search', { cursor })).rejects.toMatchObject(invalid);
    });

    it('refuses a cursor replayed against another query or another tool', async () => {
        const cursor = await firstCursor();
        await expect(tools.call(ctxFor(), 'tasks.search', { cursor, query: 'other' })).rejects.toMatchObject(invalid);
        await expect(tools.call(ctxFor(), 'tasks.next', { cursor })).rejects.toMatchObject(invalid);
    });

    it('refuses a cursor once it has expired', async () => {
        const cursor = await firstCursor();
        const now = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(now + 61 * 60 * 1000);
        await expect(tools.call(ctxFor(), 'tasks.search', { cursor })).rejects.toMatchObject(invalid);
    });

    it('refuses a cursor signed with another key', async () => {
        const cursor = await firstCursor();
        process.env.MCP_CURSOR_SECRET = 'rotated-cursor-secret-of-32-chars-or-more';
        await expect(tools.call(ctxFor(), 'tasks.search', { cursor })).rejects.toMatchObject(invalid);
    });
});

describe('annotations', () => {
    it('derives every hint from the action rating', () => {
        tools.manifest().forEach((t) => {
            const r = actions.rating(t.name);
            expect(t.annotations).toEqual({
                readOnlyHint: !r.write,
                destructiveHint: r.write && (!r.reversible || r.scope === 'workspace'),
                idempotentHint: !r.write,
                openWorldHint: false,
            });
        });
    });
});

describe('destructive calls open a proposal', () => {
    const irreversible = (key) => {
        const real = actions.rating;
        jest.spyOn(actions, 'rating').mockImplementation((k) => (k === key ? { ...real(k), reversible: false } : real(k)));
    };

    it('files a proposal attributed to the token user, marked MCP, and changes nothing', async () => {
        const t = seedTask();
        irreversible('task.comment');
        const out = await tools.call(ctxFor({ projectIds: [PROJECT] }), 'task.comment', { taskId: t._id, body: 'drop it' });
        expect(actions.perform).not.toHaveBeenCalled();
        expect(proposals.create).toHaveBeenCalledTimes(1);
        const saved = mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS][0];
        expect(saved).toMatchObject({ source: 'mcp', requestedBy: USER, tokenId: TOKEN, tokenProjectIds: [PROJECT], taskId: t._id, status: 'pending' });
        expect(saved.changes).toEqual([expect.objectContaining({ action: 'task.comment', params: { taskId: t._id, body: 'drop it' } })]);
        expect(out).toEqual({ ok: false, pending: true, approval: 'pending', proposalRef: `proposal:${saved._id}`, proposalId: String(saved._id), message: expect.stringMatching(/approv/i) });
    });

    it('treats a workspace-scope write as destructive', async () => {
        const real = actions.rating;
        jest.spyOn(actions, 'rating').mockImplementation((k) => (k === 'task.create' ? { ...real(k), scope: 'workspace' } : real(k)));
        const out = await tools.call(ctxFor(), 'task.create', { projectId: PROJECT, title: 'Wide' });
        expect(out.pending).toBe(true);
        expect(actions.perform).not.toHaveBeenCalled();
    });

    it('still needs the write scope and the registry\'s yes before it files anything', async () => {
        const t = seedTask();
        irreversible('task.comment');
        await expect(tools.call(ctxFor({ canWrite: false }), 'task.comment', { taskId: t._id, body: 'x' })).rejects.toMatchObject({ code: -32004 });
        await expect(tools.call(ctxFor({ allowedActions: ['task.link'] }), 'task.comment', { taskId: t._id, body: 'x' })).rejects.toMatchObject({ refused: true });
        expect(proposals.create).not.toHaveBeenCalled();
    });

    it('lets a non-destructive write act as today', async () => {
        const t = seedTask();
        const out = await tools.call(ctxFor(), 'task.comment', { taskId: t._id, body: 'hi' });
        expect(out).toEqual({ ok: true, auditId: 'audit-1', result: { action: 'task.comment' }, undoable: true });
        expect(actions.perform).toHaveBeenCalledTimes(1);
        expect(proposals.create).not.toHaveBeenCalled();
    });
});
