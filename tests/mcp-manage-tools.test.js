/* Task 046, MCP parity part 1: an outside agent updates, assigns, moves, archives and lists tasks through
   the task routes' own preparation and handlers, as the person behind its token and no further. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { inverses, undoStateOf } = require('../Modules/Agents/undo');
const approval = require('../Modules/Mcp/approval');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const {
    CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, TOKEN, LOCKED_PROJECT, LOCKED_TASK, P_OPEN, P_PRIVATE, P_DEST, PL_OTHER, S_OPEN, S_NEXT, S_SECRET, S_DEST, S_PRIVATE, F,
    BEFORE, STATUSES, TYPES, settle, ctx, olderToken, readOnly, oauth, outside, ISSUER, CLIENT, GRANT_ID, PLAIN_SCOPES,
} = world;
const { rules, seed, stored, rows, audits, snapshot, rpcThrough, listedThrough, seedGrant } = world.create(mockDb);
const jwt = require('../Config/jwt');
const rpc = rpcThrough(server);
const listed = listedThrough(server);

/* A move, and an archive or a restore that takes subtasks with it, wait for a person. This makes the change the way an approval does. */
const onceApproved = async (caller, action, params) => {
    try {
        const out = await actions.perform({ companyId: CID, actor: caller.actor, action, params, approved: true, ip: caller.ip, allowedActions: caller.allowedActions });
        await settle();
        return { ok: true, auditId: out.auditId, result: out.result || null, undoable: Boolean(out.undo) };
    } catch (error) {
        return { isError: true, error: error.message };
    }
};

const READS = ['fields.list', 'subtasks.list', 'members.list'];
const WRITES = ['task.update', 'task.assign', 'task.field.set', 'task.move', 'task.archive', 'task.restore'];

let fx;

beforeEach(() => { fx = seed(); });
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_V2', 'MCP_OAUTH', 'MCP_OAUTH_ISSUER', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; }); });

const CALLS = {
    'task.update': (taskId) => ({ taskId, title: 'Changed' }),
    'task.assign': (taskId) => ({ taskId, mode: 'add', userIds: [OWNER] }),
    'task.field.set': (taskId) => ({ taskId, fieldId: F.rating, value: 3 }),
    'task.move': (taskId) => ({ taskId, projectId: P_OPEN, sprintId: S_NEXT }),
    'task.archive': (taskId) => ({ taskId }),
    'task.restore': (taskId) => ({ taskId }),
};

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect(tools.names()).toEqual(BEFORE);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        ['fields.list', 'subtasks.list', 'members.list', 'task.edit', 'task.assignees.set', 'task.field.set', 'task.move', 'task.archive', 'task.restore'].forEach((key) => {
            expect(registry.has(key)).toBe(false);
            expect(actions.rating(key)).toBeNull();
        });
        expect((await rpc(ctx(OWNER), 'task.move', CALLS['task.move'](fx.top._id))).rpcError).toMatchObject({ code: -32601 });
        const search = tools.manifest().find((tool) => tool.name === 'tasks.search');
        expect(Object.keys(search.inputSchema.properties)).toEqual(['query', 'projectId', 'status', 'limit']);
        expect(Object.keys((await rpc(ctx(OWNER), 'tasks.search', { projectId: P_OPEN })).tasks[0])).not.toContain('assigneeIds');
    });

    it('on, each tool is a rated registry action with a permission and a scope, and none deletes', () => {
        expect(tools.names()).toEqual(expect.arrayContaining([...READS, ...WRITES]));
        [...READS, ...WRITES].forEach((name) => {
            const action = tools.actionOf(name);
            expect(registry.permissionsFor(action).length).toBeGreaterThan(0);
            expect(actions.rating(action)).toMatchObject({ write: WRITES.includes(name), money: false });
            expect(scopes.scopeForTool(name)).toBe('tasks:manage');
        });
        expect(tools.names().filter((name) => /delete|trash/.test(name))).toEqual([]);
        expect(registry.isNever('task.delete')).toBe(true);
    });

    it('rates a move as not reversible and an archive as reaching past the task, so both take the careful path', () => {
        expect(actions.rating('task.move')).toEqual({ write: true, reversible: false, scope: 'project', money: false });
        expect(actions.rating('task.archive')).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(registry.get('task.move')).toMatchObject({ risk: 'high', undoable: false });
        expect(registry.get('task.archive')).toMatchObject({ risk: 'high', undoable: true });
        expect(registry.mayActDirectly(3, 'task.move')).toBe(false);
        expect(registry.mayActDirectly(3, 'task.archive')).toBe(false);
    });
});

