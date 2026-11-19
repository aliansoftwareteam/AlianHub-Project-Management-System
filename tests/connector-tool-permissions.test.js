const crypto = require('crypto');

const mockDb = require('./fixtures/fakeMongo').create();
const mockRoles = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => { const roles = mockRoles[companyId] || {}; return uid in roles ? roles[uid] : null; }),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true || p === 1 || p === 2, isReadable: (p) => p !== null && p !== undefined && p !== 0,
}));
jest.mock('../Modules/Inbox/helpers/workspaceNotice', () => ({ ownersAndAdmins: jest.fn(async () => []), sendNotice: jest.fn(async () => {}) }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors-mcp')) };
});
jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors-mcp') }), createRegistry: actual.createRegistry, SIGN_IN: actual.SIGN_IN };
});
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const socketEmitter = require('../event/socketEventEmitter');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const ctrl = require('../Modules/Connectors/connectorsController');
const connection = require('../Modules/Connectors/connection');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const runner = require('../Modules/Connectors/toolRunner');
const writes = require('../Modules/Connectors/writes');
const fakeMcpServer = require('./fixtures/fakeMcpServer');
const migration = require('../migrations/088-connector-tool-permissions');
const { buildContext } = require('../migrations');

/* A member sets how each tool of their own connection may be used: Always allow, Needs approval or Off. Nobody else may
 * change it, the permission holds at the moment a tool would be called, and an owner or admin can turn the whole app
 * off for the workspace. */

const C = '6f0000000000000000000c41';
const OWNER = '6f0000000000000000000a41';
const ADMIN = '6f0000000000000000000a42';
const MAYA = '6f0000000000000000000a43';
const RAVI = '6f0000000000000000000a44';
const P = 'notesmcp';
const SEARCH = 'notesmcp.notes.search';
const CREATE = 'notesmcp.note.create';
const NOTE = { title: 'Hi', body: 'There' };
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const ENV = {
    CONNECTORS: P, AGENT_TAINT_ROUTING: 'on', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'),
    CONNECTOR_NOTESMCP_CLIENT_ID: 'notes-client', CONNECTOR_NOTESMCP_CLIENT_SECRET: 'notes-client-secret', APIURL: 'http://localhost:4000/',
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

let server;
const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, apiToken } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C }, uid, sessionId: `6e00000000000000000000${uid.slice(-2)}`, body, params, query: {}, ...(apiToken ? { apiToken } : {}) }), r);
    return r;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const audits = (action) => (mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).filter((row) => row.action === action);
const rowOf = (id) => mockDb.store[T].find((r) => r._id === id);

/* A live connection with real handles in the secrets store, so a call that is let through really reaches the app. */
const connect = async (userId, extra = {}) => {
    const actor = { id: userId };
    const keep = (value) => store.create({ companyId: C, name: `notes connection of ${userId}`, kind: 'connector', value, actor }).then((out) => out.handle);
    return mockDb.seed(T, {
        companyId: C, userId, provider: P, status: 'connected', signIn: 'registered_app', kind: 'mcp', account: { id: `acc-${userId}`, label: `${userId}@notes.test` },
        handles: { refresh: await keep(`refresh-${userId}`), access: await keep(`access-${userId}`) }, accessExpiresAt: new Date(Date.now() + 3600 * 1000),
        products: ['notes'], scopes: [], deletedStatusKey: 0, ...extra,
    });
};
const read = (userId, { via = runner.VIA.MCP, key = SEARCH, input = { query: 'bank' } } = {}) => runner.read({ companyId: C, userId, via, callerId: 'oauth:claude', runId: null, key, input });
const admit = (userId, key = CREATE) => runner.admitWrite({ companyId: C, userId, key, input: NOTE });
const setTool = (uid, row, key, body, extra = {}) => call(ctrl.setTool, uid, { params: { id: row._id, key }, body, ...extra });
const turn = (uid, on, provider = P) => call(ctrl.setSwitch, uid, { params: { provider }, body: { on } });

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    server = fakeMcpServer.create();
    safeFetch.mockImplementation((url, opts) => server.handle(url, opts));
    mockRoles[C] = { [OWNER]: 1, [ADMIN]: 2, [MAYA]: 3, [RAVI]: 3 };
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the tools of one\'s own connection', () => {
    it('lists each tool with its read or write and its permission: reads Always allow and writes Needs approval by default', async () => {
        const row = await connect(MAYA);
        const out = await call(ctrl.connectionTools, MAYA, { params: { id: row._id } });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: P, status: 'ok', connectionId: String(row._id) });
        expect(out.body.data.tools.map(({ key, access, permission }) => ({ key, access, permission }))).toEqual([
            { key: SEARCH, access: 'read', permission: 'allow' },
            { key: 'notesmcp.notes.archive', access: 'read', permission: 'allow' },
            { key: CREATE, access: 'write', permission: 'approval' },
        ]);
    });

    it('is shown to its owner only', async () => {
        const row = await connect(MAYA);
        for (const uid of [RAVI, OWNER, ADMIN]) {
            // eslint-disable-next-line no-await-in-loop
            expect((await call(ctrl.connectionTools, uid, { params: { id: row._id } })).code).toBe(404);
        }
        expect((await call(ctrl.connectionTools, MAYA, { params: { id: row._id }, apiToken: { _id: 'tok' } })).code).toBe(403);
    });
});

