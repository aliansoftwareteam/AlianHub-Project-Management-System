/* Task 047, S-2: the person approving a plan keeps only the parts they tick. The choice names parts of the stored
   plan by their place in it, so it can take parts out and never put anything in; a part that needs one left out
   is refused in plain words, and nothing is made until the choice is one the plan can be carried out with. */
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
const planChoice = require('../Modules/Agents/planChoice');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, TOKEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const TOOL = 'project.setup';
const V_LIST = '6f0000000000000000000e11';
const V_BOARD = '6f0000000000000000000e12';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const CATALOGUE = [
    { key: 1, name: 'To Do', textColor: '#ff9600', bgColor: '#ff960035', isDeleted: false },
    { key: 2, name: 'In Progress', textColor: '#6473e8', bgColor: '#6473e835', isDeleted: false },
    { key: 3, name: 'Done', textColor: '#24c110', bgColor: '#24c11035', isDeleted: false },
    { key: 4, name: 'In Review', textColor: '#111111', bgColor: '#11111135', isDeleted: false },
    { key: 5, name: 'Blocked', textColor: '#222222', bgColor: '#22222235', isDeleted: false },
];
const PLAN = {
    projectId: P_OPEN,
    statuses: ['In Review', 'Blocked'],
    lists: ['Backlog', 'This week'],
    fields: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
    views: [{ name: 'Review board', kind: 'board', groupBy: 'status', showFields: ['Budget'] }, { name: 'Mine', mine: true }],
    reason: 'A client project with a review step',
};

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = () => stored(SCHEMA_TYPE.PROJECTS, P_OPEN);
const statusNames = () => project().taskStatusData.map((status) => status.name);
const listNames = () => rows(SCHEMA_TYPE.SPRINTS).filter((row) => String(row.projectId) === P_OPEN && Number(row.deletedStatusKey || 0) === 0).map((row) => row.name);
const liveFields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete !== false).map((field) => field.fieldTitle);
const viewTitles = () => project().ProjectRequiredComponent.map((entry) => entry.title);
const proposal = (id) => stored(SCHEMA_TYPE.AGENT_PROPOSALS, id);
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.SETTINGS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, parts, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '', ...(parts === undefined ? {} : { parts }) });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid) => {
    const base = ctx(uid);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const filed = async (args = PLAN, caller = as(INSIDER)) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const previewOf = async (id, uid = OWNER) => (await intentPreview.forProposals(CID, uid, [proposal(id)])).get(id)[0];
const partsOf = (out) => out.applied[0].result.parts.map((part) => part.part);

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    ['project_custom_field', 'view_list'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    ['task_custom_field', 'project_details', 'project_sprint_create'].forEach((key) => setRule(key, false, [0]));
    project().ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List'), view(V_BOARD, 'ProjectKanban', 'Board')];
    mockDb.seed(SCHEMA_TYPE.SETTINGS, { name: 'task_status', totalStatus: 5, settings: CATALOGUE.map((status) => ({ ...status })) });
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the preview says which lines can be left out', () => {
    it('gives every status, list, field and view its place in the plan, and what each one needs', async () => {
        const preview = await previewOf(await filed());
        expect(preview.lines).toEqual([
            { kind: 'place', project: 'Open', list: '' },
            { kind: 'newStatuses', names: ['In Review', 'Blocked'], picks: ['statuses:0', 'statuses:1'] },
            { kind: 'newLists', names: ['Backlog', 'This week'], picks: ['lists:0', 'lists:1'] },
            { kind: 'field', name: 'Budget', type: 'money', options: [], pick: 'fields:0' },
            { kind: 'field', name: 'Region', type: 'dropdown', options: ['North', 'South'], pick: 'fields:1' },
            { kind: 'planView', name: 'Review board', layout: 'board', pick: 'views:0' },
            { kind: 'group', by: 'status', field: '', under: 'views:0' },
            { kind: 'columns', names: ['Budget'], others: 0, under: 'views:0' },
            { kind: 'planView', name: 'Mine', layout: 'list', pick: 'views:1' },
            { kind: 'mine', under: 'views:1' },
        ]);
        expect(preview.needs).toEqual({ 'views:0': ['fields:0'] });
    });

    it('names no need for a plan whose parts stand alone', async () => {
        const preview = await previewOf(await filed({ projectId: P_OPEN, lists: ['Backlog'], fields: [{ name: 'Budget', type: 'money' }] }));
        expect(preview.needs).toEqual({});
    });
});

