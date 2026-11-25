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
jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors-live') }), createRegistry: actual.createRegistry, SIGN_IN: actual.SIGN_IN };
});
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { sendNotice } = require('../Modules/Inbox/helpers/workspaceNotice');
const ctrl = require('../Modules/Connectors/connectorsController');
const runner = require('../Modules/Connectors/toolRunner');
const connectionTools = require('../Modules/Connectors/connectionTools');
const fakeMcpServer = require('./fixtures/fakeMcpServer');
const writes = require('../Modules/Connectors/writes');

/* A built-in MCP app's tools come live from its server, through each member's own connection (task 109). */

const C = '6f0000000000000000000c71';
const MAYA = '6f0000000000000000000a71';
const RAVI = '6f0000000000000000000a72';
const P = 'notesmcp';
const SLOW = 'slowmcp';
const SEARCH = 'notesmcp.search_notes';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const ENV = {
    CONNECTORS: `${P},${SLOW}`, AGENT_TAINT_ROUTING: 'on', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'),
    CONNECTOR_NOTESMCP_CLIENT_ID: 'notes-client', CONNECTOR_NOTESMCP_CLIENT_SECRET: 'notes-client-secret',
    CONNECTOR_SLOWMCP_CLIENT_ID: 'slow-client', CONNECTOR_SLOWMCP_CLIENT_SECRET: 'slow-client-secret',
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

let servers;
let slow;
const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
};
const call = async (handler, uid, { params = {}, body = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C }, uid, sessionId: `6e00000000000000000000${uid.slice(-2)}`, body, params, query: {} }), r);
    return r;
};

const connect = async (userId, provider = P) => {
    const actor = { id: userId };
    const keep = (value) => store.create({ companyId: C, name: `${provider} connection of ${userId}`, kind: 'connector', value, actor }).then((out) => out.handle);
    return mockDb.seed(T, {
        companyId: C, userId, provider, status: 'connected', signIn: 'registered_app', kind: 'mcp', account: { id: `acc-${userId}`, label: `${userId}@notes.test` },
        handles: { refresh: await keep(`refresh-${userId}`), access: await keep(`access-${userId}`) }, accessExpiresAt: new Date(Date.now() + 3600 * 1000),
        products: ['notes'], scopes: [], deletedStatusKey: 0,
    });
};

const rows = () => mockDb.store[SCHEMA_TYPE.CONNECTION_TOOLS] || [];
const rowOf = (userId, tool) => rows().find((row) => row.userId === userId && row.tool === tool);
const list = (userId, provider = P) => connectionTools.listFor({ companyId: C, userId, provider });
const read = (userId, via = runner.VIA.CHAT) => runner.read({
    companyId: C, userId, via, callerId: via === runner.VIA.AGENT ? 'agent-1' : 'ask', runId: via === runner.VIA.AGENT ? 'run-1' : null,
    agentConnectors: [{ provider: P, tools: [SEARCH] }], key: SEARCH, input: { query: 'bank' },
});
// A new live tool starts at Needs approval, so a test that reads one first sets what its owner would.
const allowSearch = (userId = MAYA) => { rowOf(userId, 'search_notes').permission = 'allow'; };
const tokenOf = (opts) => String(Object.entries((opts && opts.headers) || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1] || '');

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    servers = { [MAYA]: fakeMcpServer.create(), [RAVI]: fakeMcpServer.create() };
    slow = { hang: false };
    servers[MAYA].tools.search_notes.annotations = { readOnlyHint: true };
    safeFetch.mockImplementation((url, opts) => {
        if (new URL(url).hostname === 'mcp.slow.test') return slow.hang ? new Promise(() => {}) : Promise.resolve({ status: 503, headers: {}, body: '' });
        const owner = [MAYA, RAVI].find((id) => tokenOf(opts).endsWith(`access-${id}`));
        return owner ? servers[owner].handle(url, opts) : Promise.resolve({ status: 401, headers: {}, body: '' });
    });
    mockRoles[C] = { [MAYA]: 3, [RAVI]: 3 };
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('a built-in MCP app ships no tools of its own', () => {
    it('has no tools.js in any MCP provider folder', () => {
        const dir = path.join(__dirname, '..', 'Modules', 'Connectors', 'providers');
        const mcpFolders = fs.readdirSync(dir).filter((id) => require(path.join(dir, id, 'index.js')).transport === 'mcp');
        expect(mcpFolders.length).toBeGreaterThan(0);
        expect(mcpFolders.filter((id) => fs.existsSync(path.join(dir, id, 'tools.js')))).toEqual([]);
    });
});

