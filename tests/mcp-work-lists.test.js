/* Task 046, MCP parity part 3: an outside agent reads a project's lists and folders, and creates, renames and
   moves a list through the list routes' own handlers, as the person behind its token and no further. */
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
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
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
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL, T_OPEN,
    MISSING, BEFORE, FLAGS, EVERYONE, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle,
} = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough, seedGrant, filedBy } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Sprints/routes').init));

const NAMES = ['lists.list', 'list.create', 'list.rename', 'list.move'];
const F_TOP = '6f0000000000000000000e01';
const F_SUB = '6f0000000000000000000e02';
const F_ARCHIVED = '6f0000000000000000000e03';
const F_PRIVATE = '6f0000000000000000000e04';
const L_TWIN = '6f0000000000000000000b09';
const L_NESTED = '6f0000000000000000000b0a';
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const NO_LIST = 'not_visible: that list was not found in that project, or the person cannot open it. Ask the person which list they mean.';
const EDIT_KEYS = ['project_sprint_name_edit', 'sprint_type_change', 'project_sprint_create'];

const list = (id) => stored(SCHEMA_TYPE.SPRINTS, id);
const listsNamed = (name) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === name);
const asStored = (doc) => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(doc))).filter(([field]) => !['_id', 'createdAt', 'updatedAt'].includes(field)));
const placeOf = (taskId) => { const { folderObjId, sprintArray } = stored(SCHEMA_TYPE.TASKS, taskId); return JSON.parse(JSON.stringify({ folderObjId, sprintArray })); };
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentName: 'Workspace agent' });
const everythingNow = () => JSON.stringify([mockDb.store[SCHEMA_TYPE.SPRINTS], mockDb.store[SCHEMA_TYPE.FOLDERS], mockDb.store[SCHEMA_TYPE.TASKS]]);
const moveBody = (sprint, folderId) => ({
    type: 'updateSprint', companyId: CID, projectId: P_OPEN, folderId: sprint.folderId || null, updateObject: { $set: { folderId, folderName: '' } },
    sprintName: sprint.name, projectData: { id: P_OPEN, ProjectName: 'Open' }, folderName: '', historyData: { type: 'moved' },
});

beforeEach(() => {
    const made = seed();
    const folder = (_id, name, projectId, extra = {}) => mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id, name, projectId, deletedStatusKey: 0, ...extra });
    folder(F_TOP, 'Q3', P_OPEN);
    folder(F_SUB, 'Week 1', P_OPEN, { parentFolderId: F_TOP });
    folder(F_ARCHIVED, 'Old', P_OPEN, { deletedStatusKey: 2 });
    folder(F_PRIVATE, 'Hidden plans', P_PRIVATE);
    made.list(L_TWIN, 'Twin list', P_OPEN);
    made.list(L_NESTED, 'Nested list', P_OPEN, { folderId: F_SUB, folderName: 'Week 1' });
    made.seedTask('6f0000000000000000000d0e', 'Task of the twin list', P_OPEN, L_TWIN);
    proposals.create.mockClear();
});
afterEach(settle);
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        NAMES.forEach((name) => { expect(registry.has(name)).toBe(false); expect(actions.rating(name)).toBeNull(); });
        expect((await rpc(ctx(OWNER), 'list.create', { projectId: P_OPEN, name: 'Later' })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, each tool is a rated registry action held to the keys the list routes ask for, with a plain scope and no grant', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining(NAMES));
        expect(registry.permissionsFor('lists.list')).toEqual([{ key: 'project.project_list', write: false }]);
        expect(registry.permissionsFor('list.create')).toEqual([{ key: 'project.project_sprint_create', write: true }]);
        expect(registry.permissionsFor('list.rename')).toEqual([{ key: 'project.project_sprint_name_edit', write: true }]);
        expect(registry.permissionsFor('list.move')).toEqual([{ key: 'project.project_sprint_name_edit', anyOf: EDIT_KEYS.map((key) => `project.${key}`), write: true }]);
        expect(NAMES.map((name) => scopes.scopeForTool(name))).toEqual(['projects:read', 'tasks:write', 'tasks:write', 'tasks:write']);
        NAMES.slice(1).forEach((name) => expect(actions.rating(name)).toEqual({ write: true, reversible: true, scope: 'project', money: false }));
        expect(tools.registered().filter((tool) => NAMES.includes(tool.name)).some((tool) => tool.grant)).toBe(false);
        expect(tools.names().filter((name) => /delete|archive|trash/.test(name))).toEqual([]);
    });
});