describe('only the ticked parts are made', () => {
    it('makes the chosen statuses, lists, fields and views and leaves the rest out', async () => {
        const id = await filed();
        const out = await approve(id, { 0: { statuses: [0], lists: [1], fields: [1], views: [1] } });
        expect(out.error).toBeUndefined();
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true });
        expect(out.applied[0].result).toMatchObject({ made: 4, notMade: [] });
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
        expect(listNames()).toEqual(expect.arrayContaining(['This week']));
        expect(listNames()).not.toContain('Backlog');
        expect(liveFields()).toEqual(['Region']);
        expect(viewTitles()).toEqual(['List', 'Board', 'Mine']);
    });

    it('keeps on the proposal what was approved, not what was filed', async () => {
        const id = await filed();
        await approve(id, { 0: { statuses: [1], lists: [0], fields: [0, 1], views: [0] } });
        expect(proposal(id).status).toBe('edited');
        expect(proposal(id).changes).toHaveLength(1);
        expect(proposal(id).changes[0]).toMatchObject({ action: TOOL, reversible: true });
        expect(proposal(id).changes[0].params).toEqual({
            projectId: P_OPEN,
            statuses: ['Blocked'],
            lists: ['Backlog'],
            definitions: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'dropdown', options: ['North', 'South'] }],
            views: [{ name: 'Review board', kind: 'board', look: { groupBy: 'status' }, showFields: ['Budget'] }],
        });
    });

    it('makes nothing of a kind of part the choice does not name', async () => {
        const id = await filed();
        const out = await approve(id, { 0: { lists: [0] } });
        expect(partsOf(out)).toEqual(['lists']);
        expect(statusNames()).toEqual(['To Do', 'In Progress', 'Done']);
        expect(listNames()).toContain('Backlog');
        expect(listNames()).not.toContain('This week');
        expect(liveFields()).toEqual([]);
        expect(viewTitles()).toEqual(['List', 'Board']);
    });

    it('carries out the whole plan when no choice is sent, as before', async () => {
        const id = await filed();
        const out = await approve(id);
        expect(out.applied[0].result.made).toBe(8);
        expect(proposal(id).status).toBe('approved');
    });

    it('takes back only what the chosen parts made', async () => {
        const id = await filed();
        await approve(id, { 0: { lists: [0], fields: [1] } });
        const out = await undo(id);
        expect(out.results[0].result.removed).toEqual({ views: [], fields: ['Region'], lists: ['Backlog'], statuses: [] });
        expect(liveFields()).toEqual([]);
        expect(listNames()).not.toContain('Backlog');
    });
});

describe('a choice can only take parts out of the stored plan', () => {
    const refused = async (parts, message) => {
        const id = await filed();
        const before = everythingNow();
        const out = await approve(id, parts);
        expect(out).toMatchObject({ status: 400, error: expect.stringMatching(message) });
        expect(everythingNow()).toBe(before);
        expect(proposal(id).status).toBe('pending');
        expect(proposal(id).changes[0].params.lists).toEqual(['Backlog', 'This week']);
    };

    it('refuses a part the plan does not have', async () => {
        await refused({ 0: { members: [0] } }, /no part called "members"/);
        await refused({ 0: { definitions: [0] } }, /no part called "definitions"/);
    });

    it('refuses a kind of part this plan came without', async () => {
        const id = await filed({ projectId: P_OPEN, lists: ['Backlog'] });
        expect(await approve(id, { 0: { lists: [0], views: [0] } })).toMatchObject({ status: 400, error: expect.stringMatching(/no views/) });
        expect(proposal(id).status).toBe('pending');
    });

    it('refuses a place the plan does not have, and anything that is not a place', async () => {
        await refused({ 0: { lists: [2] } }, /do not match this plan/);
        await refused({ 0: { lists: [-1] } }, /do not match this plan/);
        await refused({ 0: { lists: [0.5] } }, /do not match this plan/);
        await refused({ 0: { lists: ['0'] } }, /do not match this plan/);
        await refused({ 0: { lists: [0, 0] } }, /do not match this plan/);
        await refused({ 0: { lists: 'all' } }, /do not match this plan/);
        await refused({ 0: { lists: ['A list the plan never named'] } }, /do not match this plan/);
        await refused({ 0: { fields: [{ name: 'Salary', type: 'money' }] } }, /do not match this plan/);
    });

    it('refuses a change the proposal does not have, and a choice that is not one', async () => {
        await refused({ 1: { lists: [0] } }, /does not have/);
        await refused({ first: { lists: [0] } }, /does not have/);
        await refused([[0]], /chosen parts/);
        await refused('lists', /chosen parts/);
        await refused({ 0: [0] }, /chosen parts/);
    });

    it('refuses a choice that keeps nothing', async () => {
        await refused({ 0: {} }, /at least one part/);
        await refused({ 0: { lists: [], fields: [] } }, /at least one part/);
    });

    it('refuses a choice sent together with edited changes', async () => {
        const id = await filed();
        const out = await proposals.approve(CID, id, { decider: human(OWNER), isPrivileged: true, ip: '', parts: { 0: { lists: [0] } }, changes: [{ action: TOOL, params: { projectId: P_OPEN, lists: ['Other'] } }] });
        expect(out.error).toBeTruthy();
        expect(proposal(id).status).toBe('pending');
        expect(listNames()).not.toContain('Other');
    });

    it('offers no choice inside a change that is not a plan', async () => {
        const out = await rpc(as(INSIDER), 'fields.create', { projectId: P_OPEN, fields: [{ name: 'Budget', type: 'money' }, { name: 'Region', type: 'text' }] });
        const answer = await approve(out.proposalId, { 0: { fields: [0] } });
        expect(answer).toMatchObject({ status: 400, error: expect.stringMatching(/approved or declined whole/) });
        expect(liveFields()).toEqual([]);
    });
});

