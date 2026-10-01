/* Task 046, MCP parity part 3: an outside agent lists a project's tags and puts them on or takes them off a
   task, through the task route's own preparation and handler, as the person behind its token and no further. */
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

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { inverses, undoStateOf } = require('../Modules/Agents/undo');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL,
    MISSING, T_TWIN, TAGS, PRIVATE_TAGS, BEFORE, FLAGS, EVERYONE, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle,
} = world;
const { seed, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Tasks/routes').init));

const NAMES = ['tags.list', 'task.tags.add', 'task.tags.remove'];
const NOT_OPEN = 'not_visible: the task is not one the person behind this token can open';
const tagsOn = (taskId) => stored(SCHEMA_TYPE.TASKS, taskId).tagsArray || [];
const tasksNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.TASKS]);
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentName: 'Workspace agent' });

beforeEach(() => { seed(); proposals.create.mockClear(); });
afterEach(settle);
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(tools.names()).toEqual(BEFORE);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        NAMES.forEach((name) => {
            expect(registry.has(name)).toBe(false);
            expect(actions.rating(name)).toBeNull();
            expect(scopes.scopeForTool(name)).toBeNull();
        });
        expect((await rpc(ctx(OWNER), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, each tool is a rated registry action with the web route\'s permission and a plain scope, and needs no grant', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining(NAMES));
        expect(registry.permissionsFor('tags.list')).toEqual([{ key: 'task.task_list', write: false }]);
        expect(registry.permissionsFor('task.tags.add')).toEqual([{ key: 'task.task_tag', write: true }]);
        expect(registry.permissionsFor('task.tags.remove')).toEqual([{ key: 'task.task_tag', write: true }]);
        expect(actions.rating('task.tags.add')).toEqual({ write: true, reversible: true, scope: 'task', money: false });
        expect(NAMES.map((name) => scopes.scopeForTool(name))).toEqual(['projects:read', 'tasks:write', 'tasks:write']);
        expect(tools.registered().filter((tool) => NAMES.includes(tool.name)).map((tool) => tool.grant)).toEqual([undefined, undefined, undefined]);
    });
});

describe('tags.list', () => {
    it.each(EVERYONE)('answers the open project\'s tags for %s', async (label, uid) => {
        expect(await rpc(ctx(uid), 'tags.list', { projectId: P_OPEN })).toEqual({
            projectId: P_OPEN, tags: TAGS.map((tag) => ({ tagId: tag.uid, name: tag.tagName, color: tag.tagColor })),
        });
    });

    it('answers a private project only for the people who can open it, and otherwise as it answers a missing id', async () => {
        const missing = await rpc(ctx(OWNER), 'tags.list', { projectId: MISSING });
        expect(missing).toEqual({ error: 'project not found' });
        for (const uid of [OWNER, ADMIN, INSIDER]) {
            expect((await rpc(ctx(uid), 'tags.list', { projectId: P_PRIVATE })).tags).toEqual([{ tagId: 'tag_secret', name: 'Secret', color: '#00ff00' }]);
        }
        for (const uid of [OUTSIDER, GUEST]) expect(await rpc(ctx(uid), 'tags.list', { projectId: P_PRIVATE })).toEqual(missing);
    });

    it('answers someone else\'s personal list as a missing id, for an owner too', async () => {
        expect((await rpc(ctx(INSIDER), 'tags.list', { projectId: P_PERSONAL })).tags).toHaveLength(PRIVATE_TAGS.length);
        for (const uid of [OWNER, ADMIN, OUTSIDER, GUEST]) expect(await rpc(ctx(uid), 'tags.list', { projectId: P_PERSONAL })).toEqual({ error: 'project not found' });
    });

    it('stays inside the projects a token was narrowed to', async () => {
        expect((await rpc(narrowed(INSIDER, [P_PRIVATE]), 'tags.list', { projectId: P_PRIVATE })).tags).toHaveLength(1);
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'tags.list', { projectId: P_OPEN })).toEqual({ error: 'project not found' });
        expect(await rpc(narrowed(OWNER, [P_OPEN]), 'tags.list', { projectId: P_PRIVATE })).toEqual({ error: 'project not found' });
    });

    it('is refused to a person without the task list permission, and takes no argument it does not publish', async () => {
        setRule('task_list', null);
        expect(await rpc(ctx(OUTSIDER), 'tags.list', { projectId: P_OPEN })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_list/) });
        expect((await rpc(ctx(OWNER), 'tags.list', { projectId: P_OPEN, all: true })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'tags.list', { projectId: 'nope' })).rpcError).toMatchObject({ code: -32602 });
    });
});

