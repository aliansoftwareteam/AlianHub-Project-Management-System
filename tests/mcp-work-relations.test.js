require('./fixtures/mcpFlagsOff');
/* Task 046, MCP parity part 3: an outside agent reads, adds and removes the links between tasks through the
   relations route's own preparation and handlers, as the person behind its token and no further. */
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
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { inverses, undoStateOf } = require('../Modules/Agents/undo');
const approval = require('../Modules/Mcp/approval');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS,
    MISSING, T_OPEN_2, T_TWIN, BEFORE, FLAGS, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle,
} = world;
const { seed, stored, audits, setRule, rpcThrough, listedThrough, seedGrant, filedBy } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Tasks/routes').init));

const NAMES = ['task.relations.list', 'task.relation.add', 'task.relation.remove'];
const RELATIONS = 'POST /api/v2/tasks/relations';
const T_HUB = '6f0000000000000000000d0b';
const T_HIDDEN_LINKS_ONLY = '6f0000000000000000000d0c';
const T_NO_LINKS = '6f0000000000000000000d0d';
const LINKED = [T_OPEN_2, T_SECRET, T_PRIVATE, T_PERSONAL];
const NOT_OPEN = 'not_visible: that task was not found, or the person cannot open it. Ask the person which task they mean.';
const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member on the private work', INSIDER], ['a member outside it', OUTSIDER], ['a guest', GUEST]];

const link = (taskId, type) => ({ taskId, type, createdBy: INSIDER, createdAt: new Date('2026-09-01T00:00:00.000Z') });
const task = (id) => stored(SCHEMA_TYPE.TASKS, id);
const linksOf = (id) => (task(id).relations || []).map((entry) => ({ taskId: String(entry.taskId), type: entry.type, createdBy: entry.createdBy }));
const tasksNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.TASKS]);
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentName: 'Workspace agent' });
const openedBy = (uid) => LINKED.filter((id) => id === T_OPEN_2 || OPENS[uid].includes(id)).sort();

beforeEach(() => {
    const { seedTask } = seed();
    seedTask(T_HUB, 'Hub', P_OPEN, L_OPEN, { relations: LINKED.map((taskId) => link(taskId, 'blocked_by')) });
    LINKED.forEach((taskId) => { task(taskId).relations = [link(T_HUB, 'blocks')]; });
    seedTask(T_HIDDEN_LINKS_ONLY, 'Linked to private work only', P_OPEN, L_OPEN, { relations: [link(T_PRIVATE, 'blocked_by'), link(T_PERSONAL, 'relates_to')] });
    seedTask(T_NO_LINKS, 'Linked to nothing', P_OPEN, L_OPEN);
    proposals.create.mockClear();
});
afterEach(settle);
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_WORK = 'off';
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        NAMES.forEach((name) => { expect(registry.has(name)).toBe(false); expect(actions.rating(name)).toBeNull(); });
        expect((await rpc(ctx(OWNER), 'task.relations.list', { taskId: T_HUB })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, each tool is a rated registry action held to the task list, as the relations route is, with a plain scope and no grant', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining(NAMES));
        NAMES.forEach((name) => expect(registry.permissionsFor(name)).toEqual([{ key: 'task.task_list', write: false }]));
        expect(NAMES.map((name) => scopes.scopeForTool(name))).toEqual(['tasks:read', 'tasks:write', 'tasks:write']);
        expect(actions.rating('task.relation.add')).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(tools.registered().filter((tool) => NAMES.includes(tool.name)).map((tool) => tool.grant)).toEqual([undefined, undefined, undefined]);
    });
});

