/* Task 047, T-3: "show me". An outside agent asks for the web address of a place in AlianHub and gets it only
   for a thing the person behind the connection can open, built from the address this server is set up with. */
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
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL,
    T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, outside, settle,
} = world;
const { seed, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'screen.link';
const BASE = 'https://hub.example.test';
const AT = `${BASE}/#/${CID}`;
const NOT_FOUND = { error: 'not found' };
const ADDRESS_KEYS = ['WEBURL', 'APIURL'];
const savedAddress = Object.fromEntries(ADDRESS_KEYS.map((key) => [key, process.env[key]]));

let pages;
const link = (caller, args) => rpc(caller, TOOL, args);

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_DATA = 'on';
    process.env.WEBURL = `${BASE}/`;
    delete process.env.APIURL;
    const page = (title, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, { title, content: { html: `<p>${title}</p>` }, createdBy: INSIDER, visibility: 'project', deletedStatusKey: 0, ...extra });
    pages = {
        open: page('Open doc', { ProjectID: P_OPEN }),
        private: page('Doc of the private project', { ProjectID: P_PRIVATE }),
        own: page('The insider keeps this', { ProjectID: P_OPEN, visibility: 'private' }),
        company: page('Handbook'),
        gone: page('Deleted doc', { ProjectID: P_OPEN, deletedStatusKey: 1 }),
    };
});
afterEach(settle);
afterAll(() => {
    FLAGS.forEach((flag) => { delete process.env[flag]; });
    ADDRESS_KEYS.forEach((key) => { if (savedAddress[key] === undefined) delete process.env[key]; else process.env[key] = savedAddress[key]; });
});

describe('the tool exists with the read tools', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_DATA;
        expect(tools.names()).toEqual(BEFORE);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect(await link(ctx(OWNER), { screen: 'home' })).toEqual({ rpcError: { code: -32601, message: `Unknown tool "${TOOL}"` } });
    });

    it('on, it is a read that needs the right to read projects and reaches only this workspace', async () => {
        expect(await listed(ctx(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ write: false, risk: 'low', undoable: false });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'project.project_list', write: false }]);
        expect(actions.rating(TOOL)).toEqual({ write: false, reversible: true, scope: 'workspace', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('projects:read');
        expect(tools.registered().find((tool) => tool.name === TOOL).visibility).toBe('filtered');
    });

    it('is offered to a connection that only reads', async () => {
        expect(await link(readOnly(OWNER), { screen: 'project', projectId: P_OPEN })).toEqual({ url: `${AT}/project/${P_OPEN}/p`, screen: 'project' });
    });
});

