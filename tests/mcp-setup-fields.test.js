/* Task 047, AI-3 (fields): a connected agent adds custom fields to a project. Every call waits for a person,
   and once approved it runs the field form's own route as the person behind the token and no further. */
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
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const fieldCtrl = require('../Modules/CustomField/controller');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, T_OPEN, TOKEN, MISSING, BEFORE, FLAGS, GRANT_ID, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough, seedGrant } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/CustomField/routes').init));

const TOOL = 'fields.create';
const KEYS = ['project.project_custom_field', 'task.task_custom_field'];
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const FIVE = [
    { name: 'Budget', type: 'money' },
    { name: 'Client', type: 'text' },
    { name: 'Region', type: 'dropdown', options: ['North', ' north ', 'South\u0007', 'East', ''.padEnd(90, 'x')] },
    { name: 'Rating', type: 'rating' },
    { name: 'Owner', type: 'people' },
];

const fields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS);
const fieldNamed = (name) => fields().find((field) => field.fieldTitle === name);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([fields(), mockDb.store[SCHEMA_TYPE.PROJECTS], mockDb.store[SCHEMA_TYPE.TASKS]]);
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const formField = (name, uid, projectId = P_OPEN) => ({
    type: 'save',
    updateObject: { fieldTitle: name, fieldDescription: name, fieldType: 'text', global: false, projectId: [projectId], type: 'task', isDelete: true, userId: uid },
});
const filed = async (caller, args) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};

beforeEach(() => {
    seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_custom_field', name: 'project_custom_field', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    setRule('task_custom_field', false, [0]);
    [OWNER, INSIDER, OUTSIDER, GUEST].forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: TOKEN.replace(/.$/, String([OWNER, INSIDER, OUTSIDER, GUEST].indexOf(userId) + 1)), userId, active: true, scopes: ['read', 'write'], grants: ['tasks:manage'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

/* Each person's own token, so approval finds the token the proposal was filed with. */
const as = (uid, over = {}) => {
    const id = TOKEN.replace(/.$/, String([OWNER, INSIDER, OUTSIDER, GUEST].indexOf(uid) + 1));
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: id }, token: { ...base.token, _id: id, grants: ['tasks:manage'] } };
};

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: FIVE })).rpcError).toMatchObject({ code: -32601 });
        expect(fields()).toHaveLength(0);
    });

    it('on, it is a rated registry action held to the keys the field route asks for, under the manage grant', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: KEYS[0], anyOf: KEYS, write: true }]);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'medium', undoable: true, write: true, proposeOnly: true });
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:manage');
        expect(tools.registered().find((tool) => tool.name === TOOL).grant).toBe('tasks:manage');
    });
});

describe('a field is never made before a person has seen it', () => {
    it('files five fields named in one call as one proposal with one change, and makes none', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: FIVE, reason: 'Track the commercial side' });
        expect(fields()).toHaveLength(0);
        expect(waiting()).toHaveLength(1);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toHaveLength(1);
        expect(proposal.changes[0]).toMatchObject({ action: TOOL, reversible: true, params: { projectId: P_OPEN } });
        expect(proposal.changes[0].params.definitions).toEqual([
            { name: 'Budget', type: 'money' },
            { name: 'Client', type: 'text' },
            { name: 'Region', type: 'dropdown', options: ['North', 'South', 'East', ''.padEnd(60, 'x')] },
            { name: 'Rating', type: 'rating' },
            { name: 'Owner', type: 'people' },
        ]);
    });

    it('is held by the project\'s rule for agents whatever the project is set to, until a person approves', async () => {
        const actor = as(INSIDER).actor;
        const params = { projectId: P_OPEN, definitions: [{ name: 'Budget', type: 'money' }] };
        expect((await projectPolicy.read(CID, P_OPEN)).connected).toBe(projectPolicy.CONNECTED.SINGLE_TASK);
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        expect(await projectPolicy.ask({ companyId: CID, actor: { kind: 'agent', userId: INSIDER, agentName: 'Workspace agent' }, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params, approved: true })).toEqual({ decision: 'act', reason: '' });
        expect(await projectPolicy.ask({ companyId: CID, actor: human(INSIDER), action: TOOL, params })).toEqual({ decision: 'act', reason: '' });
    });

    it('cannot be run directly, with or without the mark of a proposal', async () => {
        const call = (params) => actions.perform({ companyId: CID, actor: as(OWNER).actor, action: TOOL, params, reason: 'direct' });
        await expect(call({ projectId: P_OPEN, definitions: [{ name: 'Budget', type: 'money' }] })).rejects.toThrow(/needs a person's approval first/);
        await expect(call({ projectId: P_OPEN, definitions: [{ name: 'Budget', type: 'money' }], __proposal: true })).rejects.toThrow(/waits for a person's approval/);
        expect(fields()).toHaveLength(0);
    });
});

