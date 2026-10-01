/* Task 047, AI-3 (views): a connected agent adds a saved view to a project. Every call waits for a person, and
   once approved it runs the project's own "add view" route as the person behind the token and no further. */
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
jest.mock('../Modules/Project/controller/getProjectById', () => mockStub());
jest.mock('../Modules/Project/controller/getProjectList', () => mockStub());
jest.mock('../Modules/Project/controller/projectAlltaskUpdate', () => mockStub());
jest.mock('../Modules/Project/controller/getSprintFolder', () => mockStub());
jest.mock('../Modules/Project/controller/updateSprint', () => mockStub());
jest.mock('../Modules/Project/controller/getProjectFilterData', () => mockStub());
jest.mock('../Modules/Project/controller/manageGlobalFilter', () => mockStub());
jest.mock('../Modules/Project/controller/checklist', () => mockStub());
jest.mock('../Modules/Project/controller/tags', () => mockStub());
jest.mock('../Modules/Project/controller/getQueryFun', () => mockStub());
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ recordProjectChanges: jest.fn(async () => null) }));
jest.mock('../Modules/Knowledge/ingest/events', () => mockStub());
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
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const socketEmitter = require('../event/socketEventEmitter');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, routeTable, asPerson, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Project/routes').init));

const TOOL = 'view.create';
const KEYS = ['project.view_list', 'project.project_details'];
const NO_PROJECT = 'not_visible: the project is not one the person behind this token can open';
const V_LIST = '6f0000000000000000000e11';
const V_BOARD = '6f0000000000000000000e12';
const V_PRIVATE = '6f0000000000000000000e13';
const F_REGION = '6f0000000000000000000f01';
const F_ELSEWHERE = '6f0000000000000000000f02';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = (id) => stored(SCHEMA_TYPE.PROJECTS, id);
const viewsOf = (id) => project(id).ProjectRequiredComponent;
const viewNamed = (id, title) => viewsOf(id).find((entry) => entry.title === title);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.PROJECTS]);
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const filed = async (caller, args) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const asCopied = (entry) => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(entry))).filter(([key]) => !['_id', 'id', 'title', 'createdAt'].includes(key)));

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'view_list', name: 'view_list', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    setRule('project_details', false, [0]);
    project(P_OPEN).ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List'), view(V_BOARD, 'ProjectKanban', 'Board')];
    project(P_PRIVATE).ProjectRequiredComponent = [view(V_PRIVATE, 'ProjectListView', 'Secret list')];
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: F_REGION, fieldTitle: 'Region', fieldType: 'dropdown', type: 'task', isDelete: true, global: false, projectId: [P_OPEN] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: F_ELSEWHERE, fieldTitle: 'Secret score', fieldType: 'number', type: 'task', isDelete: true, global: false, projectId: [P_PRIVATE] });
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    socketEmitter.emit.mockClear();
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'Later' })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, it is a rated registry action held to the keys the view route asks for, with a plain scope and no grant', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: KEYS[0], anyOf: KEYS, write: true }]);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'low', undoable: true, write: true, proposeOnly: true });
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:write');
        expect(tools.registered().find((tool) => tool.name === TOOL).grant).toBeUndefined();
    });
});

describe('a view is never added before a person has seen it', () => {
    it('files the view as one proposal, and adds nothing', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: ' High priority ', kind: 'board', groupBy: 'priority', priorities: ['HIGH', 'URGENT'], reason: 'Morning check' });
        expect(viewsOf(P_OPEN)).toHaveLength(2);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toEqual([expect.objectContaining({
            action: TOOL, reversible: true, params: { projectId: P_OPEN, name: 'High priority', kind: 'board', look: { groupBy: 'priority', priorities: ['HIGH', 'URGENT'] } },
        })]);
    });

    it('is held by the project\'s rule for agents until a person approves, and cannot be run directly', async () => {
        const actor = as(INSIDER).actor;
        const params = { projectId: P_OPEN, name: 'Mine', kind: 'list', look: {} };
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params, approved: true })).toEqual({ decision: 'act', reason: '' });
        await expect(actions.perform({ companyId: CID, actor, action: TOOL, params })).rejects.toThrow(/must be proposed/);
        await expect(actions.perform({ companyId: CID, actor, action: TOOL, params: { ...params, __proposal: true } })).rejects.toThrow(/waits for a person's approval/);
        expect(viewsOf(P_OPEN)).toHaveLength(2);
    });
});