describe('listing a connection\'s tools', () => {
    it('shows the tools the server lists, read from readOnlyHint and write without it, each waiting for approval', async () => {
        await connect(MAYA);
        const out = await list(MAYA);
        expect(out.status).toBe('ok');
        expect(out.tools.map((tool) => tool.key).sort()).toEqual(['notesmcp.archive_notes', 'notesmcp.create_note', 'notesmcp.search_notes']);
        expect(out.tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ access: 'read', permission: 'approval', changed: false });
        expect(out.tools.find((tool) => tool.tool === 'create_note')).toMatchObject({ access: 'write', permission: 'approval', changed: false });
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ companyId: C, provider: P, access: 'read', gone: false });
    });

    it('gives each member the tools their own connection lists', async () => {
        await connect(MAYA);
        await connect(RAVI);
        delete servers[RAVI].tools.archive_notes;
        expect((await list(MAYA)).tools.map((tool) => tool.tool)).toContain('archive_notes');
        expect((await list(RAVI)).tools.map((tool) => tool.tool)).not.toContain('archive_notes');
        expect(servers[MAYA].requests.every((r) => r.method !== 'post' || r.authorization.endsWith(`access-${MAYA}`))).toBe(true);
        expect(servers[RAVI].requests.every((r) => r.method !== 'post' || r.authorization.endsWith(`access-${RAVI}`))).toBe(true);
    });

    it('writes nothing when the listing has not changed', async () => {
        const crud = jest.spyOn(mockDb, 'crud');
        await connect(MAYA);
        await list(MAYA);
        const from = crud.mock.calls.length;
        await list(MAYA);
        const writes = crud.mock.calls.slice(from).filter(([, query, method]) => query.type === SCHEMA_TYPE.CONNECTION_TOOLS && !['find', 'findOne'].includes(method));
        expect(writes).toEqual([]);
    });

    it('says a member is not connected, without asking any server', async () => {
        const out = await list(MAYA);
        expect(out).toEqual({ provider: P, status: 'not_connected', tools: [] });
        expect(servers[MAYA].requests).toEqual([]);
    });

    it('says a server that fails is unreachable, not unconnected', async () => {
        await connect(MAYA, SLOW);
        expect(await list(MAYA, SLOW)).toEqual({ provider: SLOW, status: 'unreachable', tools: [] });
    });

    it('lists every app at once, so a server that never answers holds up none of the others', async () => {
        await connect(MAYA);
        await connect(MAYA, SLOW);
        slow.hang = true;
        const started = Date.now();
        const out = await connectionTools.listMine({ companyId: C, userId: MAYA, providers: [P, SLOW], timeoutMs: 200 });
        expect(Date.now() - started).toBeLessThan(2000);
        expect(out.find((entry) => entry.provider === P)).toMatchObject({ status: 'ok' });
        expect(out.find((entry) => entry.provider === SLOW)).toEqual({ provider: SLOW, status: 'unreachable', tools: [] });
    });
});

