/* Task 047, AI-3 (fields with their first values): one call names the fields and the values they start with on
   named tasks. It is one proposal and one approval; a value is set only on a task both the person behind the
   token and the approver may edit, and undo puts the values back before it takes the fields away. */
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
const completionStore = require('../Modules/Tasks/helpers/completionStore');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, T_OPEN, T_OPEN_2, T_SECRET, T_PRIVATE, TOKEN, MISSING, FLAGS, ctx, narrowed, routeTable, asPerson, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const web = asPerson(routeTable(require('../Modules/CustomField/routes').init));

const TOOL = 'fields.create';
const GRANT = 'tasks:manage';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const FIELDS = [
    { name: 'Note', type: 'text' },
    { name: 'Cost', type: 'number' },
    { name: 'Stage', type: 'dropdown', options: ['Alpha', 'Beta'] },
    { name: 'Review date', type: 'date' },
    { name: 'Signed off', type: 'checkbox' },
];
const VALUES = [
    { taskId: T_OPEN, field: 'Note', value: 'ok' },
    { taskId: T_OPEN, field: 'cost', value: 120 },
    { taskId: T_OPEN, field: 'Stage', value: 'Beta' },
    { taskId: T_OPEN, field: 'Review date', value: '2026-10-06' },
    { taskId: T_OPEN_2, field: 'Signed off', value: true },
];

const fields = () => rows(SCHEMA_TYPE.CUSTOM_FIELDS);
const fieldNamed = (name) => fields().find((field) => field.fieldTitle === name);
const idOfField = (name) => String(fieldNamed(name)._id);
const valueOn = (taskId, name) => (stored(SCHEMA_TYPE.TASKS, taskId).customField || {})[idOfField(name)];
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([fields(), mockDb.store[SCHEMA_TYPE.TASKS], mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []]);
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, grants = [GRANT]) => {
    const base = ctx(uid);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants } };
};
const filed = async (caller, args) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const formField = (name, uid) => ({
    type: 'save',
    updateObject: { fieldTitle: name, fieldDescription: name, fieldType: 'text', global: false, projectId: [P_OPEN], type: 'task', isDelete: true, userId: uid },
});
const valuesOf = (out) => out.applied[0].result.values.map((value) => [value.taskId, value.field, value.set, value.error || '']);

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_MANAGE = 'on';
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project_custom_field', name: 'project_custom_field', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }] });
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: [GRANT], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    completionStore.recordWork.mockClear();
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('fields and their first values are one proposal', () => {
    it('files them as one change, and makes no field and sets no value', async () => {
        const before = JSON.stringify([fields(), mockDb.store[SCHEMA_TYPE.TASKS]]);
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: FIELDS, values: VALUES, reason: 'Track the review' });
        expect(JSON.stringify([fields(), mockDb.store[SCHEMA_TYPE.TASKS]])).toBe(before);
        expect(waiting()).toHaveLength(1);
        expect(String(waiting()[0]._id)).toBe(id);
        expect(waiting()[0].changes).toHaveLength(1);
        expect(waiting()[0].changes[0].params.values).toEqual(VALUES);
    });

    it('a call that names no value is filed as it was before', async () => {
        await filed(as(INSIDER, []), { projectId: P_OPEN, fields: FIELDS });
        expect(Object.keys(waiting()[0].changes[0].params)).toEqual(['projectId', 'definitions']);
    });

    it('one approval makes the fields and sets each value as the field stores it', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: FIELDS, values: VALUES });
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied).toHaveLength(1);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { projectId: P_OPEN, made: 5 } });
        expect(valuesOf(out)).toEqual([[T_OPEN, 'Note', true, ''], [T_OPEN, 'Cost', true, ''], [T_OPEN, 'Stage', true, ''], [T_OPEN, 'Review date', true, ''], [T_OPEN_2, 'Signed off', true, '']]);
        const beta = fieldNamed('Stage').fieldOptions.find((option) => option.label === 'Beta');
        expect(valueOn(T_OPEN, 'Note').fieldValue).toBe('ok');
        expect(valueOn(T_OPEN, 'Cost').fieldValue).toBe('120');
        expect(valueOn(T_OPEN, 'Stage').fieldValue).toEqual([String(beta.id)]);
        expect(valueOn(T_OPEN, 'Review date').fieldValue).toBe('2026-10-06T00:00:00.000Z');
        expect(valueOn(T_OPEN_2, 'Signed off').fieldValue).toBe(true);
        expect(completionStore.recordWork).toHaveBeenCalledWith(CID, T_OPEN, expect.anything());
        expect(audits(TOOL, 'applied')[0].meta.undo).toMatchObject({ kind: 'fields', projectId: P_OPEN, values: expect.arrayContaining([{ taskId: T_OPEN, fieldId: idOfField('Note'), previous: null }]) });
    });

    it('sets a value in a field the project already had, which is kept and not made twice', async () => {
        await web('POST /api/v1/customField', INSIDER, { body: formField('Client', INSIDER) });
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: [{ name: 'Cost', type: 'number' }], values: [{ taskId: T_OPEN, field: 'Client', value: 'Acme' }, { taskId: T_OPEN, field: 'Cost', value: 7 }] });
        const out = await approve(id);
        expect(out.applied[0].result).toMatchObject({ made: 1 });
        expect(valuesOf(out)).toEqual([[T_OPEN, 'Client', true, ''], [T_OPEN, 'Cost', true, '']]);
        expect(valueOn(T_OPEN, 'Client').fieldValue).toBe('Acme');
    });
});