describe('setting a tool\'s permission', () => {
    it('keeps the owner\'s choice on the connection, answers the tool as it is now and records it', async () => {
        const row = await connect(MAYA);
        const out = await setTool(MAYA, row, SEARCH, { permission: 'off' });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ key: SEARCH, permission: 'off' });
        expect(rowOf(row._id).toolPermissions).toEqual([{ key: SEARCH, permission: 'off' }]);
        await settle();
        expect(audits('connector.tool_permission_changed')).toEqual([
            expect.objectContaining({ actorId: MAYA, entityId: P, meta: expect.objectContaining({ tool: SEARCH, permission: 'off' }) }),
        ]);

        await setTool(MAYA, row, SEARCH, { permission: 'allow' });
        expect(rowOf(row._id).toolPermissions).toEqual([]);
    });

    it('cannot be changed by another member, an owner or an admin', async () => {
        const row = await connect(MAYA);
        for (const uid of [RAVI, OWNER, ADMIN]) {
            // eslint-disable-next-line no-await-in-loop
            expect((await setTool(uid, row, SEARCH, { permission: 'off' })).code).toBe(404);
        }
        expect(rowOf(row._id).toolPermissions).toBeUndefined();
        expect(audits('connector.tool_permission_changed')).toEqual([]);
    });

    it('refuses a tool the app does not have, a permission that is not one, nothing to change, and a REST tool\'s read or write', async () => {
        const row = await connect(MAYA);
        expect((await setTool(MAYA, row, 'notesmcp.notes.delete', { permission: 'off' })).body.code).toBe('unknown_tool');
        expect((await setTool(MAYA, row, SEARCH, { permission: 'sometimes' })).body.code).toBe('bad_permission');
        expect((await setTool(MAYA, row, SEARCH, {})).body.code).toBe('nothing_to_change');
        expect((await setTool(MAYA, row, SEARCH, { access: 'write' })).body.code).toBe('access_fixed');
        expect(rowOf(row._id).toolPermissions).toBeUndefined();
    });

    it('refuses a connection that is gone, and an API token', async () => {
        const row = await connect(MAYA);
        expect((await call(ctrl.setTool, MAYA, { params: { id: '6f00000000000000000000ff', key: SEARCH }, body: { permission: 'off' } })).code).toBe(404);
        expect((await setTool(MAYA, row, SEARCH, { permission: 'off' }, { apiToken: { _id: 'tok' } })).code).toBe(403);
    });
});

describe('what a permission does when a tool would be called', () => {
    it('Off: refused in plain words, and the app is never contacted', async () => {
        await connect(MAYA, { toolPermissions: [{ key: SEARCH, permission: 'off' }] });
        const refused = await read(MAYA).catch((error) => error);
        expect(refused).toMatchObject({ code: 'tool_turned_off', deterministic: true });
        expect(refused.message).toContain('turned this Notes tool off for yourself');
        expect(server.calls).toEqual([]);
    });

    it('Off: a write is refused before it can be filed', async () => {
        await connect(MAYA, { toolPermissions: [{ key: CREATE, permission: 'off' }] });
        await expect(admit(MAYA)).rejects.toMatchObject({ code: 'tool_turned_off' });
    });

    it('Needs approval: a direct call is refused so it is filed instead, and filing it gives it an approval card', async () => {
        await connect(MAYA, { toolPermissions: [{ key: SEARCH, permission: 'approval' }] });
        await expect(read(MAYA)).rejects.toMatchObject({ code: 'needs_approval' });
        expect(server.calls).toEqual([]);
        expect(writes.isWrite(SEARCH)).toBe(true);
        const [filed] = await writes.prepareChanges(C, MAYA, [{ action: SEARCH, params: { query: 'bank' } }]);
        expect(filed.card).toMatchObject({ provider: P, tool: SEARCH });
    });

    it('Always allow: a write runs directly from the person\'s own client, but an agent run still files it', async () => {
        await connect(MAYA, { toolPermissions: [{ key: CREATE, permission: 'allow' }] });
        expect((await read(MAYA, { key: CREATE, input: NOTE })).text).toContain('Saved Hi');
        const agentRead = runner.read({
            companyId: C, userId: MAYA, via: runner.VIA.AGENT, callerId: 'agent-1', runId: 'run-1', agentConnectors: [{ provider: P, tools: [CREATE] }], key: CREATE, input: NOTE,
        });
        await expect(agentRead).rejects.toMatchObject({ code: 'needs_approval' });
        expect(server.calls.map((c) => c.name)).toEqual(['create_note']);
    });

    it('stays as it was for another tool, and for another member', async () => {
        await connect(MAYA, { toolPermissions: [{ key: CREATE, permission: 'off' }] });
        await connect(RAVI);
        expect((await read(MAYA)).text).toContain('Found 2 notes');
        expect((await read(RAVI)).text).toContain('Found 2 notes');
    });

    it('reaches the caller of a connection with the rest of it', async () => {
        await connect(MAYA, { toolPermissions: [{ key: SEARCH, permission: 'off' }] });
        const found = await resolveConnection({ companyId: C, userId: MAYA, provider: P });
        expect(found.toolPermissions).toEqual([{ key: SEARCH, permission: 'off' }]);
        expect(Object.keys(found).sort()).toEqual(['connectionId', 'getAccessToken', 'scopes', 'toolPermissions']);
    });
});