describe('a tool the server changed', () => {
    it('is flagged and its owner told once, however often it is listed', async () => {
        await connect(MAYA);
        await list(MAYA);
        servers[MAYA].tools.search_notes.description = 'Search notes, now with tags.';
        const out = await list(MAYA);
        expect(out.tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ changed: true });
        await list(MAYA);
        expect(sendNotice).toHaveBeenCalledTimes(1);
        expect(sendNotice.mock.calls[0][1]).toEqual([MAYA]);
    });

    it('still works in AI chat, and agents skip it', async () => {
        await connect(MAYA);
        await list(MAYA);
        allowSearch();
        servers[MAYA].tools.search_notes.description = 'Search notes, now with tags.';
        await list(MAYA);
        const out = await read(MAYA);
        expect(out.text).toContain('Found 2 notes for bank');
        await expect(read(MAYA, runner.VIA.AGENT)).rejects.toMatchObject({ code: 'tool_changed' });
        expect(servers[MAYA].calls).toHaveLength(1);
    });

    it('is caught by the call that meets it, which still goes through', async () => {
        await connect(MAYA);
        await list(MAYA);
        allowSearch();
        servers[MAYA].tools.search_notes.inputSchema.properties.tag = { type: 'string' };
        await read(MAYA);
        expect(servers[MAYA].calls).toHaveLength(1);
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ changed: true });
        expect(sendNotice).toHaveBeenCalledTimes(1);
    });
});

describe('a tool the server stopped listing', () => {
    it('is marked gone, not deleted, and refused', async () => {
        await connect(MAYA);
        await list(MAYA);
        delete servers[MAYA].tools.search_notes;
        expect((await list(MAYA)).tools.filter((tool) => !tool.gone).map((tool) => tool.tool)).not.toContain('search_notes');
        expect((await list(MAYA)).tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ gone: true });
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ gone: true });
        await expect(read(MAYA)).rejects.toMatchObject({ code: 'tool_missing' });
        expect(servers[MAYA].calls).toEqual([]);
    });

    it('is marked gone by a call that finds it withdrawn', async () => {
        await connect(MAYA);
        await list(MAYA);
        allowSearch();
        delete servers[MAYA].tools.search_notes;
        await expect(read(MAYA)).rejects.toMatchObject({ code: 'tool_missing' });
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ gone: true });
    });

    it('comes back when the server lists it again', async () => {
        await connect(MAYA);
        await list(MAYA);
        const kept = servers[MAYA].tools.search_notes;
        delete servers[MAYA].tools.search_notes;
        await list(MAYA);
        servers[MAYA].tools.search_notes = kept;
        await list(MAYA);
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ gone: false, changed: false });
    });
});

describe('the route of a connection\'s tools', () => {
    it('lists the owner\'s own connection live', async () => {
        const mine = await connect(MAYA);
        const out = await call(ctrl.connectionTools, MAYA, { params: { id: String(mine._id) } });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: P, status: 'ok' });
        expect(out.body.data.tools.find((tool) => tool.tool === 'search_notes').outside.description).toBe('Search the notes of the signed-in person.');
    });

    it('answers another member as if the connection did not exist', async () => {
        const mine = await connect(MAYA);
        const out = await call(ctrl.connectionTools, RAVI, { params: { id: String(mine._id) } });
        expect(out.code).toBe(404);
        expect(servers[MAYA].requests).toEqual([]);
    });
});

