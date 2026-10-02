/* Task 046, MCP parity part 2: an agent whose token was created for it finishes, creates and batches work,
   reads a task's history and writes docs, as the person behind its token and no further. */
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
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const notifications = require('../Modules/Tasks/helpers/handleNotification');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { inverses, undoStateOf } = require('../Modules/Agents/undo');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const {
    CID, OWNER, ADMIN, MEMBER, OTHER, OUTSIDER, P_OPEN, P_PRIVATE, P_DEST, PL_OTHER, S_OPEN, S_NEXT, S_SECRET, TASKS_GRANT, DOCS_GRANT,
    BEFORE, settle, ctx, withGrants, olderToken, readOnly, oauth, outside, PLAIN_SCOPES, CLIENT, GRANT_ID,
} = world;
const { rules, seed, stored, rows, audits, snapshot, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TASK_TOOLS = ['task.history', 'task.links.list', 'comment.update', 'tasks.batch'];
const DOC_TOOLS = ['page.create', 'page.update'];
const docsOnly = (uid) => withGrants(uid, [DOCS_GRANT]);
const both = (uid) => withGrants(uid, [TASKS_GRANT, DOCS_GRANT]);
const history = (taskId) => rows(SCHEMA_TYPE.HISTORY).filter((entry) => String(entry.TaskId) === String(taskId) && entry.Type === 'task');
const page = (id) => rows(SCHEMA_TYPE.PAGES).find((row) => String(row._id) === String(id));
const comment = (id) => rows(SCHEMA_TYPE.COMMENTS).find((row) => String(row._id) === String(id));
const person = (uid) => ({ kind: 'human', userId: uid });

let fx;

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    // What the manage grant reaches is the subject here, so these projects let an agent close; the default is held in agent-project-policy.test.js.
    rows(SCHEMA_TYPE.PROJECTS).forEach((project) => { project.agentPolicy = { done: 'yes' }; });
    fx.pageOpen = mockDb.seed(SCHEMA_TYPE.PAGES, {
        title: 'Runbook', ProjectID: P_OPEN, visibility: 'project', createdBy: OTHER, updatedBy: OTHER, editedBy: OTHER, editedAt: new Date('2026-09-01T00:00:00Z'),
        content: { html: '<p>Old body</p>', blocks: { blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Old body' } }] } }, rawText: 'Old body', deletedStatusKey: 0,
    });
    fx.pagePrivate = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Hidden', ProjectID: P_PRIVATE, visibility: 'project', createdBy: OTHER, content: { html: '<p>x</p>' }, deletedStatusKey: 0 });
    fx.pageTheirs = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Diary', ProjectID: P_OPEN, visibility: 'private', createdBy: OTHER, content: { html: '<p>x</p>' }, deletedStatusKey: 0 });
    fx.pagePersonal = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Mine alone', ProjectID: PL_OTHER, visibility: 'project', createdBy: OTHER, content: { html: '<p>x</p>' }, deletedStatusKey: 0 });
});
afterEach(settle);
afterAll(() => { delete process.env.MCP_TOOLS_MANAGE; delete process.env.MCP_TOOLS_V2; delete process.env.AGENT_TAINT_ROUTING; });

describe('which tools a token lists', () => {
    it('a token created to manage tasks lists the task tools and not the doc tools', async () => {
        const names = await listed(ctx(OWNER));
        expect(names).toEqual(expect.arrayContaining([...BEFORE, ...TASK_TOOLS]));
        expect(names.filter((name) => DOC_TOOLS.includes(name))).toEqual([]);
    });

    it('a token created to write docs lists the doc tools, and every older tool exactly as it was', async () => {
        const names = await listed(docsOnly(OWNER));
        expect(names).toEqual([...BEFORE, ...DOC_TOOLS]);
        const plain = (await server.handleRpc(olderToken(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
        const asDocs = (await server.handleRpc(docsOnly(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
        expect(asDocs.filter((tool) => BEFORE.includes(tool.name))).toEqual(plain);
    });

    it.each([['a token created before the grants', olderToken], ['a read-only token', readOnly], ['an OAuth token without the scopes', oauth]])('%s lists what it listed before', async (_who, as) => {
        expect((await listed(as(OWNER))).filter((name) => [...TASK_TOOLS, ...DOC_TOOLS].includes(name))).toEqual([]);
        const off = { ...process.env };
        process.env.MCP_TOOLS_MANAGE = 'off';
        const before = (await server.handleRpc(as(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
        process.env.MCP_TOOLS_MANAGE = off.MCP_TOOLS_MANAGE;
        expect((await server.handleRpc(as(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools).toEqual(before);
    });

    it('every new action is flagged, rated and mapped to a permission, and none deletes', () => {
        ['task.history', 'task.links.list', 'task.status.change', 'task.add', 'subtask.add', 'comment.update', 'tasks.batch', 'page.create', 'page.update'].forEach((key) => {
            expect(registry.permissionsFor(key).length).toBeGreaterThan(0);
            expect(actions.rating(key)).not.toBeNull();
            expect(registry.ACTIONS.map((action) => action.key)).not.toContain(key);
        });
        expect(actions.rating('task.status.change')).toEqual({ write: true, reversible: true, scope: 'task', money: false });
        expect(registry.get('task.status.change')).toMatchObject({ risk: 'high', undoable: true });
        expect(tools.manifest(both(OWNER)).map((tool) => tool.name).filter((name) => /delete|trash/.test(name))).toEqual([]);
        process.env.MCP_TOOLS_MANAGE = 'off';
        expect(registry.has('task.status.change')).toBe(false);
        expect(registry.has('page.update')).toBe(false);
    });

    it('tells a caller that manages tasks it may close one, and everyone else that a person closes it', async () => {
        const hello = (caller) => server.handleRpc(caller, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }).then((reply) => reply.result.instructions);
        expect(await hello(ctx(OWNER))).toMatch(/stays unchecked until a person checks it/);
        expect(await hello(olderToken(OWNER))).toMatch(/A person closes the task/);
        expect(await hello(docsOnly(OWNER))).toMatch(/A person closes the task/);
    });
});

describe('every new tool keeps to what the person behind the token can open', () => {
    const TASK_CALLS = {
        'task.status.set': (taskId) => ({ taskId, status: 'Done' }),
        'subtask.create': (taskId) => ({ taskId, title: 'Part' }),
        'task.comment': (taskId) => ({ taskId, body: 'Hello' }),
        'comment.update': (taskId) => ({ taskId, commentId: '6f00000000000000000000ff', text: 'Changed' }),
    };
    const refusedOn = async (caller, name, task) => {
        const before = snapshot();
        expect(await rpc(caller, name, TASK_CALLS[name](task._id))).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(snapshot()).toBe(before);
    };
    const WRITES = Object.keys(TASK_CALLS);

    it.each(WRITES)('%s refuses a task in a project the member cannot open', (name) => refusedOn(ctx(MEMBER), name, fx.private));
    it.each(WRITES)('%s refuses a task in a private list the member is not on', (name) => refusedOn(ctx(MEMBER), name, fx.secret));
    it.each(WRITES)('%s refuses a task in another person\'s personal list, for an owner and an admin too', async (name) => {
        await refusedOn(ctx(OWNER), name, fx.personal);
        await refusedOn(ctx(ADMIN), name, fx.personal);
    });
    it.each(WRITES)('%s refuses a conversation row', (name) => refusedOn(ctx(OWNER), name, fx.chat));
    it.each(WRITES)('%s refuses a task outside a token narrowed to another project', (name) => refusedOn(ctx(OWNER, { projectIds: [P_DEST] }), name, fx.top));

    it('task.create refuses a project or list outside the same filter', async () => {
        const before = snapshot();
        for (const [caller, args] of [
            [ctx(MEMBER), { projectId: P_PRIVATE, title: 'x' }],
            [ctx(MEMBER), { projectId: P_OPEN, sprintId: S_SECRET, title: 'x' }],
            [ctx(OWNER), { projectId: PL_OTHER, title: 'x' }],
            [ctx(ADMIN), { projectId: PL_OTHER, title: 'x' }],
            [ctx(OWNER, { projectIds: [P_DEST] }), { projectId: P_OPEN, title: 'x' }],
        ]) {
            expect(await rpc(caller, 'task.create', args)).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        }
        expect(snapshot()).toBe(before);
    });

    it('the reads answer "not found" outside it', async () => {
        for (const name of ['task.history', 'task.links.list']) {
            expect(await rpc(ctx(MEMBER), name, { taskId: fx.private._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
            expect(await rpc(ctx(MEMBER), name, { taskId: fx.secret._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
            expect(await rpc(ctx(OWNER), name, { taskId: fx.personal._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
            expect(await rpc(ctx(OWNER), name, { taskId: fx.chat._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
            expect(await rpc(ctx(OWNER, { projectIds: [P_DEST] }), name, { taskId: fx.top._id })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        }
    });

    it.each([['a token without the grant', olderToken], ['a docs-only token', docsOnly], ['a read-only token', readOnly], ['an OAuth token without the scope', oauth]])('%s runs none of the task tools', async (_who, as) => {
        const before = snapshot();
        for (const name of TASK_TOOLS) {
            expect(await rpc(as(OWNER), name, { taskId: fx.top._id })).toMatchObject({ isError: true, error: expect.stringMatching(/permission|only read/) });
        }
        expect(snapshot()).toBe(before);
    });

    it.each([
        ['task.status.set', (id) => ({ taskId: id, status: 'Done', force: true }), /force is not an argument/],
        ['task.status.set', (id) => ({ taskId: id, status: 3 }), /status must be string/],
        ['task.create', () => ({ projectId: P_OPEN, title: 'x', CompanyId: 'other' }), /CompanyId is not an argument/],
        ['task.create', () => ({ projectId: P_OPEN, title: 'x', links: [{ url: 'https://example.com', owner: 'me' }] }), /links\[0\]\.owner is not an argument/],
        ['task.create', () => ({ projectId: P_OPEN, title: 'x', assigneeIds: 'me' }), /assigneeIds must be array/],
        ['subtask.create', (id) => ({ taskId: id, title: 'x', priority: 'ASAP' }), /priority must be one of/],
        ['comment.update', (id) => ({ taskId: id, commentId: 'abc', text: 'x' }), /commentId is not in the form/],
        ['task.history', (id) => ({ taskId: id, since: 'yesterday' }), /since is not an argument/],
        ['tasks.batch', () => ({ operations: [] }), /operations must have at least 1 item/],
        ['tasks.batch', () => ({ operations: Array.from({ length: 26 }, () => ({ tool: 'task.archive', arguments: {} })) }), /at most 25 items/],
        ['tasks.batch', () => ({ operations: [{ tool: 'task.archive' }] }), /operations\[0\]\.arguments is required/],
        ['page.create', () => ({ title: 'x', visibility: 'private' }), /visibility is not an argument/],
        ['page.update', () => ({ pageId: '6f00000000000000000000ff' }), /name a title or a text/],
    ])('%s refuses %s', async (name, args, message) => {
        const before = snapshot();
        expect((await rpc(both(OWNER), name, args(fx.top._id))).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(message) });
        expect(snapshot()).toBe(before);
    });
});

describe('task.status.set for a token created to manage tasks', () => {
    it('closes a task the way a person\'s close does, and records who it was closed for and through', async () => {
        const out = await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'done', reason: 'PR merged' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { status: 'Done', statusType: 'close', changed: true } });
        expect(stored(fx.top._id)).toMatchObject({ statusType: 'close', statusKey: 3, status: { key: 3, text: 'Done', type: 'close' } });

        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'task', updatedFields: expect.objectContaining({ statusKey: 3, statusType: 'close' }) }));
        expect(socketEmitter.emit.mock.calls.filter(([, event]) => event.updatedFields && event.updatedFields.statusKey === 3).every(([, event]) => event.actor === undefined)).toBe(true);
        expect(notifications.HandleBothNotification).toHaveBeenCalledWith(expect.objectContaining({ changeType: 'status', taskId: fx.top._id, projectId: P_OPEN }));
        expect(history(fx.top._id).map((entry) => entry.Message)).toEqual(['<b>Claude, for Olivia Owner</b> has changed <b> Status</b> as <b>Done</b>.']);
        expect(history(fx.top._id)[0]).toMatchObject({ Key: 'Task_Status', UserId: OWNER });

        expect(stored(fx.top._id).completion).toMatchObject({
            closedBy: { actorId: OWNER, actorType: 'human', viaAgent: true }, checkedBy: null, badge: 'UNCHECKED',
            workBy: [expect.objectContaining({ actorId: OWNER, actorType: 'agent', viaAccount: 'personal' })],
        });
        const [row] = audits('task.status.change');
        expect(row).toMatchObject({ action: 'agent.action', entityId: fx.top._id, meta: { state: 'applied', reason: 'PR merged', undo: { kind: 'statusChange', taskId: fx.top._id, previous: 'In Progress' } } });
    });

    it('is undone by a person through the same path, which reopens the task', async () => {
        await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' });
        const [row] = audits('task.status.change');
        expect(await undoStateOf(CID, row, person(MEMBER), { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        await inverses.statusChange(CID, row.meta.undo, person(MEMBER));
        await settle();
        expect(stored(fx.top._id)).toMatchObject({ statusType: 'active', statusKey: 2, completion: { closedBy: null, reopenCount: 1 } });
        expect(history(fx.top._id).map((entry) => entry.Message)[1]).toBe('<b>Mia Member</b> has changed <b> Status</b> as <b>In Progress</b>.');
    });

    it('applies at once where destructive calls are proposals, since it can be undone', async () => {
        process.env.MCP_TOOLS_V2 = 'on';
        expect(await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' })).toMatchObject({ ok: true, undoable: true });
        expect(proposals.create).not.toHaveBeenCalled();
        expect(stored(fx.top._id).statusType).toBe('close');
    });

    it('never counts an agent\'s close out of review as a person\'s check', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === P_OPEN).taskStatusData.push({ key: 4, name: 'In Review', type: 'active' });
        Object.assign(stored(fx.top._id), { status: { key: 4, text: 'In Review', type: 'active' }, statusKey: 4 });
        await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' });
        expect(stored(fx.top._id).completion).toMatchObject({ checkedBy: null, badge: 'UNCHECKED', closedBy: { viaAgent: true } });
    });

    it('sets any other status of the project, changes nothing when it already holds, and refuses one the project does not define', async () => {
        expect((await rpc(ctx(MEMBER), 'task.status.set', { taskId: fx.top._id, status: 'To Do' })).result).toMatchObject({ status: 'To Do', statusType: 'default_active', changed: true });
        const same = await rpc(ctx(MEMBER), 'task.status.set', { taskId: fx.top._id, status: 'to do' });
        expect(same).toMatchObject({ ok: true, undoable: false, result: { changed: false } });
        const unknown = await rpc(ctx(MEMBER), 'task.status.set', { taskId: fx.top._id, status: 'Shipped' });
        expect(unknown).toMatchObject({ isError: true, error: expect.stringMatching(/does not exist in this project \(has: To Do, In Progress, Done\)/) });
        expect(stored(fx.top._id).statusKey).toBe(1);
    });

    it('leaves the close to a person where the workspace has a person check an agent\'s work first', async () => {
        mockDb.store.companies[0].agentPolicy = { requireCheckBeforeDone: true };
        const out = await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' });
        expect(out).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/a person closes this task/) });
        expect(stored(fx.top._id).statusKey).toBe(2);
        expect((await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'To Do' })).ok).toBe(true);
    });

    it('is refused to a member whose role may not change a status', async () => {
        rules.setRule(null, 'task_status', null);
        expect(await rpc(ctx(MEMBER), 'task.status.set', { taskId: fx.top._id, status: 'Done' })).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_status/) });
        expect(stored(fx.top._id).statusKey).toBe(2);
    });

    it('without the grant behaves as before: in progress and in review only, and closing stays on the never-list', async () => {
        const closed = await rpc(olderToken(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' });
        expect(closed).toMatchObject({ isError: true, refused: true, reason: 'You cannot set a task to "Done". Use In progress or In review, and a person closes the task.' });
        expect(closed.neverAvailable).toContain('status.set("Done")');
        expect(stored(fx.top._id).statusKey).toBe(2);
        expect(await rpc(docsOnly(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' })).toMatchObject({ refused: true });
        expect((await rpc(ctx(MEMBER), 'task.status.set', { taskId: fx.private._id, status: 'Done' })).neverAvailable).not.toContain('status.set("Done")');
        expect(audits('task.status.change', 'applied')).toHaveLength(0);
    });
});

describe('task.create and subtask.create in one call', () => {
    it('creates a task with its details through the task create path, with the project\'s next key', async () => {
        const out = await rpc(ctx(OWNER), 'task.create', {
            projectId: P_OPEN, sprintId: S_NEXT, title: 'Ship the importer', description: 'Goal: import\nDone when: rows land', assigneeIds: [MEMBER, OTHER], priority: 'HIGH',
            dueDate: '2026-12-01', startDate: '2026-11-20', status: 'In Progress', taskType: 'Bug', estimateMinutes: 120,
            links: [{ url: 'https://example.com/acme/app/pull/12', label: 'PR 12' }, { url: 'https://example.com/spec', kind: 'doc' }],
        });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { key: 'OPE-11', title: 'Ship the importer' } });
        const task = stored(out.result.taskId);
        expect(task).toMatchObject({
            TaskName: 'Ship the importer', TaskKey: 'OPE-11', AssigneeUserId: [MEMBER, OTHER], watchers: [MEMBER, OTHER, OWNER], Task_Priority: 'HIGH', Task_Leader: OWNER,
            statusKey: 2, statusType: 'active', TaskType: 'bug', TaskTypeKey: 2, totalEstimatedTime: 120, isParentTask: true, ParentTaskId: '', ancestors: [], deletedStatusKey: 0,
            rawDescription: 'Goal: import\nDone when: rows land', sprintArray: { id: S_NEXT, name: 'Sprint 2' },
        });
        expect([String(task.ProjectID), String(task.sprintId), String(task.CompanyId)]).toEqual([P_OPEN, S_NEXT, CID]);
        expect(new Date(task.DueDate).toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(task.descriptionBlock.blocks.map((block) => block.data.text)).toEqual(['Goal: import', 'Done when: rows land']);
        expect(task.links.map((link) => [link.url, link.kind, link.label, link.actorType])).toEqual([
            ['https://example.com/acme/app/pull/12', 'pr', 'PR 12', 'agent'], ['https://example.com/spec', 'doc', '', 'agent'],
        ]);
        expect(mockDb.store[SCHEMA_TYPE.PROJECTS].find((project) => String(project._id) === P_OPEN).lastTaskId).toBe(11);
        expect(history(task._id)[0].Message).toMatch(/^<b>Claude, for Olivia Owner<\/b> has created new <b>Ship the importer<\/b>/);
        expect(audits('task.add')[0].meta.undo).toEqual({ kind: 'task', taskId: out.result.taskId, projectId: P_OPEN });
    });

    it('lands in the first list the person can see, in the opening status and unassigned, when nothing more is said', async () => {
        const out = await rpc(ctx(MEMBER), 'task.create', { projectId: P_OPEN, title: 'Plain' });
        expect(stored(out.result.taskId)).toMatchObject({ statusKey: 1, statusType: 'default_active', AssigneeUserId: [], Task_Priority: 'MEDIUM', TaskType: 'task' });
        expect(String(stored(out.result.taskId).sprintId)).toBe(S_OPEN);
    });

    it('creates a subtask with a status and a link in one call, under its parent\'s list, with the project\'s next key', async () => {
        const out = await rpc(ctx(MEMBER), 'subtask.create', { taskId: fx.top._id, title: 'PR 1261', status: 'Done', links: [{ url: 'https://example.com/acme/app/pull/1261' }] });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { key: 'OPE-11', title: 'PR 1261' } });
        const made = stored(out.result.subtaskId);
        expect(made).toMatchObject({ TaskKey: 'OPE-11', isParentTask: false, ParentTaskId: fx.top._id, ancestors: [fx.top._id], statusType: 'close', statusKey: 3, TaskType: 'task' });
        expect([String(made.ProjectID), String(made.sprintId)]).toEqual([P_OPEN, S_OPEN]);
        expect(made.links).toHaveLength(1);
        expect(stored(fx.top._id).subTasks).toBe(2);
        expect(audits('subtask.add')[0].meta.undo).toEqual({ kind: 'subtask', subtaskId: out.result.subtaskId, parentTaskId: fx.top._id });
    });

    it('refuses a fourth level, an assignee who cannot open the project, a task type or status the project lacks and a link that is not one', async () => {
        const before = snapshot();
        expect((await rpc(ctx(OWNER), 'subtask.create', { taskId: fx.grandchild._id, title: 'Too deep' })).error).toMatch(/three levels deep/);
        expect((await rpc(ctx(OWNER), 'task.create', { projectId: P_PRIVATE, title: 'x', assigneeIds: [MEMBER] })).error).toBe('Someone named here cannot open this project. Pick people who are on the project, or ask the person to add them first.');
        expect((await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: 'x', assigneeIds: [OUTSIDER] })).error).toMatch(/active members/);
        expect((await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: 'x', taskType: 'Epic' })).error).toMatch(/task type must be one of Task, Bug/);
        expect((await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: 'x', status: 'Shipped' })).error).toMatch(/does not exist in this project/);
        expect((await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: 'x', links: [{ url: 'javascript:alert(1)' }] })).error).toMatch(/web address starting with http/);
        expect((await rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, sprintId: world.S_DEST, title: 'x' })).reason).toMatch(/^not_visible/);
        expect(snapshot()).toBe(before);
    });

    it('holds each detail to the permission a person needs for it', async () => {
        rules.setRule(null, 'task_assignee', null);
        const refused = await rpc(ctx(MEMBER), 'task.create', { projectId: P_OPEN, title: 'x', assigneeIds: [OTHER] });
        expect(refused).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_assignee/) });
        expect((await rpc(ctx(MEMBER), 'task.create', { projectId: P_OPEN, title: 'x', priority: 'LOW' })).ok).toBe(true);
        rules.setRule(null, 'task_create', null);
        expect(await rpc(ctx(MEMBER), 'task.create', { projectId: P_OPEN, title: 'y' })).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_create/) });
    });

    it('without the grant creates as before, and a subtask made that way takes the project\'s next key too', async () => {
        const task = await rpc(olderToken(OWNER), 'task.create', { projectId: P_OPEN, title: 'Old way', assigneeIds: [MEMBER], status: 'Done' });
        expect(stored(task.result.taskId)).toMatchObject({ AssigneeUserId: [], statusType: 'default_active' });
        const sub = await rpc(olderToken(OWNER), 'subtask.create', { taskId: fx.top._id, title: 'Old subtask' });
        expect(sub.result.key).toMatch(/^OPE-\d+$/);
        expect(stored(sub.result.subtaskId).TaskKey).toBe(sub.result.key);
        expect(audits('task.add')).toHaveLength(0);
        expect(audits('subtask.add')).toHaveLength(0);
    });
});

