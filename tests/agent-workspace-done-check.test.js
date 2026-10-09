/* Task 047: the workspace's agent settings (the allowed modes and "a person checks before Done"), saved by the rule a project's are. */
const mockDb = require('./fixtures/fakeMongo').create();

const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const mockRoles = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async (companyId, uid) => mockRoles[uid]), isPrivileged: (role) => role === 1 || role === 2 }));

const { dbCollections } = require('../Config/collections');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const ctrl = require('../Modules/Agents/controller');
const projectPolicy = require('../Modules/Agents/projectPolicy');

const CID = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000d01';
const TOKEN = '6f0000000000000000000e01';
const MODES = ['workspace', 'personal', 'local'];

const answer = async (handlers, req) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, send(sent) { this.body = sent; return this; }, json(sent) { this.body = sent; return this; }, on() {} };
    const request = { headers: { companyid: CID }, params: {}, query: {}, ip: '1.1.1.1', originalUrl: '/api/v2/agents/policy', url: '/api/v2/agents/policy', ...req };
    for (const handler of [].concat(handlers)) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(request, res, () => { passed = true; });
        if (!passed) break;
    }
    return { code: res.statusCode, body: res.body };
};
const put = (uid, body, extra = {}) => answer(ctrl.setPolicy, { uid, method: 'PUT', body, ...extra });
const get = (uid, extra = {}) => answer(ctrl.getPolicy, { uid, method: 'GET', ...extra });
const audits = (action) => (mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((row) => row.action === action);
const changes = () => audits('agent.workspace_policy_changed');
const announced = () => socketEmitter.emit.mock.calls.filter(([event, sent]) => event === 'update' && sent.module === 'agent' && sent.data.kind === 'policy').map(([, sent]) => sent);
const OFF = { allowedModes: MODES, requireCheckBeforeDone: false };
const ON = { allowedModes: MODES, requireCheckBeforeDone: true };
const company = () => mockDb.store[dbCollections.COMPANIES][0];
const held = () => (company().agentPolicy || {}).requireCheckBeforeDone;
const hold = (requireCheckBeforeDone) => { company().agentPolicy = { requireCheckBeforeDone }; };

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    mockDb.seed(dbCollections.COMPANIES, { _id: CID });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Website', agentPolicy: { done: projectPolicy.DONE.YES } });
});

describe('who may set the workspace\'s check before Done', () => {
    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s turns it on and off, and every project is held to it', async (_who, uid) => {
        expect(await put(uid, { requireCheckBeforeDone: true })).toMatchObject({ code: 200, body: { status: true, data: { requireCheckBeforeDone: true, allowedModes: MODES } } });
        expect(held()).toBe(true);
        expect(await projectPolicy.effective(CID, PROJECT)).toMatchObject({ done: projectPolicy.DONE.NEVER, workspaceChecksBeforeDone: true });

        expect(await put(uid, { requireCheckBeforeDone: false })).toMatchObject({ code: 200, body: { data: { requireCheckBeforeDone: false } } });
        expect(await projectPolicy.effective(CID, PROJECT)).toMatchObject({ done: projectPolicy.DONE.YES, workspaceChecksBeforeDone: false });
    });

    it('records each change with what it was and what it is, and tells the company\'s open clients', async () => {
        await put(ADMIN, { requireCheckBeforeDone: true });
        expect(changes()).toHaveLength(1);
        expect(changes()[0]).toMatchObject({ actorId: ADMIN, entityType: 'company', entityId: CID, ip: '1.1.1.1', meta: { from: OFF, to: ON } });
        expect(announced()).toEqual([expect.objectContaining({ type: 'update', companyId: CID, data: { kind: 'policy' } })]);

        await put(OWNER, { allowedModes: ['workspace'] });
        expect(changes()).toHaveLength(2);
        expect(changes()[1]).toMatchObject({ actorId: OWNER, meta: { from: ON, to: { allowedModes: ['workspace'], requireCheckBeforeDone: true } } });
        expect(announced()).toHaveLength(2);
    });

    it('records and announces nothing for a value it does not take', async () => {
        expect(await put(OWNER, { allowedModes: ['anything'] })).toMatchObject({ code: 400 });
        expect(changes()).toHaveLength(0);
        expect(announced()).toHaveLength(0);
    });

    it('leaves the allowed modes as they were', async () => {
        await put(OWNER, { allowedModes: ['workspace'] });
        expect((await put(OWNER, { requireCheckBeforeDone: true })).body.data).toEqual({ allowedModes: ['workspace'], requireCheckBeforeDone: true, connectedPaused: false });
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('%s is refused, and reads it as it stands', async (_who, uid) => {
        hold(true);
        expect(await put(uid, { requireCheckBeforeDone: false })).toMatchObject({ code: 403, body: { status: false } });
        expect(held()).toBe(true);
        expect(await get(uid)).toMatchObject({ code: 200, body: { data: { requireCheckBeforeDone: true } } });
        expect(changes()).toHaveLength(0);
        expect(announced()).toHaveLength(0);
    });

    it('an API token is refused, whoever holds it, and still reads it', async () => {
        hold(true);
        const script = { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } };
        expect(await put(OWNER, { requireCheckBeforeDone: false }, script)).toMatchObject({ code: 403, body: { status: false } });
        expect(await put(OWNER, { allowedModes: ['workspace'] }, script)).toMatchObject({ code: 403, body: { status: false } });
        expect(company().agentPolicy).toEqual({ requireCheckBeforeDone: true });
        expect(changes()).toHaveLength(0);
        expect(announced()).toHaveLength(0);
        expect(await get(OWNER, script)).toMatchObject({ code: 200, body: { data: { requireCheckBeforeDone: true } } });
    });

    it('an agent\'s token is refused, whoever holds it, and the attempt is recorded', async () => {
        hold(true);
        expect(await put(OWNER, { requireCheckBeforeDone: false }, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } })).toMatchObject({ code: 403, body: { status: false } });
        expect(held()).toBe(true);
        expect(audits('agent.action_refused').filter((row) => row.meta.action === ctrl.POLICY_EDIT_ACTION)).toHaveLength(1);
        expect(changes()).toHaveLength(0);
        expect(announced()).toHaveLength(0);
    });
});