describe('the owner’s choices on a live tool (task 110)', () => {
    const CREATE = 'notesmcp.create_note';
    const setTool = (uid, row, key, body) => call(ctrl.setTool, uid, { params: { id: String(row._id), key }, body });

    it('holds a permission on the tool’s own row: Off refuses, Needs approval asks to be filed, Always allow runs', async () => {
        const mine = await connect(MAYA);
        await list(MAYA);
        expect((await setTool(MAYA, mine, SEARCH, { permission: 'off' })).body.data).toMatchObject({ key: SEARCH, permission: 'off' });
        await expect(read(MAYA)).rejects.toMatchObject({ code: 'tool_turned_off' });
        await setTool(MAYA, mine, SEARCH, { permission: 'approval' });
        await expect(read(MAYA)).rejects.toMatchObject({ code: 'needs_approval' });
        await setTool(MAYA, mine, SEARCH, { permission: 'allow' });
        expect((await read(MAYA)).text).toContain('Found 2 notes for bank');
        expect(servers[MAYA].calls).toHaveLength(1);
    });

    it('is refused to another member, and for a tool the connection never listed', async () => {
        const mine = await connect(MAYA);
        await list(MAYA);
        expect((await setTool(RAVI, mine, SEARCH, { permission: 'off' })).code).toBe(404);
        expect((await setTool(MAYA, mine, 'notesmcp.drop_everything', { permission: 'off' })).body.code).toBe('unknown_tool');
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ permission: 'approval' });
    });

    it('keeps the owner’s read or write over the server’s hint on the next listing', async () => {
        const mine = await connect(MAYA);
        await list(MAYA);
        await setTool(MAYA, mine, SEARCH, { access: 'write' });
        await list(MAYA);
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ access: 'write', accessByOwner: true });
    });

    it('flags a tool whose readOnlyHint flips, since that moves it between Read and Write', async () => {
        await connect(MAYA);
        await list(MAYA);
        servers[MAYA].tools.search_notes.annotations = { readOnlyHint: false };
        expect((await list(MAYA)).tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ access: 'write', changed: true });
        expect((await list(MAYA)).tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ changed: true });
    });

    it('does not flag a row stored before the hint was kept', async () => {
        await connect(MAYA);
        await list(MAYA);
        delete rowOf(MAYA, 'search_notes').hinted;
        expect((await list(MAYA)).tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ changed: false });
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ hinted: 'read' });
    });

    it('never turns on Always allow when the owner moves a tool into Read', async () => {
        const mine = await connect(MAYA);
        await list(MAYA);
        await setTool(MAYA, mine, CREATE, { access: 'read' });
        expect(rowOf(MAYA, 'create_note')).toMatchObject({ access: 'read', permission: 'approval' });
    });

    it('takes Always allow away from a tool moved into Write, and keeps any other choice', async () => {
        const mine = await connect(MAYA);
        await list(MAYA);
        await setTool(MAYA, mine, SEARCH, { permission: 'allow' });
        await setTool(MAYA, mine, SEARCH, { access: 'write' });
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ access: 'write', permission: 'approval' });
        await setTool(MAYA, mine, SEARCH, { permission: 'off' });
        await setTool(MAYA, mine, SEARCH, { access: 'read' });
        await setTool(MAYA, mine, SEARCH, { access: 'write' });
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ access: 'write', permission: 'off' });
    });

    it('records the current shape as looked at, which clears the warning and lets agents use it again', async () => {
        const mine = await connect(MAYA);
        await list(MAYA);
        servers[MAYA].tools.search_notes.description = 'Search notes, now with tags.';
        await list(MAYA);
        await expect(read(MAYA, runner.VIA.AGENT)).rejects.toMatchObject({ code: 'tool_changed' });
        const out = await setTool(MAYA, mine, SEARCH, { lookedAt: true });
        expect(out.body.data).toMatchObject({ changed: false });
        expect(rowOf(MAYA, 'search_notes').seenShape).toBe(rowOf(MAYA, 'search_notes').shape);
        expect((await list(MAYA)).tools.find((tool) => tool.tool === 'search_notes')).toMatchObject({ changed: false });
    });

    it('files a live write for its owner’s approval card', async () => {
        await connect(MAYA);
        await list(MAYA);
        expect(writes.isWrite(CREATE)).toBe(true);
        const [filed] = await writes.prepareChanges(C, MAYA, [{ action: CREATE, params: { title: 'Hi', body: 'There' } }]);
        expect(filed.card).toMatchObject({ provider: P, tool: CREATE, title: 'create_note' });
        expect(servers[MAYA].calls).toEqual([]);
    });

    it('takes a permission carried over from before the tool was first listed', async () => {
        const mine = await connect(MAYA);
        mockDb.store[T].find((row) => row._id === mine._id).toolPermissions = [{ key: SEARCH, permission: 'off' }];
        await list(MAYA);
        expect(rowOf(MAYA, 'search_notes')).toMatchObject({ permission: 'off' });
    });
});
