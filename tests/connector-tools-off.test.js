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
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const ctrl = require('../Modules/Connectors/connectorsController');
const connection = require('../Modules/Connectors/connection');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const runner = require('../Modules/Connectors/toolRunner');
const mcpClient = require('../Modules/Connectors/mcpClient');
const fakeMcpServer = require('./fixtures/fakeMcpServer');

/* A member turns tools of their own connection off for their own use: nobody else may change that list, it names only
 * tools the app has, and a tool on it is refused at the moment it would be called. */

const C = '6f0000000000000000000c41';
const OWNER = '6f0000000000000000000a41';
const ADMIN = '6f0000000000000000000a42';
const MAYA = '6f0000000000000000000a43';
const RAVI = '6f0000000000000000000a44';
const P = 'notesmcp';
const SEARCH = 'notesmcp.notes.search';
const CREATE = 'notesmcp.note.create';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const ENV = {
    CONNECTORS: P, AGENT_TAINT_ROUTING: 'on', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'),
    CONNECTOR_NOTESMCP_CLIENT_ID: 'notes-client', CONNECTOR_NOTESMCP_CLIENT_SECRET: 'notes-client-secret',
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

/* A live connection with real handles in the secrets store, so a call that is let through really reaches the app. */
const connect = async (userId, toolsOff) => {
    const actor = { id: userId };
    const keep = (value) => store.create({ companyId: C, name: `notes connection of ${userId}`, kind: 'connector', value, actor }).then((out) => out.handle);
    return mockDb.seed(T, {
        companyId: C, userId, provider: P, status: 'connected', signIn: 'registered_app', kind: 'mcp', account: { id: `acc-${userId}`, label: `${userId}@notes.test` },
        handles: { refresh: await keep(`refresh-${userId}`), access: await keep(`access-${userId}`) }, accessExpiresAt: new Date(Date.now() + 3600 * 1000),
        products: ['notes'], scopes: [], ...(toolsOff ? { toolsOff } : {}), deletedStatusKey: 0,
    });
};
const read = (userId) => runner.read({ companyId: C, userId, via: runner.VIA.MCP, callerId: 'oauth:claude', key: SEARCH, input: { query: 'bank' } });

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mcpClient.forget();
    server = fakeMcpServer.create();
    safeFetch.mockImplementation((url, opts) => server.handle(url, opts));
    mockRoles[C] = { [OWNER]: 1, [ADMIN]: 2, [MAYA]: 3, [RAVI]: 3 };
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the tools of a connector, as a member sees them', () => {
    it('lists each catalog tool with its key, label, read or write and whether it is on, and nothing the app wrote', async () => {
        const out = await call(ctrl.memberTools, MAYA, { params: { provider: P } });
        expect(out.code).toBe(200);
        expect(out.body.data.tools).toEqual([
            { key: SEARCH, label: 'Connectors.tool.notesmcpNotesSearch', kind: 'read', on: true },
            { key: 'notesmcp.notes.archive', label: 'Connectors.tool.notesmcpNotesArchive', kind: 'read', on: false },
            { key: CREATE, label: 'Connectors.tool.notesmcpNoteCreate', kind: 'write', on: true },
        ]);
        expect(JSON.stringify(out.body)).not.toMatch(/inputSchema|shape|description|search_notes/);
    });

    it('is refused for an app the registry does not have, an API token and a guest', async () => {
        expect((await call(ctrl.memberTools, MAYA, { params: { provider: 'nothing-here' } })).code).toBe(404);
        expect((await call(ctrl.memberTools, MAYA, { params: { provider: P }, apiToken: { _id: 'tok' } })).code).toBe(403);
        mockRoles[C][RAVI] = 0;
        expect((await call(ctrl.memberTools, RAVI, { params: { provider: P } })).code).toBe(403);
    });

    it('shows every tool off while the app is not switched on here', async () => {
        process.env.CONNECTORS = '';
        const out = await call(ctrl.memberTools, MAYA, { params: { provider: P } });
        expect(out.body.data.tools.map((tool) => tool.on)).toEqual([false, false, false]);
    });
});