describe('an owner gets the address of each kind of place', () => {
    it('a project, plain or on one of its views', async () => {
        expect(await link(ctx(OWNER), { screen: 'project', projectId: P_OPEN })).toEqual({ url: `${AT}/project/${P_OPEN}/p`, screen: 'project' });
        expect(await link(ctx(OWNER), { screen: 'project', projectId: P_PRIVATE, view: 'board' })).toEqual({ url: `${AT}/project/${P_PRIVATE}/p?tab=ProjectKanban`, screen: 'project', view: 'board' });
    });

    it('the workload of a project, which opens on the current week', async () => {
        expect(await link(ctx(OWNER), { screen: 'project', projectId: P_OPEN, view: 'workload' })).toEqual({
            url: `${AT}/project/${P_OPEN}/p?tab=Workload`, screen: 'project', view: 'workload', note: expect.stringMatching(/current week/),
        });
    });

    it.each([['list', 'ProjectListView'], ['board', 'ProjectKanban'], ['calendar', 'Calendar'], ['gantt', 'GanttView'], ['table', 'TableView'], ['workload', 'Workload'], ['dashboard', 'ProjectDashboard'], ['activity', 'ActivityLog']])(
        'the %s view', async (view, tab) => {
            expect((await link(ctx(OWNER), { screen: 'project', projectId: P_OPEN, view })).url).toBe(`${AT}/project/${P_OPEN}/p?tab=${tab}`);
        },
    );

    it('a list, by its id alone or with its project', async () => {
        expect(await link(ctx(OWNER), { screen: 'list', sprintId: L_OPEN })).toEqual({ url: `${AT}/project/${P_OPEN}/s/${L_OPEN}`, screen: 'list' });
        expect((await link(ctx(OWNER), { screen: 'list', sprintId: L_SECRET, projectId: P_OPEN, view: 'board' })).url).toBe(`${AT}/project/${P_OPEN}/s/${L_SECRET}?tab=ProjectKanban`);
        expect(await link(ctx(OWNER), { screen: 'list', sprintId: L_OPEN, projectId: P_PRIVATE })).toEqual(NOT_FOUND);
    });

    it('a list kept in a folder', async () => {
        const FOLDER = '6f0000000000000000000f01';
        mockDb.store[SCHEMA_TYPE.SPRINTS].find((row) => String(row._id) === L_OPEN).folderId = FOLDER;
        expect((await link(ctx(OWNER), { screen: 'list', sprintId: L_OPEN })).url).toBe(`${AT}/project/${P_OPEN}/fs/${FOLDER}/${L_OPEN}`);
    });

    it('a task, opened in its list', async () => {
        expect(await link(ctx(OWNER), { screen: 'task', taskId: T_OPEN })).toEqual({ url: `${AT}/project/${P_OPEN}/s/${L_OPEN}/${T_OPEN}?detailTab=task-detail-tab`, screen: 'task' });
    });

    it('a doc', async () => {
        expect(await link(ctx(OWNER), { screen: 'doc', pageId: String(pages.open._id) })).toEqual({ url: `${AT}/pages/${pages.open._id}`, screen: 'doc' });
        expect(await link(ctx(OWNER), { screen: 'doc', pageId: String(pages.company._id) })).toEqual({ url: `${AT}/pages/${pages.company._id}`, screen: 'doc' });
    });

    it.each([['home', ''], ['everything', '/everything'], ['projects', '/project'], ['inbox', '/inbox'], ['planner', '/planner'], ['docs', '/pages'], ['goals', '/goals']])(
        'the %s screen', async (screen, path) => {
            expect(await link(ctx(OWNER), { screen })).toEqual({ url: `${AT}${path}`, screen });
        },
    );
});