describe('lists.list', () => {
    it('answers the project\'s live lists with the folder and parent folder of each, and its live folders', async () => {
        const out = await rpc(ctx(OWNER), 'lists.list', { projectId: P_OPEN });
        expect(out.folders).toEqual([{ folderId: F_TOP, name: 'Q3', parentFolderId: '' }, { folderId: F_SUB, name: 'Week 1', parentFolderId: F_TOP }]);
        expect(out.lists.map((row) => row.sprintId).sort()).toEqual([L_OPEN, L_SECRET, L_TWIN, L_NESTED].sort());
        expect(out.lists.find((row) => row.sprintId === L_NESTED)).toEqual({
            sprintId: L_NESTED, name: 'Nested list', private: false, sprint: false, folderId: F_SUB, folder: 'Week 1', parentFolderId: F_TOP, parentFolder: 'Q3',
        });
        expect(out.lists.find((row) => row.sprintId === L_SECRET)).toMatchObject({ private: true, folderId: '', folder: '' });
    });

    it.each(EVERYONE)('lists a private list for %s only when that person is on it or runs the workspace', async (label, uid) => {
        const out = await rpc(ctx(uid), 'lists.list', { projectId: P_OPEN });
        const sees = [OWNER, INSIDER].includes(uid);
        expect(out.lists.some((row) => row.sprintId === L_SECRET)).toBe(sees);
        if (!sees) expect(JSON.stringify(out)).not.toMatch(`${L_SECRET}|Private list`);
    });

    it('answers a private project and someone else\'s personal list as it answers a missing id', async () => {
        const missing = await rpc(ctx(OWNER), 'lists.list', { projectId: MISSING });
        expect(missing).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
        for (const uid of [OUTSIDER, GUEST]) expect(await rpc(ctx(uid), 'lists.list', { projectId: P_PRIVATE })).toEqual(missing);
        for (const uid of [OWNER, ADMIN, OUTSIDER, GUEST]) expect(await rpc(ctx(uid), 'lists.list', { projectId: P_PERSONAL })).toEqual(missing);
        expect((await rpc(ctx(INSIDER), 'lists.list', { projectId: P_PERSONAL })).lists.map((row) => row.sprintId)).toEqual([L_PERSONAL]);
        expect((await rpc(ctx(INSIDER), 'lists.list', { projectId: P_PRIVATE })).folders).toEqual([{ folderId: F_PRIVATE, name: 'Hidden plans', parentFolderId: '' }]);
    });

    it('stays inside the projects a token was narrowed to', async () => {
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'lists.list', { projectId: P_PRIVATE })).toEqual({ error: 'That project was not found. Ask the person which project they mean.' });
        expect((await rpc(narrowed(INSIDER, [P_OPEN]), 'lists.list', { projectId: P_OPEN })).lists.length).toBe(4);
    });
});

