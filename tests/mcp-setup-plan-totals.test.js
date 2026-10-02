/* Task 047, slice AI-1, job 13: a rollup or a formula field and the view that shows it are asked for as one plan,
   which a person approves once. Each part is held to what a call of its own is held to. */
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
const planFiling = require('../Modules/Agents/planFiling');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, L_OPEN, T_OPEN, TOKEN, FLAGS, ctx, settle } = world;
const { seed, rows, stored, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const TOOL = 'project.setup';
const GRANT = 'tasks:manage';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const V_LIST = '6f0000000000000000000e11';
const COST = '6f0000000000000000000f02';
const CLIENT_NAME = '6f0000000000000000000f03';
const SUB_1 = '6f0000000000000000000d11';
const SUB_2 = '6f0000000000000000000d12';
const COST_TOTAL = { name: 'Cost total', type: 'rollup', function: 'sum', source: 'Cost' };
const WITH_TAX = { name: 'Cost with tax', type: 'formula', expression: '{Cost} * 1.2' };
const TOTALS_VIEW = { name: 'Cost by status', groupBy: 'status', showFieldIds: [COST], showFields: ['Cost total'] };
const PLAN = { projectId: P_OPEN, fields: [COST_TOTAL, WITH_TAX], views: [TOTALS_VIEW], reason: 'Totals of Cost, for each group and on each parent' };
const FIELD_KEYS = ['project_custom_field', 'task_custom_field'];

const view = (_id, keyName, title) => ({ _id, id: _id, keyName, name: title, value: title, title, icon: `${title}.svg`, activeIcon: `${title}-on.svg`, sortIndex: 1, viewStatus: true });
const project = () => stored(SCHEMA_TYPE.PROJECTS, P_OPEN);
const fieldNamed = (name) => rows(SCHEMA_TYPE.CUSTOM_FIELDS).find((field) => field.fieldTitle === name);
const idOfField = (name) => String(fieldNamed(name)._id);
const liveFields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete !== false).map((field) => field.fieldTitle);
const viewNamed = (title) => project().ProjectRequiredComponent.find((entry) => entry.title === title);
const viewTitles = () => project().ProjectRequiredComponent.map((entry) => entry.title);
const valueOn = (taskId, name) => ((stored(SCHEMA_TYPE.TASKS, taskId).customField || {})[idOfField(name)] || {}).fieldValue;
const proposal = (id) => stored(SCHEMA_TYPE.AGENT_PROPOSALS, id);
const paramsOf = (id) => JSON.parse(JSON.stringify(proposal(id).changes[0].params));
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.TASKS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER, parts = undefined) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '', ...(parts ? { parts } : {}) });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid) => {
    const base = ctx(uid);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants: [GRANT] } };
};
const ask = (plan, uid = INSIDER) => rpc(as(uid), TOOL, { projectId: P_OPEN, ...plan });
const filed = async (plan = PLAN, uid = INSIDER) => {
    const out = await rpc(as(uid), TOOL, plan);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const previewOf = async (id, uid = OWNER) => (await intentPreview.forProposals(CID, uid, [proposal(id)])).get(String(id))[0];
const toolNamed = async (name) => (await server.handleRpc(as(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((tool) => tool.name === name);
const seedField = (_id, fieldTitle, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle, fieldType, type: 'task', global: false, projectId: [P_OPEN], isDelete: true, ...extra });

beforeEach(() => {
    const made = seed();
    process.env.MCP_TOOLS_MANAGE = 'on';
    process.env.MCP_TOOLS_DATA = 'on';
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    ['project_custom_field', 'view_list'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    ['task_custom_field', 'project_details'].forEach((key) => setRule(key, false, [0]));
    project().ProjectRequiredComponent = [view(V_LIST, 'ProjectListView', 'List')];
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: [GRANT], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    seedField(COST, 'Cost', 'number');
    seedField(CLIENT_NAME, 'Client', 'text');
    stored(SCHEMA_TYPE.TASKS, T_OPEN).subTasks = 2;
    made.seedTask(SUB_1, 'First part', P_OPEN, L_OPEN, { ParentTaskId: T_OPEN, isParentTask: false, customField: { [COST]: { fieldValue: '100' } } });
    made.seedTask(SUB_2, 'Second part', P_OPEN, L_OPEN, { ParentTaskId: T_OPEN, isParentTask: false, customField: { [COST]: { fieldValue: '250' } } });
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('asking for a rollup, a formula and the view that shows them', () => {
    it('is one call that files one plan, and makes none of them', async () => {
        const before = everythingNow();
        const id = await filed();

        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
        expect(proposal(id).changes).toHaveLength(1);
        expect(proposal(id).changes[0].action).toBe(TOOL);
        expect(paramsOf(id)).toEqual({
            projectId: P_OPEN,
            definitions: [COST_TOTAL, WITH_TAX],
            views: [{ name: 'Cost by status', kind: 'list', look: { groupBy: 'status', showFieldIds: [COST] }, showFields: ['Cost total'] }],
        });
    });

    it('says at once what a rollup or a formula lacks, and files nothing', async () => {
        const refused = async (field, why) => expect((await ask({ fields: [field], views: [TOTALS_VIEW] })).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(why) });
        await refused({ name: 'Cost total', type: 'rollup', source: 'Cost' }, /needs a function/);
        await refused({ name: 'Cost total', type: 'rollup', function: 'sum' }, /needs a source/);
        await refused({ name: 'Cost total', type: 'rollup', function: 'median', source: 'Cost' }, /function/);
        await refused({ name: 'Cost total', type: 'formula' }, /needs an expression/);
        await refused({ name: 'Cost total', type: 'formula', expression: '{Cost} +' }, /cannot be understood/);
        expect(waiting()).toHaveLength(0);
    });

    it('answers at once a rollup of a field that is not there or is not a number, and a formula that closes a circle', async () => {
        const answered = async (field, why) => expect(await ask({ fields: [field], views: [{ name: 'Costs', showFieldIds: [COST] }] })).toMatchObject({ ok: false, error: expect.stringMatching(why) });
        await answered({ ...COST_TOTAL, source: 'Budget' }, /fields\[0\] \(Cost total\).*"Budget".*not a field/);
        await answered({ ...COST_TOTAL, source: 'Client' }, /"Client".*not a number field/);
        seedField('6f0000000000000000000f04', 'Net', 'formula', { formulaExpression: '{gross} - 1' });
        await answered({ name: 'Gross', type: 'formula', expression: '{net} + 1' }, /depend on each other/);
        expect(waiting()).toHaveLength(0);
    });

    it('is asked the same on the road a workspace agent files a plan by', async () => {
        const stopped = (fields) => planFiling.stoppedFor({ companyId: CID, actor: { kind: 'agent', userId: INSIDER }, uid: INSIDER, allowedActions: [], action: TOOL, params: { projectId: P_OPEN, fields } });
        expect(await stopped([{ ...COST_TOTAL, source: 'Client' }])).toEqual({ error: expect.stringMatching(/"Client".*not a number field/) });
        expect(await stopped([COST_TOTAL, WITH_TAX])).toBeNull();
    });

    it('is refused for a person whose role may not make a field, whatever the kind of field', async () => {
        FIELD_KEYS.forEach((key) => setRule(key, false, [3, 0]));
        expect(await ask({ fields: [COST_TOTAL], views: [TOTALS_VIEW] }, OUTSIDER)).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: .*fields \(/) });
        expect(waiting()).toHaveLength(0);
    });

    it('still keeps a rollup and a formula out of a project that is not there yet', async () => {
        for (const [field, why] of [[{ name: 'Parts', type: 'rollup' }, /fields\[0\]\.type must be one of/], [{ name: 'Parts', type: 'number', function: 'count' }, /fields\[0\]\.function is not an argument/]]) {
            expect((await rpc(as(OWNER), 'project.create', { name: 'Client work', fields: [field] })).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(why) });
        }
        expect(waiting()).toHaveLength(0);
    });
});

describe('the card of the plan', () => {
    it('gives each field and the view a line of its own, and says the view needs the rollup it shows', async () => {
        const preview = await previewOf(await filed());
        expect(preview).toMatchObject({ kind: 'setup', title: 'Open' });
        expect(preview.lines).toEqual([
            { kind: 'place', project: 'Open', list: '' },
            { kind: 'computedField', name: 'Cost total', type: 'rollup', function: 'sum', source: 'Cost', pick: 'fields:0' },
            { kind: 'computedField', name: 'Cost with tax', type: 'formula', expression: '{Cost} * 1.2', pick: 'fields:1' },
            { kind: 'planView', name: 'Cost by status', layout: 'list', pick: 'views:0' },
            { kind: 'group', by: 'status', field: '', under: 'views:0' },
            { kind: 'columns', names: ['Cost', 'Cost total'], others: 0, under: 'views:0' },
        ]);
        expect(preview.needs).toEqual({ 'views:0': ['fields:0'] });
        expect(preview.locked).toBeUndefined();
        expect(preview.blank).toBeUndefined();
    });

    it('is not there for a viewer who cannot open the project', async () => {
        project().isPrivateSpace = true;
        project().AssigneeUserId = [INSIDER];
        const id = await filed();
        expect(await previewOf(id, OUTSIDER)).toBeNull();
        expect(await previewOf(id, INSIDER)).toMatchObject({ kind: 'setup' });
    });
});

describe('the parts a person may not approve', () => {
    it('marks both fields for a person whose role may not make a field, and holds the view that shows one of them', async () => {
        const id = await filed();
        FIELD_KEYS.forEach((key) => setRule(key, false, [3]));

        expect(await previewOf(id, INSIDER)).toMatchObject({ locked: ['fields:0', 'fields:1'], lockedWhy: { 'fields:0': 'own_rights', 'fields:1': 'own_rights' }, needs: { 'views:0': ['fields:0'] } });
        expect((await previewOf(id, OWNER)).locked).toBeUndefined();
        expect(await approve(id, INSIDER)).toMatchObject({ status: 403, reason: 'not_permitted', why: 'own_rights' });
        expect(await approve(id, INSIDER, { 0: { fields: [], views: [0] } })).toMatchObject({ status: 400, error: expect.stringMatching(/The view "Cost by status" needs the field "Cost total"/) });
        expect(proposal(id).status).toBe('pending');
        expect(liveFields()).toEqual(['Cost', 'Client']);
        expect(viewTitles()).toEqual(['List']);
    });

    it('marks the view for a person whose role may not add a view, and leaves the fields to them', async () => {
        const id = await filed();
        const { views } = paramsOf(id);
        ['view_list', 'project_details'].forEach((key) => setRule(key, false, [3]));

        expect(await previewOf(id, INSIDER)).toMatchObject({ locked: ['views:0'], lockedWhy: { 'views:0': 'own_rights' } });
        const out = await approve(id, INSIDER, { 0: { fields: [0, 1], views: [] } });
        expect(out.error).toBeUndefined();
        expect(liveFields()).toEqual(['Cost', 'Client', 'Cost total', 'Cost with tax']);
        expect(viewTitles()).toEqual(['List']);
        const madeIds = [...views[0].look.showFieldIds, idOfField('Cost total')];
        const waitingView = { kind: views[0].kind, name: views[0].name, look: { ...views[0].look, showFieldIds: madeIds } };
        expect(paramsOf(out.left.waiting[0])).toEqual({ projectId: P_OPEN, views: [waitingView] });
    });

    it('keeps a locked rollup waiting for someone whose role may make it, who then makes it once', async () => {
        const id = await filed({ projectId: P_OPEN, fields: [COST_TOTAL], views: [{ name: 'Costs', showFieldIds: [COST] }] }, OWNER);
        FIELD_KEYS.forEach((key) => setRule(key, false, [3]));

        const out = await approve(id, INSIDER, { 0: { fields: [], views: [0] } });
        expect(out.error).toBeUndefined();
        expect(viewTitles()).toEqual(['List', 'Costs']);
        expect(fieldNamed('Cost total')).toBeUndefined();
        const [left] = out.left.waiting;
        expect(paramsOf(left)).toEqual({ projectId: P_OPEN, definitions: [COST_TOTAL] });

        expect((await approve(left, OWNER)).error).toBeUndefined();
        expect(valueOn(T_OPEN, 'Cost total')).toBe(350);
        expect(viewTitles()).toEqual(['List', 'Costs']);
    });
});

describe('one approval', () => {
    it('makes the rollup, the formula and the view, and the rollup holds its number at once', async () => {
        const id = await filed();
        const out = await approve(id);

        expect(out.error).toBeUndefined();
        expect(out.applied).toHaveLength(1);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { projectId: P_OPEN, made: 3, notMade: [] } });
        expect(out.applied[0].result.parts.map((part) => [part.part, part.ok])).toEqual([['fields', true], ['views', true]]);
        expect(fieldNamed('Cost total')).toMatchObject({ fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: COST, projectId: [P_OPEN], global: false, userId: INSIDER });
        expect(fieldNamed('Cost with tax')).toMatchObject({ fieldType: 'formula', formulaExpression: '{Cost} * 1.2', projectId: [P_OPEN] });
        expect(valueOn(T_OPEN, 'Cost total')).toBe(350);

        const made = viewNamed('Cost by status');
        expect(made).toMatchObject({ keyName: 'ProjectListView' });
        expect(made.settings.groupBy).toBe(0);
        expect(made.settings.columns.shown).toEqual([`cf:${COST}`, `cf:${idOfField('Cost total')}`].sort());
        expect(out.applied[0].result.parts[1].items).toEqual([{ name: 'Cost by status', kind: 'list', made: true, viewId: String(made._id), leftOut: [] }]);
        expect(proposal(id)).toMatchObject({ status: 'approved', decidedBy: OWNER });
        expect(waiting()).toHaveLength(0);
    });

    it('is asked of the approver for each part: a guest approves none of it', async () => {
        const id = await filed();
        expect((await approve(id, GUEST)).error).toBeTruthy();
        expect(liveFields()).toEqual(['Cost', 'Client']);
        expect(viewTitles()).toEqual(['List']);
        expect(proposal(id).status).toBe('pending');
    });

    it('is taken back whole by one undo, and the field people typed into stays', async () => {
        const id = await filed();
        await approve(id);
        const out = await undo(id);

        expect(out.error).toBeUndefined();
        expect(out.results[0].result).toMatchObject({ removed: { views: ['Cost by status'], fields: ['Cost total', 'Cost with tax'], lists: [], statuses: [] }, kept: [] });
        expect(liveFields()).toEqual(['Cost', 'Client']);
        expect(viewTitles()).toEqual(['List']);
        expect(valueOn(SUB_1, 'Cost')).toBe('100');
        expect(proposal(id).status).toBe('undone');
    });
});

describe('what the agent is told', () => {
    it('the plan takes a rollup and a formula, and asks for one plan where a request needs several parts', async () => {
        const plan = await toolNamed(TOOL);
        expect(plan.inputSchema.properties.fields.items.properties.type.enum).toEqual(expect.arrayContaining(['number', 'rollup', 'formula']));
        expect(Object.keys(plan.inputSchema.properties.fields.items.properties)).toEqual(expect.arrayContaining(['function', 'source', 'expression']));
        expect(plan.description).toMatch(/a rollup or a formula included/);
        expect(plan.description).toMatch(/send them as one plan here, not as a call for each: the person then approves once/);
    });

    it('the tool for fields and the tool for a view each point to the plan', async () => {
        for (const name of ['fields.create', 'view.create']) {
            expect((await toolNamed(name)).description).toMatch(/use project\.setup: it files them as one plan, which the person approves once/);
        }
        expect((await toolNamed('view.create')).description).toMatch(/totals each number column it shows, group by group/);
    });
});