describe('who may ask for a view', () => {
    it('files for an owner and for a member who holds either key the view route takes', async () => {
        await filed(as(OWNER), { projectId: P_OPEN, name: 'Owner view' });
        setRule('view_list', false, [3, 0]);
        expect((await web('POST /api/v1/project/:id/views', OUTSIDER, { params: { id: P_OPEN }, body: { sourceViewId: V_LIST, title: 'By hand' } })).code).toBe(200);
        await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Member view' });
        expect(waiting()).toHaveLength(2);
    });

    it('refuses a member and a guest the view route refuses, and files nothing', async () => {
        setRule('view_list', false, [3, 0]);
        setRule('project_details', false, [3, 0]);
        const before = everythingNow();
        for (const uid of [OUTSIDER, GUEST]) {
            expect((await web('POST /api/v1/project/:id/views', uid, { params: { id: P_OPEN }, body: { sourceViewId: V_LIST, title: 'By hand' } })).code).toBe(403);
            expect(await rpc(as(uid), TOOL, { projectId: P_OPEN, name: 'Mine' })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: project\.view_list/) });
        }
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
    });

    it('answers a project the person cannot open, and one outside a narrowed token, as a missing project', async () => {
        expect(await rpc(as(OWNER), TOOL, { projectId: MISSING, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        for (const [uid, projectId] of [[OUTSIDER, P_PRIVATE], [GUEST, P_PRIVATE], [OWNER, P_PERSONAL]]) {
            expect(await rpc(as(uid), TOOL, { projectId, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc({ ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds }, TOOL, { projectId: P_PRIVATE, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect((await rpc(readOnly(OWNER), TOOL, { projectId: P_OPEN, name: 'Nowhere' })).rpcError).toMatchObject({ code: -32004 });
        expect(waiting()).toHaveLength(0);
    });

    it('says at once when the project has no view of that kind to start from, and takes only what a view holds', async () => {
        expect(await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'Calendar', kind: 'calendar' })).toMatchObject({ ok: false, error: expect.stringMatching(/no calendar view/) });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'x', kind: 'gantt' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: '' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'x', groupBy: 'colour' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'x', settings: { filters: [] } })).rpcError).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving adds the view the project\'s own route would add', () => {
    const look = { kind: 'list', groupBy: 'priority', sortBy: 'due', sortDirection: 'desc', mine: true, statuses: ['in progress'], priorities: ['HIGH'], showFieldIds: [F_REGION], subtasks: 'expanded', search: 'invoice' };
    const settings = {
        groupBy: 2, me: true, search: 'invoice', subtasks: 'expanded', sort: { field: 'DueDate', dir: -1 }, columns: { shown: [`cf:${F_REGION}`] },
        filters: [
            { name: { value: 'statusKey', name: 'status', type: 'array', filterOn: 'statusKey' }, comparison: { value: ':', name: 'Is' }, values: [2], condition: '&&' },
            { name: { value: 'Task_Priority', name: 'priority', type: 'array', filterOn: 'Task_Priority' }, comparison: { value: ':', name: 'Is' }, values: ['HIGH'], condition: '&&' },
        ],
    };

    it('stores what the route stores for the same person, and answers where the view is', async () => {
        process.env.WEBURL = 'https://hub.example.test';
        expect((await web('POST /api/v1/project/:id/views', INSIDER, { params: { id: P_OPEN }, body: { sourceViewId: V_LIST, title: 'By hand', settings } })).code).toBe(200);
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'By the agent', ...look });
        const out = await approve(id);
        delete process.env.WEBURL;
        expect(out.error).toBeUndefined();
        const made = viewNamed(P_OPEN, 'By the agent');
        expect(asCopied(made)).toEqual(asCopied(viewNamed(P_OPEN, 'By hand')));
        expect(made).toMatchObject({ keyName: 'ProjectListView', sourceViewId: V_LIST, createdBy: INSIDER, settings: { groupBy: 2, me: true, sort: { field: 'DueDate', dir: -1 } } });
        expect(out.applied[0]).toMatchObject({
            action: TOOL, ok: true,
            result: { projectId: P_OPEN, viewId: String(made._id), name: 'By the agent', kind: 'list', leftOut: [], url: `https://hub.example.test/#/${CID}/project/${P_OPEN}/p?tab=ProjectListView&view=${made._id}` },
        });
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: P_OPEN, meta: { onBehalfOf: INSIDER, undo: { kind: 'view', projectId: P_OPEN, viewId: String(made._id) } } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', updatedFields: { ProjectRequiredComponent: 'add' } }));
    });

    it('leaves out a status and a field the project does not have, and says which part', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Partly', statuses: ['Blocked', 'Done'], groupBy: F_ELSEWHERE, showFieldIds: [F_ELSEWHERE, F_REGION] });
        const { applied } = await approve(id);
        expect(applied[0].result.leftOut.sort()).toEqual(['columns', 'filters', 'group']);
        const made = viewNamed(P_OPEN, 'Partly');
        expect(made.settings.groupBy).toBe(0);
        expect(made.settings.columns.shown).toEqual([`cf:${F_REGION}`]);
        expect(made.settings.filters.map((row) => row.values)).toEqual([[3]]);
        expect(JSON.stringify(applied[0].result)).not.toMatch(/Secret score/);
    });

    it('asks the person behind the token again, and adds nothing when they may not any more', async () => {
        const id = await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Late' });
        setRule('view_list', false, [3]);
        setRule('project_details', false, [3]);
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(viewsOf(P_OPEN)).toHaveLength(2);
    });
});

describe('undo removes exactly the view that was added', () => {
    it('takes it out of the project and leaves every other view as it was', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Short lived', kind: 'board' });
        await approve(id);
        expect(viewsOf(P_OPEN).map((entry) => entry.title)).toEqual(['List', 'Board', 'Short lived']);
        const before = JSON.stringify(viewsOf(P_OPEN).slice(0, 2));
        socketEmitter.emit.mockClear();
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, removed: true } });
        expect(viewsOf(P_OPEN).map((entry) => entry.title)).toEqual(['List', 'Board']);
        expect(JSON.stringify(viewsOf(P_OPEN))).toBe(before);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', updatedFields: { ProjectRequiredComponent: 'remove' } }));
    });
});