describe('a part that needs one left out', () => {
    it('is refused in plain words, with nothing made', async () => {
        const id = await filed();
        const before = everythingNow();
        const out = await approve(id, { 0: { fields: [1], views: [0] } });
        expect(out).toMatchObject({ status: 400 });
        expect(out.error).toBe('The view "Review board" needs the field "Budget", which is left out. Keep both, or leave both out.');
        expect(everythingNow()).toBe(before);
        expect(proposal(id).status).toBe('pending');
    });

    it('is made once what it needs is kept too', async () => {
        const id = await filed();
        const out = await approve(id, { 0: { fields: [0], views: [0] } });
        expect(out.error).toBeUndefined();
        expect(liveFields()).toEqual(['Budget']);
        expect(viewTitles()).toEqual(['List', 'Board', 'Review board']);
    });
});

describe('through the approve route', () => {
    const routes = {};
    const register = (method) => (path, ...handlers) => { routes[`${method} ${path}`] = handlers.flat(); };
    require('../Modules/Agents/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} });
    const send = async (id, caller, body) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
        const url = `/api/v2/agents/proposals/${id}/approve`;
        const req = { ...caller, method: 'POST', originalUrl: url, url, query: {}, params: { id }, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
        for (const handler of routes['POST /api/v2/agents/proposals/:id/approve']) {
            let passed = false;
            await handler(req, res, () => { passed = true; });
            if (!passed) break;
        }
        await settle();
        return { code: res.statusCode, body: res.body };
    };

    it('a signed-in person approves with the parts they kept', async () => {
        const id = await filed();
        const out = await send(id, { uid: OWNER }, { parts: { 0: { lists: [1] } } });
        expect(out).toMatchObject({ code: 200, body: { status: true } });
        expect(listNames()).toContain('This week');
        expect(listNames()).not.toContain('Backlog');
        expect(liveFields()).toEqual([]);
    });

    it('answers a choice the plan cannot follow as a refusal the page can show', async () => {
        const id = await filed();
        const out = await send(id, { uid: OWNER }, { parts: { 0: { fields: [1], views: [0] } } });
        expect(out).toMatchObject({ code: 400, body: { status: false, statusText: expect.stringMatching(/needs the field "Budget"/) } });
        expect(proposal(id).status).toBe('pending');
    });

    it('a token cannot approve, with a choice or without', async () => {
        const id = await filed();
        const out = await send(id, { uid: OWNER, apiToken: { _id: tokenOf(OWNER), userId: OWNER, name: 'A script', scopes: ['read', 'write'] } }, { parts: { 0: { lists: [1] } } });
        expect(out.code).toBe(403);
        expect(proposal(id).status).toBe('pending');
        expect(listNames()).not.toContain('This week');
    });
});

describe('the choice of a plan, on its own', () => {
    const change = (params, action = TOOL) => ({ action, params, label: 'Set up', reversible: true });

    it('says whether one was sent', () => {
        expect(planChoice.given(undefined)).toBe(false);
        expect(planChoice.given(null)).toBe(false);
        expect(planChoice.given({})).toBe(true);
    });

    it('keeps the name and the description of a new project, whatever is left out of its plan', () => {
        const filedChange = change({ name: 'Client work', description: 'For the client', lists: ['Backlog', 'Later'], statuses: ['In Review'] }, 'project.create');
        const out = planChoice.narrow([filedChange], { 0: { lists: [1] } });
        expect(out.error).toBeUndefined();
        expect(out.changes).toEqual([change({ name: 'Client work', description: 'For the client', lists: ['Later'] }, 'project.create')]);
        expect(planChoice.narrow([filedChange], { 0: {} }).changes[0].params).toEqual({ name: 'Client work', description: 'For the client' });
    });

    it('leaves the other changes of a proposal as they were filed', () => {
        const other = change({ projectId: P_OPEN, name: 'Mine' }, 'view.create');
        const out = planChoice.narrow([other, change({ projectId: P_OPEN, lists: ['A', 'B'] })], { 1: { lists: [0] } });
        expect(out.changes).toEqual([other, change({ projectId: P_OPEN, lists: ['A'] })]);
    });

    it('holds a rollup to the field it reads', () => {
        const params = { projectId: P_OPEN, definitions: [{ name: 'Cost', type: 'number' }, { name: 'Total cost', type: 'rollup', function: 'sum', source: 'cost' }] };
        expect(planChoice.needsOf(params)).toEqual({ 'fields:1': ['fields:0'] });
        expect(planChoice.narrow([change(params)], { 0: { fields: [1] } }).error).toBe('The field "Total cost" needs the field "Cost", which is left out. Keep both, or leave both out.');
    });
});