describe('task.history, task.links.list and task.get', () => {
    it('reads the activity log the task panel shows, newest first, as plain text', async () => {
        await rpc(ctx(OWNER), 'task.update', { taskId: fx.top._id, title: 'Renamed <b>x</b>' });
        await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done' });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { Type: 'project', Key: 'x', UserId: OWNER, ProjectId: P_OPEN, TaskId: '', Message: 'project entry' });
        mockDb.seed(SCHEMA_TYPE.HISTORY, { Type: 'task', Key: 'x', UserId: OTHER, ProjectId: P_OPEN, TaskId: fx.bug._id, Message: 'another task' });
        const out = await rpc(ctx(MEMBER), 'task.history', { taskId: fx.top._id });
        expect(out.taskId).toBe(fx.top._id);
        expect(out.entries.map((entry) => entry.text).sort()).toEqual([
            'Claude, for Olivia Owner has changed Status as Done.',
            'Claude, for Olivia Owner has changed Task name from Task OPN-1 to Renamed <b>x</b>.',
        ]);
        expect(out.entries[0]).toMatchObject({ userId: OWNER, kind: expect.any(String) });
        expect((await rpc(ctx(MEMBER), 'task.history', { taskId: fx.top._id, limit: 1 })).entries).toHaveLength(1);
    });

    it('is refused where the role may not see a task\'s activity log', async () => {
        rules.setRule(null, 'task_activity_log', false);
        expect(await rpc(ctx(MEMBER), 'task.history', { taskId: fx.top._id })).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: task\.task_activity_log/) });
        expect((await rpc(ctx(OWNER), 'task.history', { taskId: fx.top._id })).entries).toEqual([]);
    });

    it('lists a task\'s links with their ids, and task.get carries them with the checklist, the subtask count and the tasks above', async () => {
        Object.assign(stored(fx.child._id), { links: [{ _id: 'l1', url: 'https://example.com/pull/7', kind: 'pr', label: 'PR 7', addedBy: OWNER, actorType: 'agent' }], checklistArray: [{ name: 'Write tests' }] });
        expect(await rpc(ctx(MEMBER), 'task.links.list', { taskId: fx.child._id })).toEqual({
            taskId: fx.child._id, links: [{ linkId: 'l1', url: 'https://example.com/pull/7', label: 'PR 7', kind: 'pr', addedBy: OWNER, actorType: 'agent', addedAt: null }],
        });
        const brief = await rpc(ctx(MEMBER), 'task.get', { taskId: fx.child._id });
        expect(brief).toMatchObject({ key: 'OPN-2', subTasks: 1, ancestors: [fx.top._id], parentTaskId: fx.top._id, assigneeIds: [], checklist: ['Write tests'], archived: false, links: [expect.objectContaining({ linkId: 'l1' })] });
        expect(brief.youMayNot.join(' ')).not.toMatch(/Done/);
        expect((await rpc(olderToken(MEMBER), 'task.get', { taskId: fx.child._id })).youMayNot.join(' ')).toMatch(/a person closes it/);
    });
});