describe('a value that cannot be set is refused before anybody is asked', () => {
    const one = (value) => ({ projectId: P_OPEN, fields: FIELDS, values: [value] });
    const refusedAtOnce = async (caller, args, message) => {
        const before = everythingNow();
        const out = await rpc(caller, TOOL, args);
        expect(out.pending).toBeUndefined();
        expect([out.error, out.reason, out.rpcError && out.rpcError.message].filter(Boolean).join(' ')).toMatch(message);
        expect(everythingNow()).toBe(before);
    };

    it('a task that is missing, in another project, or one the person cannot open: all answer alike', async () => {
        for (const [uid, taskId] of [[OWNER, MISSING], [OWNER, T_PRIVATE], [OUTSIDER, T_SECRET], [GUEST, T_SECRET]]) {
            await refusedAtOnce(as(uid), one({ taskId, field: 'Note', value: 'x' }), /values\[0\]: That task was not found in this project/);
        }
        await refusedAtOnce({ ...as(INSIDER), projectIds: narrowed(INSIDER, [MISSING]).projectIds }, one({ taskId: T_OPEN, field: 'Note', value: 'x' }), /not_visible/);
    });

    it('a field that is neither in the call nor in the project, and a value the field does not take', async () => {
        await refusedAtOnce(as(OWNER), one({ taskId: T_OPEN, field: 'Budget', value: 1 }), /values\[0\] names "Budget"/);
        await refusedAtOnce(as(OWNER), one({ taskId: T_OPEN, field: 'Stage', value: 'Gamma' }), /values\[0\] \(Stage\) needs one of its options: Alpha, Beta/);
        await refusedAtOnce(as(OWNER), one({ taskId: T_OPEN, field: 'Cost', value: 'lots' }), /values\[0\] \(Cost\) needs a number/);
        await refusedAtOnce(as(OWNER), one({ taskId: T_OPEN, field: 'Note', value: { $set: 1 } }), /values\[0\]/);
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: FIELDS, values: [] })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: FIELDS, values: [{ taskId: T_OPEN, field: 'Note' }] })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, fields: FIELDS, values: [{ taskId: T_OPEN, field: 'Note', value: 'x', fieldId: MISSING }] })).rpcError).toMatchObject({ code: -32602 });
    });

    it('a connection that may not set a field on a task: without the manage grant, with the tool off, or a person without the right', async () => {
        await refusedAtOnce(as(INSIDER, []), one({ taskId: T_OPEN, field: 'Note', value: 'x' }), /task\.field\.set/);
        process.env.MCP_TOOLS_MANAGE = 'off';
        await refusedAtOnce(as(INSIDER), one({ taskId: T_OPEN, field: 'Note', value: 'x' }), /task\.field\.set/);
        process.env.MCP_TOOLS_MANAGE = 'on';
        setRule('task_custom_field', false, [3, 0]);
        await refusedAtOnce(as(INSIDER), one({ taskId: T_OPEN, field: 'Note', value: 'x' }), /permission_denied/);
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving sets a value only where both people may', () => {
    const args = { projectId: P_OPEN, fields: [{ name: 'Note', type: 'text' }], values: [{ taskId: T_OPEN, field: 'Note', value: 'ok' }] };

    it('the person behind the token is asked again: the field is made and the value is not set', async () => {
        const id = await filed(as(INSIDER), args);
        setRule('task_custom_field', false, [3, 0]);
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: true, result: { made: 1 } });
        expect(valuesOf(out)).toEqual([[T_OPEN, 'Note', false, expect.stringMatching(/permission_denied/)]]);
        expect(valueOn(T_OPEN, 'Note')).toBeUndefined();
    });

    it('an approver who may add fields but not edit the task\'s fields gets the field and no value', async () => {
        const id = await filed(as(OWNER), args);
        setRule('task_custom_field', false, [3, 0]);
        const out = await approve(id, OUTSIDER);
        expect(out.error).toBeUndefined();
        expect(valuesOf(out)).toEqual([[T_OPEN, 'Note', false, expect.stringMatching(/person approving may not/)]]);
        expect(valueOn(T_OPEN, 'Note')).toBeUndefined();
    });

    it('an approver who cannot open the task\'s list gets the field and no value, and is not told the task is there', async () => {
        const id = await filed(as(INSIDER), { ...args, values: [{ taskId: T_SECRET, field: 'Note', value: 'ok' }, { taskId: T_OPEN, field: 'Note', value: 'ok' }] });
        const out = await approve(id, OUTSIDER);
        expect(valuesOf(out)).toEqual([[T_SECRET, 'Note', false, 'That task was not found in this project. Check the id.'], [T_OPEN, 'Note', true, '']]);
        expect(valueOn(T_SECRET, 'Note')).toBeUndefined();
        expect(valueOn(T_OPEN, 'Note').fieldValue).toBe('ok');
    });

    it('a task trashed or moved to another project since is left alone', async () => {
        const id = await filed(as(INSIDER), { ...args, values: [{ taskId: T_OPEN, field: 'Note', value: 'ok' }, { taskId: T_OPEN_2, field: 'Note', value: 'ok' }] });
        stored(SCHEMA_TYPE.TASKS, T_OPEN).deletedStatusKey = 1;
        stored(SCHEMA_TYPE.TASKS, T_OPEN_2).ProjectID = world.P_PRIVATE;
        const out = await approve(id);
        expect(valuesOf(out).map((value) => value[2])).toEqual([false, false]);
        expect(stored(SCHEMA_TYPE.TASKS, T_OPEN_2).customField).toEqual({});
    });
});

