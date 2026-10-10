require('./fixtures/mcpFlagsOff');
/* AI-1 run 2, defects 4 and 5: an agent read a due day as the UTC instant it is stored as and named the day before,
   and with no way to list a project's saved views it added the same view twice. */
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
const scopes = require('../Modules/Mcp/scopes');
const dates = require('../Modules/Mcp/dates');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, T_OPEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const BASE = 'https://hub.example.test';
const IST_MIDNIGHT_11_OCT = '2026-10-10T18:30:00.000Z';
const V_LIST = '6f0000000000000000000e11';
const V_MINE = '6f0000000000000000000e12';
const V_OFF = '6f0000000000000000000e13';
const V_OWN = 'own-view-1';
const NO_PROJECT = { error: 'That project was not found. Ask the person which project they mean.' };

const user = (uid) => rows(SCHEMA_TYPE.USERS).find((row) => String(row._id) === uid);
const project = (id) => stored(SCHEMA_TYPE.PROJECTS, id);
const managing = (uid) => {
    const base = ctx(uid);
    return { ...base, token: { ...base.token, grants: ['tasks:manage'] } };
};
const view = (_id, keyName, title, extra = {}) => ({ _id, id: _id, keyName, title, viewStatus: true, ...extra });

beforeEach(() => {
    seed();
    ['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((flag) => { process.env[flag] = 'on'; });
    process.env.WEBURL = BASE;
    stored(SCHEMA_TYPE.TASKS, T_OPEN).DueDate = IST_MIDNIGHT_11_OCT;
    stored(SCHEMA_TYPE.TASKS, T_OPEN).startDate = '2026-10-08T18:30:00.000Z';
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { [...FLAGS, 'WEBURL'].forEach((flag) => { delete process.env[flag]; }); });

describe('a day reads as the person\'s own calendar day', () => {
    it('gives a due day stored as midnight in India as that day and its weekday', () => {
        expect(dates.shown({ dueDate: IST_MIDNIGHT_11_OCT }, 'Asia/Kolkata')).toEqual({ dueDate: '2026-10-11', dueDateWeekday: 'Sunday' });
        expect(dates.shown({ DueDate: new Date(IST_MIDNIGHT_11_OCT) }, 'Asia/Kolkata')).toEqual({ DueDate: '2026-10-11', DueDateWeekday: 'Sunday' });
    });

    it('keeps a day already written as a day, and names its weekday', () => {
        expect(dates.shown({ tasks: [{ startDate: '2026-10-12' }] }, 'America/Los_Angeles')).toEqual({ tasks: [{ startDate: '2026-10-12', startDateWeekday: 'Monday' }] });
    });

    it('gives a moment at the person\'s offset, and a timer\'s start with its weekday', () => {
        expect(dates.shown({ createdAt: '2026-10-10T20:00:00.000Z', entries: [{ startedAt: '2026-10-10T20:00:00.000Z' }] }, 'Asia/Kolkata')).toEqual({
            createdAt: '2026-10-11T01:30:00.000+05:30',
            entries: [{ startedAt: '2026-10-11T01:30:00.000+05:30', startedAtWeekday: 'Sunday' }],
        });
    });

    it('leaves a moment in UTC as it is stored, and anything that is not a date alone', () => {
        const at = new Date('2026-10-10T20:00:00.000Z');
        expect(dates.shown({ updatedAt: at, dueDate: null, title: '2026-10-10T18:30:00.000Z', count: 3 }, dates.UTC)).toEqual({ updatedAt: at, dueDate: null, title: '2026-10-10T18:30:00.000Z', count: 3 });
    });

    it('answers tasks.search and task.get with the day in India for a person there', async () => {
        user(INSIDER).Time_Zone = 'Asia/Kolkata';
        const found = await rpc(ctx(INSIDER), 'tasks.search', { query: 'Open task' });
        expect(found.tasks.find((task) => task.taskId === T_OPEN)).toMatchObject({ dueDate: '2026-10-11', dueDateWeekday: 'Sunday' });
        const planned = await rpc(managing(INSIDER), 'tasks.search', { query: 'Open task' });
        expect(planned.tasks.find((task) => task.taskId === T_OPEN)).toMatchObject({ dueDate: '2026-10-11', dueDateWeekday: 'Sunday', startDate: '2026-10-09', startDateWeekday: 'Friday' });
        expect(await rpc(ctx(INSIDER), 'task.get', { taskId: T_OPEN })).toMatchObject({ dueDate: '2026-10-11', dueDateWeekday: 'Sunday' });
    });

    it('finds by dueFrom and dueTo the task it answers as due that day, for a person in India', async () => {
        user(INSIDER).Time_Zone = 'Asia/Kolkata';
        const shown = await rpc(managing(INSIDER), 'tasks.search', { query: 'Open task' });
        expect(shown.tasks.find((task) => task.taskId === T_OPEN).dueDate).toBe('2026-10-11');
        const onTheDay = await rpc(managing(INSIDER), 'tasks.search', { dueFrom: '2026-10-11', dueTo: '2026-10-11' });
        expect(onTheDay.tasks.map((task) => task.taskId)).toContain(T_OPEN);
        const dayBefore = await rpc(managing(INSIDER), 'tasks.search', { dueFrom: '2026-10-10', dueTo: '2026-10-10' });
        expect(dayBefore.tasks.map((task) => task.taskId)).not.toContain(T_OPEN);
    });

    it('logs time on the person\'s own day and clock', async () => {
        user(INSIDER).Time_Zone = 'Asia/Kolkata';
        const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'sheet_settings', name: 'sheet_settings', isParent: true, roles: [] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key: 'user_timesheet', name: 'user_timesheet', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] });
        jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T12:00:00Z'));
        const out = await rpc(ctx(INSIDER), 'timelog.create', { taskId: T_OPEN, minutes: 30, date: '2026-10-11', startTime: '01:00' });
        expect(out).toMatchObject({ ok: true });
        const [entry] = rows(SCHEMA_TYPE.TIMESHEET);
        expect(entry.LogStartTime).toBe(Date.parse('2026-10-10T19:30:00Z') / 1000);
        expect(await rpc(ctx(INSIDER), 'timelog.create', { taskId: T_OPEN, minutes: 30, date: '2026-10-12' })).toMatchObject({ isError: true, error: expect.stringMatching(/day that has not come yet/) });
        expect(await rpc(ctx(INSIDER), 'timelog.create', { taskId: T_OPEN, minutes: 30, date: '2026-10-11', startTime: '20:00' })).toMatchObject({ isError: true, error: expect.stringMatching(/start time that has not come yet/) });
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(1);
    });

    it('answers the day in UTC for a person with no time zone stored', async () => {
        const found = await rpc(ctx(INSIDER), 'tasks.search', { query: 'Open task' });
        expect(found.tasks.find((task) => task.taskId === T_OPEN)).toMatchObject({ dueDate: '2026-10-10', dueDateWeekday: 'Saturday' });
    });
});