describe('task.tags.add and task.tags.remove', () => {
    it('stores what the task route stores for the same person, and records it', async () => {
        const viaWeb = await web('PATCH /api/v2/tasks', INSIDER, { body: { action: 'updateTags', companyId: CID, projectId: P_OPEN, taskId: T_TWIN, tagId: 'tag_bug', operation: 'add' } });
        expect(viaWeb.body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'task.tags.add', { taskId: T_OPEN, tag: 'bug', reason: 'Triage' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { tagId: 'tag_bug', name: 'Bug', changed: true } });
        expect(tagsOn(T_OPEN)).toEqual(tagsOn(T_TWIN));
        expect(tagsOn(T_OPEN)).toEqual(['tag_bug']);
        const [row] = audits('task.tags.add', 'applied');
        expect(row.meta).toMatchObject({ undo: { kind: 'tag', taskId: T_OPEN, tagId: 'tag_bug', operation: 'add' } });
        expect(row.meta).toMatchObject({ onBehalfOf: INSIDER, reason: 'Triage', state: 'applied' });
    });

    it.each(EVERYONE)('lets %s tag a task in the open list by id, and take the tag off again', async (label, uid) => {
        expect(await rpc(ctx(uid), 'task.tags.add', { taskId: T_OPEN, tag: 'tag_api' })).toMatchObject({ ok: true });
        expect(tagsOn(T_OPEN)).toEqual(['tag_api']);
        expect(await rpc(ctx(uid), 'task.tags.add', { taskId: T_OPEN, tag: 'API' })).toMatchObject({ ok: true, undoable: false, result: { changed: false } });
        expect(await rpc(ctx(uid), 'task.tags.remove', { taskId: T_OPEN, tag: 'API' })).toMatchObject({ ok: true, result: { changed: true } });
        expect(tagsOn(T_OPEN)).toEqual([]);
    });

    it.each([
        ['a task in a private list', T_SECRET, [OUTSIDER, GUEST], [OWNER, INSIDER]],
        ['a task in a private project', T_PRIVATE, [OUTSIDER, GUEST], [OWNER, INSIDER]],
        ['a task in someone else\'s personal list', T_PERSONAL, [OWNER, ADMIN, OUTSIDER, GUEST], [INSIDER]],
    ])('answers %s as a missing task to those who cannot open it, and changes nothing', async (label, taskId, closedTo, openTo) => {
        const tag = taskId === T_SECRET ? 'Bug' : 'Secret';
        const missing = await rpc(ctx(OWNER), 'task.tags.add', { taskId: MISSING, tag });
        expect(missing).toMatchObject({ refused: true, reason: NOT_OPEN });
        const before = tasksNow();
        for (const uid of closedTo) {
            for (const name of ['task.tags.add', 'task.tags.remove']) {
                const { auditId, ...answer } = await rpc(ctx(uid), name, { taskId, tag });
                expect(answer).toEqual({ ...missing, auditId: undefined, action: name });
                expect(auditId).toBeTruthy();
            }
        }
        expect(tasksNow()).toBe(before);
        for (const uid of openTo) expect(await rpc(ctx(uid), 'task.tags.add', { taskId, tag })).toMatchObject({ ok: true });
    });

    it('keeps a narrowed token inside its projects', async () => {
        const before = tasksNow();
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ refused: true, reason: NOT_OPEN });
        expect(await rpc(narrowed(OWNER, [P_OPEN]), 'task.tags.add', { taskId: T_PRIVATE, tag: 'Secret' })).toMatchObject({ refused: true, reason: NOT_OPEN });
        expect(tasksNow()).toBe(before);
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'task.tags.add', { taskId: T_PRIVATE, tag: 'Secret' })).toMatchObject({ ok: true });
    });

    it('holds the person to the tag permission the task route asks for', async () => {
        setRule('task_tag', false, [0]);
        const before = tasksNow();
        expect(await rpc(ctx(GUEST), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_tag/) });
        expect(tasksNow()).toBe(before);
        expect(await rpc(ctx(OUTSIDER), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ ok: true });
    });

    it('takes only a tag the task\'s own project defines', async () => {
        const before = tasksNow();
        expect(await rpc(ctx(OWNER), 'task.tags.add', { taskId: T_OPEN, tag: 'tag_secret' })).toMatchObject({ isError: true, error: expect.stringMatching(/not one this task's project has/) });
        expect(await rpc(ctx(OWNER), 'task.tags.add', { taskId: T_OPEN, tag: 'Nothing' })).toMatchObject({ isError: true });
        expect((await rpc(ctx(OWNER), 'task.tags.add', { taskId: T_OPEN, tag: '' })).rpcError).toMatchObject({ code: -32602 });
        expect(tasksNow()).toBe(before);
    });

    it('needs the write scope: a read-only token and an OAuth token without it are refused', async () => {
        const before = tasksNow();
        expect(await rpc(readOnly(OWNER), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ isError: true, error: 'This token is read-only.' });
        expect(await rpc(outside(OWNER, ['tasks:read', 'projects:read']), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ isError: true, error: 'This token lacks the tasks:write scope.' });
        expect(await rpc(outside(OWNER, ['tasks:write']), 'tags.list', { projectId: P_OPEN })).toMatchObject({ isError: true, error: 'This token lacks the projects:read scope.' });
        expect(tasksNow()).toBe(before);
    });

    it('stays inside the actions an agent was given', async () => {
        const before = tasksNow();
        const limited = ctx(OWNER, { allowedActions: ['tasks.search', 'task.tags.remove'] });
        expect(await rpc(limited, 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ refused: true, reason: expect.stringMatching(/not in this agent's skills/) });
        expect(await rpc(limited, 'tags.list', { projectId: P_OPEN })).toMatchObject({ refused: true, reason: expect.stringMatching(/not in this agent's skills/) });
        expect(tasksNow()).toBe(before);
        expect(await rpc(limited, 'task.tags.remove', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ ok: true, result: { changed: false } });
    });

    it('runs for an outside client under taint routing, because it stays on one task and can be undone', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        expect(await rpc(outside(OUTSIDER, ['tasks:write']), 'task.tags.add', { taskId: T_OPEN, tag: 'Bug' })).toMatchObject({ ok: true });
        expect(tagsOn(T_OPEN)).toEqual(['tag_bug']);
        expect(proposals.create).not.toHaveBeenCalled();
    });

    it('keeps the task route\'s own guard when the action is reached without an MCP token', async () => {
        const before = tasksNow();
        for (const taskId of [T_SECRET, T_PRIVATE, T_PERSONAL]) {
            await expect(actions.perform({ companyId: CID, actor: inProduct(OUTSIDER), action: 'task.tags.add', params: { taskId, tag: 'Bug' } })).rejects.toThrow();
        }
        expect(tasksNow()).toBe(before);
    });

    it('is undone by the person who can open the task, through the same route', async () => {
        await rpc(ctx(INSIDER), 'task.tags.add', { taskId: T_SECRET, tag: 'Bug' });
        const [row] = audits('task.tags.add', 'applied');
        expect(await undoStateOf(CID, row, { userId: INSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        expect(await undoStateOf(CID, row, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });
        await inverses.tag(CID, row.meta.undo, { userId: INSIDER });
        expect(tagsOn(T_SECRET)).toEqual([]);
    });
});