describe('who lists and runs the write tools', () => {
    it('a token created with the grant lists them', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining([...READS, ...WRITES]));
    });

    it('a token created without the grant lists exactly what it listed before, and is refused the reads too', async () => {
        expect(await listed(olderToken(OWNER))).toEqual(BEFORE);
        expect((await rpc(olderToken(OWNER), 'subtasks.list', { taskId: fx.top._id }))).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        expect(await rpc(olderToken(OWNER), 'members.list', {})).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        expect(await rpc(olderToken(OWNER), 'fields.list', { projectId: P_OPEN })).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        const search = await rpc(olderToken(OWNER), 'tasks.search', { projectId: P_OPEN, assigneeId: MEMBER });
        expect(search.tasks.length).toBeGreaterThan(1);
        expect(Object.keys(search.tasks[0])).not.toContain('assigneeIds');
        expect(Object.keys(await rpc(olderToken(OWNER), 'task.get', { taskId: fx.top._id }))).not.toContain('ancestors');
    });

    it.each([['a token without the grant', olderToken], ['a read-only token', readOnly], ['an OAuth token without the scope', oauth]])('%s neither lists nor runs a write tool', async (_who, as) => {
        const caller = as(OWNER);
        expect((await listed(caller)).filter((name) => [...READS, ...WRITES].includes(name))).toEqual([]);
        const before = snapshot();
        for (const name of WRITES) {
            expect(await rpc(caller, name, CALLS[name](fx.top._id))).toMatchObject({ isError: true, error: expect.stringMatching(/permission|only read/) });
        }
        expect(snapshot()).toBe(before);
    });

    it('an approval is refused once the filing token does not hold the grant', async () => {
        const token = (grants) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, active: true, scopes: ['read', 'write'], projectIds: [], grants });
        const proposal = { requestedBy: OWNER, tokenId: TOKEN, tokenProjectIds: [], changes: [{ action: 'task.move', params: CALLS['task.move'](fx.top._id) }] };
        token([]);
        expect(await approval.refusalFor(CID, proposal, { decider: { userId: OWNER }, isPrivileged: true })).toMatchObject({ status: 403, error: expect.stringMatching(/grant/) });
        mockDb.store[SCHEMA_TYPE.API_TOKENS].length = 0;
        token(['tasks:manage']);
        expect(await approval.refusalFor(CID, proposal, { decider: { userId: OWNER }, isPrivileged: true })).toBeNull();
    });
});

