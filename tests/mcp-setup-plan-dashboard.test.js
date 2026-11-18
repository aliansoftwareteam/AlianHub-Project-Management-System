require('./fixtures/mcpFlagsOff');
/* Task 047, S2-D: a plan may hold one project dashboard of up to six cards the editor adds with nothing more to fill
   in. It is made by the editor's own route as the person who approves, shown on the project where they can open it
   and private to them otherwise, and undo removes it unless someone changed it since. */
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
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const intentPreview = require('../Modules/Agents/intentPreview');
const dashboards = require('../Modules/Agents/dashboardRequests');
const plans = require('../Modules/Agents/projectSetup');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, TOKEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const web = world.asPerson(world.routeTable(require('../Modules/UserDashboard/routes').init));

const V_LIST = '6f0000000000000000000e11';
const V_BOARD = '6f0000000000000000000e12';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const MEMBER_KEYS = ['project_create', 'project_description', 'project_delete', 'project_close', 'project_custom_field', 'view_list'];
const BOARD = { name: 'Delivery overview', cards: ['tasks_by_status', 'due_soon'] };
const SETUP = { projectId: P_OPEN, lists: ['Backlog'], dashboard: BOARD, reason: 'A board for the delivery' };
const NEW_PROJECT = { name: 'Website relaunch', lists: ['Backlog'], dashboard: BOARD };

