const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn() }));

const { dbCollections } = require('../Config/collections');
const apiTokens = require('../Modules/ApiTokens/controller');
const { resolveActor, attribution } = require('../Modules/Agents/actor');
const server = require('../Modules/Mcp/server');

const USER_ID = '6f0000000000000000000001';
const C = '6f0000000000000000000c01';
const pat = (over = {}) => ({ _id: '6f0000000000000000000101', name: 'Laptop token', userId: USER_ID, scopes: ['read', 'write'], active: true, ...over });
const agentToken = (over = {}) => pat({ name: 'Reviewer CLI', kind: 'agent', agentAccount: { mode: 'personal', provider: 'cursor' }, ...over });
const req = (over = {}) => ({ headers: {}, query: {}, body: {}, uid: USER_ID, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(dbCollections.USERS, { _id: USER_ID, Employee_Name: 'Mevil' });
});

describe('F2 — a plain personal token is an agent when it arrives over MCP', () => {
    it('marks the caller as an agent named after the token, on a local account', async () => {
        const actor = await resolveActor(req({ apiToken: pat(), mcp: true }));
        expect(actor).toMatchObject({ kind: 'agent', userId: USER_ID, agentId: null, agentName: 'Laptop token', viaAccount: 'local', personName: 'Mevil', tokenName: 'Laptop token' });
        expect(attribution(actor)).toMatchObject({ actorType: 'agent', actorId: USER_ID, viaAccount: 'local', label: 'Laptop token' });
    });

    it('takes the account mode and provider from the user when they linked one', async () => {
        mockDb.store[dbCollections.USERS][0].agentAccount = { mode: 'personal', provider: 'claude-code', label: 'My Claude' };
        const actor = await resolveActor(req({ apiToken: pat(), mcp: true }));
        expect(actor).toMatchObject({ kind: 'agent', viaAccount: 'personal', provider: 'claude-code', agentName: 'Laptop token' });
        expect(attribution(actor).label).toBe('Mevil via claude-code');
    });

    it('falls back to "MCP" when the token has no name', async () => {
        const actor = await resolveActor(req({ apiToken: pat({ name: '' }), mcp: true }));
        expect(actor.agentName).toBe('MCP');
    });

    it('keeps the same token human outside MCP', async () => {
        const actor = await resolveActor(req({ apiToken: pat() }));
        expect(actor).toMatchObject({ kind: 'human', userId: USER_ID, viaAccount: 'workspace', agentName: null });
        expect(attribution(actor).actorType).toBe('human');
    });

    it('keeps a web session human', async () => {
        const actor = await resolveActor(req());
        expect(actor).toMatchObject({ kind: 'human', tokenId: null, viaAccount: 'workspace' });
    });

    it('leaves an agent-kind token exactly as before, over MCP or not', async () => {
        const direct = await resolveActor(req({ apiToken: agentToken() }));
        const viaMcp = await resolveActor(req({ apiToken: agentToken(), mcp: true }));
        expect(direct).toMatchObject({ kind: 'agent', agentName: 'Reviewer CLI', viaAccount: 'personal', provider: 'cursor' });
        expect(viaMcp).toEqual(direct);
        const nameless = await resolveActor(req({ apiToken: agentToken({ name: '' }), mcp: true }));
        expect(nameless.agentName).toBe('CLI agent');
    });
});

describe('F2 — the MCP server marks the request before resolving the actor', () => {
    it('authenticate sets req.mcp and returns an agent actor for a plain token', async () => {
        apiTokens.verifyToken.mockResolvedValue(pat());
        const r = req({ headers: { authorization: 'Bearer ah_abc' }, query: { companyId: C } });
        const ctx = await server.authenticate(r);
        expect(apiTokens.verifyToken).toHaveBeenCalledWith(C, 'ah_abc');
        expect(r.mcp).toBe(true);
        expect(ctx).toMatchObject({ companyId: C, userId: USER_ID, canWrite: true });
        expect(ctx.actor).toMatchObject({ kind: 'agent', agentName: 'Laptop token', viaAccount: 'local' });
    });

    it('does not mark the request when the token is rejected', async () => {
        apiTokens.verifyToken.mockResolvedValue(null);
        const r = req({ headers: { authorization: 'Bearer nope' }, query: { companyId: C } });
        expect(await server.authenticate(r)).toBeNull();
        expect(r.mcp).toBeUndefined();
    });
});