describe('an outside client under a person\'s grant', () => {
    const MANAGING = [...PLAIN_SCOPES, 'tasks:manage'];
    const managing = (uid) => outside(uid, MANAGING);
    const filedBy = (uid, taskId, action = 'task.move') => ({
        requestedBy: uid, tokenId: '', oauthClientId: CLIENT, oauthGrantId: GRANT_ID, tokenProjectIds: [],
        changes: [{ action, params: action === 'task.move' ? CALLS['task.move'](taskId) : { taskId } }],
    });
    const decided = (proposal, decider = OWNER) => approval.refusalFor(CID, proposal, { decider: { userId: decider }, isPrivileged: true });
    const grantRow = () => rows(SCHEMA_TYPE.OAUTH_GRANTS)[0];
    const approvalRow = () => rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)[0];

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.MCP_OAUTH = 'on';
        process.env.MCP_OAUTH_ISSUER = ISSUER;
        delete process.env.AGENT_TAINT_ROUTING;
    });

    it('lists and runs the write tools once its grant holds the scope, as that person and no further', async () => {
        expect(await listed(managing(MEMBER))).toEqual(expect.arrayContaining([...READS, ...WRITES]));
        expect(await rpc(managing(MEMBER), 'task.update', { taskId: fx.top._id, title: 'Changed from outside' })).toMatchObject({ ok: true });
        expect(stored(fx.top._id).TaskName).toBe('Changed from outside');
        const before = snapshot();
        for (const task of [fx.secret, fx.private, fx.personal]) {
            expect(await rpc(managing(MEMBER), 'task.update', { taskId: task._id, title: 'x' })).toMatchObject({ isError: true });
        }
        expect(snapshot()).toBe(before);
    });

    it('needs no write scope beside it, and gains nothing a write scope gives', async () => {
        const only = outside(MEMBER, ['tasks:read', 'tasks:manage']);
        expect(await rpc(only, 'task.update', { taskId: fx.top._id, title: 'Manage alone' })).toMatchObject({ ok: true });
        const before = snapshot();
        expect(await rpc(only, 'task.status.set', { taskId: fx.top._id, status: 'Done' })).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:write/) });
        expect(await rpc(only, 'task.comment', { taskId: fx.top._id, body: 'x' })).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:write/) });
        expect(snapshot()).toBe(before);
    });

    it('lists nothing new while the tools are switched off, whatever its grant holds', async () => {
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect(await listed(managing(OWNER))).toEqual(BEFORE);
        expect((await rpc(managing(OWNER), 'task.update', { taskId: fx.top._id, title: 'x' })).rpcError).toMatchObject({ code: -32601 });
        expect(scopes.scopeForTool('task.update')).toBeNull();
    });

    it('files what reaches past one task for a person while outside calls are routed, and acts on the rest', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = snapshot();
        expect(await rpc(managing(OWNER), 'task.archive', { taskId: fx.top._id, reason: 'done with it' })).toMatchObject({ ok: false, pending: true, proposalId: 'proposal-1' });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({
            source: 'mcp', requestedBy: OWNER, tokenId: '', oauthClientId: CLIENT, oauthGrantId: GRANT_ID, tokenProjectIds: [],
            why: expect.stringMatching(/^done with it \(.*outside client/),
            changes: [expect.objectContaining({ action: 'task.archive', params: { taskId: fx.top._id } })],
        }));
        expect(snapshot()).toBe(before);
        expect(await rpc(managing(OWNER), 'task.update', { taskId: fx.top._id, title: 'Still direct' })).toMatchObject({ ok: true });
    });

    it('is refused the same routed call without the scope, as before, and nothing is filed', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = snapshot();
        const plain = outside(OWNER, PLAIN_SCOPES);
        expect(await rpc(plain, 'task.create', { projectId: P_OPEN, title: 'From outside' })).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/outside client/) });
        expect(await rpc(plain, 'task.archive', { taskId: fx.top._id })).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        expect(proposals.create).not.toHaveBeenCalled();
        expect(snapshot()).toBe(before);
    });

    it('files a move for a person where destructive calls are proposals, naming the grant that filed it', async () => {
        process.env.MCP_TOOLS_V2 = 'on';
        const before = snapshot();
        expect(await rpc(managing(OWNER), 'task.move', { taskId: fx.top._id, projectId: P_OPEN, sprintId: S_NEXT })).toMatchObject({ ok: false, pending: true });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({ requestedBy: OWNER, tokenId: '', oauthClientId: CLIENT, oauthGrantId: GRANT_ID }));
        expect(snapshot()).toBe(before);
    });

    it('has its filed change approved while the grant, the scope, the approval and the seat all stand', async () => {
        seedGrant(MEMBER, MANAGING);
        expect(await decided(filedBy(MEMBER, fx.top._id))).toBeNull();
        expect(await decided(filedBy(MEMBER, fx.top._id, 'task.archive'))).toBeNull();
    });

    it.each([
        ['the grant was revoked', () => { grantRow().revokedAt = new Date(); }, /revoked/],
        ['the grant expired', () => { grantRow().expiresAt = new Date(Date.now() - 1000); }, /expired/],
        ['the grant is gone', () => { rows(SCHEMA_TYPE.OAUTH_GRANTS).length = 0; }, /revoked/],
        ['the person withdrew the scope', () => { grantRow().scopes = [...PLAIN_SCOPES]; }, /no longer holds the grant/],
        ['the grant holds the other manage scope only', () => { grantRow().scopes = [...PLAIN_SCOPES, 'docs:manage']; approvalRow().scopes.push('docs:manage'); }, /no longer holds the grant/],
        ['the workspace revoked its approval of the client', () => { approvalRow().status = 'revoked'; }, /no longer approved/],
        ['the workspace took the scope out of its approval', () => { approvalRow().scopes = [...PLAIN_SCOPES]; }, /no longer holds the grant/],
        ['the grant is another person\'s', () => { grantRow().userId = OTHER; }, /revoked/],
        ['the grant is another client\'s', () => { grantRow().clientId = 'https://other.manage.test/client.json'; }, /revoked/],
        ['the grant is another workspace\'s', () => { grantRow().companyId = '6f00000000000000000000ff'; }, /revoked/],
        ['the grant names another resource', () => { grantRow().resource = 'https://elsewhere.manage.test/mcp'; }, /revoked/],
        ['the person lost their seat', () => { jwt.verifyCompanyMembership.mockResolvedValueOnce(false); }, /revoked/],
        ['outside sign-in was switched off', () => { process.env.MCP_OAUTH = 'off'; }, /revoked/],
    ])('has its filed change refused once %s', async (_what, change, message) => {
        seedGrant(MEMBER, MANAGING);
        change();
        expect(await decided(filedBy(MEMBER, fx.top._id))).toMatchObject({ status: 403, error: expect.stringMatching(message) });
    });

    it('has a filed change refused when the grant\'s scope does not reach it, or the person can no longer open the target', async () => {
        seedGrant(MEMBER, MANAGING);
        expect(await decided(filedBy(MEMBER, fx.top._id, 'task.comment'))).toMatchObject({ status: 403, error: expect.stringMatching(/no longer holds the grant/) });
        expect(await decided({ ...filedBy(MEMBER, fx.top._id), changes: [{ action: 'page.update', params: { pageId: fx.top._id } }] })).toMatchObject({ status: 403 });
        expect(await decided(filedBy(MEMBER, fx.private._id))).toMatchObject({ status: 403, error: expect.stringMatching(/requester/) });
    });

    it('is not approved on the strength of a personal token when its grant is gone', async () => {
        seedGrant(MEMBER, MANAGING, { revokedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: MEMBER, active: true, scopes: ['read', 'write'], projectIds: [], grants: ['tasks:manage'] });
        expect(await decided({ ...filedBy(MEMBER, fx.top._id), tokenId: TOKEN })).toMatchObject({ status: 403, error: expect.stringMatching(/revoked/) });
    });
});

