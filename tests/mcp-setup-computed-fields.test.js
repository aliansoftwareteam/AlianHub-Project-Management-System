/* Task 047, job 13: a connected agent asks for a rollup or a formula field. It waits for a person like every
   field, is saved by the field form's own route, and the number it works out is there to read afterwards. */
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
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, T_OPEN, TOKEN, FLAGS, ctx, narrowed, routeTable, asPerson, settle } = world;
const { seed, rows, stored, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const web = asPerson(routeTable(require('../Modules/CustomField/routes').init));

const TOOL = 'fields.create';
const GRANT = 'tasks:manage';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const COST = '6f0000000000000000000f02';
const CLIENT_NAME = '6f0000000000000000000f03';
const SUB_1 = '6f0000000000000000000d11';
const SUB_2 = '6f0000000000000000000d12';
const COST_TOTAL = { name: 'Cost total', type: 'rollup', function: 'sum', source: 'Cost' };
const MARGIN = { name: 'Margin', type: 'formula', expression: '{Price} - {Cost}' };

const fields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS);
const fieldNamed = (name) => fields().find((field) => field.fieldTitle === name);
const idOfField = (name) => String(fieldNamed(name)._id);
const valueOn = (taskId, name) => ((stored(SCHEMA_TYPE.TASKS, taskId).customField || {})[idOfField(name)] || {}).fieldValue;
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants: [GRANT] } };
};
const ask = (caller, list, more = {}) => rpc(caller, TOOL, { projectId: P_OPEN, fields: list, ...more });
const filed = async (caller, list, more = {}) => {
    const out = await ask(caller, list, more);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const madeBy = (out) => out.applied[0].result.fields.map((field) => [field.name, field.made]);
const seedField = (_id, fieldTitle, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle, fieldType, type: 'task', global: false, projectId: [P_OPEN], isDelete: true, ...extra });

beforeEach(() => {
    const made = seed();
    process.env.MCP_TOOLS_MANAGE = 'on';
    process.env.MCP_TOOLS_DATA = 'on';
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_custom_field', name: 'project_custom_field', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    setRule('task_custom_field', false, [0]);
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: [GRANT], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    seedField(COST, 'Cost', 'number');
    seedField(CLIENT_NAME, 'Client', 'text');
    stored(SCHEMA_TYPE.TASKS, T_OPEN).subTasks = 2;
    made.seedTask(SUB_1, 'First part', P_OPEN, L_OPEN, { ParentTaskId: T_OPEN, isParentTask: false, customField: { [COST]: { fieldValue: '100' } } });
    made.seedTask(SUB_2, 'Second part', P_OPEN, L_OPEN, { ParentTaskId: T_OPEN, isParentTask: false, customField: { [COST]: { fieldValue: '250' } } });
    Object.keys(mockElsewhere.store).forEach((type) => { mockElsewhere.store[type].length = 0; });
    mockElsewhere.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('asking for a rollup or a formula', () => {
    it('files both as one proposal that says what each works out, and makes neither', async () => {
        const id = await filed(as(INSIDER), [{ ...COST_TOTAL, source: ' cost ' }, MARGIN, { name: 'Parts', type: 'rollup', function: 'count' }]);
        expect(fields()).toHaveLength(2);
        expect(waiting()).toHaveLength(1);
        expect(String(waiting()[0]._id)).toBe(id);
        expect(waiting()[0].changes[0].params.definitions).toEqual([
            { name: 'Cost total', type: 'rollup', function: 'sum', source: 'cost' },
            MARGIN,
            { name: 'Parts', type: 'rollup', function: 'count' },
        ]);
    });

    it('says at once what a rollup or a formula lacks, and files nothing', async () => {
        const refused = async (field, why) => expect((await ask(as(OWNER), [field])).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(why) });
        await refused({ name: 'Cost total', type: 'rollup', source: 'Cost' }, /needs a function/);
        await refused({ name: 'Cost total', type: 'rollup', function: 'sum' }, /needs a source/);
        await refused({ name: 'Cost total', type: 'rollup', function: 'median', source: 'Cost' }, /function/);
        await refused({ name: 'Margin', type: 'formula' }, /needs an expression/);
        await refused({ name: 'Margin', type: 'formula', expression: '{Cost} +' }, /cannot be understood/);
        await refused({ name: 'Margin', type: 'formula', expression: 'process.exit(1)' }, /cannot be understood/);
        expect(waiting()).toHaveLength(0);
    });

    it('answers at once a rollup of a field that is not there or is not a number, and a formula that closes a circle', async () => {
        expect(await ask(as(OWNER), [{ ...COST_TOTAL, source: 'Budget' }])).toMatchObject({ ok: false, error: expect.stringMatching(/fields\[0\] \(Cost total\).*"Budget".*not a field/) });
        expect(await ask(as(OWNER), [{ ...COST_TOTAL, source: 'Client' }])).toMatchObject({ ok: false, error: expect.stringMatching(/"Client".*not a number field/) });
        seedField('6f0000000000000000000f04', 'Net', 'formula', { formulaExpression: '{gross} - 1' });
        expect(await ask(as(OWNER), [{ name: 'Gross', type: 'formula', expression: '{net} + 1' }])).toMatchObject({ ok: false, error: expect.stringMatching(/depend on each other/) });
        expect(waiting()).toHaveLength(0);
        expect(fields()).toHaveLength(3);
    });
});

describe('who may ask for one', () => {
    it('files for an owner and for a member who holds the field permission', async () => {
        await filed(as(OWNER), [COST_TOTAL]);
        await filed(as(OUTSIDER), [MARGIN]);
        expect(waiting()).toHaveLength(2);
    });

    it('refuses a member without the permission and a guest, as the field form does', async () => {
        setRule('project_custom_field', false, [3, 0]);
        setRule('task_custom_field', false, [3, 0]);
        for (const uid of [OUTSIDER, GUEST]) {
            expect(await ask(as(uid), [COST_TOTAL])).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: project\.project_custom_field/) });
        }
        expect(waiting()).toHaveLength(0);
    });

    it('answers a project outside a narrowed token, one the person cannot open and one of another company as a missing project', async () => {
        const out = (caller, projectId) => rpc(caller, TOOL, { projectId, fields: [COST_TOTAL] });
        expect(await out({ ...as(INSIDER), projectIds: narrowed(INSIDER, [P_PRIVATE]).projectIds }, P_OPEN)).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await out(as(OUTSIDER), P_PRIVATE)).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await out(as(OWNER, { companyId: mockOtherCompany }), P_OPEN)).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(waiting()).toHaveLength(0);
        expect(mockElsewhere.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
    });
});