describe('views.list', () => {
    beforeEach(() => {
        project(P_OPEN).ProjectRequiredComponent = [
            view(V_LIST, 'ProjectListView', 'List', { setAsDefault: true }),
            view(V_MINE, 'ProjectListView', 'Mine this week', { settings: { groupBy: 2, me: true, sort: { field: 'DueDate', dir: -1 }, filters: [{ name: { value: 'DueDate', name: 'due_date', type: 'date', filterOn: 'DueDate' }, comparison: { value: ':=', name: 'Is' }, values: ['This week'] }] } }),
            view(V_OFF, 'ProjectKanban', 'Switched off', { viewStatus: false }),
        ];
        project(P_PRIVATE).ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'Secret list')];
        rows(SCHEMA_TYPE.COMPANY_USERS).find((seat) => seat.userId === OWNER).ProjectRequiredComponent = [
            { id: V_OWN, keyName: 'TableView', title: 'My table', isPrivate: true, projectId: P_OPEN },
            { id: 'own-view-2', keyName: 'TableView', title: 'Elsewhere', isPrivate: true, projectId: P_PRIVATE },
        ];
    });

    it('is a rated read of a project, under the project read', () => {
        expect(registry.get('views.list')).toMatchObject({ risk: 'low', write: false });
        expect(actions.rating('views.list')).toMatchObject({ write: false, scope: 'project' });
        expect(scopes.scopeForTool('views.list')).toBe('projects:read');
    });

    it('lists the shared views that are on and the caller\'s own private ones, each with what it shows and a link', async () => {
        const out = await rpc(ctx(OWNER), 'views.list', { projectId: P_OPEN });
        expect(out.views.map((entry) => [entry.name, entry.kind, entry.private])).toEqual([['List', 'list', false], ['Mine this week', 'list', false], ['My table', 'table', true]]);
        expect(out.views[0]).toMatchObject({ viewId: V_LIST, default: true });
        expect(out.views[1]).toMatchObject({ groupBy: 'priority', mine: true, sort: { by: 'due', direction: 'desc' }, filters: ['due_date'] });
        expect(out.views[1].url).toBe(`${BASE}/#/${CID}/project/${P_OPEN}/p?tab=ProjectListView&view=${V_MINE}`);
    });

    it('shows nobody else\'s private views', async () => {
        const out = await rpc(ctx(OUTSIDER), 'views.list', { projectId: P_OPEN });
        expect(out.views.map((entry) => entry.name)).toEqual(['List', 'Mine this week']);
    });

    it('answers a project the person cannot open as one that is not there', async () => {
        expect(await rpc(ctx(OUTSIDER), 'views.list', { projectId: P_PRIVATE })).toEqual(NO_PROJECT);
    });
});

