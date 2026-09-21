const crypto = require('crypto');

const mockDb = require('./fixtures/fakeMongo').create();
const mockApproved = { value: true };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {}, rating: () => null }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn(async () => ({ ok: true })) }));
// Slice S3's per-workspace approval, standing in until that module lands.
jest.mock('../Modules/Mcp/approvalsHook', () => {
    const approvals = { isClientApproved: jest.fn(async () => mockApproved.value) };
    return { load: jest.fn(() => approvals) };
});

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const jwt = require('../Config/jwt');
const apiTokens = require('../Modules/ApiTokens/controller');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');
const grants = require('../Modules/OAuthServer/grants');
const clients = require('../Modules/OAuthServer/clients');
const approvals = require('../Modules/Mcp/approvalsHook').load();

/* Sprint 10 slice S4: /mcp accepts audience-bound OAuth access tokens. */

const ISSUER = 'https://hub.s10s4.test';
const RESOURCE = `${ISSUER}/mcp`;
const METADATA_URL = `${ISSUER}/.well-known/oauth-protected-resource/mcp`;
const C = '6f0000000000000000000c41';
const OTHER_C = '6f0000000000000000000c42';
const USER = '6f0000000000000000000a41';
const REDIRECT = 'http://127.0.0.1:41414/callback';
const PAT = `ahp_${'b'.repeat(48)}`;
const BETA_401_BODY = { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'A valid bearer token and companyId are required.' } };
const HOUR = 60 * 60 * 1000;

