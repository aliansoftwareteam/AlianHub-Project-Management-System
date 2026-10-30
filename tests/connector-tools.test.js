const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn() }), { virtual: true });
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const connectorTools = require('../Modules/Connectors/tools');
const registry = require('../Modules/Agents/registry');
const readers = require('../Modules/Agents/skills/readers');
const { offeredReaders } = require('../Modules/Agents/skills/catalogues');
const mcpTools = require('../Modules/Mcp/tools');
const egressContext = require('../Modules/Agents/engine/egressContext');
const agentFetch = require('../Modules/Agents/engine/agentFetch');
const mcpOAuth = require('../Config/mcpOAuth');

/* The fake provider's one read tool, defined once in tests/fixtures/connectors/fake, reached from an agent run and
 * from MCP with nothing else written for it. */

const C = '6f0000000000000000000c01';
const PRISHA = '6f0000000000000000000a01';
const RUN = '6f0000000000000000000d01';
const MINE = 'conn-prisha';
const KEY = 'fake.notes.list';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const connectorError = (code) => Object.assign(new Error(code), { name: 'ConnectorError', code, provider: 'fake' });
const connected = (scopes = ['notes.read']) => resolveConnection.mockResolvedValue({ connectionId: MINE, scopes, getAccessToken: async () => 'secret-token' });
const notes = (url) => (new URL(url).hostname === 'api.fake.test'
    ? { status: 200, headers: {}, body: JSON.stringify({ notes: [{ title: 'Board meeting' }, { title: 'Call the bank' }] }) }
    : { status: 404, headers: {}, body: '' });
