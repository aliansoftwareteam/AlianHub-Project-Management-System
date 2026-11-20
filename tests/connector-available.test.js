const crypto = require('crypto');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 3),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true, isReadable: (p) => p !== null && p !== undefined && p !== 0 && p !== false,
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
jest.mock('../Modules/AICore/llmProvider', () => ({ ...jest.requireActual('../Modules/AICore/llmProvider'), getProvider: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { evaluatePermission } = require('../Config/permissionGuard');
const { getProvider } = require('../Modules/AICore/llmProvider');
const egressContext = require('../Modules/Agents/engine/egressContext');
const lookup = require('../Modules/Connectors/available');
const connectionTools = require('../Modules/Connectors/connectionTools');
const runner = require('../Modules/Connectors/toolRunner');
const agentConnectors = require('../Modules/Agents/agentConnectors');
const askConnectors = require('../Modules/AI/askConnectors');
const fakeMcpServer = require('./fixtures/fakeMcpServer');

/* Ask and agents learn a person's usable connector tools from one lookup (task 111). */

const C = '6f0000000000000000000c81';
const MAYA = '6f0000000000000000000a81';
const P = 'notesmcp';
const SLOW = 'slowmcp';
const SEARCH = 'notesmcp.search_notes';
const ARCHIVE = 'notesmcp.archive_notes';
const ENV = {
    CONNECTORS: `${P},${SLOW}`, AGENT_TAINT_ROUTING: 'on', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'),
    CONNECTOR_NOTESMCP_CLIENT_ID: 'notes-client', CONNECTOR_NOTESMCP_CLIENT_SECRET: 'notes-client-secret',
    CONNECTOR_SLOWMCP_CLIENT_ID: 'slow-client', CONNECTOR_SLOWMCP_CLIENT_SECRET: 'slow-client-secret',
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

let server;

const connect = async (provider = P) => {
    const actor = { id: MAYA };
    const keep = (value) => store.create({ companyId: C, name: `${provider} connection`, kind: 'connector', value, actor }).then((out) => out.handle);
    return mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, {
        companyId: C, userId: MAYA, provider, status: 'connected', signIn: 'registered_app', kind: 'mcp', account: { id: 'acc-maya', label: 'maya@notes.test' },
        handles: { refresh: await keep('refresh-maya'), access: await keep('access-maya') }, accessExpiresAt: new Date(Date.now() + 3600 * 1000),
        products: ['notes'], scopes: [], deletedStatusKey: 0,
    });
};

const find = (options) => lookup.available({ companyId: C, userId: MAYA, timeoutMs: 500, ...options });
const keysOf = (found) => found.tools.map((tool) => tool.key).sort();
const appOf = (found, provider = P) => found.apps.find((app) => app.provider === provider);
const agentRead = (ticks) => runner.read({
    companyId: C, userId: MAYA, via: runner.VIA.AGENT, callerId: 'agent-1', runId: 'run-1', agentConnectors: ticks, key: SEARCH, input: { query: 'bank' },
});

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    server = fakeMcpServer.create();
    server.tools.search_notes.annotations = { readOnlyHint: true };
    server.tools.archive_notes.annotations = { readOnlyHint: true };
    safeFetch.mockImplementation((url, opts) => {
        if (new URL(url).hostname === 'mcp.slow.test') return Promise.resolve({ status: 503, headers: {}, body: '' });
        return server.handle(url, opts);
    });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the lookup', () => {
    it('lists the tools the person\'s own connection offers, ready to run', async () => {
        await connect();
        const found = await find({ provider: P });
        expect(appOf(found)).toMatchObject({ provider: P, status: 'ok' });
        expect(keysOf(found)).toEqual([ARCHIVE, 'notesmcp.create_note', SEARCH]);
        expect(found.tools.find((tool) => tool.key === SEARCH)).toMatchObject({ live: true, kind: 'read', permission: 'allow' });
        expect(found.unavailable).toEqual([]);
    });

    it('filters by kind and by app', async () => {
        await connect();
        expect(keysOf(await find({ provider: P, kind: 'read' }))).toEqual([ARCHIVE, SEARCH]);
        expect(keysOf(await find({ provider: P, kind: 'write' }))).toEqual(['notesmcp.create_note']);
        const both = await find({ provider: [P, SLOW] });
        expect(both.apps.map((app) => app.provider)).toEqual([P, SLOW]);
        expect(both.tools.every((tool) => tool.provider === P)).toBe(true);
    });

    it('leaves out a changed tool for an agent, keeps it for Ask, and says why', async () => {
        await connect();
        await find({ provider: P });
        server.tools.search_notes.description = 'Search notes, now with tags.';
        expect(keysOf(await find({ provider: P, purpose: 'ask' }))).toContain(SEARCH);
        const forAgent = await find({ provider: P, purpose: 'agent' });
        expect(keysOf(forAgent)).not.toContain(SEARCH);
        expect(appOf(forAgent).leftOut).toEqual([{ key: SEARCH, kind: 'read', reason: 'changed' }]);
    });

    it('leaves out a tool its owner turned off', async () => {
        const row = await connect();
        await find({ provider: P });
        await connectionTools.change({ companyId: C, connectionId: String(row._id), tool: 'search_notes', fields: { permission: 'off' } });
        const found = await find({ provider: P });
        expect(keysOf(found)).not.toContain(SEARCH);
        expect(appOf(found).leftOut).toEqual([{ key: SEARCH, kind: 'read', reason: 'off' }]);
    });

    it('names a tool the server stopped listing as gone', async () => {
        await connect();
        await find({ provider: P });
        delete server.tools.search_notes;
        expect(appOf(await find({ provider: P })).leftOut).toEqual([{ key: SEARCH, kind: 'read', reason: 'gone' }]);
    });

    it('reports an unreachable app as unreachable and an unconnected one as not connected', async () => {
        await connect(SLOW);
        const found = await find({ provider: [P, SLOW] });
        expect(found.unavailable).toEqual([
            { provider: P, name: expect.any(String), status: 'not_connected' },
            { provider: SLOW, name: expect.any(String), status: 'unreachable' },
        ]);
        expect(found.tools).toEqual([]);
    });

    it('offers nothing from an app CONNECTORS does not name', async () => {
        process.env.CONNECTORS = SLOW;
        await connect();
        expect(appOf(await find({ provider: P }))).toMatchObject({ status: 'provider_off', tools: [] });
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('an agent and a live app\'s tools', () => {
    it('keeps a tick on a live tool, and refuses a tool name no server could list', () => {
        expect(agentConnectors.toStore([{ provider: P, tools: [SEARCH] }])).toEqual([{ provider: P, tools: [SEARCH] }]);
        expect(() => agentConnectors.toStore([{ provider: P, tools: ['slowmcp.search'] }])).toThrow(/not a tool of/);
        expect(() => agentConnectors.toStore([{ provider: P, tools: ['notesmcp.bad name'] }])).toThrow(/not a tool of/);
    });

    it('refuses an unticked live tool before the app is asked', async () => {
        await connect();
        await expect(agentRead([])).rejects.toMatchObject({ code: 'agent_not_allowed' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('refuses a ticked tool the server no longer offers, naming the tick to remove', async () => {
        await connect();
        await find({ provider: P });
        delete server.tools.search_notes;
        await find({ provider: P });
        await expect(agentRead([{ provider: P, tools: [SEARCH] }])).rejects.toMatchObject({
            code: 'tool_missing',
            message: expect.stringContaining('the Notes connection this run uses does not offer it'),
        });
    });

    it('says a server it could not reach is unreachable, not that the tool is gone', async () => {
        await connect(SLOW);
        const key = `${SLOW}.search_notes`;
        const read = runner.read({ companyId: C, userId: MAYA, via: runner.VIA.AGENT, callerId: 'agent-1', runId: 'run-1', agentConnectors: [{ provider: SLOW, tools: [key] }], key, input: { query: 'bank' } });
        await expect(read).rejects.toMatchObject({ code: 'unreachable', message: expect.stringContaining('could not be reached') });
    });
});

describe('a read that waits for its owner\'s approval', () => {
    const setPermission = async (row, tool, permission) => connectionTools.change({ companyId: C, connectionId: String(row._id), tool, fields: { permission } });

    it('is left out of AI chat, which cannot answer from it, and kept for agents', async () => {
        const row = await connect();
        await find({ provider: P });
        await setPermission(row, 'search_notes', 'approval');
        const forAsk = await find({ provider: P, purpose: 'ask' });
        expect(keysOf(forAsk)).not.toContain(SEARCH);
        expect(appOf(forAsk).leftOut).toEqual([{ key: SEARCH, kind: 'read', reason: 'approval' }]);
        expect(keysOf(await find({ provider: P, purpose: 'agent' }))).toContain(SEARCH);
    });

    it('is said to the asker when it leaves AI chat nothing to read', async () => {
        const row = await connect();
        await find({ provider: P });
        await setPermission(row, 'search_notes', 'approval');
        await setPermission(row, 'archive_notes', 'approval');
        await setPermission(row, 'create_note', 'off');
        const out = await egressContext.run({ companyId: C, actor: MAYA }, () => askConnectors.readStep({ companyId: C, userId: MAYA, question: 'find the bank notes', apps: [P] }));
        expect(out.notes).toEqual([expect.objectContaining({ provider: P, code: 'needs_approval', text: expect.stringContaining('wait for your approval') })]);
        expect(getProvider).not.toHaveBeenCalled();
    });
});

describe('Ask through the lookup', () => {
    const pick = (calls) => getProvider.mockReturnValue({ chat: jest.fn(async () => ({ content: JSON.stringify({ calls }), totalTokens: 1, model: 'm' })) });
    const step = (apps) => egressContext.run({ companyId: C, actor: MAYA }, () => askConnectors.readStep({ companyId: C, userId: MAYA, question: 'find the bank notes', apps }));

    it('reads a live tool on the asker\'s own connection, and says an unreachable app is unreachable', async () => {
        await connect();
        await connect(SLOW);
        pick([{ tool: SEARCH, arguments: { query: 'bank' } }]);
        const out = await step([P, SLOW]);
        expect(out.sources).toEqual([expect.objectContaining({ provider: P, tool: SEARCH, detail: expect.stringContaining('bank') })]);
        expect(out.notes).toEqual([expect.objectContaining({ provider: SLOW, code: 'unreachable', text: expect.stringContaining('could not be reached') })]);
    });

    it('does not read a live tool for an asker without the connectors right', async () => {
        await connect();
        evaluatePermission.mockResolvedValueOnce(0);
        pick([{ tool: SEARCH, arguments: { query: 'bank' } }]);
        const out = await step([P]);
        expect(out.sources).toEqual([]);
        expect(out.notes).toEqual([expect.objectContaining({ code: 'not_allowed' })]);
    });

    it('does not file a change to a live app it cannot carry yet', async () => {
        await connect();
        pick([{ tool: 'notesmcp.create_note', arguments: { title: 'Minutes', body: 'Ship it.' } }]);
        const out = await step([P]);
        expect(out.proposals).toEqual([]);
        expect(out.notes).toEqual([expect.objectContaining({ code: 'live_write' })]);
    });
});