describe('every write tool keeps to what the person behind the token can open', () => {
    const refusedOn = async (caller, name, task) => {
        const before = snapshot();
        const out = await rpc(caller, name, CALLS[name](task._id));
        expect(out).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(snapshot()).toBe(before);
    };

    it.each(WRITES)('%s refuses a task in a project the member cannot open', (name) => refusedOn(ctx(MEMBER), name, fx.private));
    it.each(WRITES)('%s refuses a task in a private sprint the member is not on', (name) => refusedOn(ctx(MEMBER), name, fx.secret));
    it.each(WRITES)('%s refuses a task in another person\'s personal list, for an owner and an admin too', async (name) => {
        await refusedOn(ctx(OWNER), name, fx.personal);
        await refusedOn(ctx(ADMIN), name, fx.personal);
    });
    it.each(WRITES)('%s refuses a conversation row', async (name) => {
        await refusedOn(ctx(OWNER), name, fx.chat);
        await refusedOn(ctx(MEMBER), name, fx.chat);
    });
    it.each(WRITES)('%s refuses a task outside a token narrowed to another project', (name) => refusedOn(ctx(OWNER, { projectIds: [P_DEST] }), name, fx.top));

    it('a refusal is written to the audit log', async () => {
        await rpc(ctx(MEMBER), 'task.update', CALLS['task.update'](fx.private._id));
        expect((mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((row) => row.action === 'agent.action_refused' && row.meta.action === 'task.edit')).toHaveLength(1);
    });

    it('the reads answer "not found" outside the same filter', async () => {
        expect(await rpc(ctx(MEMBER), 'subtasks.list', { taskId: fx.private._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        expect(await rpc(ctx(OWNER), 'subtasks.list', { taskId: fx.personal._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        expect(await rpc(ctx(MEMBER), 'fields.list', { projectId: P_PRIVATE })).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
        expect(await rpc(ctx(OWNER), 'fields.list', { projectId: PL_OTHER })).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
        expect(await rpc(ctx(MEMBER), 'members.list', { projectId: P_PRIVATE })).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
        expect(await rpc(ctx(OWNER, { projectIds: [P_DEST] }), 'fields.list', { projectId: P_OPEN })).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
    });

    it('a member whose role lacks the permission is refused, as on the task route', async () => {
        rules.setRule(null, 'task_name_edit', null);
        const out = await rpc(ctx(MEMBER), 'task.update', { taskId: fx.top._id, title: 'Changed' });
        expect(out).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_name_edit/) });
        expect(stored(fx.top._id).TaskName).toBe('Task OPN-1');
        expect((await rpc(ctx(MEMBER), 'task.update', { taskId: fx.top._id, priority: 'HIGH' })).ok).toBe(true);
    });
});

describe('arguments are held to the schema each tool publishes', () => {
    it.each([
        ['task.update', (id) => ({ taskId: id, title: 'x', CompanyId: 'other' }), /CompanyId is not an argument/],
        ['task.update', (id) => ({ taskId: id, title: 7 }), /title must be string/],
        ['task.update', (id) => ({ taskId: id, priority: 'ASAP' }), /priority must be one of/],
        ['task.update', (id) => ({ taskId: id, title: 'x'.repeat(251) }), /at most 250/],
        ['task.update', (id) => ({ taskId: id, estimateMinutes: 1.5 }), /estimateMinutes must be integer/],
        ['task.update', (id) => ({ taskId: id }), /name at least one of/],
        ['task.update', () => ({ title: 'x' }), /taskId is required/],
        ['task.update', () => ({ taskId: { $ne: null }, title: 'x' }), /taskId must be string/],
        ['task.assign', (id) => ({ taskId: id, mode: 'swap', userIds: [OWNER] }), /mode must be one of/],
        ['task.assign', (id) => ({ taskId: id, mode: 'add', userIds: OWNER }), /userIds must be array/],
        ['task.assign', (id) => ({ taskId: id, mode: 'add', userIds: ['me'] }), /userIds\[0\]/],
        ['task.field.set', (id) => ({ taskId: id, fieldId: F.rating }), /value is required/],
        ['task.move', (id) => ({ taskId: id, sprintId: S_NEXT }), /projectId is required/],
        ['task.archive', (id) => ({ taskId: id, permanently: true }), /permanently is not an argument/],
        ['subtasks.list', (id) => ({ taskId: id, limit: 'all' }), /limit must be integer/],
        ['members.list', () => ({ role: 'owner' }), /role is not an argument/],
    ])('%s refuses %s', async (name, args, message) => {
        const before = snapshot();
        const out = await rpc(ctx(OWNER), name, args(fx.top._id));
        expect(out.rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(message) });
        expect(snapshot()).toBe(before);
    });
});

describe('task.update', () => {
    it('sets several fields in one call through the task handlers, and is audited with what it replaced', async () => {
        const out = await rpc(ctx(OWNER), 'task.update', {
            taskId: fx.top._id, title: 'Ship <b>it</b>', description: 'Goal: ship\nDone when: it ships', priority: 'URGENT', dueDate: '2026-12-01', startDate: '2026-11-01', estimateMinutes: 90, reason: 'planning',
        });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { changed: ['TaskName', 'rawDescription', 'Task_Priority', 'DueDate', 'startDate', 'totalEstimatedTime'] } });
        const task = stored(fx.top._id);
        expect(task).toMatchObject({ TaskName: 'Ship <b>it</b>', Task_Priority: 'URGENT', totalEstimatedTime: 90, ProjectID: P_OPEN, CompanyId: CID });
        expect(task.DueDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(task.dueDateDeadLine.map((row) => row.date.toISOString())).toEqual(['2026-12-01T00:00:00.000Z']);
        const updates = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'findOneAndUpdate').map((call) => call.data[1]);
        expect(updates).toEqual(expect.arrayContaining([expect.objectContaining({ rawDescription: 'Goal: ship\nDone when: it ships' }), { startDate: new Date('2026-11-01T00:00:00.000Z') }]));
        expect(updates.find((update) => update.descriptionBlock).descriptionBlock.blocks.map((block) => block.data.text)).toEqual(['Goal: ship', 'Done when: it ships']);

        const [row] = audits('task.edit');
        expect(row).toMatchObject({ action: 'agent.action', entityId: fx.top._id, meta: { state: 'applied', undoable: true, reason: 'planning', undo: { kind: 'update', taskId: fx.top._id, previous: { TaskName: 'Task OPN-1', Task_Priority: 'MEDIUM' } } } });
        expect(String(row._id)).toBe(String(out.auditId));

        await inverses.update(CID, row.meta.undo);
        expect(stored(fx.top._id)).toMatchObject({ TaskName: 'Task OPN-1', Task_Priority: 'MEDIUM', DueDate: new Date('2026-10-10T00:00:00Z') });
    });

    it('writes only what differs, clears a due date with null, and refuses a date that is not one', async () => {
        const same = await rpc(ctx(OWNER), 'task.update', { taskId: fx.top._id, priority: 'MEDIUM' });
        expect(same).toMatchObject({ ok: true, undoable: false, result: { changed: [] } });
        const cleared = await rpc(ctx(OWNER), 'task.update', { taskId: fx.top._id, dueDate: null });
        expect(cleared.result.changed).toEqual(['DueDate']);
        expect(stored(fx.top._id).DueDate).toBeNull();
        const bad = await rpc(ctx(OWNER), 'task.update', { taskId: fx.top._id, dueDate: 'next tuesday', title: 'Never' });
        expect(bad).toMatchObject({ isError: true, error: expect.stringMatching(/due date must be a day/) });
        expect(stored(fx.top._id).TaskName).toBe('Task OPN-1');
        expect((await rpc(ctx(OWNER), 'task.update', { taskId: fx.top._id, startDate: '2026-12-02', dueDate: '2026-12-01' })).error).toMatch(/start date is after the due date/);
    });
});

describe('task.assign', () => {
    it('adds, removes and sets assignees, and undo puts the list back', async () => {
        const added = await rpc(ctx(OWNER), 'task.assign', { taskId: fx.top._id, mode: 'add', userIds: [OTHER, MEMBER] });
        expect(added).toMatchObject({ ok: true, undoable: true, result: { assignees: [MEMBER, OTHER], added: [OTHER], removed: [] } });
        expect(stored(fx.top._id).AssigneeUserId).toEqual([MEMBER, OTHER]);

        await rpc(ctx(OWNER), 'task.assign', { taskId: fx.top._id, mode: 'remove', userIds: [MEMBER] });
        expect(stored(fx.top._id).AssigneeUserId).toEqual([OTHER]);

        const set = await rpc(ctx(OWNER), 'task.assign', { taskId: fx.top._id, mode: 'set', userIds: [ADMIN] });
        expect(set.result).toMatchObject({ assignees: [ADMIN], added: [ADMIN], removed: [OTHER] });
        expect(stored(fx.top._id).AssigneeUserId).toEqual([ADMIN]);

        const rows = audits('task.assignees.set');
        expect(rows).toHaveLength(3);
        expect(rows[2].meta.undo).toEqual({ kind: 'assign', taskId: fx.top._id, previous: [OTHER] });
        await inverses.assign(CID, rows[2].meta.undo);
        expect(stored(fx.top._id).AssigneeUserId).toEqual([OTHER]);
    });

    it('refuses a person who cannot open the task\'s project, and one who is not a member', async () => {
        const closed = await rpc(ctx(OWNER), 'task.assign', { taskId: fx.private._id, mode: 'add', userIds: [OWNER, MEMBER] });
        expect(closed).toMatchObject({ isError: true, error: 'Someone named here cannot open this project. Pick people who are on the project, or ask the person to add them first.' });
        expect(stored(fx.private._id).AssigneeUserId).toEqual([OTHER]);
        expect((await rpc(ctx(OWNER), 'task.assign', { taskId: fx.private._id, mode: 'add', userIds: [OWNER] })).ok).toBe(true);

        const outsider = await rpc(ctx(OWNER), 'task.assign', { taskId: fx.top._id, mode: 'set', userIds: [OUTSIDER] });
        expect(outsider).toMatchObject({ isError: true, error: expect.stringMatching(/active members/) });
        expect(stored(fx.top._id).AssigneeUserId).toEqual([MEMBER]);
        expect(audits('task.assignees.set').filter((row) => row.meta.state === 'failed')).toHaveLength(2);
    });
});

describe('task.field.set and fields.list', () => {
    it('lists the fields a project\'s tasks carry: id, title, type, options and task types, and nothing switched off or of another project', async () => {
        const out = await rpc(ctx(MEMBER), 'fields.list', { projectId: P_OPEN });
        expect(out.fields.map((field) => field.title)).toEqual(['Area', 'Budget', 'Confidence', 'Steps']);
        expect(out.fields.find((field) => field.title === 'Area')).toEqual({ fieldId: F.choice, title: 'Area', type: 'dropdown', options: [{ id: 'a1', label: 'Web' }, { id: 'a2', label: 'API' }], taskTypeKeys: [] });
        expect(out.fields.find((field) => field.title === 'Steps').taskTypeKeys).toEqual([2]);
    });

    it('stores a value of the field\'s type through the field value write, and undo restores what was there', async () => {
        const out = await rpc(ctx(OWNER), 'task.field.set', { taskId: fx.top._id, fieldId: F.rating, value: 4 });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { fieldId: F.rating, title: 'Confidence' } });
        expect(stored(fx.top._id).customField[F.rating]).toEqual({ fieldValue: 4, _id: F.rating });
        await rpc(ctx(OWNER), 'task.field.set', { taskId: fx.top._id, fieldId: F.number, value: 1200 });
        await rpc(ctx(OWNER), 'task.field.set', { taskId: fx.top._id, fieldId: F.choice, value: 'api' });
        expect(stored(fx.top._id).customField).toMatchObject({ [F.number]: { fieldValue: '1200' }, [F.choice]: { fieldValue: ['a2'] } });

        const [row] = audits('task.field.set');
        expect(row.meta.undo).toEqual({ kind: 'update', taskId: fx.top._id, previous: { [`customField.${F.rating}`]: null } });
        await inverses.update(CID, row.meta.undo);
        expect(stored(fx.top._id).customField[F.rating]).toBeUndefined();
    });

    it.each([
        ['a rating out of range', () => ({ fieldId: F.rating, value: 9 }), /whole number from 1 to 5/],
        ['text for a rating', () => ({ fieldId: F.rating, value: 'high' }), /whole number from 1 to 5/],
        ['text for a number', () => ({ fieldId: F.number, value: 'lots' }), /Budget needs a number/],
        ['an option the dropdown does not have', () => ({ fieldId: F.choice, value: 'Mobile' }), /needs one of its options: Web, API/],
        ['a field not used for the task\'s type', () => ({ fieldId: F.bugOnly, value: 'x' }), /does not apply to this type of task/],
        ['a field of another project', () => ({ fieldId: F.elsewhere, value: 'x' }), /does not belong to this task's project/],
        ['a field that is switched off', () => ({ fieldId: F.off, value: 'x' }), /does not belong to this task's project/],
        ['a field that does not exist', () => ({ fieldId: '6f0000000000000000000fff', value: 'x' }), /does not belong to this task's project/],
    ])('refuses %s', async (_what, args, message) => {
        const before = snapshot();
        const out = await rpc(ctx(OWNER), 'task.field.set', { taskId: fx.top._id, ...args() });
        expect(out).toMatchObject({ isError: true, error: expect.stringMatching(message) });
        expect(snapshot()).toBe(before);
    });

    it('sets a field kept for one task type on a task of that type', async () => {
        expect((await rpc(ctx(OWNER), 'task.field.set', { taskId: fx.bug._id, fieldId: F.bugOnly, value: 'Open the page' })).ok).toBe(true);
        expect(stored(fx.bug._id).customField[F.bugOnly].fieldValue).toBe('Open the page');
    });
});

describe('subtasks.list, members.list and tasks.search', () => {
    it('lists a task\'s direct subtasks with their own count and the tasks above them', async () => {
        const out = await rpc(ctx(MEMBER), 'subtasks.list', { taskId: fx.top._id });
        expect(out.parentTaskId).toBe(fx.top._id);
        expect(out.subtasks).toHaveLength(1);
        expect(out.subtasks[0]).toMatchObject({ taskId: fx.child._id, key: 'OPN-2', title: 'Task OPN-2', status: 'In Progress', assigneeIds: [], subTasks: 1, ancestors: [fx.top._id], parentTaskId: fx.top._id });
        expect((await rpc(ctx(MEMBER), 'subtasks.list', { taskId: fx.child._id })).subtasks.map((task) => task.key)).toEqual(['OPN-3']);
    });

    it('lists active members by name with their role and no email, and says who can open a project', async () => {
        const out = await rpc(ctx(MEMBER), 'members.list', {});
        expect(out.members).toEqual([
            { userId: ADMIN, name: 'Adam Admin', roleType: 2, role: 'admin' },
            { userId: MEMBER, name: 'Mia Member', roleType: 3, role: 'member' },
            { userId: OWNER, name: 'Olivia Owner', roleType: 1, role: 'owner' },
            { userId: OTHER, name: 'Priya Other', roleType: 3, role: 'member' },
        ]);
        expect(JSON.stringify(out)).not.toMatch(/@|mail/i);
        expect((await rpc(ctx(MEMBER), 'members.list', { query: 'pri' })).members.map((member) => member.userId)).toEqual([OTHER]);
        const onPrivate = await rpc(ctx(OWNER), 'members.list', { projectId: P_PRIVATE });
        expect(Object.fromEntries(onPrivate.members.map((member) => [member.name, member.opensProject]))).toEqual({ 'Adam Admin': true, 'Mia Member': false, 'Olivia Owner': true, 'Priya Other': true });
    });

    it('lists, for anyone but an unnarrowed owner or admin, only the people of the projects they can open', async () => {
        const GUEST = '6f0000000000000000000005';
        const LONER = '6f0000000000000000000006';
        [[GUEST, 0], [LONER, 0]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
        [[GUEST, 'Gus Guest'], [LONER, 'Lou Loner']].forEach(([_id, Employee_Name]) => mockDb.seed(SCHEMA_TYPE.USERS, { _id, Employee_Name }));
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === P_PRIVATE).AssigneeUserId = [OTHER, GUEST];
        const ids = async (caller) => (await rpc(caller, 'members.list', {})).members.map((member) => member.userId).sort();
        expect(await ids(ctx(OWNER))).toEqual([OWNER, ADMIN, MEMBER, OTHER, GUEST, LONER].sort());
        expect(await ids(ctx(MEMBER))).toEqual([OWNER, ADMIN, MEMBER, OTHER].sort());
        expect(await ids(ctx(OTHER, { projectIds: [P_PRIVATE] }))).toEqual([OWNER, ADMIN, OTHER, GUEST].sort());
        expect(await ids(ctx(OWNER, { projectIds: [P_PRIVATE] }))).toEqual([OWNER, ADMIN, OTHER, GUEST].sort());
        mockDb.store[SCHEMA_TYPE.RULES].filter((rule) => rule.key === 'task_list').forEach((rule) => rule.roles.push({ key: 0, permission: true }));
        expect(await ids(ctx(GUEST))).toEqual([OWNER, ADMIN, OTHER, GUEST].sort());
    });

    it('tasks.search filters by assignee, list and due date, and each task carries what planning needs', async () => {
        const mine = await rpc(ctx(OWNER), 'tasks.search', { projectId: P_OPEN, assigneeId: MEMBER });
        expect(mine.tasks.map((task) => task.key)).toEqual(['OPN-1']);
        expect(mine.tasks[0]).toMatchObject({ key: 'OPN-1', title: 'Task OPN-1', status: 'In Progress', priority: 'MEDIUM', projectId: P_OPEN, sprintId: S_OPEN, assigneeIds: [MEMBER], subTasks: 1, ancestors: [], parentTaskId: '', archived: false });
        expect(mine.tasks[0].dueDate).toBeTruthy();
        const due = await rpc(ctx(OWNER), 'tasks.search', { dueFrom: '2026-11-01', dueTo: '2026-11-30' });
        expect(due.tasks.map((task) => task.key)).toEqual(['OPN-4']);
        expect((await rpc(ctx(OWNER), 'tasks.search', { sprintId: S_SECRET })).tasks.map((task) => task.key)).toEqual(['OPN-9']);
        expect((await rpc(ctx(MEMBER), 'tasks.search', { sprintId: S_SECRET })).tasks).toEqual([]);
        expect(await rpc(ctx(OWNER), 'tasks.search', { dueFrom: 'soon' })).toEqual({ error: 'dueFrom and dueTo must be written YYYY-MM-DD.' });
        expect(Object.keys(tools.manifest(ctx(OWNER)).find((tool) => tool.name === 'tasks.search').inputSchema.properties)).toEqual(expect.arrayContaining(['assigneeId', 'sprintId', 'dueFrom', 'dueTo']));
        expect(Object.keys(tools.manifest().find((tool) => tool.name === 'tasks.search').inputSchema.properties)).toEqual(['query', 'projectId', 'status', 'limit']);
    });
});

describe('task.move', () => {
    it('moves a top-level task to another list of its project, and every level of its subtasks follows', async () => {
        const out = await onceApproved(ctx(MEMBER), 'task.move', { taskId: fx.top._id, projectId: P_OPEN, sprintId: S_NEXT });
        expect(out).toMatchObject({ ok: true, undoable: false, result: { projectId: P_OPEN, sprintId: S_NEXT, moved: 3 } });
        [fx.top, fx.child, fx.grandchild].forEach((task) => {
            expect(stored(task._id)).toMatchObject({ deletedStatusKey: 0, statusKey: 2, sprintArray: { id: S_NEXT, name: 'Sprint 2' } });
            expect([String(stored(task._id).sprintId), String(stored(task._id).ProjectID)]).toEqual([S_NEXT, P_OPEN]);
        });
        expect([fx.top, fx.child, fx.grandchild].map((task) => stored(task._id).AssigneeUserId)).toEqual([[MEMBER], [MEMBER], [MEMBER]]);
        expect(audits('task.move')).toHaveLength(1);
        expect(audits('task.move')[0].meta).toMatchObject({ state: 'applied', undoable: false, undo: null });
    });

    it('carries a task into another project with that project\'s status and type, and only the assignees who can open it', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === P_DEST).isPrivateSpace = true;
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === P_DEST).AssigneeUserId = [OTHER];
        stored(fx.bug._id).TaskType = 'task';
        stored(fx.bug._id).AssigneeUserId = [OTHER, MEMBER];
        const out = await onceApproved(ctx(OWNER), 'task.move', { taskId: fx.bug._id, projectId: P_DEST, sprintId: S_DEST });
        expect(out).toMatchObject({ ok: true, result: { projectId: P_DEST, sprintId: S_DEST, moved: 1 } });
        expect(stored(fx.bug._id)).toMatchObject({ ProjectID: P_DEST, sprintId: S_DEST, statusKey: 8, statusType: 'active', status: { key: 8, text: 'in progress', type: 'active' }, TaskType: 'task', TaskTypeKey: 5, deletedStatusKey: 0, AssigneeUserId: [OTHER] });
    });

    it('refuses a task whose type the other project cannot take before anything is written', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === P_OPEN).taskTypeCounts = [{ key: 1, name: 'Task', value: 'task' }];
        const before = snapshot();
        const out = await onceApproved(ctx(OWNER), 'task.move', { taskId: fx.bug._id, projectId: P_DEST, sprintId: S_DEST });
        expect(out).toMatchObject({ isError: true, error: expect.stringMatching(/does not exist in the other project/) });
        expect(snapshot()).toBe(before);
    });

    it('refuses a subtask on its own, with a message that says what to move instead', async () => {
        const before = snapshot();
        const out = await onceApproved(ctx(OWNER), 'task.move', { taskId: fx.child._id, projectId: P_OPEN, sprintId: S_NEXT });
        expect(out).toMatchObject({ isError: true, error: 'A subtask moves with its parent: move the top-level task instead.' });
        expect(snapshot()).toBe(before);
    });

    it.each([
        ['a project the caller cannot open', MEMBER, { projectId: P_PRIVATE, sprintId: S_PRIVATE }],
        ['a private list the caller is not on', MEMBER, { projectId: P_OPEN, sprintId: S_SECRET }],
        ['another person\'s personal list', OWNER, { projectId: PL_OTHER, sprintId: S_OPEN }],
        ['a list that is not in the project named', OWNER, { projectId: P_DEST, sprintId: S_NEXT }],
    ])('refuses a destination that is %s', async (_what, uid, destination) => {
        const before = snapshot();
        const out = await rpc(ctx(uid), 'task.move', { taskId: fx.top._id, ...destination });
        expect(out).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(snapshot()).toBe(before);
    });

    it('refuses a destination outside a narrowed token, and one the member may not move tasks into', async () => {
        expect(await rpc(ctx(OWNER, { projectIds: [P_OPEN] }), 'task.move', { taskId: fx.top._id, projectId: P_DEST, sprintId: S_DEST })).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/) });
        Object.assign(mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === LOCKED_PROJECT), { isPrivateSpace: false, ProjectName: 'Locked', CompanyId: CID, taskStatusData: STATUSES, taskTypeCounts: TYPES });
        Object.assign(stored(LOCKED_TASK), { CompanyId: CID, TaskName: 'Locked task', deletedStatusKey: 0 });
        const lockedList = mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: LOCKED_PROJECT, name: 'Locked list', AssigneeUserId: [], deletedStatusKey: 0 });
        const before = snapshot();
        const into = await rpc(ctx(MEMBER), 'task.move', { taskId: fx.bug._id, projectId: LOCKED_PROJECT, sprintId: lockedList._id });
        expect(into).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_move/) });
        const outOf = await rpc(ctx(MEMBER), 'task.move', { taskId: LOCKED_TASK, projectId: P_OPEN, sprintId: S_NEXT });
        expect(outOf).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_move/) });
        expect(snapshot()).toBe(before);
        expect(proposals.create).not.toHaveBeenCalled();
        expect((await onceApproved(ctx(MEMBER), 'task.move', { taskId: LOCKED_TASK, projectId: P_OPEN, sprintId: S_NEXT })).error).toMatch(/^permission_denied: task\.task_move/);
        expect((await onceApproved(ctx(OWNER), 'task.move', { taskId: fx.bug._id, projectId: LOCKED_PROJECT, sprintId: lockedList._id })).ok).toBe(true);
    });

    it.each([['off', ''], ['on', 'on']])('is filed for a person to approve, not run, with the newer tool format %s', async (_label, flag) => {
        if (flag) process.env.MCP_TOOLS_V2 = flag;
        const before = snapshot();
        const out = await rpc(ctx(OWNER), 'task.move', { taskId: fx.top._id, projectId: P_OPEN, sprintId: S_NEXT, reason: 'next sprint' });
        expect(out).toMatchObject({ ok: false, pending: true, proposalId: 'proposal-1' });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({
            source: 'mcp', requestedBy: OWNER, tokenId: TOKEN, why: 'next sprint (this change cannot be undone)',
            changes: [expect.objectContaining({ action: 'task.move', params: { taskId: fx.top._id, projectId: P_OPEN, sprintId: S_NEXT } })],
        }));
        expect(snapshot()).toBe(before);
    });
});