const actor = { kind: 'agent', userId: PRISHA, agentId: '6f0000000000000000000b01', agentName: 'Digest', runId: RUN };
const runRow = () => (mockDb.store[SCHEMA_TYPE.AGENT_RUNS] || []).find((r) => String(r._id) === RUN);
const agentRead = (input = {}) => egressContext.run({ companyId: C }, () => readers.read(KEY, C, { runId: RUN, actor, allowedActions: [] }, input));
const mcp = (scopes) => ({ companyId: C, userId: PRISHA, actor: { kind: 'token', userId: PRISHA }, token: { oauth: true, scopes } });

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    safeFetch.mockImplementation(async (url) => notes(url));
    connected();
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, status: 'running', connectorReads: [] });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('a tool definition', () => {
    const fake = require('./fixtures/connectors/fake');
    const good = require('./fixtures/connectors/fake/tools')[0];
    const problems = (over) => connectorTools.problemsOf(fake, [{ ...good, ...over }]);

    it('accepts the fake provider\'s tool', () => {
        expect(connectorTools.problemsOf(fake, [good])).toEqual([]);
    });

    it('refuses a key, product, scope, caps or input it cannot trust', () => {
        expect(problems({ key: 'other.notes.list' }).join()).toMatch(/does not start with fake/);
        expect(problems({ product: 'mail' }).join()).toMatch(/product "mail"/);
        expect(problems({ scope: 'files.read' }).join()).toMatch(/not one of the notes scopes/);
        expect(problems({ caps: { maxItems: 0, maxChars: 10 } }).join()).toMatch(/caps/);
        expect(problems({ input: { ...good.input, properties: { connectionId: { type: 'string' } } } }).join()).toMatch(/reserved/);
        expect(problems({ input: { ...good.input, properties: { limit: { type: 'integer' } } } }).join()).toMatch(/no minimum and maximum/);
        expect(problems({ input: { ...good.input, properties: { folder: { type: 'string' } } } }).join()).toMatch(/folder has no maxLength/);
        expect(problems({ input: { ...good.input, additionalProperties: true } }).join()).toMatch(/additionalProperties/);
        expect(connectorTools.problemsOf(fake, [good, good]).join()).toMatch(/used twice/);
    });

    it('loads no tools for a provider the registry skipped', () => {
        const fs = require('fs');
        const path = require('path');
        const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'connectors-'));
        fs.mkdirSync(path.join(dir, 'bad'));
        fs.writeFileSync(path.join(dir, 'bad', 'index.js'), "module.exports = { id: 'bad', name: 'Bad' };");
        fs.writeFileSync(path.join(dir, 'bad', 'tools.js'), "module.exports = [{ key: 'bad.notes.list' }];");
        try {
            expect(connectorTools.make(dir).all()).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('a skill reader built from a tool', () => {
    const { READER_CATALOGUE } = require('../Modules/Agents/skills/catalogues');

    it('keeps an integer an integer and bounds connectionId', () => {
        expect(READER_CATALOGUE[KEY].params.limit).toMatchObject({ type: 'integer', min: 1, max: 20, default: 5 });
        expect(READER_CATALOGUE[KEY].params.connectionId).toMatchObject({ type: 'string', maxLength: 64 });
    });

    it('is checked against those bounds when a skill is saved', () => {
        const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
        const prompt = { partials: ['json_only'], instructions: 'Summarise the notes.', template: '{{gather.notes.text}}', output: '{"summary":"..."}' };
        const step = (params) => validateSkill({ key: 'team.notes', name: 'Notes', inputs: [], gather: [{ reader: KEY, as: 'notes', params }], prompt, emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }] });
        const fields = (checked) => checked.errors.map((e) => `${e.field} ${e.code}`);
        expect(fields(step({ limit: 2.5 }))).toContain('gather[0].params.limit invalid_params');
        expect(fields(step({ connectionId: 'x'.repeat(65) }))).toContain('gather[0].params.connectionId invalid_params');
        const kept = step({ limit: 3, connectionId: 'conn-prisha' });
        expect(fields(kept)).toEqual([]);
        expect(kept.value.gather[0].params).toMatchObject({ limit: 3, connectionId: 'conn-prisha' });
    });
});

describe('one definition, registered for agents and MCP', () => {
    it('is an agent action, a reader and an MCP tool while CONNECTORS names its provider', () => {
        expect(registry.has(KEY)).toBe(true);
        expect(offeredReaders()).toContain(KEY);
        expect(mcpTools.names()).toContain(KEY);
        process.env.CONNECTORS = 'slack';
        expect(registry.has(KEY)).toBe(false);
        expect(offeredReaders()).not.toContain(KEY);
        expect(mcpTools.names()).not.toContain(KEY);
    });

    it('offers connectors:read and connectors:write at consent only while a provider\'s tools are on', () => {
        expect(mcpOAuth.offeredScopes()).toEqual(expect.arrayContaining(['connectors:read', 'connectors:write']));
        expect(mcpOAuth.WRITE_SCOPES).not.toContain('connectors:write');
        process.env.CONNECTORS = '';
        expect(mcpOAuth.offeredScopes()).not.toContain('connectors:read');
    });
});

describe('from an agent run', () => {
    it('reads the person\'s own connection, marks the run and counts the read', async () => {
        const out = await agentRead({ limit: 2 });
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'fake' });
        expect(out.text).toBe('- Board meeting\n- Call the bank');
        expect(out.taint).toEqual([expect.objectContaining({ kind: 'connector', ref: expect.stringMatching(/^fake:[0-9a-f]{16}$/) })]);
        expect(runRow().connectorReads).toEqual([expect.objectContaining({ action: KEY, connector: 'fake', connectionId: MINE, state: 'applied', chars: out.text.length })]);
        const [url, options] = safeFetch.mock.calls[0];
        expect(url).toBe('https://api.fake.test/notes?limit=2');
        expect(options.headers.Authorization).toBe('Bearer secret-token');
        expect(options.maxRedirects).toBe(0);
    });

    it('makes no web fetch after the read', async () => {
        await egressContext.run({ companyId: C }, async () => {
            await readers.read(KEY, C, { runId: RUN, actor, allowedActions: [] }, {});
            await expect(agentFetch.audit('https://example.com/')).rejects.toMatchObject({ code: 'connector_read' });
        });
    });

    it('stops at the run\'s cap on connector reads', async () => {
        mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0].connectorReads = [1, 2, 3].map(() => ({ state: 'applied', chars: 10 }));
        await expect(agentRead()).rejects.toMatchObject({ code: 'run_call_cap' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('counts a read that failed, so an agent cannot retry past the cap', async () => {
        safeFetch.mockRejectedValue(new Error('provider down'));
        for (let i = 0; i < 3; i += 1) await expect(agentRead()).rejects.toThrow('provider down');
        expect(runRow().connectorReads.map((r) => r.state)).toEqual(['failed', 'failed', 'failed']);
        await expect(agentRead()).rejects.toMatchObject({ code: 'run_call_cap' });
        expect(safeFetch).toHaveBeenCalledTimes(3);
    });

    it('lets only as many racing reads through as the run has calls left', async () => {
        const outcomes = await Promise.allSettled([1, 2, 3, 4].map(() => agentRead()));
        expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(3);
        expect(outcomes.filter((o) => o.status === 'rejected').map((o) => o.reason.code)).toEqual(['run_call_cap']);
        expect(safeFetch).toHaveBeenCalledTimes(3);
    });

    it('sends a GET whatever method the read tool asks for', async () => {
        const tool = connectorTools.get(KEY);
        jest.spyOn(connectorTools, 'get').mockReturnValue({ ...tool, run: async ({ connection }) => (await connection.request('https://api.fake.test/notes', { method: 'post', json: { title: 'x' } })).body });
        try {
            await agentRead();
        } finally {
            connectorTools.get.mockRestore();
        }
        const [, options] = safeFetch.mock.calls[0];
        expect(options.method).toBe('get');
        expect(options.data).toBeUndefined();
    });
});

describe('from MCP', () => {
    it('is listed and runs for a token holding connectors:read', async () => {
        expect(mcpTools.manifest(mcp(['connectors:read'])).map((t) => t.name)).toContain(KEY);
        const out = await mcpTools.call(mcp(['connectors:read']), KEY, { limit: 1 });
        expect(out.text).toContain('Board meeting');
        expect(resolveConnection).toHaveBeenCalledWith({ companyId: C, userId: PRISHA, provider: 'fake' });
    });

    it('is neither listed nor run for a token without connectors:read', async () => {
        const reader = mcp(['tasks:read', 'projects:read']);
        expect(mcpTools.manifest(reader).map((t) => t.name)).not.toContain(KEY);
        await expect(mcpTools.call(reader, KEY, {})).rejects.toThrow(/connectors:read/);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('only the caller\'s own connection', () => {
    it('refuses a connectionId that is not the caller\'s, before anything is fetched', async () => {
        const out = await mcpTools.call(mcp(['connectors:read']), KEY, { connectionId: 'conn-someone-else' });
        expect(out).toMatchObject({ code: 'not_connected' });
        await expect(agentRead({ connectionId: 'conn-someone-else' })).rejects.toMatchObject({ code: 'not_connected' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('tells a person with no connection to connect the provider', async () => {
        resolveConnection.mockRejectedValue(connectorError('not_connected'));
        expect(await mcpTools.call(mcp(['connectors:read']), KEY, {})).toEqual({ code: 'not_connected', error: 'Connect Fake on My connections first, then ask again.' });
    });

    it('names the product to tick when the connection lacks the tool\'s scope', async () => {
        connected(['files.read']);
        expect(await mcpTools.call(mcp(['connectors:read']), KEY, {})).toEqual({ code: 'scope_missing', error: 'Tick notes on your Fake connection in My connections, then ask again.' });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('sends the token to no host the provider does not name', async () => {
        const tool = connectorTools.get(KEY);
        await egressContext.run({ companyId: C }, async () => {
            await expect(agentFetch.callApi('https://evil.test/x', { token: 't', hosts: tool.definition.egressHosts })).rejects.toMatchObject({ code: 'host_not_declared' });
        });
        expect(safeFetch).not.toHaveBeenCalled();
    });
});