describe('task.relations.list', () => {
    it.each(PEOPLE)('answers, for %s, the linked tasks that person can open and nothing of the others', async (label, uid) => {
        const out = await rpc(ctx(uid), 'task.relations.list', { taskId: T_HUB });
        expect(out.relations.map((row) => row.task.taskId).sort()).toEqual(openedBy(uid));
        out.relations.forEach((row) => expect(row).toMatchObject({ type: 'blocked_by', label: 'is blocked by', task: { title: expect.any(String), projectId: expect.any(String) } }));
        expect(Object.keys(out).sort()).toEqual(['relations', 'taskId']);
        expect(JSON.stringify(out)).not.toMatch(LINKED.filter((id) => !openedBy(uid).includes(id)).join('|') || 'nothing is hidden');
    });

    it('reads the same for a task linked only to work the reader cannot open as for a task linked to nothing', async () => {
        const hidden = await rpc(ctx(OUTSIDER), 'task.relations.list', { taskId: T_HIDDEN_LINKS_ONLY });
        const none = await rpc(ctx(OUTSIDER), 'task.relations.list', { taskId: T_NO_LINKS });
        expect(hidden).toEqual({ taskId: T_HIDDEN_LINKS_ONLY, relations: [] });
        expect({ ...hidden, taskId: T_NO_LINKS }).toEqual(none);
    });

    it('answers a task in a private list, a private project or someone else\'s personal list as it answers a missing id', async () => {
        const missing = await rpc(ctx(OWNER), 'task.relations.list', { taskId: MISSING });
        expect(missing).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        for (const uid of [OUTSIDER, GUEST]) {
            for (const taskId of [T_SECRET, T_PRIVATE, T_PERSONAL]) expect(await rpc(ctx(uid), 'task.relations.list', { taskId })).toEqual(missing);
        }
        expect(await rpc(ctx(OWNER), 'task.relations.list', { taskId: T_PERSONAL })).toEqual(missing);
        expect((await rpc(ctx(INSIDER), 'task.relations.list', { taskId: T_PERSONAL })).relations).toHaveLength(1);
    });

    it('keeps a narrowed token to the linked tasks inside its projects', async () => {
        const out = await rpc(narrowed(INSIDER, [P_OPEN]), 'task.relations.list', { taskId: T_HUB });
        expect(out.relations.map((row) => row.task.taskId).sort()).toEqual([T_OPEN_2, T_SECRET].sort());
        expect(JSON.stringify(out)).not.toMatch(`${T_PRIVATE}|${T_PERSONAL}`);
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'task.relations.list', { taskId: T_HUB })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
    });
});