describe('who may ask for a field', () => {
    it('files for an owner and for a member who holds the field permission', async () => {
        await filed(as(OWNER), { projectId: P_OPEN, fields: [{ name: 'Budget', type: 'money' }] });
        await filed(as(OUTSIDER), { projectId: P_OPEN, fields: [{ name: 'Client', type: 'text' }] });
        await filed(as(INSIDER), { projectId: P_PRIVATE, fields: [{ name: 'Client', type: 'text' }] });
        expect(waiting()).toHaveLength(3);
    });

    it('refuses a member and a guest the field form refuses, and files nothing', async () => {
        setRule('project_custom_field', false, [3, 0]);
        setRule('task_custom_field', false, [3, 0]);
        const before = everythingNow();
        for (const uid of [OUTSIDER, GUEST]) {
            expect((await web('POST /api/v1/customField', uid, { body: formField('By hand', uid) })).code).toBe(403);
            expect(await rpc(as(uid), TOOL, { projectId: P_OPEN, fields: FIVE })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: project\.project_custom_field/) });
        }
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
    });

    it('takes either key the field form takes', async () => {
        setRule('project_custom_field', false, [3, 0]);
        expect((await web('POST /api/v1/customField', OUTSIDER, { body: formField('By hand', OUTSIDER) })).code).toBe(200);
        await filed(as(OUTSIDER), { projectId: P_OPEN, fields: [{ name: 'Client', type: 'text' }] });
    });

    it('answers a project the person cannot open, and one outside a narrowed token, as a missing project', async () => {
        const args = (projectId) => ({ projectId, fields: [{ name: 'Client', type: 'text' }] });
        expect(await rpc(as(OWNER), TOOL, args(MISSING))).toMatchObject({ refused: true, reason: NO_PROJECT });
        for (const [uid, projectId] of [[OUTSIDER, P_PRIVATE], [GUEST, P_PRIVATE], [OWNER, P_PERSONAL]]) {
            expect(await rpc(as(uid), TOOL, args(projectId))).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc({ ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds }, TOOL, args(P_PRIVATE))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(readOnly(OWNER), TOOL, args(P_OPEN))).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(waiting()).toHaveLength(0);
    });

    it('files for an outside client only under the manage scope its person granted, which approval asks again', async () => {
        const args = { projectId: P_OPEN, fields: [{ name: 'Client', type: 'text' }] };
        expect(await rpc(outside(INSIDER, ['tasks:write']), TOOL, args)).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        expect(waiting()).toHaveLength(0);
        const scopesHeld = ['tasks:read', 'tasks:write', 'tasks:manage'];
        const grant = seedGrant(INSIDER, scopesHeld);
        const id = await filed(outside(INSIDER, scopesHeld), args);
        expect(waiting()[0]).toMatchObject({ requestedBy: INSIDER, oauthGrantId: GRANT_ID });
        grant.revokedAt = new Date();
        expect(await approve(id)).toMatchObject({ error: expect.stringMatching(/revoked/) });
        grant.revokedAt = null;
        expect((await approve(id)).applied[0]).toMatchObject({ ok: true, result: { made: 1 } });
        expect(fieldNamed('Client')).toMatchObject({ projectId: [P_OPEN], userId: INSIDER });
    });

    it('takes only the types the field form offers, and says what is wrong with each field', async () => {
        const wrong = await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: [{ name: 'Total', type: 'formula' }] });
        expect(wrong.rpcError).toMatchObject({ code: -32602 });
        const each = await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: [{ name: 'Region', type: 'dropdown' }, { name: 'Client', type: 'text' }, { name: ' client ', type: 'text' }, { name: 'Stage', type: 'dropdown', options: ['  '] }] });
        expect(each.rpcError.code).toBe(-32602);
        expect(each.rpcError.message).toMatch(/fields\[0\] \(Region\).*option/);
        expect(each.rpcError.message).toMatch(/fields\[3\] \(Stage\).*option/);
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: [{ name: 'Client', type: 'text' }, { name: ' client ', type: 'text' }] })).rpcError.message).toMatch(/named twice/);
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: Array.from({ length: 11 }, (v, at) => ({ name: `F${at}`, type: 'text' })) })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: [{ name: 'Client', type: 'text', global: true }] })).rpcError).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving makes the fields the field form would make', () => {
    it('stores each one for that project alone, as the form stores it, and says which were made', async () => {
        expect((await web('POST /api/v1/customField', INSIDER, { body: formField('By hand', INSIDER) })).code).toBe(200);
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: FIVE });
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied).toHaveLength(1);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { projectId: P_OPEN, made: 5 } });
        expect(out.applied[0].result.fields.map((field) => [field.name, field.type, field.made])).toEqual(FIVE.map((field) => [field.name, field.type, true]));
        expect(fields().map((field) => field.fieldTitle)).toEqual(['By hand', 'Budget', 'Client', 'Region', 'Rating', 'Owner']);

        const client = fieldNamed('Client');
        const byHand = fieldNamed('By hand');
        ['global', 'projectId', 'type', 'isDelete', 'userId', 'fieldType'].forEach((key) => expect(client[key]).toEqual(byHand[key]));
        expect(client).toMatchObject({ global: false, projectId: [P_OPEN], type: 'task', isDelete: true, userId: INSIDER });
        expect(fieldNamed('Region').fieldOptions.map((option) => option.label)).toEqual(['North', 'South', 'East', ''.padEnd(60, 'x')]);
        expect(fieldNamed('Rating').fieldRatingMax).toBe(5);
        expect(out.applied[0].result.fields.map((field) => field.fieldId)).toEqual(FIVE.map((field) => String(fieldNamed(field.name)._id)));
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: P_OPEN, meta: { onBehalfOf: INSIDER, undo: { kind: 'fields', projectId: P_OPEN } } });
    });

    it('keeps a field the project already has by that name, and makes only the others', async () => {
        await web('POST /api/v1/customField', INSIDER, { body: formField('Client', INSIDER) });
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: [{ name: ' client', type: 'textarea' }, { name: 'Budget', type: 'money' }] });
        const { applied } = await approve(id);
        expect(applied[0].result).toMatchObject({ made: 1, fields: [{ name: 'Client', type: 'text', made: false, fieldId: String(fieldNamed('Client')._id) }, { name: 'Budget', made: true }] });
        expect(fields().filter((field) => /client/i.test(field.fieldTitle))).toHaveLength(1);
        expect(audits(TOOL, 'applied')[0].meta.undo.fieldIds).toEqual([String(fieldNamed('Budget')._id)]);
    });

    it('reports a field that could not be saved by name, and keeps the ones that were', async () => {
        const save = fieldCtrl.insertCustomFieldPromise;
        jest.spyOn(fieldCtrl, 'insertCustomFieldPromise').mockImplementation((definition, ...rest) => (definition.fieldTitle === 'Client' ? Promise.reject(new Error('disk full')) : save(definition, ...rest)));
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: [{ name: 'Budget', type: 'money' }, { name: 'Client', type: 'text' }, { name: 'Stage', type: 'dropdown', options: ['Lead', 'Won'] }] });
        const { applied } = await approve(id);
        expect(applied[0].ok).toBe(true);
        expect(applied[0].result.made).toBe(2);
        expect(applied[0].result.fields.map((field) => [field.name, field.made, Boolean(field.error)])).toEqual([['Budget', true, false], ['Client', false, true], ['Stage', true, false]]);
        expect(fields().map((field) => field.fieldTitle)).toEqual(['Budget', 'Stage']);
    });

    it('asks the person behind the token and the approver again, and makes nothing for either who may not', async () => {
        const id = await filed(as(OUTSIDER), { projectId: P_OPEN, fields: [{ name: 'Client', type: 'text' }] });
        expect(await approve(id, GUEST)).toMatchObject({ error: expect.stringMatching(/approver may not/i) });
        setRule('project_custom_field', false, [3]);
        setRule('task_custom_field', false, [3]);
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(fields()).toHaveLength(0);
    });
});