const boards = () => rows(SCHEMA_TYPE.USERDASHBOARD);
const named = (title) => boards().find((board) => board.title === title);
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = INSIDER, parts) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '', ...(parts ? { parts } : {}) });
const undo = (id, uid = INSIDER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid) => {
    const base = ctx(uid);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants: ['tasks:manage'] } };
};
const filed = async (tool, args, caller = as(INSIDER)) => {
    const out = await rpc(caller, tool, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const previewOf = async (id) => (await intentPreview.forProposals(CID, OWNER, [stored(SCHEMA_TYPE.AGENT_PROPOSALS, id)])).get(id)[0];
const partOf = (out, name) => out.applied[0].result.parts.find((part) => part.part === name);

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    MEMBER_KEYS.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    ['task_custom_field', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, false, [0]));
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_status', totalStatus: 1, settings: [{ key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035', isDeleted: false }] });
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'project_status', totalStatus: 5, settings: [] });
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_type', totalStatus: 1, settings: [{ key: 1, name: 'Task', value: 'task', taskImage: 'task.png' }] });
    mockDb.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { _id: V_LIST, keyName: 'ProjectListView', name: 'List', icon: 'list.svg', activeIcon: 'list-on.svg' });
    mockDb.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { _id: V_BOARD, keyName: 'ProjectKanban', name: 'Board', icon: 'board.svg', activeIcon: 'board-on.svg' });
    ['Priority', 'MultipleAssignees', 'TimeTracking', 'tags', 'CustomFields'].forEach((key) => mockDb.seed(SCHEMA_TYPE.APPS, { key, name: key, appStatus: true }));
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: ['tasks:manage'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('what a plan may name', () => {
    it('takes one dashboard of one to six cards of the picker, each once', () => {
        expect(plans.setupProblem(SETUP)).toBe('');
        expect(plans.planProblem({ dashboard: { name: 'Overview', cards: ['due_soon', 'my_time', 'project_pulse', 'logged_vs_estimate', 'free_capacity', 'at_risk', 'tasks_by_status'] } })).toMatch(/1 to 6 cards/);
        expect(plans.planProblem({ dashboard: { name: 'Overview', cards: ['burndown'] } })).toMatch(/"burndown" is not a card/);
        expect(plans.planProblem({ dashboard: { name: 'Overview', cards: ['due_soon', 'due_soon'] } })).toMatch(/names a card twice/);
        expect(plans.planProblem({ dashboard: { name: '  ', cards: ['due_soon'] } })).toMatch(/needs a name/);
        expect(plans.planProblem({ dashboards: [BOARD, BOARD] })).toMatch(/holds 1 dashboard/);
    });

    it('is refused at the call when a card is not one the editor adds as it is, and nothing is filed', async () => {
        const out = await rpc(as(INSIDER), 'project.setup', { ...SETUP, dashboard: { name: 'Overview', cards: ['velocity'] } });
        expect(out.pending).toBeUndefined();
        expect(rows(SCHEMA_TYPE.AGENT_PROPOSALS)).toHaveLength(0);
    });

    it('is kept in the stored plan as its one dashboard, and the card shows it with its cards as a part to leave out', async () => {
        const id = await filed('project.setup', SETUP);
        expect(stored(SCHEMA_TYPE.AGENT_PROPOSALS, id).changes[0].params.dashboards).toEqual([BOARD]);
        const preview = await previewOf(id);
        expect(preview.lines).toContainEqual({ kind: 'planDashboard', name: 'Delivery overview', cards: ['TasksByStatusCard', 'DueSoonCard'], pick: 'dashboards:0' });
        expect(boards()).toHaveLength(0);
    });
});

describe('project.setup', () => {
    it('makes the dashboard as the approver, on the project, with its cards one under another', async () => {
        const out = await approve(await filed('project.setup', SETUP), OWNER);
        expect(partOf(out, 'dashboards')).toMatchObject({ ok: true, items: [{ name: 'Delivery overview', made: true, shared: true }] });
        const board = named('Delivery overview');
        expect(board).toMatchObject({ ownerId: OWNER, visibility: 'project', projectId: P_OPEN, isDeleted: false });
        expect(board.cards.map((card) => card.componentId)).toEqual(['TasksByStatusCard', 'DueSoonCard']);
        expect(board.cards[1].config.position.y).toBe(board.cards[0].config.position.h);
    });

    it('is left out when the person approving unticks it', async () => {
        const out = await approve(await filed('project.setup', SETUP), INSIDER, { 0: { lists: [0] } });
        expect(partOf(out, 'dashboards')).toBeUndefined();
        expect(boards()).toHaveLength(0);
    });

    it('is removed by undo while it is as the plan made it', async () => {
        const id = await filed('project.setup', SETUP);
        await approve(id);
        const out = await undo(id);
        expect(out.results[0].result.removed.dashboards).toEqual(['Delivery overview']);
        expect(named('Delivery overview').isDeleted).toBe(true);
    });

    it('stays when someone changed it since, and the undo says why', async () => {
        const id = await filed('project.setup', SETUP);
        await approve(id);
        const board = named('Delivery overview');
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect((await web('PUT /api/v1/dashboards/:id/cards', INSIDER, { params: { id: String(board._id) }, body: { cards: board.cards.slice(0, 1) } })).code).toBe(200);
        const out = await undo(id);
        expect(out.results[0].result.removed.dashboards).toEqual([]);
        expect(out.results[0].result.kept).toContainEqual({ part: 'dashboards', name: 'Delivery overview', reason: dashboards.CHANGED_SINCE });
        expect(named('Delivery overview').isDeleted).toBe(false);
    });
});

describe('project.create', () => {
    it('makes the dashboard on the new project, and undo takes it with the project', async () => {
        const id = await filed('project.create', NEW_PROJECT);
        const out = await approve(id);
        const project = rows(SCHEMA_TYPE.PROJECTS).find((row) => row.ProjectName === 'Website relaunch');
        expect(partOf(out, 'dashboards')).toMatchObject({ ok: true });
        expect(named('Delivery overview')).toMatchObject({ ownerId: INSIDER, visibility: 'project', projectId: String(project._id) });
        const back = await undo(id);
        expect(back.results[0].result).toMatchObject({ trashed: true, removed: { dashboards: ['Delivery overview'] } });
        expect(named('Delivery overview').isDeleted).toBe(true);
    });
});

describe('who can see it', () => {
    it('is private to its owner where they cannot open the project', async () => {
        const made = await dashboards.makeForPlan({ companyId: CID, who: { uid: OUTSIDER, via: '', mark: null }, projectId: P_PRIVATE, dashboard: BOARD });
        expect(made.shared).toBe(false);
        expect(named('Delivery overview')).toMatchObject({ ownerId: OUTSIDER, visibility: 'private', projectId: '' });
    });

    it('is taken back only by its owner', async () => {
        const made = await dashboards.makeForPlan({ companyId: CID, who: { uid: OWNER, via: '', mark: null }, projectId: P_OPEN, dashboard: BOARD });
        const out = await plans.withdrawDashboardsOf({ companyId: CID, who: { uid: INSIDER, via: '', mark: null }, dashboards: [made] });
        expect(out.removed.dashboards).toEqual([]);
        expect(out.kept[0]).toMatchObject({ part: 'dashboards', reason: expect.stringMatching(/Only the owner/) });
        expect(named('Delivery overview').isDeleted).toBe(false);
    });
});