describe('task.archive and task.restore', () => {
    it('archives a task with its subtasks, restores it, and each can be undone by a person who can open it', async () => {
        const archived = await onceApproved(ctx(MEMBER), 'task.archive', { taskId: fx.top._id });
        expect(archived).toMatchObject({ ok: true, undoable: true, result: { archived: true } });
        expect([stored(fx.top._id).deletedStatusKey, stored(fx.child._id).deletedStatusKey]).toEqual([2, 3]);
        const [row] = audits('task.archive');
        expect(row.meta.undo).toEqual({ kind: 'archive', taskId: fx.top._id, previous: 0 });
        expect(await undoStateOf(CID, row, { userId: OWNER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        expect(await undoStateOf(CID, { ...row, meta: { ...row.meta, undo: { ...row.meta.undo, taskId: fx.private._id } }, entityId: fx.private._id }, { userId: MEMBER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });

        expect((await rpc(ctx(MEMBER), 'task.archive', { taskId: fx.top._id })).error).toMatch(/already archived/);
        expect((await rpc(ctx(MEMBER), 'task.restore', { taskId: fx.child._id })).error).toMatch(/Restore the parent task/);

        const restored = await onceApproved(ctx(MEMBER), 'task.restore', { taskId: fx.top._id });
        expect(restored).toMatchObject({ ok: true, undoable: true, result: { archived: false } });
        expect([stored(fx.top._id).deletedStatusKey, stored(fx.child._id).deletedStatusKey]).toEqual([0, 0]);
        expect(audits('task.restore', 'applied')[0].meta.undo).toEqual({ kind: 'archive', taskId: fx.top._id, previous: 2 });

        await inverses.archive(CID, audits('task.restore', 'applied')[0].meta.undo, { userId: OWNER });
        await settle();
        expect(stored(fx.top._id).deletedStatusKey).toBe(2);
        await inverses.archive(CID, row.meta.undo, { userId: OWNER });
        await settle();
        expect(stored(fx.top._id).deletedStatusKey).toBe(0);
    });

    it('never touches a task in the trash, and restores only what is archived', async () => {
        stored(fx.bug._id).deletedStatusKey = 1;
        for (const name of ['task.archive', 'task.restore', 'task.update']) {
            expect(await rpc(ctx(OWNER), name, CALLS[name](fx.bug._id))).toMatchObject({ isError: true, refused: true });
        }
        expect(stored(fx.bug._id).deletedStatusKey).toBe(1);
        expect((await rpc(ctx(OWNER), 'task.restore', { taskId: fx.top._id })).error).toMatch(/not archived/);
        expect(await actions.perform({ companyId: CID, actor: ctx(OWNER).actor, action: 'task.restore', params: { taskId: fx.bug._id } }).catch((error) => error.message)).toMatch(/not found/);
    });
});