describe('comments', () => {
    it('changes a comment the agent wrote for its person, and nothing else', async () => {
        const posted = await rpc(ctx(OWNER), 'task.comment', { taskId: fx.top._id, body: 'First try' });
        const theirs = mockDb.seed(SCHEMA_TYPE.COMMENTS, { taskId: fx.top._id, projectId: P_OPEN, sprintId: S_OPEN, userId: OWNER, message: 'Typed by hand', type: 'text', isDeleted: false });
        const elsewhere = mockDb.seed(SCHEMA_TYPE.COMMENTS, { taskId: fx.bug._id, projectId: P_OPEN, sprintId: S_OPEN, userId: OWNER, actorType: 'agent', message: 'Other task', type: 'text', isDeleted: false });
        const othersAgent = mockDb.seed(SCHEMA_TYPE.COMMENTS, { taskId: fx.top._id, projectId: P_OPEN, sprintId: S_OPEN, userId: OTHER, actorType: 'agent', message: 'Someone else\'s agent', type: 'text', isDeleted: false });

        const out = await rpc(ctx(OWNER), 'comment.update', { taskId: fx.top._id, commentId: posted.result.commentId, text: 'Second <b>try</b>' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { commentId: posted.result.commentId } });
        expect(comment(posted.result.commentId).message).toBe('Second &lt;b&gt;try&lt;/b&gt;');

        for (const row of [theirs, elsewhere, othersAgent]) {
            expect(await rpc(ctx(OWNER), 'comment.update', { taskId: fx.top._id, commentId: row._id, text: 'Rewritten' })).toMatchObject({ isError: true, error: expect.stringMatching(/You can change only a comment an agent wrote/) });
        }
        expect([theirs, elsewhere, othersAgent].map((row) => comment(row._id).message)).toEqual(['Typed by hand', 'Other task', 'Someone else\'s agent']);

        const [row] = audits('comment.update', 'applied');
        expect(row.meta.undo).toEqual({ kind: 'commentText', commentId: posted.result.commentId, taskId: fx.top._id, previous: 'First try' });
        await inverses.commentText(CID, row.meta.undo);
        expect(comment(posted.result.commentId).message).toBe('First try');
    });

    it('tells the members a comment names in the editor\'s markup, for a token created to manage tasks only', async () => {
        const body = `Ready for you @[Priya Other](${OTHER}) and @[Otto Outsider](${OUTSIDER})`;
        const told = await rpc(ctx(OWNER), 'task.comment', { taskId: fx.top._id, body });
        expect(told.result.mentioned).toEqual([OTHER]);
        expect(comment(told.result.commentId)).toMatchObject({ mentionIds: [OTHER], message: body, actorType: 'agent' });
        expect(rows(SCHEMA_TYPE.MENTIONS)).toEqual([expect.objectContaining({ comment_id: told.result.commentId, mentionIds: [OTHER], taskId: fx.top._id, userId: OWNER })]);

        const quiet = await rpc(olderToken(OWNER), 'task.comment', { taskId: fx.top._id, body });
        expect(quiet.result.mentioned).toBeUndefined();
        expect(comment(quiet.result.commentId).mentionIds).toBeUndefined();
        expect(rows(SCHEMA_TYPE.MENTIONS)).toHaveLength(1);
    });
});