describe('approving makes the field the field form would make', () => {
    it('stores a rollup with its function and the field it reads, also one of the same call named after it', async () => {
        const byHand = { fieldTitle: 'By hand', fieldDescription: '', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: COST, global: false, projectId: [P_OPEN], type: 'task', isDelete: true, userId: INSIDER };
        expect((await web('POST /api/v1/customField', INSIDER, { body: { type: 'save', updateObject: byHand } })).code).toBe(200);
        const id = await filed(as(INSIDER), [COST_TOTAL, { name: 'Hours average', type: 'rollup', function: 'avg', source: 'Hours' }, { name: 'Hours', type: 'number' }, { name: 'Parts', type: 'rollup', function: 'count' }]);
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(madeBy(out)).toEqual([['Cost total', true], ['Hours average', true], ['Hours', true], ['Parts', true]]);
        const total = fieldNamed('Cost total');
        ['fieldType', 'rollupFunction', 'rollupSourceFieldId', 'global', 'projectId', 'type', 'isDelete', 'userId'].forEach((key) => expect(total[key]).toEqual(fieldNamed('By hand')[key]));
        expect(fieldNamed('Hours average')).toMatchObject({ fieldType: 'rollup', rollupFunction: 'avg', rollupSourceFieldId: idOfField('Hours'), projectId: [P_OPEN] });
        expect(fieldNamed('Parts')).toMatchObject({ fieldType: 'rollup', rollupFunction: 'count', rollupSourceFieldId: '' });
    });

    it('stores a formula with its expression, and reports by name one the field form refuses', async () => {
        const id = await filed(as(INSIDER), [MARGIN, { name: 'A', type: 'formula', expression: '{b} + 1' }, { name: 'B', type: 'formula', expression: '{a} + 1' }]);
        const out = await approve(id);
        expect(madeBy(out)).toEqual([['Margin', true], ['A', true], ['B', false]]);
        expect(out.applied[0].result.fields[2].error).toMatch(/depend on each other/);
        expect(fieldNamed('Margin')).toMatchObject({ fieldType: 'formula', formulaExpression: '{Price} - {Cost}', projectId: [P_OPEN], global: false, userId: INSIDER });
        expect(fieldNamed('B')).toBeUndefined();
    });

    it('asks the approver and the person behind the token again, and makes nothing for either who may not', async () => {
        const id = await filed(as(OUTSIDER), [COST_TOTAL]);
        expect(await approve(id, GUEST)).toMatchObject({ error: expect.stringMatching(/approver may not/i) });
        setRule('project_custom_field', false, [3]);
        setRule('task_custom_field', false, [3]);
        expect((await approve(id)).applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(fieldNamed('Cost total')).toBeUndefined();
    });
});

describe('the number is there to read', () => {
    it('a rollup just made holds its number on the task, and task.fields.list reads it with when it was worked out', async () => {
        await approve(await filed(as(INSIDER), [COST_TOTAL]));
        expect(valueOn(T_OPEN, 'Cost total')).toBe(350);
        const read = await rpc(as(INSIDER), 'task.fields.list', { taskId: T_OPEN });
        const total = read.fields.find((field) => field.title === 'Cost total');
        expect(total).toEqual({ fieldId: idOfField('Cost total'), title: 'Cost total', type: 'rollup', value: 350, computed: true, computedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    });

    it('a value set with task.field.set moves the rollup above it', async () => {
        await approve(await filed(as(INSIDER), [COST_TOTAL]));
        expect(await rpc(as(OWNER), 'task.field.set', { taskId: SUB_1, fieldId: COST, value: 50 })).toMatchObject({ ok: true });
        expect(valueOn(T_OPEN, 'Cost total')).toBe(300);
    });

    it('counts the first values the same call sets', async () => {
        const hours = [{ name: 'Hours total', type: 'rollup', function: 'sum', source: 'Hours' }, { name: 'Hours', type: 'number' }];
        const values = [{ taskId: SUB_1, field: 'Hours', value: 3 }, { taskId: SUB_2, field: 'Hours', value: 4 }];
        await approve(await filed(as(INSIDER), hours, { values }));
        expect(valueOn(T_OPEN, 'Hours total')).toBe(7);
        expect((await ask(as(INSIDER), hours, { values: [{ taskId: T_OPEN, field: 'Hours total', value: 9 }] })).error).toMatch(/computed and cannot be set/);
    });
});

describe('undo', () => {
    it('switches a rollup off though tasks hold its number, and leaves the field people typed into', async () => {
        const id = await filed(as(INSIDER), [COST_TOTAL, MARGIN]);
        await approve(id);
        expect(valueOn(T_OPEN, 'Cost total')).toBe(350);
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0].result).toMatchObject({ kept: [], removed: [{ name: 'Cost total' }, { name: 'Margin' }] });
        expect(fieldNamed('Cost total').isDelete).toBe(false);
        expect(fieldNamed('Margin').isDelete).toBe(false);
        expect(fieldNamed('Cost').isDelete).toBe(true);
        expect(valueOn(SUB_1, 'Cost')).toBe('100');
    });
});

describe('the card', () => {
    const cardFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id))[0];

    it('names the function and the field a rollup reads, and a formula by its expression', async () => {
        await filed(as(INSIDER), [COST_TOTAL, MARGIN, { name: 'Parts', type: 'rollup', function: 'count' }, { name: 'Hours', type: 'number' }]);
        const card = await cardFor(OWNER, waiting()[0]);
        expect(card).toMatchObject({ kind: 'fields', title: 'Cost total, Margin, Parts, Hours' });
        expect(card.lines).toEqual([
            { kind: 'place', project: 'Open', list: '' },
            { kind: 'computedField', name: 'Cost total', type: 'rollup', function: 'sum', source: 'Cost' },
            { kind: 'computedField', name: 'Margin', type: 'formula', expression: '{Price} - {Cost}' },
            { kind: 'computedField', name: 'Parts', type: 'rollup', function: 'count', source: '' },
            { kind: 'field', name: 'Hours', type: 'number', options: [] },
        ]);
    });

    it('is not there for a viewer who cannot open the project', async () => {
        seedField('6f0000000000000000000f05', 'Cost', 'number', { projectId: [P_PRIVATE] });
        await rpc(as(INSIDER), TOOL, { projectId: P_PRIVATE, fields: [COST_TOTAL] });
        expect(waiting()).toHaveLength(1);
        expect(await cardFor(OUTSIDER, waiting()[0])).toBeNull();
        expect(await cardFor(INSIDER, waiting()[0])).toMatchObject({ kind: 'fields' });
    });
});