describe('turning tools off for one\'s own use', () => {
    it('keeps the list on the person\'s connection, answers the connection as they see it and records it', async () => {
        const row = await connect(MAYA);
        const out = await call(ctrl.setToolsOff, MAYA, { params: { id: row._id }, body: { toolsOff: [CREATE, CREATE] } });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: P, connectionId: String(row._id), connected: true, toolsOff: [CREATE] });
        expect(JSON.stringify(out.body)).not.toMatch(/access-|refresh-|sec_/);
        expect(mockDb.store[T].find((r) => r._id === row._id).toolsOff).toEqual([CREATE]);
        await settle();
        expect(audits('connector.tools_changed')).toEqual([expect.objectContaining({ actorId: MAYA, entityId: P, meta: expect.objectContaining({ toolsOff: [CREATE] }) })]);

        const back = await call(ctrl.setToolsOff, MAYA, { params: { id: row._id }, body: { toolsOff: [] } });
        expect(back.body.data.toolsOff).toEqual([]);
    });

    it('cannot be changed by another member, or by an owner or admin', async () => {
        const row = await connect(MAYA);
        for (const uid of [RAVI, OWNER, ADMIN]) {
            // eslint-disable-next-line no-await-in-loop
            const out = await call(ctrl.setToolsOff, uid, { params: { id: row._id }, body: { toolsOff: [SEARCH] } });
            expect(out.code).toBe(404);
        }
        expect(mockDb.store[T].find((r) => r._id === row._id).toolsOff).toBeUndefined();
        expect(audits('connector.tools_changed')).toEqual([]);
    });

    it('refuses a tool the app does not have, a tool of another app, and a list that is not one', async () => {
        const row = await connect(MAYA);
        for (const toolsOff of [['notesmcp.notes.delete'], ['fake.notes.list'], [SEARCH, 7], SEARCH, undefined]) {
            // eslint-disable-next-line no-await-in-loop
            const out = await call(ctrl.setToolsOff, MAYA, { params: { id: row._id }, body: { toolsOff } });
            expect(out.code).toBe(400);
            expect(out.body.code).toBe('unknown_tool');
        }
        expect(mockDb.store[T].find((r) => r._id === row._id).toolsOff).toBeUndefined();
    });

    it('refuses a connection that is gone, and an API token', async () => {
        const row = await connect(MAYA);
        expect((await call(ctrl.setToolsOff, MAYA, { params: { id: '6f00000000000000000000ff' }, body: { toolsOff: [] } })).code).toBe(404);
        expect((await call(ctrl.setToolsOff, MAYA, { params: { id: row._id }, body: { toolsOff: [] }, apiToken: { _id: 'tok' } })).code).toBe(403);
        mockDb.store[T].find((r) => r._id === row._id).handles = {};
        expect((await call(ctrl.setToolsOff, MAYA, { params: { id: row._id }, body: { toolsOff: [] } })).code).toBe(404);
    });
});

describe('a tool the person turned off', () => {
    it('reaches the caller of a connection with the rest of it', async () => {
        await connect(MAYA, [SEARCH]);
        const found = await resolveConnection({ companyId: C, userId: MAYA, provider: P });
        expect(found.toolsOff).toEqual([SEARCH]);
        expect(Object.keys(found).sort()).toEqual(['connectionId', 'getAccessToken', 'scopes', 'toolsOff']);
    });

    it('is refused when it would be called, in plain words, and the app is never contacted', async () => {
        await connect(MAYA, [SEARCH]);
        const refused = await read(MAYA).catch((error) => error);
        expect(refused).toMatchObject({ code: 'tool_turned_off', deterministic: true });
        expect(refused.message).toContain('turned this Notes tool off for yourself');
        expect(server.calls).toEqual([]);
    });

    it('is refused for a write too, before it can be filed', async () => {
        await connect(MAYA, [CREATE]);
        await expect(runner.admitWrite({ companyId: C, userId: MAYA, key: CREATE, input: { title: 'Hi', body: 'There' } })).rejects.toMatchObject({ code: 'tool_turned_off' });
    });

    it('stays on for another tool, and for another member who left it on', async () => {
        await connect(MAYA, [CREATE]);
        await connect(RAVI);
        expect((await read(MAYA)).text).toContain('Found 2 notes');
        expect((await read(RAVI)).text).toContain('Found 2 notes');
    });
});

describe('the list of connectors', () => {
    it('names an app this install cannot sign in to yet, apart from the ones offered', async () => {
        expect((await connection.list(C, MAYA)).unavailable).toEqual([]);
        delete process.env.CONNECTOR_NOTESMCP_CLIENT_ID;
        const out = await connection.list(C, MAYA);
        expect(out.providers).toEqual([]);
        expect(out.unavailable).toEqual([{ provider: P }]);
    });

    it('shows the person which of their tools they turned off', async () => {
        await connect(MAYA, [CREATE]);
        const [own] = (await connection.list(C, MAYA)).connections;
        expect(own).toMatchObject({ provider: P, connected: true, toolsOff: [CREATE] });
    });
});