describe('tasks.batch', () => {
    it('on one task, runs each operation on its own, reports each, and records the ones that applied as one group a person can undo', async () => {
        const out = await rpc(ctx(MEMBER), 'tasks.batch', { reason: 'weekly tidy', operations: [
            { tool: 'task.status.set', arguments: { taskId: fx.bug._id, status: 'Done' } },
            { tool: 'task.assign', arguments: { taskId: fx.bug._id, mode: 'add', userIds: [MEMBER] } },
            { tool: 'task.update', arguments: { taskId: fx.bug._id, colour: 'red' } },
            { tool: 'tasks.search', arguments: {} },
            { tool: 'tasks.batch', arguments: { operations: [] } },
            { tool: 'page.create', arguments: { title: 'Notes' } },
            { tool: 'task.update', arguments: { taskId: fx.bug._id, title: 'Renamed' } },
        ] });
        expect(out).toMatchObject({ ok: false, applied: 3, notApplied: 4, undoable: true });
        expect(out.items.map((item) => [item.index, item.tool, item.ok])).toEqual([
            [0, 'task.status.set', true], [1, 'task.assign', true], [2, 'task.update', false],
            [3, 'tasks.search', false], [4, 'tasks.batch', false], [5, 'page.create', false], [6, 'task.update', true],
        ]);
        expect(out.items[2].error).toMatch(/colour is not an argument/);
        expect(out.items[3].error).toMatch(/not a write tool a batch can run/);
        expect(out.items[5].error).toMatch(/not a write tool a batch can run/);
        expect(stored(fx.bug._id).statusType).toBe('close');
        expect(stored(fx.bug._id).AssigneeUserId).toEqual([OTHER, MEMBER]);
        expect(rows(SCHEMA_TYPE.PAGES).map((row) => row.title)).not.toContain('Notes');
        expect(proposals.create).not.toHaveBeenCalled();

        const [group] = audits('tasks.batch');
        const applied = [out.items[0].auditId, out.items[1].auditId, out.items[6].auditId];
        expect(group).toMatchObject({ action: 'agent.action', meta: { state: 'applied', reason: 'weekly tidy', undo: { kind: 'batch', auditIds: applied }, params: { tools: ['task.status.set', 'task.assign', 'task.update'] } } });
        expect(String(group._id)).toBe(String(out.auditId));

        const undone = await inverses.batch(CID, group.meta.undo, person(OWNER));
        await settle();
        expect(undone).toMatchObject({ undone: 3 });
        expect(stored(fx.bug._id).statusType).toBe('active');
        expect(stored(fx.bug._id).AssigneeUserId).toEqual([OTHER]);
        expect(stored(fx.bug._id).TaskName).toBe('Task OPN-4');
    });

    it('on more than one task, runs nothing and files the operations a call could make as one proposal', async () => {
        const before = snapshot();
        const out = await rpc(ctx(MEMBER), 'tasks.batch', { reason: 'weekly tidy', operations: [
            { tool: 'task.status.set', arguments: { taskId: fx.top._id, status: 'Done' } },
            { tool: 'task.update', arguments: { taskId: fx.private._id, title: 'Not mine' } },
            { tool: 'task.assign', arguments: { taskId: fx.bug._id, mode: 'add', userIds: [MEMBER] } },
        ] });
        expect(out).toMatchObject({ ok: false, pending: true, proposalId: 'proposal-1', applied: 0, notApplied: 3, waiting: 2, undoable: false });
        expect(out.items.map((item) => [item.index, item.pending === true])).toEqual([[0, true], [1, false], [2, true]]);
        expect(out.items[1]).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(snapshot()).toBe(before);
        expect(audits('tasks.batch')).toHaveLength(0);
        expect(proposals.create).toHaveBeenCalledTimes(1);
        expect(proposals.create.mock.calls[0][1]).toMatchObject({
            source: 'mcp', requestedBy: MEMBER, projectId: P_OPEN, taskId: null, taskIds: [String(fx.top._id), String(fx.bug._id)],
            changes: [{ action: 'task.status.change', params: { taskId: String(fx.top._id) } }, { action: 'task.assignees.set', params: { taskId: String(fx.bug._id) } }],
        });
    });

    it('records no group when nothing applied, and each item of a group is undone only by someone who can open it', async () => {
        const none = await rpc(ctx(MEMBER), 'tasks.batch', { operations: [{ tool: 'task.update', arguments: { taskId: fx.private._id, title: 'x' } }] });
        expect(none).toMatchObject({ ok: false, applied: 0, auditId: null, undoable: false });
        expect(audits('tasks.batch')).toHaveLength(0);

        const hidden = await rpc(ctx(OWNER), 'task.update', { taskId: fx.private._id, priority: 'HIGH' });
        const open = await rpc(ctx(OWNER), 'task.update', { taskId: fx.top._id, priority: 'HIGH' });
        const undone = await inverses.batch(CID, { kind: 'batch', auditIds: [hidden.auditId, open.auditId] }, person(MEMBER));
        expect(undone.items.map((item) => item.ok)).toEqual([true, false]);
        expect([stored(fx.top._id).Task_Priority, stored(fx.private._id).Task_Priority]).toEqual(['MEDIUM', 'HIGH']);
    });
});

