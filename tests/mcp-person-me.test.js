require('./fixtures/mcpFlagsOff');
/* Task 047, AI-1 gaps: "who am I" and "which days count". A connected agent asks who the person behind it is, so
   "assign it to me" and "due tomorrow" mean something, and which days the workspace or a project works. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockElsewhere = require('./fixtures/fakeMongo').create();
const mockOtherCompany = '6f00000000000000000000c2';

/* One database per company, as in production: a call that names another company reads that company's rows only. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (String(companyId) === mockOtherCompany ? mockElsewhere : mockDb).crud(companyId, q, method),
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
jest.mock('../Modules/Company/controller/updateCompany', () => Object.assign(mockStub(), {
    getCompanyDataFun: async (ids) => (mockDb.store.companies || []).filter((company) => ids.map(String).includes(String(company._id))),
}));
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

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, outside, settle } = world;
const { seed, rows, stored, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const ME = 'person.me';
const DAYS = 'workdays.get';
const BOTH = [ME, DAYS];
const NO_PROJECT = { error: 'That project was not found. Ask the person which project they mean.' };
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const user = (uid) => rows(SCHEMA_TYPE.USERS).find((row) => String(row._id) === uid);
const company = () => mockDb.store.companies.find((row) => String(row._id) === CID);
const elsewhere = (uid) => ctx(uid, { companyId: mockOtherCompany });
const me = (caller) => rpc(caller, ME, {});
const days = (caller, args = {}) => rpc(caller, DAYS, args);

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_WORK = 'off';
    process.env.MCP_TOOLS_DATA = 'on';
    Object.keys(mockElsewhere.store).forEach((type) => { mockElsewhere.store[type].length = 0; });
    mockElsewhere.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OUTSIDER, roleType: 1, status: 2, isDelete: false });
    mockDb.store.companies.push({ _id: mockOtherCompany, workingDays: [0, 1, 2, 3, 4] });
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => FLAGS.forEach((flag) => { delete process.env[flag]; }));

describe('the tools exist with the read tools', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_DATA = 'off';
        expect(tools.names()).toEqual(BEFORE);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        BOTH.forEach((name) => {
            expect(registry.has(name)).toBe(false);
            expect(actions.rating(name)).toBeNull();
        });
        expect(await me(ctx(OWNER))).toEqual({ rpcError: { code: -32601, message: `Unknown tool "${ME}"` } });
        expect(await days(ctx(OWNER))).toEqual({ rpcError: { code: -32601, message: `Unknown tool "${DAYS}"` } });
    });

    it.each(BOTH)('on, %s is a read that needs the right to read projects and changes nothing', async (name) => {
        expect(await listed(ctx(OWNER))).toContain(name);
        expect(registry.get(name)).toMatchObject({ write: false, risk: 'low', undoable: false });
        expect(registry.permissionsFor(name)).toEqual([{ key: 'project.project_list', write: false }]);
        expect(actions.rating(name)).toMatchObject({ write: false, money: false });
        expect(scopes.scopeForTool(name)).toBe('projects:read');
        expect(tools.registered().find((tool) => tool.name === name).strict).toBe(true);
    });

    it('the working days go through the caller\'s filter; who the caller is reads nothing a filter could judge, and says so', () => {
        expect(tools.registered().find((tool) => tool.name === DAYS).visibility).toBe('filtered');
        expect(tools.registered().find((tool) => tool.name === ME)).toMatchObject({ visibility: 'none', visibilityReason: expect.stringMatching(/only the caller's own record/) });
    });

    it.each(BOTH)('%s is marked read-only for a client that reads the hints', async (name) => {
        process.env.MCP_TOOLS_V2 = 'on';
        const listedTool = (await server.handleRpc(ctx(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((tool) => tool.name === name);
        expect(listedTool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    });

    it.each(BOTH)('%s answers a connection that only reads, and refuses one that may not read projects', async (name) => {
        expect(await rpc(readOnly(OWNER), name, {})).not.toHaveProperty('error');
        expect(await rpc(outside(OWNER, ['tasks:read']), name, {})).toMatchObject({ isError: true, error: expect.stringMatching(/projects:read permission/) });
        expect((await rpc(ctx(OWNER, { allowedActions: ['tasks.next'] }), name, {})).refused).toBe(true);
    });

    it('neither writes anything', async () => {
        const before = JSON.stringify([rows(SCHEMA_TYPE.USERS), rows(SCHEMA_TYPE.COMPANY_USERS), rows(SCHEMA_TYPE.PROJECTS), mockDb.store.companies]);
        await me(ctx(OWNER));
        await days(ctx(OWNER), { projectId: P_OPEN });
        expect(JSON.stringify([rows(SCHEMA_TYPE.USERS), rows(SCHEMA_TYPE.COMPANY_USERS), rows(SCHEMA_TYPE.PROJECTS), mockDb.store.companies])).toBe(before);
    });
});

describe('who the connection acts for', () => {
    it('takes no argument, so nobody else can be asked about', async () => {
        expect((await rpc(ctx(OWNER), ME, { userId: INSIDER })).rpcError).toMatchObject({ code: -32602 });
    });

    it.each([
        ['an owner', OWNER, 'Olive Owner', 'owner'],
        ['an admin', ADMIN, 'Adam Admin', 'admin'],
        ['a member', OUTSIDER, 'Mia Member', 'member'],
        ['a guest', GUEST, 'Gus Guest', 'guest'],
    ])('%s is told their own id, name and role, and nobody else\'s', async (_who, uid, name, role) => {
        const answer = await me(ctx(uid));
        expect(answer).toMatchObject({ userId: uid, name, role });
        const others = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST].filter((id) => id !== uid);
        others.forEach((id) => expect(JSON.stringify(answer)).not.toContain(id));
    });

    it('a role the workspace made itself is named as a custom role', async () => {
        rows(SCHEMA_TYPE.COMPANY_USERS).find((seat) => seat.userId === INSIDER).roleType = 7;
        rows(SCHEMA_TYPE.RULES).filter((rule) => !rule.isParent).forEach((rule) => { rule.roles.push({ key: 7, permission: true }); });
        expect(await me(ctx(INSIDER))).toMatchObject({ userId: INSIDER, role: 'custom' });
    });

    it('gives the person\'s time zone and the day it is for them', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T20:30:00Z'));
        user(OWNER).Time_Zone = 'Asia/Kolkata';
        expect(await me(ctx(OWNER))).toMatchObject({ timeZone: 'Asia/Kolkata', today: '2026-10-03' });
        user(OWNER).Time_Zone = 'America/Los_Angeles';
        expect(await me(ctx(OWNER))).toMatchObject({ timeZone: 'America/Los_Angeles', today: '2026-10-02' });
    });

    it.each([['none stored', undefined], ['one that is not a time zone', 'Mars/Olympus']])('with %s, says so and gives the day in UTC', async (_what, zone) => {
        jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T20:30:00Z'));
        user(OWNER).Time_Zone = zone;
        const answer = await me(ctx(OWNER));
        expect(answer).toMatchObject({ timeZone: null, today: '2026-10-02' });
        expect(answer.note).toMatch(/UTC/);
    });

    it('reads only the caller\'s own record', async () => {
        mockDb.calls.length = 0;
        await me(ctx(GUEST));
        const userReads = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.USERS);
        expect(userReads.length).toBeGreaterThan(0);
        userReads.forEach((call) => expect(String(call.data[0]._id)).toBe(GUEST));
    });

    it('in another company the person is who they are there', async () => {
        expect(await me(ctx(OUTSIDER))).toMatchObject({ userId: OUTSIDER, role: 'member' });
        expect(await me(elsewhere(OUTSIDER))).toMatchObject({ userId: OUTSIDER, role: 'owner' });
    });

    it('a person with no seat in the company the call names is refused', async () => {
        const answer = await me(elsewhere(GUEST));
        expect(answer.refused).toBe(true);
        expect(JSON.stringify(answer)).not.toContain('Gus Guest');
    });
});

describe('which days count', () => {
    it('a workspace that never chose its week works Monday to Friday', async () => {
        expect(await days(ctx(OUTSIDER))).toMatchObject({ of: 'workspace', workingDays: WEEKDAYS, dayNumbers: [1, 2, 3, 4, 5], daysOff: ['Sunday', 'Saturday'] });
    });

    it('answers the week the workspace chose', async () => {
        company().workingDays = [0, 1, 2, 3, 4];
        expect(await days(ctx(GUEST))).toMatchObject({ of: 'workspace', workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'], dayNumbers: [0, 1, 2, 3, 4], daysOff: ['Friday', 'Saturday'] });
    });

    it('a project with a week of its own answers that week, one without answers the workspace\'s', async () => {
        company().workingDays = [1, 2, 3, 4];
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).workingDays = [1, 2, 3, 4, 5, 6];
        expect(await days(ctx(OUTSIDER), { projectId: P_OPEN })).toMatchObject({ of: 'project', projectId: P_OPEN, dayNumbers: [1, 2, 3, 4, 5, 6], daysOff: ['Sunday'] });
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).workingDays = undefined;
        expect(await days(ctx(OUTSIDER), { projectId: P_OPEN })).toMatchObject({ of: 'workspace', projectId: P_OPEN, dayNumbers: [1, 2, 3, 4] });
    });

    it('says plainly that no public holidays are kept', async () => {
        const answer = await days(ctx(OWNER));
        expect(answer.holidays).toBeNull();
        expect(answer.note).toMatch(/no list of public holidays/);
    });

    it('takes only a project id', async () => {
        expect((await days(ctx(OWNER), { userId: INSIDER })).rpcError).toMatchObject({ code: -32602 });
        expect((await days(ctx(OWNER), { projectId: 'Open' })).rpcError).toMatchObject({ code: -32602 });
    });

    it('an owner and a member on the private project read its week', async () => {
        stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).workingDays = [2, 3, 4];
        expect(await days(ctx(OWNER), { projectId: P_PRIVATE })).toMatchObject({ of: 'project', dayNumbers: [2, 3, 4] });
        expect(await days(ctx(INSIDER), { projectId: P_PRIVATE })).toMatchObject({ of: 'project', dayNumbers: [2, 3, 4] });
    });

    it.each([['a member outside the private project', OUTSIDER], ['a guest', GUEST]])('%s is answered as for a project that does not exist', async (_who, uid) => {
        stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).workingDays = [2, 3, 4];
        const missing = await days(ctx(uid), { projectId: MISSING });
        expect(missing).toEqual(NO_PROJECT);
        expect(await days(ctx(uid), { projectId: P_PRIVATE })).toEqual(missing);
        expect(await days(ctx(uid), { projectId: P_PERSONAL })).toEqual(missing);
    });

    it('an owner is not answered for another person\'s personal list, and a token kept to some projects not outside them', async () => {
        expect(await days(ctx(OWNER), { projectId: P_PERSONAL })).toEqual(NO_PROJECT);
        expect(await days(narrowed(OWNER, [P_OPEN]), { projectId: P_PRIVATE })).toEqual(NO_PROJECT);
        expect(await days(narrowed(OWNER, [P_OPEN]), { projectId: P_OPEN })).toMatchObject({ projectId: P_OPEN });
    });

    it('another company reads its own week and none of this company\'s projects', async () => {
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).workingDays = [1, 2];
        expect(await days(elsewhere(OUTSIDER))).toMatchObject({ of: 'workspace', dayNumbers: [0, 1, 2, 3, 4] });
        expect(await days(elsewhere(OUTSIDER), { projectId: P_OPEN })).toEqual(NO_PROJECT);
    });
});