const ENV_KEYS = ['MCP_OAUTH', 'MCP_OAUTH_ISSUER', 'APIURL', 'JWT_SECRET', 'MCP_OAUTH_TOKEN_SECRET', 'API_TOKEN_STRICT'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');
const challengeParams = (header) => Object.fromEntries([...String(header).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

const store = (type) => mockDb.store[type] || [];

const mint = async ({ scopes = ['tasks:read'], companyId = C, now = new Date(), client: given } = {}) => {
    const client = given || (await clients.register({ kind: 'dynamic', name: 'S10S4 Agent', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none' })).client;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const { code, grant } = await grants.issueCode({ client, companyId, userId: USER, scopes, redirectUri: REDIRECT, codeChallenge: challengeOf(verifier), now });
    const issued = await grants.exchangeCode({ client, code, codeVerifier: verifier, redirectUri: REDIRECT, resource: RESOURCE, now });
    return { client, grant, raw: issued.access_token, refresh: issued.refresh_token };
};

const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const call = (name, args = {}, id = 1) => rpc('tools/call', { name, arguments: args }, id);

const request = ({ body = rpc('ping'), token, headers = {}, query = {} } = {}) => ({
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, query, body, ip: '10.1.1.1',
});
const response = () => {
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.end = jest.fn(() => res);
    return res;
};
const post = async (req) => { const res = response(); await server.post(req, res); return res; };
const get = async (req) => { const res = response(); await server.get(req, res); return res; };

const expectInvalidToken = (res) => {
    expect(res.statusCode).toBe(401);
    expect(challengeParams(res.headers['WWW-Authenticate'])).toMatchObject({ error: 'invalid_token', resource_metadata: METADATA_URL });
    expect(tools.call).not.toHaveBeenCalled();
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockApproved.value = true;
    process.env.APIURL = `${ISSUER}/`;
    process.env.JWT_SECRET = 's10s4-test-secret';
    delete process.env.MCP_OAUTH_ISSUER;
    delete process.env.MCP_OAUTH_TOKEN_SECRET;
    delete process.env.API_TOKEN_STRICT;
    process.env.MCP_OAUTH = 'both';
    mockDb.seed(dbCollections.USERS, { _id: USER, Employee_Name: 'Priya', AssignCompany: C });
    apiTokens.verifyToken.mockResolvedValue({ _id: '6f0000000000000000000141', name: 'Laptop', userId: USER, scopes: ['read', 'write'], active: true });
});

describe('an OAuth access token on /mcp', () => {
    it('is accepted, and the token\'s workspace is the call\'s workspace', async () => {
        const { raw, grant, client } = await mint();
        const res = await post(request({ token: raw, body: call('tasks.search') }));
        expect(res.statusCode).toBe(200);
        expect(tools.call).toHaveBeenCalledTimes(1);
        const [ctx] = tools.call.mock.calls[0];
        expect(ctx).toMatchObject({ companyId: C, userId: USER });
        expect(ctx.oauth).toEqual({ clientId: client.clientId, grantId: grant.grantId, scopes: ['tasks:read'] });
        expect(apiTokens.verifyToken).not.toHaveBeenCalled();
    });

    it('answers the GET probe once authenticated', async () => {
        const { raw } = await mint();
        const res = await get(request({ token: raw, body: undefined }));
        expect(res.statusCode).toBe(405);
    });

    it('is refused for another audience with a 401 challenge', async () => {
        const { raw } = await mint();
        store(SCHEMA_TYPE.OAUTH_TOKENS).filter((row) => row.kind === 'access').forEach((row) => { row.resource = 'https://other.example.com/mcp'; });
        expectInvalidToken(await post(request({ token: raw })));
    });

    it.each([
        ['a trailing slash', `${RESOURCE}/`],
        ['an upper-case host', 'https://HUB.s10s4.test/mcp'],
        ['an upper-case path', `${ISSUER}/MCP`],
        ['a query', `${RESOURCE}?x=1`],
    ])('is refused when its audience differs by %s', async (label, audience) => {
        const { raw } = await mint();
        store(SCHEMA_TYPE.OAUTH_TOKENS).filter((row) => row.kind === 'access').forEach((row) => { row.resource = audience; });
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused when the server\'s own resource moved (the token names the old one)', async () => {
        const { raw } = await mint();
        process.env.MCP_OAUTH_ISSUER = 'https://moved.s10s4.test';
        const res = await post(request({ token: raw }));
        expect(res.statusCode).toBe(401);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('is refused once expired', async () => {
        const { raw } = await mint({ now: new Date(Date.now() - 2 * HOUR) });
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused once its grant is revoked, even with the token row untouched', async () => {
        const { raw, grant } = await mint();
        store(SCHEMA_TYPE.OAUTH_GRANTS).find((g) => g.grantId === grant.grantId).revokedAt = new Date();
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused once its grant is revoked through the authorization server', async () => {
        const { raw, grant } = await mint();
        await grants.revokeGrant(grant.grantId, 'test');
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused past its grant\'s cap', async () => {
        const { raw, grant } = await mint();
        store(SCHEMA_TYPE.OAUTH_GRANTS).find((g) => g.grantId === grant.grantId).expiresAt = new Date(Date.now() - 1000);
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused once its client is revoked, even with the grant and token rows untouched', async () => {
        const { raw, client } = await mint();
        store(SCHEMA_TYPE.OAUTH_CLIENTS).find((row) => row.clientId === client.clientId).revokedAt = new Date();
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused when the workspace no longer approves the client (slice S3 hook)', async () => {
        const { raw, client } = await mint();
        mockApproved.value = false;
        expectInvalidToken(await post(request({ token: raw })));
        expect(approvals.isClientApproved).toHaveBeenCalledWith(C, client.clientId);
    });

    it('is refused when it is not a token this server issued', async () => {
        expectInvalidToken(await post(request({ token: `ahoa_${'x'.repeat(43)}` })));
    });

    it('is refused when a refresh token is presented as the bearer', async () => {
        const { refresh } = await mint();
        const res = await post(request({ token: refresh }));
        expect(res.statusCode).toBe(401);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('cuts off a person who left the workspace', async () => {
        const { raw } = await mint();
        jwt.verifyCompanyMembership.mockResolvedValueOnce(false);
        const res = await post(request({ token: raw }));
        expect(res.statusCode).toBe(403);
        expect(jwt.verifyCompanyMembership).toHaveBeenCalledWith(USER, C);
        expect(tools.call).not.toHaveBeenCalled();
    });
});

describe('a client ID metadata document client (a URL, no client row)', () => {
    const DOCUMENT_CLIENT = { clientId: 'https://agent.s10s4.test/oauth/client.json', kind: 'metadata_document', tokenEndpointAuthMethod: 'none', scopes: [], redirectUris: [REDIRECT] };

    it('is accepted and named after its host', async () => {
        const { raw, grant } = await mint({ client: DOCUMENT_CLIENT });
        const res = await post(request({ token: raw, body: call('tasks.search') }));
        expect(res.statusCode).toBe(200);
        const [ctx] = tools.call.mock.calls[0];
        expect(ctx.oauth).toMatchObject({ clientId: DOCUMENT_CLIENT.clientId, grantId: grant.grantId });
        expect(ctx.actor).toMatchObject({ clientId: DOCUMENT_CLIENT.clientId, agentName: 'agent.s10s4.test' });
        expect(store(SCHEMA_TYPE.OAUTH_CLIENTS)).toHaveLength(0);
    });

    it('is refused once its grant is revoked', async () => {
        const { raw, grant } = await mint({ client: DOCUMENT_CLIENT });
        store(SCHEMA_TYPE.OAUTH_GRANTS).find((g) => g.grantId === grant.grantId).revokedAt = new Date();
        expectInvalidToken(await post(request({ token: raw })));
    });

    it('is refused once the workspace withdraws its approval', async () => {
        const { raw } = await mint({ client: DOCUMENT_CLIENT });
        mockApproved.value = false;
        expectInvalidToken(await post(request({ token: raw })));
        expect(approvals.isClientApproved).toHaveBeenCalledWith(C, DOCUMENT_CLIENT.clientId);
    });
});

describe('the token\'s workspace is the only workspace', () => {
    it.each([
        ['query', { query: { companyId: OTHER_C } }],
        ['header', { headers: { companyid: OTHER_C } }],
    ])('refuses a companyId in the %s that names another workspace', async (where, extra) => {
        const { raw } = await mint();
        const res = await post(request({ token: raw, body: call('tasks.search'), ...extra }));
        expect(res.statusCode).toBe(403);
        expect(res.body.error.message).toMatch(/another workspace/);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('accepts a companyId that names the token\'s own workspace', async () => {
        const { raw } = await mint();
        const res = await post(request({ token: raw, body: call('tasks.search'), query: { companyId: C }, headers: { companyid: C } }));
        expect(res.statusCode).toBe(200);
    });
});

describe('scopes come from the token', () => {
    it('refuses a write with 403 insufficient_scope naming what the token holds and lacks', async () => {
        const { raw } = await mint({ scopes: ['tasks:read'] });
        const res = await post(request({ token: raw, body: call('task.comment', { taskId: 'x', body: 'y' }, 9) }));
        expect(res.statusCode).toBe(403);
        const params = challengeParams(res.headers['WWW-Authenticate']);
        expect(params).toMatchObject({ error: 'insufficient_scope', scope: 'tasks:read tasks:write', resource_metadata: METADATA_URL });
        expect(res.body).toMatchObject({ id: 9, error: { code: -32004, data: { error: 'insufficient_scope', requiredScopes: ['tasks:write'] } } });
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('does not read a *:read scope into another area', async () => {
        const { raw } = await mint({ scopes: ['tasks:read'] });
        const res = await post(request({ token: raw, body: call('docs.read', { pageId: 'x' }) }));
        expect(res.statusCode).toBe(403);
        expect(res.body.error.data.requiredScopes).toEqual(['docs:read']);
    });

    it('lets the write through once the token holds tasks:write', async () => {
        const { raw } = await mint({ scopes: ['tasks:read', 'tasks:write'] });
        const res = await post(request({ token: raw, body: call('task.comment', { taskId: 'x', body: 'y' }) }));
        expect(res.statusCode).toBe(200);
        expect(tools.call).toHaveBeenCalledTimes(1);
    });
});

describe('MCP_OAUTH modes', () => {
    it('under only, answers a personal token with 401 and the challenge', async () => {
        process.env.MCP_OAUTH = 'only';
        const res = await post(request({ token: PAT, query: { companyId: C } }));
        expect(res.statusCode).toBe(401);
        expect(challengeParams(res.headers['WWW-Authenticate'])).toMatchObject({ error: 'invalid_token', resource_metadata: METADATA_URL });
        expect(apiTokens.verifyToken).not.toHaveBeenCalled();
    });

    it('under only, still takes an OAuth token', async () => {
        process.env.MCP_OAUTH = 'only';
        const { raw } = await mint();
        expect((await post(request({ token: raw }))).statusCode).toBe(200);
    });

    it.each(['both', 'on', 'true'])('under %s, takes a personal token as before', async (value) => {
        process.env.MCP_OAUTH = value;
        const res = await post(request({ token: PAT, query: { companyId: C }, body: call('tasks.search') }));
        expect(res.statusCode).toBe(200);
        expect(apiTokens.verifyToken).toHaveBeenCalledWith(C, PAT);
        expect(tools.call.mock.calls[0][0].oauth).toBeUndefined();
    });

    it.each(['both', 'on'])('under %s, takes an OAuth token too', async (value) => {
        process.env.MCP_OAUTH = value;
        const { raw } = await mint();
        expect((await post(request({ token: raw }))).statusCode).toBe(200);
    });

    it.each([undefined, 'off', 'nonsense'])('with MCP_OAUTH=%s, an OAuth token gets exactly beta\'s 401', async (value) => {
        const { raw } = await mint();
        if (value === undefined) delete process.env.MCP_OAUTH; else process.env.MCP_OAUTH = value;
        apiTokens.verifyToken.mockResolvedValue(null);
        const res = await post(request({ token: raw, query: { companyId: C } }));
        expect(res.statusCode).toBe(401);
        expect(res.headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="alianhub-mcp"' });
        expect(res.body).toEqual(BETA_401_BODY);
    });

    it('with the flag off, a personal token works exactly as on beta', async () => {
        delete process.env.MCP_OAUTH;
        const res = await post(request({ token: PAT, query: { companyId: C }, body: call('task.comment'), headers: { 'mcp-protocol-version': '1999-01-01' } }));
        expect(res.statusCode).toBe(200);
        expect(tools.call).toHaveBeenCalledTimes(1);
        expect(apiTokens.logTokenActivity).toHaveBeenCalledWith(C, '6f0000000000000000000141', { method: 'POST', path: '/mcp', statusCode: 200, durationMs: 0, ip: '10.1.1.1' });
    });
});

describe('a session is never authorization', () => {
    it.each(['both', 'only'])('under %s, a session cookie alone gets 401', async (value) => {
        process.env.MCP_OAUTH = value;
        const res = await post(request({ headers: { cookie: 'ah_session=abc; ah_refresh=def' }, query: { companyId: C } }));
        expect(res.statusCode).toBe(401);
        expect(apiTokens.verifyToken).not.toHaveBeenCalled();
        expect(tools.call).not.toHaveBeenCalled();
    });

    it.each(['both', 'only'])('under %s, an Mcp-Session-Id alone gets 401', async (value) => {
        process.env.MCP_OAUTH = value;
        const { raw } = await mint();
        await post(request({ token: raw, body: rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } }) }));
        jest.clearAllMocks();
        const res = await post(request({ headers: { 'mcp-session-id': 'session-1' }, body: call('tasks.search') }));
        expect(res.statusCode).toBe(401);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('does not take an OAuth token from the query string', async () => {
        const { raw } = await mint();
        const res = await post(request({ query: { access_token: raw } }));
        expect(res.statusCode).toBe(400);
        const renamed = await post(request({ query: { t: raw } }));
        expect(renamed.statusCode).toBe(400);
        expect(tools.call).not.toHaveBeenCalled();
    });
});

describe('the inbound token stays at the door', () => {
    it('reaches neither the tool context nor the activity log', async () => {
        const { raw } = await mint({ scopes: ['tasks:read', 'tasks:write'] });
        await post(request({ token: raw, body: call('task.comment', { taskId: 'x', body: 'y' }) }));
        const [ctx] = tools.call.mock.calls[0];
        const seen = JSON.stringify(ctx);
        expect(seen).not.toContain(raw);
        expect(seen).not.toContain(raw.slice(5));
        expect(JSON.stringify(apiTokens.logTokenActivity.mock.calls)).not.toContain(raw);
    });
});

describe('activity log', () => {
    it('records the client and the grant for an OAuth call', async () => {
        const { raw, client, grant } = await mint();
        await post(request({ token: raw, body: call('tasks.search') }));
        expect(apiTokens.logTokenActivity).toHaveBeenCalledWith(C, null, {
            method: 'POST', path: '/mcp', statusCode: 200, durationMs: 0, ip: '10.1.1.1', clientId: client.clientId, grantId: grant.grantId, userId: USER,
        });
    });
});

describe('attribution of an OAuth call', () => {
    it('is an outside client acting for the person who granted it', async () => {
        const { raw, client, grant } = await mint();
        await post(request({ token: raw, body: call('tasks.search') }));
        const { actor } = tools.call.mock.calls[0][0];
        const { attribution } = require('../Modules/Agents/actor');
        expect(actor).toMatchObject({ kind: 'agent', userId: USER, viaAccount: 'external', clientId: client.clientId, grantId: grant.grantId, delegatedBy: USER, tokenId: null });
        expect(attribution(actor)).toEqual({
            actorId: client.clientId, actorType: 'agent', agentId: null, viaAccount: 'external',
            clientId: client.clientId, grantId: grant.grantId, delegatedBy: USER, label: 'S10S4 Agent for Priya',
        });
    });

    it('marks the call as coming from outside content', async () => {
        const { raw, client } = await mint();
        await post(request({ token: raw, body: call('tasks.search') }));
        const { taint } = tools.call.mock.calls[0][0];
        expect(taint).toMatchObject({ tainted: true, taintSources: [{ kind: 'client', ref: client.clientId }] });
    });
});

describe('MCP-Protocol-Version', () => {
    it.each(['2025-11-25', '2025-06-18'])('accepts %s', async (version) => {
        const { raw } = await mint();
        expect((await post(request({ token: raw, headers: { 'mcp-protocol-version': version } }))).statusCode).toBe(200);
    });

    it('accepts a request without it', async () => {
        const { raw } = await mint();
        expect((await post(request({ token: raw }))).statusCode).toBe(200);
    });

    it('answers an unknown version 400 before anything else', async () => {
        const { raw } = await mint();
        const res = await post(request({ token: raw, headers: { 'mcp-protocol-version': '1999-01-01' } }));
        expect(res.statusCode).toBe(400);
        expect(res.body.error.message).toMatch(/1999-01-01/);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('checks the GET probe too', async () => {
        const { raw } = await mint();
        expect((await get(request({ token: raw, body: undefined, headers: { 'mcp-protocol-version': 'nope' } }))).statusCode).toBe(400);
    });
});