describe('a thing the person cannot open answers as a thing that is not there', () => {
    const hiddenFrom = (who, args) => async () => {
        expect(await link(who(), args)).toEqual(NOT_FOUND);
        expect(await link(who(), { ...args, ...Object.fromEntries(Object.keys(args).filter((key) => key.endsWith('Id')).map((key) => [key, MISSING])) })).toEqual(NOT_FOUND);
    };
    const member = () => ctx(OUTSIDER);
    const guest = () => ctx(GUEST);

    it('a member opens what is open to them', async () => {
        expect((await link(member(), { screen: 'project', projectId: P_OPEN, view: 'workload' })).url).toBe(`${AT}/project/${P_OPEN}/p?tab=Workload`);
        expect((await link(member(), { screen: 'task', taskId: T_OPEN })).url).toContain(`/${T_OPEN}`);
        expect((await link(member(), { screen: 'list', sprintId: L_OPEN })).url).toContain(`/s/${L_OPEN}`);
        expect((await link(member(), { screen: 'doc', pageId: String(pages.open._id) })).url).toBe(`${AT}/pages/${pages.open._id}`);
    });

    it('a member on the private work opens it', async () => {
        expect((await link(ctx(INSIDER), { screen: 'project', projectId: P_PRIVATE })).url).toBe(`${AT}/project/${P_PRIVATE}/p`);
        expect((await link(ctx(INSIDER), { screen: 'task', taskId: T_SECRET })).url).toContain(`/s/${L_SECRET}/${T_SECRET}`);
        expect((await link(ctx(INSIDER), { screen: 'task', taskId: T_PERSONAL })).url).toContain(`/${T_PERSONAL}`);
        expect((await link(ctx(INSIDER), { screen: 'doc', pageId: String(pages.own._id) })).url).toBe(`${AT}/pages/${pages.own._id}`);
    });

    it('a member: a private project', hiddenFrom(member, { screen: 'project', projectId: P_PRIVATE }));
    it('a member: the workload of a private project', hiddenFrom(member, { screen: 'project', projectId: P_PRIVATE, view: 'workload' }));
    it('a member: a list of a private project', hiddenFrom(member, { screen: 'list', sprintId: L_PRIVATE }));
    it('a member: a private list of an open project', hiddenFrom(member, { screen: 'list', sprintId: L_SECRET }));
    it('a member: a task of a private project', hiddenFrom(member, { screen: 'task', taskId: T_PRIVATE }));
    it('a member: a task in a private list', hiddenFrom(member, { screen: 'task', taskId: T_SECRET }));
    it('a member: a doc of a private project', async () => hiddenFrom(member, { screen: 'doc', pageId: String(pages.private._id) })());
    it('a member: a doc someone keeps to themselves', async () => hiddenFrom(member, { screen: 'doc', pageId: String(pages.own._id) })());

    it('a guest opens the open task and nothing private', async () => {
        expect((await link(guest(), { screen: 'task', taskId: T_OPEN })).url).toContain(`/${T_OPEN}`);
        for (const args of [
            { screen: 'project', projectId: P_PRIVATE }, { screen: 'list', sprintId: L_PRIVATE }, { screen: 'list', sprintId: L_SECRET },
            { screen: 'task', taskId: T_PRIVATE }, { screen: 'task', taskId: T_SECRET }, { screen: 'doc', pageId: String(pages.private._id) },
        ]) {
            expect(await link(guest(), args)).toEqual(NOT_FOUND);
        }
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s: another person\'s personal list', async (label, uid) => {
        expect(await link(ctx(uid), { screen: 'project', projectId: P_PERSONAL })).toEqual(NOT_FOUND);
        expect(await link(ctx(uid), { screen: 'list', sprintId: L_PERSONAL })).toEqual(NOT_FOUND);
        expect(await link(ctx(uid), { screen: 'task', taskId: T_PERSONAL })).toEqual(NOT_FOUND);
    });

    it('a connection kept to one project opens nothing outside it', async () => {
        const kept = () => narrowed(OWNER, [P_OPEN]);
        expect((await link(kept(), { screen: 'project', projectId: P_OPEN })).url).toBe(`${AT}/project/${P_OPEN}/p`);
        expect((await link(kept(), { screen: 'task', taskId: T_OPEN })).url).toContain(`/${T_OPEN}`);
        for (const args of [
            { screen: 'project', projectId: P_PRIVATE }, { screen: 'list', sprintId: L_PRIVATE }, { screen: 'task', taskId: T_PRIVATE },
            { screen: 'doc', pageId: String(pages.private._id) }, { screen: 'doc', pageId: String(pages.company._id) },
        ]) {
            expect(await link(kept(), args)).toEqual(NOT_FOUND);
        }
    });

    it('a deleted thing, a malformed id and a missing id answer alike', async () => {
        expect(await link(ctx(OWNER), { screen: 'doc', pageId: String(pages.gone._id) })).toEqual(NOT_FOUND);
        mockDb.store[SCHEMA_TYPE.TASKS].find((row) => String(row._id) === T_OPEN).deletedStatusKey = 1;
        expect(await link(ctx(OWNER), { screen: 'task', taskId: T_OPEN })).toEqual(NOT_FOUND);
        expect(await link(ctx(OWNER), { screen: 'task', taskId: 'not-an-id' })).toEqual(NOT_FOUND);
        expect(await link(ctx(OWNER), { screen: 'task' })).toEqual(NOT_FOUND);
        expect(await link(ctx(OWNER), { screen: 'project' })).toEqual(NOT_FOUND);
        expect(await link(ctx(OWNER), { screen: 'list' })).toEqual(NOT_FOUND);
        expect(await link(ctx(OWNER), { screen: 'doc' })).toEqual(NOT_FOUND);
    });

    it('an answer for a hidden thing carries no address', async () => {
        expect(JSON.stringify(await link(member(), { screen: 'project', projectId: P_PRIVATE }))).not.toMatch(/http|#|project\//);
    });
});

describe('the address comes from how the server is set up', () => {
    it('uses the web address, without a doubled slash', async () => {
        process.env.WEBURL = 'https://work.example.test///';
        expect((await link(ctx(OWNER), { screen: 'inbox' })).url).toBe(`https://work.example.test/#/${CID}/inbox`);
    });

    it('falls back to the server address where the web app is served from it', async () => {
        delete process.env.WEBURL;
        process.env.APIURL = 'http://localhost:4000/';
        expect((await link(ctx(OWNER), { screen: 'inbox' })).url).toBe(`http://localhost:4000/#/${CID}/inbox`);
    });

    it('gives no link when no address is set, and never takes one from the request', async () => {
        delete process.env.WEBURL;
        const caller = ctx(OWNER, { headers: { host: 'evil.example.test', origin: 'https://evil.example.test', 'x-forwarded-host': 'evil.example.test' } });
        const out = await link(caller, { screen: 'project', projectId: P_OPEN });
        expect(out).toEqual({ error: expect.stringMatching(/web address/) });
        expect(JSON.stringify(out)).not.toMatch(/evil|http/);
    });

    it('ignores an address that is not a web address', async () => {
        process.env.WEBURL = 'javascript:alert(1)';
        expect(await link(ctx(OWNER), { screen: 'inbox' })).toEqual({ error: expect.stringMatching(/web address/) });
    });
});

describe('the call is checked like every other', () => {
    it('refuses an argument the tool does not take, and a screen or view it does not know', async () => {
        expect((await link(ctx(OWNER), { screen: 'settings' })).rpcError.code).toBe(-32602);
        expect((await link(ctx(OWNER), { screen: 'project', projectId: P_OPEN, view: 'secret' })).rpcError.code).toBe(-32602);
        expect((await link(ctx(OWNER), { screen: 'project', projectId: P_OPEN, url: 'https://evil.example.test' })).rpcError.code).toBe(-32602);
        expect((await link(ctx(OWNER), {})).rpcError.code).toBe(-32602);
    });

    it('an app that may not read projects gets no link', async () => {
        const out = await link(outside(OWNER, ['tasks:read']), { screen: 'project', projectId: P_OPEN });
        expect(out.isError).toBe(true);
        expect(out.url).toBeUndefined();
        expect((await link(outside(OWNER, ['projects:read']), { screen: 'project', projectId: P_OPEN })).url).toBe(`${AT}/project/${P_OPEN}/p`);
    });

    it('a connection kept to other actions gets no link', async () => {
        const out = await link(ctx(OWNER, { allowedActions: ['tasks.next'] }), { screen: 'project', projectId: P_OPEN });
        expect(out).toMatchObject({ isError: true, refused: true });
        expect(out.url).toBeUndefined();
    });

    it('writes nothing', async () => {
        const before = JSON.stringify([mockDb.store[SCHEMA_TYPE.PROJECTS], mockDb.store[SCHEMA_TYPE.TASKS], mockDb.store[SCHEMA_TYPE.SPRINTS], mockDb.store[SCHEMA_TYPE.PAGES]]);
        await link(ctx(OWNER), { screen: 'task', taskId: T_OPEN });
        await link(ctx(OUTSIDER), { screen: 'task', taskId: T_PRIVATE });
        expect(JSON.stringify([mockDb.store[SCHEMA_TYPE.PROJECTS], mockDb.store[SCHEMA_TYPE.TASKS], mockDb.store[SCHEMA_TYPE.SPRINTS], mockDb.store[SCHEMA_TYPE.PAGES]])).toBe(before);
    });
});