describe('turning an app off for the workspace', () => {
    it('is for owners and admins only, and never through an API token', async () => {
        expect((await turn(MAYA, false)).code).toBe(403);
        expect((await call(ctrl.setSwitch, OWNER, { params: { provider: P }, body: { on: false }, apiToken: { _id: 'tok' } })).code).toBe(403);
        expect((await turn(ADMIN, false, 'nothing-here')).code).toBe(404);
        expect((await call(ctrl.setSwitch, ADMIN, { params: { provider: P }, body: { on: 'no' } })).body.code).toBe('bad_switch');
        expect(mockDb.store[SCHEMA_TYPE.CONNECTOR_SWITCHES] || []).toEqual([]);
    });

    it('offers no tools, refuses every call and every new connection, and records it', async () => {
        const row = await connect(MAYA);
        expect((await turn(ADMIN, false)).body.data).toEqual({ off: [P] });
        await settle();
        expect(audits('connector.app_switched')).toEqual([expect.objectContaining({ actorId: ADMIN, entityId: P, meta: { on: false } })]);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'connector', data: { provider: P, change: 'app_off' } }));

        expect((await call(ctrl.connectionTools, MAYA, { params: { id: row._id } })).body.data).toMatchObject({ status: 'app_off', tools: [] });
        const refused = await read(MAYA).catch((error) => error);
        expect(refused).toMatchObject({ code: 'app_off' });
        expect(refused.message).toContain('turned Notes off for this workspace');
        await expect(admit(MAYA)).rejects.toMatchObject({ code: 'app_off' });
        expect(server.calls).toEqual([]);
        expect((await connection.list(C, MAYA)).workspaceOff).toEqual([P]);
        await expect(connection.start({ companyId: C, userId: RAVI, sessionId: 's1', provider: P, origin: 'http://localhost:8080' })).rejects.toMatchObject({ code: 'app_off' });
    });

    it('gives everything back when it is turned on again', async () => {
        await connect(MAYA, { toolPermissions: [{ key: CREATE, permission: 'off' }] });
        await turn(OWNER, false);
        await turn(OWNER, true);
        expect((await connection.list(C, MAYA)).workspaceOff).toEqual([]);
        expect((await read(MAYA)).text).toContain('Found 2 notes');
        await expect(admit(MAYA)).rejects.toMatchObject({ code: 'tool_turned_off' });
    });
});

describe('migration 088', () => {
    const quiet = { info: jest.fn(), error: jest.fn() };
    const ctx = () => buildContext({ MongoDbCrudOpration: mockDb.crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => [{ _id: C }] });

    it('turns every tool a member had turned off into an Off permission, keeps choices already made, and runs once', async () => {
        const row = await connect(MAYA, { toolsOff: [SEARCH, CREATE], toolPermissions: [{ key: CREATE, permission: 'allow' }] });
        const other = await connect(RAVI);
        expect(await migration.moveCompany(ctx(), C)).toEqual({ moved: 1 });
        expect(rowOf(row._id).toolPermissions).toEqual([{ key: CREATE, permission: 'allow' }, { key: SEARCH, permission: 'off' }]);
        expect(rowOf(row._id).toolsOff).toBeUndefined();
        expect(rowOf(other._id).toolPermissions).toBeUndefined();
        expect(await migration.moveCompany(ctx(), C)).toEqual({ moved: 0 });
        await expect(read(MAYA)).rejects.toMatchObject({ code: 'tool_turned_off' });
    });
});