describe('undo puts the values back, then takes the fields away', () => {
    it('clears what it set, restores what a kept field held, and switches the new fields off', async () => {
        await web('POST /api/v1/customField', INSIDER, { body: formField('Client', INSIDER) });
        const client = idOfField('Client');
        stored(SCHEMA_TYPE.TASKS, T_OPEN).customField = { [client]: { fieldValue: 'Before', _id: client } };
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: [{ name: 'Cost', type: 'number' }], values: [{ taskId: T_OPEN, field: 'Client', value: 'Acme' }, { taskId: T_OPEN, field: 'Cost', value: 7 }, { taskId: T_OPEN_2, field: 'Cost', value: 9 }] });
        await approve(id);
        expect(valueOn(T_OPEN, 'Client').fieldValue).toBe('Acme');

        const out = await undo(id);
        expect(out.error).toBeUndefined();
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, kept: [], values: { restored: 3, kept: [] } } });
        expect(out.results[0].result.removed.map((field) => field.name)).toEqual(['Cost']);
        expect(stored(SCHEMA_TYPE.TASKS, T_OPEN).customField).toEqual({ [client]: { fieldValue: 'Before', _id: client } });
        expect(stored(SCHEMA_TYPE.TASKS, T_OPEN_2).customField).toEqual({});
        expect(fieldNamed('Cost').isDelete).toBe(false);
        expect(fieldNamed('Client').isDelete).toBe(true);
    });

    it('leaves a value on a task the person undoing cannot open, and so the field that holds it, and says why', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, fields: [{ name: 'Cost', type: 'number' }], values: [{ taskId: T_SECRET, field: 'Cost', value: 7 }] });
        await approve(id, INSIDER);
        stored(SCHEMA_TYPE.SPRINTS, world.L_SECRET).AssigneeUserId = [OUTSIDER];
        stored(SCHEMA_TYPE.TASKS, T_SECRET).AssigneeUserId = [];
        const out = await undo(id, INSIDER);
        expect(out.results[0].result.values).toEqual({ restored: 0, kept: [{ field: 'Cost', reason: expect.stringMatching(/cannot open/) }] });
        expect(out.results[0].result.kept).toEqual([expect.objectContaining({ name: 'Cost', reason: expect.stringMatching(/holds a value/) })]);
        expect(valueOn(T_SECRET, 'Cost').fieldValue).toBe('7');
        expect(JSON.stringify(out.results[0].result)).not.toContain(T_SECRET);
    });
});