describe('undo takes back exactly the fields that were made', () => {
    it('switches each one off as the field form does, and leaves every other field alone', async () => {
        await web('POST /api/v1/customField', INSIDER, { body: formField('By hand', INSIDER) });
        await web('POST /api/v1/customField', INSIDER, { body: formField('Client', INSIDER) });
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: FIVE });
        await approve(id);
        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, kept: [] } });
        expect(out.results[0].result.removed.map((field) => field.name)).toEqual(['Budget', 'Region', 'Rating', 'Owner']);
        expect(fields().filter((field) => field.isDelete === false).map((field) => field.fieldTitle)).toEqual(['Budget', 'Region', 'Rating', 'Owner']);
        expect(fieldNamed('By hand').isDelete).toBe(true);
        expect(fieldNamed('Client').isDelete).toBe(true);
    });

    it('leaves a field that holds a value on a task, or that is on another project now, and says so', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: [{ name: 'Budget', type: 'money' }, { name: 'Client', type: 'text' }, { name: 'Stage', type: 'dropdown', options: ['Lead'] }] });
        await approve(id);
        stored(SCHEMA_TYPE.TASKS, T_OPEN).customField = { [String(fieldNamed('Budget')._id)]: { fieldValue: '1200' } };
        fieldNamed('Client').projectId.push(P_PRIVATE);
        const out = await undo(id);
        expect(out.results[0].result.removed.map((field) => field.name)).toEqual(['Stage']);
        expect(out.results[0].result.kept.map((field) => [field.name, field.reason])).toEqual([
            ['Budget', expect.stringMatching(/holds a value/)],
            ['Client', expect.stringMatching(/other projects/)],
        ]);
        expect(fieldNamed('Budget').isDelete).toBe(true);
        expect(fieldNamed('Client').isDelete).toBe(true);
        expect(stored(SCHEMA_TYPE.TASKS, T_OPEN).customField[String(fieldNamed('Budget')._id)]).toEqual({ fieldValue: '1200' });
        expect(fieldNamed('Stage').isDelete).toBe(false);
    });
});