describe('page.create and page.update for a token created to write docs', () => {
    it('creates a doc in a project through the page create path, marked as an agent\'s draft', async () => {
        const out = await rpc(docsOnly(MEMBER), 'page.create', { title: 'Release notes', text: '# 14.36\n\nWhat changed\n\n- Importer\n- Faster lists', projectId: P_OPEN, taskId: fx.top._id });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { title: 'Release notes', draft: true } });
        const made = page(out.result.pageId);
        expect(made).toMatchObject({ title: 'Release notes', createdBy: MEMBER, updatedBy: MEMBER, createdByAgent: true, agentName: 'Claude', agentStatus: 'draft', visibility: 'project', deletedStatusKey: 0 });
        expect([String(made.ProjectID), made.linkedTasks.map(String)]).toEqual([P_OPEN, [fx.top._id]]);
        expect(made.rawText).toMatch(/14\.36[\s\S]*What changed[\s\S]*Importer[\s\S]*Faster lists/);
        expect(made.content.blocks.blocks.map((block) => block.type)).toEqual(expect.arrayContaining(['header', 'paragraph', 'list']));
        expect(audits('page.create')[0]).toMatchObject({ entityType: 'page', entityId: out.result.pageId, meta: { undo: { kind: 'page', pageId: out.result.pageId } } });
    });

    it('creates a doc for the whole workspace when no project is named, but not from a token kept to some projects', async () => {
        const out = await rpc(docsOnly(MEMBER), 'page.create', { title: 'Handbook' });
        expect(page(out.result.pageId).ProjectID).toBeUndefined();
        const narrowed = await rpc(ctx(MEMBER, { projectIds: [P_OPEN], token: docsOnly(MEMBER).token }), 'page.create', { title: 'Outside' });
        expect(narrowed).toMatchObject({ refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(rows(SCHEMA_TYPE.PAGES).map((row) => row.title)).not.toContain('Outside');
    });

    it('changes a doc\'s title and text, keeps what it replaced as a version, and undo restores that version', async () => {
        const out = await rpc(docsOnly(MEMBER), 'page.update', { pageId: fx.pageOpen._id, title: 'Runbook v2', text: 'New body' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { pageId: fx.pageOpen._id, title: 'Runbook v2' } });
        expect(page(fx.pageOpen._id)).toMatchObject({ title: 'Runbook v2', rawText: 'New body', updatedBy: MEMBER, editedBy: MEMBER });
        const versions = rows(SCHEMA_TYPE.PAGE_VERSIONS).filter((version) => String(version.pageId) === String(fx.pageOpen._id));
        expect(versions).toEqual([expect.objectContaining({ title: 'Runbook', rawText: 'Old body', reason: 'manual', savedBy: MEMBER, visibility: 'project' })]);

        const [row] = audits('page.update');
        expect(row.meta.undo).toEqual({ kind: 'pageVersion', pageId: fx.pageOpen._id, versionId: String(versions[0]._id), projectId: P_OPEN });
        expect(await undoStateOf(CID, row, person(OWNER), { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        await inverses.pageVersion(CID, row.meta.undo, person(OWNER));
        expect(page(fx.pageOpen._id)).toMatchObject({ title: 'Runbook', rawText: 'Old body', updatedBy: OWNER });
    });

    it.each([
        ['a doc in a project the member cannot open', MEMBER, () => fx.pagePrivate],
        ['another person\'s private doc', MEMBER, () => fx.pageTheirs],
        ['another person\'s private doc, for an owner too', OWNER, () => fx.pageTheirs],
        ['a doc in another person\'s personal list, for an owner too', OWNER, () => fx.pagePersonal],
    ])('page.update refuses %s', async (_what, uid, target) => {
        const before = snapshot();
        expect(await rpc(docsOnly(uid), 'page.update', { pageId: target()._id, title: 'Taken' })).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(snapshot()).toBe(before);
        expect(rows(SCHEMA_TYPE.PAGE_VERSIONS)).toHaveLength(0);
    });

    it('a doc shared with the person by name is read through the tools, and changed only by a named editor', async () => {
        const nameAs = (role) => { page(fx.pagePrivate._id).sharedWith = [{ userId: MEMBER, role, by: OTHER, at: new Date() }]; };

        expect(await rpc(ctx(MEMBER), 'docs.read', { pageId: fx.pagePrivate._id })).not.toMatchObject({ title: 'Hidden' });
        nameAs('viewer');
        const before = snapshot();
        expect(await rpc(ctx(MEMBER), 'docs.read', { pageId: fx.pagePrivate._id })).toMatchObject({ pageId: String(fx.pagePrivate._id), title: 'Hidden' });
        expect(await rpc(docsOnly(MEMBER), 'page.update', { pageId: fx.pagePrivate._id, title: 'Taken' })).toMatchObject({ isError: true });
        expect(snapshot()).toBe(before);
        expect(rows(SCHEMA_TYPE.PAGE_VERSIONS)).toHaveLength(0);

        nameAs('editor');
        expect(await rpc(docsOnly(MEMBER), 'page.update', { pageId: fx.pagePrivate._id, title: 'Agreed' })).toMatchObject({ ok: true, result: { title: 'Agreed' } });
        expect(page(fx.pagePrivate._id)).toMatchObject({ title: 'Agreed', ProjectID: P_PRIVATE });
        expect(await rpc(ctx(MEMBER, { projectIds: [P_OPEN], token: docsOnly(MEMBER).token }), 'page.update', { pageId: fx.pagePrivate._id, title: 'Narrowed' }))
            .toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        expect(page(fx.pagePrivate._id).title).toBe('Agreed');
    });

    it('page.create refuses a project, a parent doc or a task outside what the person can open, and a narrowed token', async () => {
        const before = snapshot();
        for (const [caller, args] of [
            [docsOnly(MEMBER), { title: 'x', projectId: P_PRIVATE }],
            [docsOnly(OWNER), { title: 'x', projectId: PL_OTHER }],
            [docsOnly(MEMBER), { title: 'x', projectId: P_OPEN, parentPageId: fx.pageTheirs._id }],
            [docsOnly(MEMBER), { title: 'x', projectId: P_OPEN, taskId: fx.secret._id }],
            [ctx(OWNER, { projectIds: [P_DEST], token: docsOnly(OWNER).token }), { title: 'x', projectId: P_OPEN }],
        ]) {
            expect(await rpc(caller, 'page.create', args)).toMatchObject({ isError: true, refused: true, reason: expect.stringMatching(/^not_visible/) });
        }
        expect(snapshot()).toBe(before);
    });

    it('a token created to manage tasks writes no doc, and one created to write docs changes no task', async () => {
        const before = snapshot();
        for (const name of DOC_TOOLS) {
            expect(await rpc(ctx(OWNER), name, { pageId: fx.pageOpen._id, title: 'x' })).toMatchObject({ isError: true, error: expect.stringMatching(/docs:manage permission/) });
        }
        for (const [name, args] of [['task.update', { taskId: fx.top._id, title: 'x' }], ['task.archive', { taskId: fx.top._id }], ['tasks.batch', { operations: [{ tool: 'task.archive', arguments: { taskId: fx.top._id } }] }]]) {
            expect(await rpc(docsOnly(OWNER), name, args)).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        }
        for (const as of [olderToken, readOnly, oauth]) {
            expect(await rpc(as(OWNER), 'page.update', { pageId: fx.pageOpen._id, title: 'x' })).toMatchObject({ isError: true, error: expect.stringMatching(/permission|only read/) });
        }
        expect(snapshot()).toBe(before);
    });
});

describe('an outside client whose grant holds a manage scope', () => {
    const forTasks = (uid) => outside(uid, [...PLAIN_SCOPES, TASKS_GRANT]);
    const forDocs = (uid) => outside(uid, [...PLAIN_SCOPES, DOCS_GRANT]);

    afterEach(() => { delete process.env.AGENT_TAINT_ROUTING; });

    it('lists the tools of the scope it holds and of no other', async () => {
        const names = await listed(forTasks(OWNER));
        expect(names).toEqual(expect.arrayContaining([...BEFORE, ...TASK_TOOLS]));
        expect(names.filter((name) => DOC_TOOLS.includes(name))).toEqual([]);
        expect(await listed(forDocs(OWNER))).toEqual([...BEFORE, ...DOC_TOOLS]);
        expect(await listed(outside(OWNER, PLAIN_SCOPES))).toEqual(BEFORE);
    });

    it('closes a task for the person with the scope, and is refused the close without it', async () => {
        expect(await rpc(forTasks(MEMBER), 'task.status.set', { taskId: fx.top._id, status: 'Done' })).toMatchObject({ ok: true, result: { statusType: 'close' } });
        expect(stored(fx.top._id)).toMatchObject({ statusType: 'close', completion: { closedBy: expect.objectContaining({ actorId: MEMBER, viaAgent: true }) } });
        const before = snapshot();
        expect(await rpc(outside(MEMBER, PLAIN_SCOPES), 'task.status.set', { taskId: fx.bug._id, status: 'Done' })).toMatchObject({ isError: true });
        expect(snapshot()).toBe(before);
    });

    it('writes a doc with the docs scope and changes no task with it, and the other way round', async () => {
        expect(await rpc(forDocs(OWNER), 'page.update', { pageId: fx.pageOpen._id, title: 'Runbook, revised', text: 'New body' })).toMatchObject({ ok: true });
        expect(page(fx.pageOpen._id).title).toBe('Runbook, revised');
        const before = snapshot();
        expect(await rpc(forDocs(OWNER), 'task.update', { taskId: fx.top._id, title: 'x' })).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        expect(await rpc(forTasks(OWNER), 'page.update', { pageId: fx.pageOpen._id, title: 'x' })).toMatchObject({ isError: true, error: expect.stringMatching(/docs:manage permission/) });
        expect(await rpc(forDocs(MEMBER), 'page.update', { pageId: fx.pagePrivate._id, title: 'x' })).toMatchObject({ isError: true });
        expect(snapshot()).toBe(before);
    });

    it('files a doc change and a new task for a person while outside calls are routed, each under its own scope', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = snapshot();
        expect(await rpc(forDocs(OWNER), 'page.update', { pageId: fx.pageOpen._id, title: 'Held' })).toMatchObject({ ok: false, pending: true });
        expect(await rpc(forTasks(OWNER), 'task.create', { projectId: P_OPEN, title: 'Held too' })).toMatchObject({ ok: false, pending: true });
        expect(proposals.create.mock.calls.map(([, filed]) => [filed.changes[0].action, filed.oauthClientId, filed.oauthGrantId, filed.tokenId])).toEqual([
            ['page.update', CLIENT, GRANT_ID, ''], ['task.add', CLIENT, GRANT_ID, ''],
        ]);
        expect(await rpc(forDocs(OWNER), 'task.create', { projectId: P_OPEN, title: 'No scope for this' })).toMatchObject({ isError: true, refused: true });
        expect(proposals.create).toHaveBeenCalledTimes(2);
        expect(snapshot()).toBe(before);
    });
});