describe('view.create and a name already in use', () => {
    beforeEach(() => {
        project(P_OPEN).ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List'), view(V_MINE, 'ProjectListView', 'Mine this week'), view(V_OFF, 'ProjectKanban', 'Switched off', { viewStatus: false })];
    });

    it('takes the name of a switched-off view, which views.list does not show', async () => {
        expect((await rpc(ctx(OWNER), 'views.list', { projectId: P_OPEN })).views.map((entry) => entry.name)).not.toContain('Switched off');
        expect(await rpc(managing(OWNER), 'view.create', { projectId: P_OPEN, name: 'Switched off' })).toMatchObject({ ok: false, pending: true });
    });

    it('is refused by the add-view write itself when the name is taken by then', async () => {
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        const body = { sourceViewId: V_LIST, title: 'MINE   this week', uniqueTitle: true };
        await require('../Modules/Project/controller/viewSettings').createView({ headers: { companyid: CID }, params: { id: P_OPEN }, body, uid: OWNER }, res);
        expect(res.code).toBe(409);
        expect(project(P_OPEN).ProjectRequiredComponent).toHaveLength(3);
        await require('../Modules/Project/controller/viewSettings').createView({ headers: { companyid: CID }, params: { id: P_OPEN }, body: { ...body, title: 'Mine next week' }, uid: OWNER }, res);
        expect(res.code).toBe(200);
        expect(project(P_OPEN).ProjectRequiredComponent).toHaveLength(4);
    });

    it('is refused with the link to the view that has the name, and nothing is filed', async () => {
        const out = await rpc(managing(OWNER), 'view.create', { projectId: P_OPEN, name: '  mine THIS week ' });
        expect(out).toMatchObject({
            ok: false,
            error: expect.stringMatching(/already has a saved view named "Mine this week"/),
            existing: { viewId: V_MINE, name: 'Mine this week', kind: 'list', url: `${BASE}/#/${CID}/project/${P_OPEN}/p?tab=ProjectListView&view=${V_MINE}` },
        });
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
    });

    it('files a view with a new name', async () => {
        expect(await rpc(managing(OWNER), 'view.create', { projectId: P_OPEN, name: 'Mine next week' })).toMatchObject({ ok: false, pending: true });
    });
});