describe('task.relation.add', () => {
    it('stores what the relations route stores for the same person, on both tasks, and records it', async () => {
        const viaWeb = await web(RELATIONS, INSIDER, { body: { action: 'add', companyId: CID, taskId: T_TWIN, relatedTaskId: T_NO_LINKS, type: 'blocks' } });
        expect(viaWeb.body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'blocks', reason: 'Found in review' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'blocks' } });
        expect(linksOf(T_OPEN)).toEqual(linksOf(T_TWIN));
        expect(linksOf(T_OPEN)).toEqual([{ taskId: T_NO_LINKS, type: 'blocks', createdBy: INSIDER }]);
        expect(linksOf(T_NO_LINKS)).toEqual([{ taskId: T_TWIN, type: 'blocked_by', createdBy: INSIDER }, { taskId: T_OPEN, type: 'blocked_by', createdBy: INSIDER }]);
        expect(audits('task.relation.add', 'applied')[0].meta).toMatchObject({ onBehalfOf: INSIDER, undo: { kind: 'relation', taskId: T_OPEN, relatedTaskId: T_NO_LINKS } });
    });

    it.each(PEOPLE)('lets %s link two tasks of the open list', async (label, uid) => {
        expect(await rpc(ctx(uid), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'relates_to' })).toMatchObject({ ok: true });
        expect(linksOf(T_NO_LINKS)).toEqual([{ taskId: T_OPEN, type: 'relates_to', createdBy: uid }]);
    });

    it('answers either end the person cannot open as a missing task, whichever end it is, and links nothing', async () => {
        const missing = await rpc(ctx(OWNER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: MISSING, type: 'blocks' });
        expect(missing).toMatchObject({ refused: true, reason: NOT_OPEN });
        const before = tasksNow();
        const closed = [[OUTSIDER, T_SECRET], [GUEST, T_SECRET], [OUTSIDER, T_PRIVATE], [GUEST, T_PRIVATE], [OWNER, T_PERSONAL], [ADMIN, T_PERSONAL], [OUTSIDER, T_PERSONAL]];
        for (const [uid, hidden] of closed) {
            for (const args of [{ taskId: T_OPEN, relatedTaskId: hidden }, { taskId: hidden, relatedTaskId: T_OPEN }]) {
                expect(await rpc(ctx(uid), 'task.relation.add', { ...args, type: 'blocks' })).toMatchObject({ refused: true, reason: NOT_OPEN });
            }
        }
        expect(tasksNow()).toBe(before);
        expect(await rpc(ctx(INSIDER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_PERSONAL, type: 'blocks' })).toMatchObject({ ok: true });
    });

    it('keeps a narrowed token inside its projects at both ends', async () => {
        const before = tasksNow();
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_PRIVATE, type: 'blocks' })).toMatchObject({ refused: true, reason: NOT_OPEN });
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.relation.add', { taskId: T_PRIVATE, relatedTaskId: T_OPEN, type: 'blocks' })).toMatchObject({ refused: true, reason: NOT_OPEN });
        expect(tasksNow()).toBe(before);
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_SECRET, type: 'blocks' })).toMatchObject({ ok: true });
    });

    it('is closed to a person without the task list permission, takes only a known type, and links a pair once', async () => {
        setRule('task_list', null, [0]);
        const before = tasksNow();
        expect(await rpc(ctx(GUEST), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'blocks' })).toMatchObject({ refused: true, reason: NOT_OPEN });
        expect(await rpc(ctx(GUEST), 'task.relations.list', { taskId: T_HUB })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_list/) });
        expect((await rpc(ctx(OWNER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'follows' })).rpcError).toMatchObject({ code: -32602 });
        expect(await rpc(ctx(OWNER), 'task.relation.add', { taskId: T_HUB, relatedTaskId: T_OPEN_2, type: 'blocks' })).toMatchObject({ isError: true, error: expect.stringMatching(/already linked/) });
        expect(await rpc(ctx(OWNER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_OPEN, type: 'blocks' })).toMatchObject({ isError: true });
        expect(tasksNow()).toBe(before);
    });

    it('needs the write scope', async () => {
        const before = tasksNow();
        expect(await rpc(readOnly(OWNER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'blocks' })).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(await rpc(outside(OWNER, ['tasks:read']), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'blocks' })).toMatchObject({ isError: true, error: 'This connection was not given the tasks:write permission. Ask the person to connect you again and allow it.' });
        expect(await rpc(outside(OWNER, ['tasks:write']), 'task.relations.list', { taskId: T_HUB })).toMatchObject({ isError: true, error: 'This connection was not given the tasks:read permission. Ask the person to connect you again and allow it.' });
        expect(tasksNow()).toBe(before);
    });

    it('is undone by a person who can open both tasks', async () => {
        await rpc(ctx(INSIDER), 'task.relation.add', { taskId: T_OPEN, relatedTaskId: T_SECRET, type: 'duplicates' });
        const [row] = audits('task.relation.add', 'applied');
        expect(await undoStateOf(CID, row, { userId: OWNER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        expect(await undoStateOf(CID, row, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });
        await inverses.relation(CID, row.meta.undo, { userId: OWNER });
        await settle();
        expect(linksOf(T_OPEN)).toEqual([]);
        expect(linksOf(T_SECRET).map((entry) => entry.taskId)).toEqual([T_HUB]);
    });
});

describe('task.relation.remove', () => {
    it('stores what the relations route stores for the same person, on both tasks', async () => {
        task(T_TWIN).relations = [link(T_NO_LINKS, 'relates_to')];
        task(T_OPEN).relations = [link(T_NO_LINKS, 'relates_to')];
        task(T_NO_LINKS).relations = [link(T_TWIN, 'relates_to'), link(T_OPEN, 'relates_to')];
        expect((await web(RELATIONS, OUTSIDER, { body: { action: 'remove', companyId: CID, taskId: T_TWIN, relatedTaskId: T_NO_LINKS } })).body).toMatchObject({ status: true });

        expect(await rpc(ctx(OUTSIDER), 'task.relation.remove', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS })).toMatchObject({ ok: true, undoable: true, result: { removed: true } });
        expect(linksOf(T_OPEN)).toEqual(linksOf(T_TWIN));
        expect(linksOf(T_OPEN)).toEqual([]);
        expect(linksOf(T_NO_LINKS)).toEqual([]);
        const [row] = audits('task.relation.remove', 'applied');
        await inverses.relationRemoved(CID, row.meta.undo, { userId: OUTSIDER });
        await settle();
        expect(linksOf(T_OPEN)).toEqual([{ taskId: T_NO_LINKS, type: 'relates_to', createdBy: OUTSIDER }]);
    });

    it('answers a link whose other end the person cannot open as a link to a missing task, and leaves it', async () => {
        const missing = await rpc(ctx(OUTSIDER), 'task.relation.remove', { taskId: T_HUB, relatedTaskId: MISSING });
        expect(missing).toMatchObject({ refused: true, reason: NOT_OPEN });
        const before = tasksNow();
        for (const hidden of [T_SECRET, T_PRIVATE, T_PERSONAL]) {
            const { auditId, ...answer } = await rpc(ctx(OUTSIDER), 'task.relation.remove', { taskId: T_HUB, relatedTaskId: hidden });
            expect(answer).toEqual({ ...missing, auditId: undefined });
            expect(auditId).toBeTruthy();
        }
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.relation.remove', { taskId: T_HUB, relatedTaskId: T_PRIVATE })).toMatchObject({ refused: true, reason: NOT_OPEN });
        expect(await rpc(ctx(OUTSIDER), 'task.relation.remove', { taskId: T_OPEN, relatedTaskId: T_NO_LINKS })).toMatchObject({ isError: true, error: 'These tasks are not linked.' });
        expect(tasksNow()).toBe(before);
    });
});

