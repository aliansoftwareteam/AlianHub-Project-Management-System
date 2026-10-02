/* Task 046 M3, slice L6: an outside agent adds a task to another list, takes it out again, reads the lists it
   was added to and searches one list's rows, through the task routes' own handlers and as the person behind
   its token. The task's home alone decides who reads it: a list it was added to never does. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockQueries = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        mockQueries.push({ type: q.type, method, data: q.data });
        return mockDb.crud(companyId, q, method);
    },
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
const { MAX_EXTRA_LISTS } = require('../Modules/Tasks/helpers/taskExtraListsRules');

const {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL,
    T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, MISSING, T_OPEN_2, T_TWIN, BEFORE, FLAGS, EVERYONE, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle,
} = world;
const { seed, stored, audits, setRule, rpcThrough, listedThrough, seedGrant, filedBy } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Tasks/routes').init));

const NAMES = ['task.lists.list', 'task.lists.add', 'task.lists.remove'];
const PATCH = 'PATCH /api/v2/tasks';
const L_OPEN_2 = '6f0000000000000000000b05';
const L_SCRUM = '6f0000000000000000000b06';
const HOME_ROWS = [T_OPEN, T_OPEN_2, T_TWIN];
const TASK_NOT_OPEN = 'not_visible: that task was not found, or the person cannot open it. Ask the person which task they mean.';
const PROJECT_NOT_OPEN = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const LIST_NOT_OPEN = 'not_visible: that list was not found in that project, or the person cannot open it. Ask the person which list they mean.';
const PEOPLE = [['an owner', OWNER], ['an admin', ADMIN], ['a member on the private work', INSIDER], ['a member outside it', OUTSIDER], ['a guest', GUEST]];
const PROJECT_OF = { [L_OPEN]: P_OPEN, [L_OPEN_2]: P_OPEN, [L_SCRUM]: P_OPEN, [L_SECRET]: P_OPEN, [L_PRIVATE]: P_PRIVATE, [L_PERSONAL]: P_PERSONAL };

const task = (id) => stored(SCHEMA_TYPE.TASKS, id);
const placed = (id) => (task(id).extraLists || []).map((entry) => [String(entry.projectId), String(entry.sprintId), entry.addedBy]);
const place = (id, lists, addedBy = OWNER) => {
    task(id).extraLists = lists.map((sprintId) => ({ projectId: PROJECT_OF[sprintId] || P_OPEN, sprintId, addedBy, addedAt: new Date('2026-09-30T00:00:00.000Z') }));
};
const into = (taskId, sprintId, extra = {}) => ({ taskId, projectId: PROJECT_OF[sprintId], sprintId, ...extra });
const paramsOf = ({ taskId, projectId, sprintId }) => ({ taskId, listProjectId: projectId, sprintId });
const tasksNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.TASKS]);
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentName: 'Workspace agent' });
const found = async (caller, args) => ((await rpc(caller, 'tasks.search', { limit: 50, ...args })).tasks || []).map((row) => row.taskId).sort();
const sorted = (ids) => [...ids].sort();
const manager = (uid) => ctx(uid, { token: { _id: world.TOKEN, userId: uid, scopes: ['read', 'write'], grants: ['tasks:manage'], active: true } });
const searchFilters = () => mockQueries.filter((q) => q.type === SCHEMA_TYPE.TASKS && q.method === 'find' && q.data[0] && q.data[0].CompanyId).map((q) => q.data[0]);
const searchTool = async (caller) => (await server.handleRpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((tool) => tool.name === 'tasks.search');

beforeEach(() => {
    const { list } = seed();
    list(L_OPEN_2, 'Second open list', P_OPEN);
    list(L_SCRUM, 'Sprint 1', P_OPEN, { isScrum: true });
    proposals.create.mockClear();
    mockQueries.length = 0;
});
afterEach(settle);
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list, the registry and the search are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        place(T_PRIVATE, [L_OPEN]);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        NAMES.forEach((name) => { expect(registry.has(name)).toBe(false); expect(actions.rating(name)).toBeNull(); });
        expect((await rpc(ctx(OWNER), 'task.lists.list', { taskId: T_OPEN })).rpcError).toMatchObject({ code: -32601 });
        expect((await rpc(ctx(OWNER), 'task.lists.add', into(T_OPEN, L_OPEN_2))).rpcError).toMatchObject({ code: -32601 });
        expect((await searchTool(ctx(OWNER))).inputSchema.properties).not.toHaveProperty('sprintId');

        process.env.MCP_TOOLS_MANAGE = 'on';
        expect(await found(manager(OWNER), { sprintId: L_OPEN })).toEqual(sorted(HOME_ROWS));
    });

    it('on, each tool is a rated registry action held to what the task route asks, with a plain scope and no grant', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining(NAMES));
        expect(registry.permissionsFor('task.lists.list')).toEqual([{ key: 'task.task_list', write: false }]);
        expect(registry.permissionsFor('task.lists.add')).toEqual([{ key: 'task.task_move', write: true }]);
        expect(registry.permissionsFor('task.lists.remove')).toEqual([{ key: 'task.task_list', write: false }]);
        expect(NAMES.map((name) => scopes.scopeForTool(name))).toEqual(['tasks:read', 'tasks:write', 'tasks:write']);
        expect(actions.rating('task.lists.list')).toEqual({ write: false, reversible: true, scope: 'task', money: false });
        ['task.lists.add', 'task.lists.remove'].forEach((name) => expect(actions.rating(name)).toEqual({ write: true, reversible: true, scope: 'project', money: false }));
        expect(tools.registered().filter((tool) => NAMES.includes(tool.name)).map((tool) => tool.grant)).toEqual([undefined, undefined, undefined]);
        expect((await searchTool(ctx(OWNER))).inputSchema.properties).toHaveProperty('sprintId');
    });
});

describe('task.lists.add', () => {
    it('stores what the task route stores for the same person, and records it', async () => {
        const viaWeb = await web(PATCH, INSIDER, { body: { action: 'addToList', taskId: T_TWIN, sprintId: L_OPEN_2 } });
        expect(viaWeb.body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'task.lists.add', into(T_OPEN, L_OPEN_2, { reason: 'Planned for the launch too' }));
        expect(out).toMatchObject({ ok: true, undoable: true, result: { taskId: T_OPEN, projectId: P_OPEN, sprintId: L_OPEN_2, added: true } });
        expect(placed(T_OPEN)).toEqual(placed(T_TWIN));
        expect(placed(T_OPEN)).toEqual([[P_OPEN, L_OPEN_2, INSIDER]]);
        expect(task(T_OPEN).sprintId).toBe(L_OPEN);
        expect(audits('task.lists.add', 'applied')[0].meta).toMatchObject({ onBehalfOf: INSIDER, undo: { kind: 'extraList', taskId: T_OPEN, listProjectId: P_OPEN, sprintId: L_OPEN_2, operation: 'add' } });
    });

    it.each(EVERYONE)('lets %s add a task of the open list to another open list', async (label, uid) => {
        expect(await rpc(ctx(uid), 'task.lists.add', into(T_OPEN, L_OPEN_2))).toMatchObject({ ok: true });
        expect(placed(T_OPEN)).toEqual([[P_OPEN, L_OPEN_2, uid]]);
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN], ['a member on the private work', INSIDER]])('lets %s add it to a private list and to a list of a private project', async (label, uid) => {
        expect(await rpc(ctx(uid), 'task.lists.add', into(T_OPEN, L_SECRET))).toMatchObject({ ok: true });
        expect(await rpc(ctx(uid), 'task.lists.add', into(T_OPEN, L_PRIVATE))).toMatchObject({ ok: true });
        expect(placed(T_OPEN)).toEqual([[P_OPEN, L_SECRET, uid], [P_PRIVATE, L_PRIVATE, uid]]);
    });

    it('answers a task whose home the person cannot open as a missing task, whatever list it names', async () => {
        const missing = await rpc(ctx(OWNER), 'task.lists.add', into(MISSING, L_OPEN_2));
        expect(missing).toMatchObject({ refused: true, reason: TASK_NOT_OPEN });
        place(T_PRIVATE, [L_OPEN]);
        const before = tasksNow();
        const closed = [[OUTSIDER, T_SECRET], [GUEST, T_SECRET], [OUTSIDER, T_PRIVATE], [GUEST, T_PRIVATE], [OWNER, T_PERSONAL], [ADMIN, T_PERSONAL], [OUTSIDER, T_PERSONAL]];
        for (const [uid, hidden] of closed) {
            const { auditId, ...answer } = await rpc(ctx(uid), 'task.lists.add', into(hidden, L_OPEN_2));
            expect(answer).toEqual({ ...missing, auditId: undefined });
            expect(auditId).toBeTruthy();
        }
        expect(tasksNow()).toBe(before);
    });

    it('answers a list the person cannot open as a missing list', async () => {
        const before = tasksNow();
        expect(await rpc(ctx(OWNER), 'task.lists.add', { taskId: T_OPEN, projectId: P_OPEN, sprintId: MISSING })).toMatchObject({ refused: true, reason: LIST_NOT_OPEN });
        for (const uid of [OUTSIDER, GUEST]) {
            expect(await rpc(ctx(uid), 'task.lists.add', into(T_OPEN, L_SECRET))).toMatchObject({ refused: true, reason: LIST_NOT_OPEN });
            expect(await rpc(ctx(uid), 'task.lists.add', into(T_OPEN, L_PRIVATE))).toMatchObject({ refused: true, reason: PROJECT_NOT_OPEN });
            expect(await rpc(ctx(uid), 'task.lists.add', { taskId: T_OPEN, projectId: P_OPEN, sprintId: L_PRIVATE })).toMatchObject({ refused: true, reason: LIST_NOT_OPEN });
        }
        expect(await rpc(ctx(OWNER), 'task.lists.add', { taskId: T_OPEN, projectId: P_OPEN, sprintId: L_PRIVATE })).toMatchObject({ refused: true, reason: LIST_NOT_OPEN });
        expect(tasksNow()).toBe(before);
    });

    it('keeps a narrowed token to a task inside its projects and a list inside its projects', async () => {
        const before = tasksNow();
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.add', into(T_OPEN, L_PRIVATE))).toMatchObject({ refused: true, reason: PROJECT_NOT_OPEN });
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.add', into(T_PRIVATE, L_OPEN))).toMatchObject({ refused: true, reason: TASK_NOT_OPEN });
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'task.lists.add', into(T_OPEN, L_PRIVATE))).toMatchObject({ refused: true, reason: TASK_NOT_OPEN });
        expect(tasksNow()).toBe(before);
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.add', into(T_OPEN, L_SECRET))).toMatchObject({ ok: true });
        expect(await rpc(narrowed(INSIDER, [P_OPEN, P_PRIVATE]), 'task.lists.add', into(T_OPEN, L_PRIVATE))).toMatchObject({ ok: true });
    });

    it('is refused by the rules the task route keeps: no Scrum sprint, no personal list, once per list, never the home list, and the cap', async () => {
        place(T_OPEN_2, [L_OPEN_2]);
        place(T_TWIN, Array.from({ length: MAX_EXTRA_LISTS }, (_, at) => `6f00000000000000000ffb${String(at).padStart(2, '0')}`));
        const before = tasksNow();
        expect(await rpc(ctx(OWNER), 'task.lists.add', into(T_OPEN, L_SCRUM))).toMatchObject({ isError: true, error: 'A task cannot be added to a Scrum sprint or a backlog.' });
        expect(await rpc(ctx(INSIDER), 'task.lists.add', into(T_OPEN, L_PERSONAL))).toMatchObject({ isError: true, error: 'A task cannot be added to a personal list.' });
        expect(await rpc(ctx(INSIDER), 'task.lists.add', into(T_PERSONAL, L_OPEN))).toMatchObject({ isError: true, error: 'A task in a personal list cannot be added to another list.' });
        expect(await rpc(ctx(OWNER), 'task.lists.add', into(T_OPEN, L_OPEN))).toMatchObject({ isError: true, error: 'The task already lives in that list.' });
        expect(await rpc(ctx(OWNER), 'task.lists.add', into(T_OPEN_2, L_OPEN_2))).toMatchObject({ isError: true, error: 'The task is already in that list.' });
        expect(await rpc(ctx(OWNER), 'task.lists.add', into(T_TWIN, L_OPEN_2))).toMatchObject({ isError: true, error: `A task can be in at most ${MAX_EXTRA_LISTS} extra lists.` });
        expect(tasksNow()).toBe(before);
    });

    it('is closed to a person who may not move tasks, and takes only ids', async () => {
        setRule('task_move', null, [0]);
        const before = tasksNow();
        expect(await rpc(ctx(GUEST), 'task.lists.add', into(T_OPEN, L_OPEN_2))).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_move/) });
        expect((await rpc(ctx(OWNER), 'task.lists.add', { taskId: T_OPEN, projectId: P_OPEN, sprintId: 'the second list' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'task.lists.add', { taskId: T_OPEN, sprintId: L_OPEN_2 })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'task.lists.add', into(T_OPEN, L_OPEN_2, { extraLists: [] }))).rpcError).toMatchObject({ code: -32602 });
        expect(tasksNow()).toBe(before);
    });

    it('needs the write scope', async () => {
        const before = tasksNow();
        expect(await rpc(readOnly(OWNER), 'task.lists.add', into(T_OPEN, L_OPEN_2))).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(await rpc(outside(OWNER, ['tasks:read']), 'task.lists.add', into(T_OPEN, L_OPEN_2))).toMatchObject({ isError: true, error: 'This connection was not given the tasks:write permission. Ask the person to connect you again and allow it.' });
        expect(await rpc(outside(OWNER, ['tasks:write']), 'task.lists.list', { taskId: T_OPEN })).toMatchObject({ isError: true, error: 'This connection was not given the tasks:read permission. Ask the person to connect you again and allow it.' });
        expect(tasksNow()).toBe(before);
    });

    it('is undone by a person who can open the task and the list', async () => {
        await rpc(ctx(INSIDER), 'task.lists.add', into(T_OPEN, L_SECRET));
        const [row] = audits('task.lists.add', 'applied');
        expect(await undoStateOf(CID, row, { userId: OWNER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        expect(await undoStateOf(CID, row, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });
        await inverses.extraList(CID, row.meta.undo, { userId: OWNER });
        await settle();
        expect(placed(T_OPEN)).toEqual([]);
    });

    it('is not undone by a person who can open the list but not the task\'s home', async () => {
        await rpc(ctx(INSIDER), 'task.lists.add', into(T_PRIVATE, L_OPEN));
        const [row] = audits('task.lists.add', 'applied');
        expect(await undoStateOf(CID, row, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false, projectId: P_PRIVATE });
        expect(await undoStateOf(CID, row, { userId: INSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true, projectId: P_PRIVATE });
    });

    it('is not undone by a person who can open the task but not the list', async () => {
        await rpc(ctx(INSIDER), 'task.lists.add', into(T_OPEN, L_PRIVATE));
        const [row] = audits('task.lists.add', 'applied');
        expect(await undoStateOf(CID, row, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false, reason: 'target_not_visible', projectId: P_OPEN });
        expect(await undoStateOf(CID, row, { userId: INSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
    });
});

describe('task.lists.remove', () => {
    it('stores what the task route stores for the same person, and is put back by undo', async () => {
        place(T_OPEN, [L_OPEN_2, L_PRIVATE]);
        place(T_TWIN, [L_OPEN_2, L_PRIVATE]);
        expect((await web(PATCH, OUTSIDER, { body: { action: 'removeFromList', taskId: T_TWIN, sprintId: L_OPEN_2 } })).body).toMatchObject({ status: true });

        expect(await rpc(ctx(OUTSIDER), 'task.lists.remove', into(T_OPEN, L_OPEN_2))).toMatchObject({ ok: true, undoable: true, result: { taskId: T_OPEN, projectId: P_OPEN, sprintId: L_OPEN_2, removed: true } });
        expect(placed(T_OPEN)).toEqual(placed(T_TWIN));
        expect(placed(T_OPEN)).toEqual([[P_PRIVATE, L_PRIVATE, OWNER]]);
        const [row] = audits('task.lists.remove', 'applied');
        expect(row.meta).toMatchObject({ onBehalfOf: OUTSIDER, undo: { kind: 'extraList', taskId: T_OPEN, listProjectId: P_OPEN, sprintId: L_OPEN_2, operation: 'remove' } });
        await inverses.extraList(CID, row.meta.undo, { userId: OUTSIDER });
        await settle();
        expect(placed(T_OPEN)).toEqual([[P_PRIVATE, L_PRIVATE, OWNER], [P_OPEN, L_OPEN_2, OUTSIDER]]);
    });

    it('answers a task whose home the person cannot open as a missing task, though they can open the list it was added to', async () => {
        place(T_PRIVATE, [L_OPEN]);
        place(T_SECRET, [L_OPEN]);
        const missing = await rpc(ctx(OUTSIDER), 'task.lists.remove', into(MISSING, L_OPEN));
        expect(missing).toMatchObject({ refused: true, reason: TASK_NOT_OPEN });
        const before = tasksNow();
        for (const uid of [OUTSIDER, GUEST]) {
            for (const hidden of [T_PRIVATE, T_SECRET]) {
                const { auditId, ...answer } = await rpc(ctx(uid), 'task.lists.remove', into(hidden, L_OPEN));
                expect(answer).toEqual({ ...missing, auditId: undefined });
                expect(auditId).toBeTruthy();
            }
        }
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.remove', into(T_PRIVATE, L_OPEN))).toMatchObject({ refused: true, reason: TASK_NOT_OPEN });
        expect(tasksNow()).toBe(before);
        expect(await rpc(ctx(INSIDER), 'task.lists.remove', into(T_PRIVATE, L_OPEN))).toMatchObject({ ok: true });
    });

    it('leaves a list the caller cannot open, a list outside a narrowed token and a list the task is not in', async () => {
        place(T_OPEN, [L_SECRET, L_PRIVATE]);
        const before = tasksNow();
        expect(await rpc(ctx(OUTSIDER), 'task.lists.remove', into(T_OPEN, L_SECRET))).toMatchObject({ refused: true, reason: LIST_NOT_OPEN });
        expect(await rpc(ctx(OUTSIDER), 'task.lists.remove', into(T_OPEN, L_PRIVATE))).toMatchObject({ refused: true, reason: PROJECT_NOT_OPEN });
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.remove', into(T_OPEN, L_PRIVATE))).toMatchObject({ refused: true, reason: PROJECT_NOT_OPEN });
        expect(await rpc(ctx(OWNER), 'task.lists.remove', into(T_OPEN, L_OPEN_2))).toMatchObject({ isError: true, error: 'The task is not in that list.' });
        expect(await rpc(ctx(OWNER), 'task.lists.remove', into(T_OPEN, L_OPEN))).toMatchObject({ isError: true, error: 'The task is not in that list.' });
        expect(tasksNow()).toBe(before);
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.remove', into(T_OPEN, L_SECRET))).toMatchObject({ ok: true });
    });
});

describe('task.lists.list', () => {
    const OPEN_TO = { [OWNER]: [L_OPEN_2, L_SECRET, L_PRIVATE], [ADMIN]: [L_OPEN_2, L_SECRET, L_PRIVATE], [INSIDER]: [L_OPEN_2, L_SECRET, L_PRIVATE], [OUTSIDER]: [L_OPEN_2], [GUEST]: [L_OPEN_2] };

    it.each(PEOPLE)('answers, for %s, the lists that person can open and nothing of the others', async (label, uid) => {
        place(T_OPEN, [L_OPEN_2, L_SECRET, L_PRIVATE]);
        const out = await rpc(ctx(uid), 'task.lists.list', { taskId: T_OPEN });
        expect(Object.keys(out).sort()).toEqual(['lists', 'taskId']);
        expect(out.lists.map((row) => row.sprintId)).toEqual(OPEN_TO[uid]);
        out.lists.forEach((row) => expect(row).toMatchObject({ projectId: PROJECT_OF[row.sprintId], name: expect.any(String), project: expect.any(String), addedBy: OWNER }));
        expect(JSON.stringify(out)).not.toMatch([L_OPEN_2, L_SECRET, L_PRIVATE].filter((id) => !OPEN_TO[uid].includes(id)).join('|') || 'nothing is hidden');
    });

    it('reads the same for a task added only to lists the reader cannot open as for a task added to none', async () => {
        place(T_OPEN, [L_SECRET, L_PRIVATE]);
        const hidden = await rpc(ctx(OUTSIDER), 'task.lists.list', { taskId: T_OPEN });
        const none = await rpc(ctx(OUTSIDER), 'task.lists.list', { taskId: T_OPEN_2 });
        expect(hidden).toEqual({ taskId: T_OPEN, lists: [] });
        expect({ ...hidden, taskId: T_OPEN_2 }).toEqual(none);
    });

    it('answers a task whose home the person cannot open as a missing task, though they can open a list it was added to', async () => {
        place(T_PRIVATE, [L_OPEN]);
        place(T_SECRET, [L_OPEN]);
        const missing = await rpc(ctx(OWNER), 'task.lists.list', { taskId: MISSING });
        expect(missing).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
        for (const uid of [OUTSIDER, GUEST]) {
            for (const taskId of [T_SECRET, T_PRIVATE, T_PERSONAL]) expect(await rpc(ctx(uid), 'task.lists.list', { taskId })).toEqual(missing);
        }
        expect(await rpc(ctx(OWNER), 'task.lists.list', { taskId: T_PERSONAL })).toEqual(missing);
        expect((await rpc(ctx(INSIDER), 'task.lists.list', { taskId: T_PRIVATE })).lists.map((row) => row.sprintId)).toEqual([L_OPEN]);
    });

    it('keeps a narrowed token to the lists inside its projects', async () => {
        place(T_OPEN, [L_OPEN_2, L_SECRET, L_PRIVATE]);
        const out = await rpc(narrowed(INSIDER, [P_OPEN]), 'task.lists.list', { taskId: T_OPEN });
        expect(out.lists.map((row) => row.sprintId)).toEqual([L_OPEN_2, L_SECRET]);
        expect(JSON.stringify(out)).not.toMatch(`${L_PRIVATE}|${P_PRIVATE}`);
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'task.lists.list', { taskId: T_OPEN })).toEqual({ error: 'That task was not found. Ask the person which task they mean.' });
    });
});

describe('tasks.search by list', () => {
    beforeEach(() => {
        place(T_PRIVATE, [L_OPEN]);
        place(T_SECRET, [L_OPEN]);
        place(T_OPEN, [L_PRIVATE]);
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN], ['a member on the private work', INSIDER]])('answers %s the tasks that live in the list and the tasks added to it', async (label, uid) => {
        expect(await found(ctx(uid), { sprintId: L_OPEN })).toEqual(sorted([...HOME_ROWS, T_PRIVATE, T_SECRET]));
        expect(await found(ctx(uid), { sprintId: L_PRIVATE })).toEqual(sorted([T_PRIVATE, T_OPEN]));
    });

    it.each([['a member outside the private work', OUTSIDER], ['a guest', GUEST]])('answers %s no added task whose home they cannot open, and nothing of a list they cannot open', async (label, uid) => {
        expect(await found(ctx(uid), { sprintId: L_OPEN })).toEqual(sorted(HOME_ROWS));
        expect(await found(ctx(uid), { sprintId: L_PRIVATE })).toEqual([]);
        expect(await found(ctx(uid), { sprintId: L_SECRET })).toEqual([]);
        expect(await found(ctx(uid), { sprintId: MISSING })).toEqual([]);
    });

    it('keeps a narrowed token to added tasks whose home is inside its projects, in a list inside its projects', async () => {
        expect(await found(narrowed(INSIDER, [P_OPEN]), { sprintId: L_OPEN })).toEqual(sorted([...HOME_ROWS, T_SECRET]));
        expect(await found(narrowed(INSIDER, [P_OPEN]), { sprintId: L_PRIVATE })).toEqual([]);
        expect(await found(narrowed(INSIDER, [P_PRIVATE]), { sprintId: L_OPEN })).toEqual([]);
        expect(await found(narrowed(INSIDER, [P_PRIVATE]), { sprintId: L_PRIVATE })).toEqual([T_PRIVATE]);
    });

    it('adds the list beside the caller\'s own clause, which stays as it is without one', async () => {
        for (const caller of [ctx(OUTSIDER), ctx(OWNER), narrowed(INSIDER, [P_OPEN])]) {
            mockQueries.length = 0;
            await rpc(caller, 'tasks.search', {});
            const [plain] = searchFilters();
            mockQueries.length = 0;
            await rpc(caller, 'tasks.search', { sprintId: L_OPEN });
            const [{ $and: added, ...own }] = searchFilters();
            expect(own).toEqual(plain);
            expect(added).toHaveLength(1);
            expect(Object.keys(added[0])).toEqual(['$or']);
            expect(added[0].$or.map((branch) => Object.keys(branch))).toEqual([['sprintId'], ['extraLists']]);
        }
    });

    it('narrows the other filters and refuses what is not a list id', async () => {
        expect(await found(ctx(OWNER), { sprintId: L_OPEN, query: 'private' })).toEqual([T_PRIVATE]);
        expect(await found(ctx(OWNER), { sprintId: L_OPEN, projectId: P_PRIVATE })).toEqual([T_PRIVATE]);
        expect(await rpc(ctx(OWNER), 'tasks.search', { sprintId: 'the open list' })).toMatchObject({ error: 'sprintId must be the id of a list (see lists.list).' });
    });

    it('reads the same for a caller whose token manages tasks', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        expect(await found(manager(OWNER), { sprintId: L_OPEN })).toEqual(sorted([...HOME_ROWS, T_PRIVATE, T_SECRET]));
        expect(await found(manager(OUTSIDER), { sprintId: L_OPEN })).toEqual(sorted(HOME_ROWS));
        expect(await found(manager(OUTSIDER), { sprintId: L_PRIVATE })).toEqual([]);
    });
});

describe('the actions, reached without an MCP token', () => {
    it('answer a task or a list the person cannot open as a missing one, and write nothing', async () => {
        place(T_PRIVATE, [L_OPEN]);
        const before = tasksNow();
        const perform = (action, params) => actions.perform({ companyId: CID, actor: inProduct(OUTSIDER), action, params });
        await expect(perform('task.lists.add', { taskId: T_SECRET, sprintId: L_OPEN_2 })).rejects.toThrow('Task not found');
        await expect(perform('task.lists.add', { taskId: MISSING, sprintId: L_OPEN_2 })).rejects.toThrow(/not found/i);
        await expect(perform('task.lists.add', { taskId: T_OPEN, sprintId: L_PRIVATE })).rejects.toThrow('List not found');
        await expect(perform('task.lists.add', { taskId: T_OPEN, sprintId: L_SECRET })).rejects.toThrow('List not found');
        await expect(perform('task.lists.add', { taskId: T_OPEN, sprintId: MISSING })).rejects.toThrow('List not found');
        await expect(perform('task.lists.remove', { taskId: T_SECRET, sprintId: L_OPEN })).rejects.toThrow('Task not found');
        await expect(perform('task.lists.remove', { taskId: T_PRIVATE, sprintId: L_OPEN })).rejects.toThrow('Task not found');
        expect(tasksNow()).toBe(before);
    });

    it('answer a list named beside a project it is not in as the route answers a list that is not there', async () => {
        place(T_OPEN, [L_PRIVATE]);
        const before = tasksNow();
        const perform = (action, params) => actions.perform({ companyId: CID, actor: inProduct(INSIDER), action, params });
        await expect(perform('task.lists.add', { taskId: T_OPEN, listProjectId: P_PRIVATE, sprintId: L_OPEN_2 })).rejects.toThrow('List not found');
        await expect(perform('task.lists.add', { taskId: T_OPEN, listProjectId: P_OPEN, sprintId: MISSING })).rejects.toThrow('List not found');
        await expect(perform('task.lists.remove', { taskId: T_OPEN, listProjectId: P_OPEN, sprintId: L_PRIVATE })).rejects.toThrow('The task is not in that list.');
        expect(tasksNow()).toBe(before);
        expect(await perform('task.lists.add', { taskId: T_OPEN, sprintId: L_OPEN_2 })).toMatchObject({ result: { taskId: T_OPEN, projectId: P_OPEN, sprintId: L_OPEN_2, added: true } });
        expect(await perform('task.lists.remove', { taskId: T_OPEN, sprintId: L_PRIVATE })).toMatchObject({ result: { projectId: P_PRIVATE, removed: true } });
        expect(placed(T_OPEN)).toEqual([[P_OPEN, L_OPEN_2, INSIDER]]);
    });
});

describe('an outside client under taint routing', () => {
    const args = into(T_OPEN, L_OPEN_2);
    const decided = (proposal, decider = OWNER) => approval.refusalFor(CID, proposal, { decider: { userId: decider }, isPrivileged: true });

    beforeEach(() => { process.env.AGENT_TAINT_ROUTING = 'on'; });

    it('is refused a change that reaches a task and a list, and nothing is filed', async () => {
        const before = tasksNow();
        expect(await rpc(outside(OWNER, ['tasks:read', 'tasks:write']), 'task.lists.add', args)).toMatchObject({ refused: true, reason: expect.stringMatching(/outside client/) });
        expect(proposals.create).not.toHaveBeenCalled();
        expect(tasksNow()).toBe(before);
    });

    it('files it for a person when the connection holds the manage scope, and approval asks the task and the list again', async () => {
        const before = tasksNow();
        expect(await rpc(outside(OWNER, ['tasks:write', 'tasks:manage']), 'task.lists.add', { ...args, reason: 'Planned for the launch too' })).toMatchObject({ ok: false, pending: true, proposalId: 'proposal-1' });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({
            source: 'mcp', requestedBy: OWNER, tokenId: '', changes: [expect.objectContaining({ action: 'task.lists.add', params: paramsOf(args) })], taskId: T_OPEN, projectId: null,
        }));
        expect(tasksNow()).toBe(before);

        const filed = (uid, at) => filedBy(uid, 'task.lists.add', paramsOf(at));
        seedGrant(OUTSIDER, ['tasks:write', 'tasks:manage']);
        expect(await decided(filed(OUTSIDER, args))).toBeNull();
        expect(await decided(filed(OUTSIDER, into(T_OPEN, L_PRIVATE)))).toMatchObject({ status: 403, error: expect.stringMatching(/can no longer open/) });
        expect(await decided(filed(OUTSIDER, into(T_SECRET, L_OPEN_2)))).toMatchObject({ status: 403, error: expect.stringMatching(/can no longer open/) });
        expect(await decided(filed(OUTSIDER, args), GUEST)).toBeNull();
        expect(await decided(filed(OUTSIDER, into(T_OPEN, L_SECRET)))).toMatchObject({ status: 403, error: expect.stringMatching(/can no longer open/) });

        mockDb.store[SCHEMA_TYPE.OAUTH_GRANTS].length = 0;
        mockDb.store[SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS].length = 0;
        seedGrant(INSIDER, ['tasks:write', 'tasks:manage']);
        expect(await decided(filed(INSIDER, into(T_OPEN, L_PRIVATE)))).toBeNull();
        expect(await decided(filed(INSIDER, into(T_OPEN, L_PRIVATE)), GUEST)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
    });
});