describe('list.create', () => {
    it('stores what the list route stores for the same person, in a subfolder, and records it', async () => {
        const viaWeb = await web('POST /api/v1/sprint', INSIDER, { body: { companyId: CID, projectId: P_OPEN, sprintName: 'From the app', folder: { folderId: F_SUB } } });
        expect(viaWeb.body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'list.create', { projectId: P_OPEN, name: 'From the agent', folderId: F_SUB, reason: 'Sprint planning' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { projectId: P_OPEN, name: 'From the agent', folderId: F_SUB } });
        const [mine] = listsNamed('From the agent');
        expect(String(mine._id)).toBe(out.result.sprintId);
        expect(asStored({ ...mine, name: '' })).toEqual(asStored({ ...listsNamed('From the app')[0], name: '' }));
        expect(audits('list.create', 'applied')[0]).toMatchObject({ entityType: 'sprint', entityId: out.result.sprintId, meta: { onBehalfOf: INSIDER, undo: { kind: 'list', projectId: P_OPEN, sprintId: out.result.sprintId } } });
    });

    it.each(EVERYONE)('lets %s create a list at the top level of the open project', async (label, uid) => {
        expect(await rpc(ctx(uid), 'list.create', { projectId: P_OPEN, name: 'Backlog' })).toMatchObject({ ok: true, result: { folderId: '' } });
        expect(listsNamed('Backlog')).toHaveLength(1);
        expect(listsNamed('Backlog')[0].folderId).toBeUndefined();
    });

    it('answers a private project and someone else\'s personal list as a missing project, and creates nothing', async () => {
        const missing = await rpc(ctx(OWNER), 'list.create', { projectId: MISSING, name: 'Nowhere' });
        expect(missing).toMatchObject({ refused: true, reason: NO_PROJECT });
        const before = everythingNow();
        for (const [uid, projectId] of [[OUTSIDER, P_PRIVATE], [GUEST, P_PRIVATE], [OWNER, P_PERSONAL], [ADMIN, P_PERSONAL], [OUTSIDER, P_PERSONAL]]) {
            expect(await rpc(ctx(uid), 'list.create', { projectId, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'list.create', { projectId: P_PRIVATE, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(everythingNow()).toBe(before);
        expect(await rpc(ctx(INSIDER), 'list.create', { projectId: P_PRIVATE, name: 'Somewhere', folderId: F_PRIVATE })).toMatchObject({ ok: true });
        expect(await rpc(ctx(INSIDER), 'list.create', { projectId: P_PERSONAL, name: 'Mine' })).toMatchObject({ ok: true });
    });

    it('holds the person to the list-create permission, and takes only a live folder of that project', async () => {
        setRule('project_sprint_create', false, [0]);
        const before = everythingNow();
        expect(await rpc(ctx(GUEST), 'list.create', { projectId: P_OPEN, name: 'Guest list' })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: project\.project_sprint_create/) });
        expect(await rpc(ctx(OUTSIDER), 'list.create', { projectId: P_OPEN, name: 'Elsewhere', folderId: F_PRIVATE })).toMatchObject({ isError: true, error: 'That folder is not in this project.' });
        expect(await rpc(ctx(OUTSIDER), 'list.create', { projectId: P_OPEN, name: 'Elsewhere', folderId: MISSING })).toMatchObject({ isError: true, error: 'That folder is not in this project.' });
        expect(await rpc(ctx(OUTSIDER), 'list.create', { projectId: P_OPEN, name: 'Old one', folderId: F_ARCHIVED })).toMatchObject({ isError: true, error: expect.stringMatching(/archived or deleted folder/) });
        expect((await rpc(ctx(OWNER), 'list.create', { projectId: P_OPEN, name: '' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'list.create', { projectId: P_OPEN, name: 'Private', private: true })).rpcError).toMatchObject({ code: -32602 });
        expect(everythingNow()).toBe(before);
    });

    it('is taken back by undo while it is empty, and kept once it holds a task', async () => {
        const { result } = await rpc(ctx(INSIDER), 'list.create', { projectId: P_OPEN, name: 'Short lived' });
        const [row] = audits('list.create', 'applied');
        expect(await undoStateOf(CID, row, { userId: OWNER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Late arrival', ProjectID: P_OPEN, sprintId: result.sprintId, deletedStatusKey: 0 });
        await expect(inverses.list(CID, row.meta.undo, { userId: OWNER })).rejects.toThrow(/has tasks in it now/);
        expect(list(result.sprintId).deletedStatusKey).toBe(0);
        mockDb.store[SCHEMA_TYPE.TASKS].pop();
        await inverses.list(CID, row.meta.undo, { userId: OWNER });
        await settle();
        expect(list(result.sprintId).deletedStatusKey).toBe(1);
    });
});

describe('list.rename', () => {
    it('stores what the list route stores for the same person, and records what it replaced', async () => {
        expect((await web('PATCH /api/v1/sprint/:id', INSIDER, { params: { id: L_TWIN }, body: { type: 'editSprintName', companyId: CID, projectId: P_OPEN, sprintName: 'Renamed' } })).body).toMatchObject({ status: true });

        expect(await rpc(ctx(INSIDER), 'list.rename', { projectId: P_OPEN, sprintId: L_OPEN, name: ' Renamed ' })).toMatchObject({ ok: true, undoable: true, result: { name: 'Renamed', changed: true } });
        expect(asStored(list(L_OPEN))).toEqual(asStored(list(L_TWIN)));
        const [row] = audits('list.rename', 'applied');
        expect(row.meta.undo).toEqual({ kind: 'listName', projectId: P_OPEN, sprintId: L_OPEN, previous: 'Open list' });
        await inverses.listName(CID, row.meta.undo, { userId: OWNER });
        expect(list(L_OPEN).name).toBe('Open list');
        expect(await rpc(ctx(INSIDER), 'list.rename', { projectId: P_OPEN, sprintId: L_OPEN, name: 'Open list' })).toMatchObject({ ok: true, undoable: false, result: { changed: false } });
    });

    it.each(EVERYONE)('lets %s rename a list of the open project', async (label, uid) => {
        expect(await rpc(ctx(uid), 'list.rename', { projectId: P_OPEN, sprintId: L_OPEN, name: 'Sprint 12' })).toMatchObject({ ok: true });
        expect(list(L_OPEN).name).toBe('Sprint 12');
    });

    it('answers a private list, a list of a private project and a list of another project as a missing list, and renames nothing', async () => {
        const missing = await rpc(ctx(OWNER), 'list.rename', { projectId: P_OPEN, sprintId: MISSING, name: 'x' });
        expect(missing).toMatchObject({ refused: true, reason: NO_LIST });
        const before = everythingNow();
        for (const uid of [OUTSIDER, GUEST]) {
            expect(await rpc(ctx(uid), 'list.rename', { projectId: P_OPEN, sprintId: L_SECRET, name: 'x' })).toMatchObject({ refused: true, reason: NO_LIST });
            expect(await rpc(ctx(uid), 'list.rename', { projectId: P_PRIVATE, sprintId: L_PRIVATE, name: 'x' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc(ctx(OWNER), 'list.rename', { projectId: P_PERSONAL, sprintId: L_PERSONAL, name: 'x' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(ctx(OWNER), 'list.rename', { projectId: P_OPEN, sprintId: L_PRIVATE, name: 'x' })).toMatchObject({ refused: true, reason: NO_LIST });
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'list.rename', { projectId: P_PRIVATE, sprintId: L_PRIVATE, name: 'x' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(everythingNow()).toBe(before);
        expect(await rpc(ctx(INSIDER), 'list.rename', { projectId: P_OPEN, sprintId: L_SECRET, name: 'Still private' })).toMatchObject({ ok: true });
    });

    it('holds the person to the rename permission alone, and leaves an archived list as it is', async () => {
        setRule('project_sprint_name_edit', false);
        const before = everythingNow();
        expect(await rpc(ctx(OUTSIDER), 'list.rename', { projectId: P_OPEN, sprintId: L_OPEN, name: 'x' })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: project\.project_sprint_name_edit/) });
        expect(everythingNow()).toBe(before);
        list(L_TWIN).deletedStatusKey = 2;
        expect(await rpc(ctx(OWNER), 'list.rename', { projectId: P_OPEN, sprintId: L_TWIN, name: 'x' })).toMatchObject({ isError: true, error: expect.stringMatching(/This list is archived/) });
        expect(list(L_TWIN).name).toBe('Twin list');
    });
});

describe('list.move', () => {
    it('stores what the list route stores for the same person, on the list and on its tasks', async () => {
        expect((await web('PATCH /api/v1/sprint/:id', INSIDER, { params: { id: L_TWIN }, body: moveBody(list(L_TWIN), F_SUB) })).body).toMatchObject({ status: true });

        expect(await rpc(ctx(INSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_SUB })).toMatchObject({ ok: true, undoable: true, result: { folderId: F_SUB } });
        expect(asStored({ ...list(L_OPEN), name: '' })).toEqual(asStored({ ...list(L_TWIN), name: '' }));
        expect(list(L_OPEN)).toMatchObject({ folderName: 'Week 1' });
        expect(placeOf(T_OPEN)).toEqual(placeOf('6f0000000000000000000d0e'));
        expect(placeOf(T_OPEN).folderObjId).toBe(F_SUB);

        const [row] = audits('list.move', 'applied');
        expect(row.meta.undo).toEqual({ kind: 'listFolder', projectId: P_OPEN, sprintId: L_OPEN, previous: '' });
        await inverses.listFolder(CID, row.meta.undo, { userId: OWNER });
        await settle();
        expect(list(L_OPEN).folderId).toBeNull();
        expect(placeOf(T_OPEN).folderObjId).toBeUndefined();
    });

    it.each(EVERYONE)('lets %s move a list to the top level', async (label, uid) => {
        expect(await rpc(ctx(uid), 'list.move', { projectId: P_OPEN, sprintId: L_NESTED, folderId: null })).toMatchObject({ ok: true, result: { folderId: '' } });
        expect(list(L_NESTED).folderId).toBeNull();
    });

    it('answers a private list and a list of a private project as a missing list, and moves nothing', async () => {
        const before = everythingNow();
        expect(await rpc(ctx(OWNER), 'list.move', { projectId: P_OPEN, sprintId: MISSING, folderId: F_TOP })).toMatchObject({ refused: true, reason: NO_LIST });
        for (const uid of [OUTSIDER, GUEST]) {
            expect(await rpc(ctx(uid), 'list.move', { projectId: P_OPEN, sprintId: L_SECRET, folderId: F_TOP })).toMatchObject({ refused: true, reason: NO_LIST });
            expect(await rpc(ctx(uid), 'list.move', { projectId: P_PRIVATE, sprintId: L_PRIVATE, folderId: F_PRIVATE })).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc(ctx(ADMIN), 'list.move', { projectId: P_PERSONAL, sprintId: L_PERSONAL, folderId: null })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_TOP })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(everythingNow()).toBe(before);
    });

    it('takes any one of the keys the route takes for a move, and refuses a person who holds none', async () => {
        EDIT_KEYS.forEach((key) => setRule(key, false));
        const before = everythingNow();
        expect(await rpc(ctx(OUTSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_TOP })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied/) });
        expect(everythingNow()).toBe(before);
        setRule('sprint_type_change', true);
        expect(await rpc(ctx(OUTSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_TOP })).toMatchObject({ ok: true });
        expect(list(L_OPEN)).toMatchObject({ folderName: 'Q3' });
    });

    it('moves only into a live folder of the list\'s own project, and not to where the list already is', async () => {
        const before = everythingNow();
        expect(await rpc(ctx(INSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_PRIVATE })).toMatchObject({ isError: true, error: 'That folder is not in this project.' });
        expect(await rpc(ctx(INSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_ARCHIVED })).toMatchObject({ isError: true, error: expect.stringMatching(/archived or deleted folder/) });
        expect(await rpc(ctx(INSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: null })).toMatchObject({ isError: true, error: expect.stringMatching(/already at the top level/) });
        expect(await rpc(ctx(INSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_NESTED, folderId: F_SUB })).toMatchObject({ isError: true, error: expect.stringMatching(/already in that folder/) });
        expect((await rpc(ctx(INSIDER), 'list.move', { projectId: P_OPEN, sprintId: L_OPEN })).rpcError).toMatchObject({ code: -32602 });
        expect(everythingNow()).toBe(before);
    });
});

describe('the actions, reached without an MCP token', () => {
    it('keep the list routes\' own guards, and write nothing', async () => {
        const before = everythingNow();
        const perform = (uid, action, params) => actions.perform({ companyId: CID, actor: inProduct(uid), action, params });
        await expect(perform(OUTSIDER, 'list.rename', { projectId: P_OPEN, sprintId: L_SECRET, name: 'x' })).rejects.toThrow(/list was not found/);
        await expect(perform(OUTSIDER, 'list.move', { projectId: P_OPEN, sprintId: L_SECRET, folderId: F_TOP })).rejects.toThrow(/list was not found/);
        await expect(perform(OUTSIDER, 'list.rename', { projectId: P_OPEN, sprintId: L_PRIVATE, name: 'x' })).rejects.toThrow(/list was not found/);
        await expect(perform(OUTSIDER, 'list.create', { projectId: P_PRIVATE, name: 'x' })).rejects.toThrow(/project was not found/);
        await expect(perform(OWNER, 'list.create', { projectId: P_PERSONAL, name: 'x' })).rejects.toThrow(/project was not found/);
        await expect(perform(OUTSIDER, 'list.rename', { projectId: P_PRIVATE, sprintId: L_PRIVATE, name: 'x' })).rejects.toThrow(/not found/);
        expect(everythingNow()).toBe(before);
    });
});

describe('scopes and outside clients', () => {
    const decided = (proposal, decider = OWNER) => approval.refusalFor(CID, proposal, { decider: { userId: decider }, isPrivileged: true });
    const rename = { projectId: P_OPEN, sprintId: L_OPEN, name: 'From outside' };

    it('needs the write scope for a write and the read scope for the read', async () => {
        const before = everythingNow();
        expect(await rpc(readOnly(OWNER), 'list.create', { projectId: P_OPEN, name: 'x' })).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(await rpc(outside(OWNER, ['projects:read']), 'list.rename', rename)).toMatchObject({ isError: true, error: 'This connection was not given the tasks:write permission. Ask the person to connect you again and allow it.' });
        expect(await rpc(outside(OWNER, ['tasks:write']), 'lists.list', { projectId: P_OPEN })).toMatchObject({ isError: true, error: 'This connection was not given the projects:read permission. Ask the person to connect you again and allow it.' });
        expect(everythingNow()).toBe(before);
        expect(await rpc(outside(OUTSIDER, ['tasks:write']), 'list.rename', rename)).toMatchObject({ ok: true });
    });

    it('under taint routing is refused a list change, or files it for a person when the connection holds the manage scope', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = everythingNow();
        for (const [name, args] of [['list.create', { projectId: P_OPEN, name: 'x' }], ['list.rename', rename], ['list.move', { projectId: P_OPEN, sprintId: L_OPEN, folderId: F_TOP }]]) {
            expect(await rpc(outside(OWNER, ['tasks:write']), name, args)).toMatchObject({ refused: true, reason: expect.stringMatching(/outside client/) });
        }
        expect(proposals.create).not.toHaveBeenCalled();
        expect(await rpc(outside(OWNER, ['tasks:write', 'tasks:manage']), 'list.rename', rename)).toMatchObject({ ok: false, pending: true });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({ requestedBy: OWNER, changes: [expect.objectContaining({ action: 'list.rename', params: rename })] }));
        expect(everythingNow()).toBe(before);

        seedGrant(INSIDER, ['tasks:write', 'tasks:manage']);
        expect(await decided(filedBy(INSIDER, 'list.rename', { ...rename, sprintId: L_SECRET }))).toBeNull();
        expect(await decided(filedBy(INSIDER, 'list.rename', { ...rename, sprintId: L_SECRET }), OUTSIDER)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
        mockDb.store[SCHEMA_TYPE.OAUTH_GRANTS][0].scopes = ['tasks:write'];
        expect(await decided(filedBy(INSIDER, 'list.rename', rename))).toMatchObject({ status: 403 });
    });
});