describe('the actions, reached without an MCP token', () => {
    it('answer either end the person cannot open as a missing task, and write nothing', async () => {
        const before = tasksNow();
        const perform = (action, params) => actions.perform({ companyId: CID, actor: inProduct(OUTSIDER), action, params });
        await expect(perform('task.relation.add', { taskId: T_OPEN, relatedTaskId: T_SECRET, type: 'blocks' })).rejects.toThrow('Task not found');
        await expect(perform('task.relation.add', { taskId: T_OPEN, relatedTaskId: MISSING, type: 'blocks' })).rejects.toThrow('Task not found');
        await expect(perform('task.relation.add', { taskId: T_SECRET, relatedTaskId: T_OPEN, type: 'blocks' })).rejects.toThrow('Task not found');
        for (const hidden of [T_SECRET, T_PRIVATE, T_PERSONAL]) {
            await expect(perform('task.relation.remove', { taskId: T_HUB, relatedTaskId: hidden })).rejects.toThrow('Task not found');
        }
        expect(tasksNow()).toBe(before);
    });
});

describe('an outside client under taint routing', () => {
    const args = { taskId: T_OPEN, relatedTaskId: T_NO_LINKS, type: 'blocks' };
    const decided = (proposal, decider = OWNER) => approval.refusalFor(CID, proposal, { decider: { userId: decider }, isPrivileged: true });

    beforeEach(() => { process.env.AGENT_TAINT_ROUTING = 'on'; });

    it('is refused a link, which reaches two tasks, and nothing is filed', async () => {
        const before = tasksNow();
        expect(await rpc(outside(OWNER, ['tasks:read', 'tasks:write']), 'task.relation.add', args)).toMatchObject({ refused: true, reason: expect.stringMatching(/outside client/) });
        expect(proposals.create).not.toHaveBeenCalled();
        expect(tasksNow()).toBe(before);
    });

    it('files the link for a person when the connection holds the manage scope, and approval asks that scope again', async () => {
        const before = tasksNow();
        expect(await rpc(outside(OWNER, ['tasks:write', 'tasks:manage']), 'task.relation.add', { ...args, reason: 'Found in review' })).toMatchObject({ ok: false, pending: true, proposalId: 'proposal-1' });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({
            source: 'mcp', requestedBy: OWNER, tokenId: '', changes: [expect.objectContaining({ action: 'task.relation.add', params: args })],
        }));
        expect(tasksNow()).toBe(before);

        const proposal = filedBy(OUTSIDER, 'task.relation.add', args);
        seedGrant(OUTSIDER, ['tasks:write']);
        expect(await decided(proposal)).toMatchObject({ status: 403, error: expect.stringMatching(/no longer holds the grant/) });
        mockDb.store[SCHEMA_TYPE.OAUTH_GRANTS].length = 0;
        mockDb.store[SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS].length = 0;
        seedGrant(OUTSIDER, ['tasks:write', 'tasks:manage']);
        expect(await decided(proposal)).toBeNull();
        expect(await decided(filedBy(OUTSIDER, 'task.relation.add', { ...args, relatedTaskId: T_SECRET }))).toMatchObject({ status: 403, error: expect.stringMatching(/can no longer open/) });
        expect(await decided(filedBy(OUTSIDER, 'task.relation.add', { ...args, relatedTaskId: T_SECRET }), GUEST)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
    });
});
