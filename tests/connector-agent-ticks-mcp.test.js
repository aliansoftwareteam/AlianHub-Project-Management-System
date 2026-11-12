const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors-mcp')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBroken: jest.fn(async () => {}), markBackoff: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const connections = require('../Modules/Connectors/resolveConnection');
const mcpClient = require('../Modules/Connectors/mcpClient');
const readers = require('../Modules/Agents/skills/readers');
const egressContext = require('../Modules/Agents/engine/egressContext');
const fakeMcpServer = require('./fixtures/fakeMcpServer');

/* An app reached through its own MCP server is held to the agent's ticks like a built connector: the server is not
 * even opened for an agent that has not ticked the tool. */

const C = '6f0000000000000000000c02';
const PRISHA = '6f0000000000000000000a02';
const RUN = '6f0000000000000000000d02';
const SEARCH = 'notesmcp.notes.search';
const ENV = { CONNECTORS: 'notesmcp', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

let server;
const actor = { kind: 'agent', userId: PRISHA, agentId: '6f0000000000000000000b02', agentName: 'Digest', runId: RUN };
const agentRead = (connectors) => egressContext.run({ companyId: C }, () => readers.read(SEARCH, C, { runId: RUN, actor, allowedActions: [], connectors }, { query: 'bank' }));

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mcpClient.forget();
    server = fakeMcpServer.create();
    safeFetch.mockImplementation((url, opts) => server.handle(url, opts));
    connections.resolveConnection.mockResolvedValue({ connectionId: 'conn-prisha-notes', scopes: [], getAccessToken: async () => 'prisha-notes-token' });
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, status: 'running', connectorReads: [] });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('an MCP app an agent has not ticked', () => {
    it.each([['nothing ticked', []], ['only its write ticked', [{ provider: 'notesmcp', tools: ['notesmcp.note.create'] }]]])('is refused with %s, and its server is never opened', async (_, connectors) => {
        await expect(agentRead(connectors)).rejects.toMatchObject({ code: 'agent_not_allowed', message: expect.stringContaining('Notes') });
        expect(connections.resolveConnection).not.toHaveBeenCalled();
        expect(safeFetch).not.toHaveBeenCalled();
        expect(server.calls).toEqual([]);
    });
});

describe('an MCP app an agent has ticked', () => {
    it('is read through the server with the person\'s own token', async () => {
        const out = await agentRead([{ provider: 'notesmcp', tools: [SEARCH] }]);
        expect(out.text).toContain('Found 2 notes');
        expect(server.calls).toEqual([{ name: 'search_notes', args: { query: 'bank' }, authorization: 'Bearer prisha-notes-token' }]);
    });
});
