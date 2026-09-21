jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async () => ({ kind: 'agent', userId: '6f0000000000000000000001' })) }));
jest.mock('../Modules/Agents/actions', () => ({ RefusedError: class RefusedError extends Error {} }));
jest.mock('../Modules/Agents/registry', () => ({ NEVER: [] }));
jest.mock('../Modules/Mcp/tools', () => ({ manifest: () => [], call: jest.fn(async () => ({ ok: true })) }));

const express = require('express');
const apiTokens = require('../Modules/ApiTokens/controller');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');
const routes = require('../Modules/Mcp/routes');

const USER_ID = '6f0000000000000000000001';
const C = '6f0000000000000000000c01';
const RAW = `ahp_${'a'.repeat(48)}`;
const ISSUER = 'https://hub.example.com';
const METADATA_URL = `${ISSUER}/.well-known/oauth-protected-resource/mcp`;
const ALL_SCOPES = ['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write'];
const READ_SCOPES = 'tasks:read projects:read docs:read time:read';
const BETA_401_BODY = { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'A valid bearer token and companyId are required.' } };

const tokenWith = (scopes) => ({ _id: '6f0000000000000000000101', name: 'Laptop', userId: USER_ID, scopes, active: true });
const call = (name, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });

const request = ({ body = { jsonrpc: '2.0', id: 1, method: 'ping' }, authorization = `Bearer ${RAW}`, query = {} } = {}) => ({
    headers: authorization ? { authorization } : {}, query: { companyId: C, ...query }, body, ip: '1.1.1.1',
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

const challengeParams = (header) => Object.fromEntries([...String(header).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

const ENV_KEYS = ['MCP_OAUTH', 'MCP_OAUTH_ISSUER', 'APIURL', 'API_TOKEN_STRICT'];
const saved = {};
beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
afterEach(() => { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MCP_OAUTH;
    delete process.env.MCP_OAUTH_ISSUER;
    process.env.APIURL = `${ISSUER}/`;
    apiTokens.verifyToken.mockResolvedValue(tokenWith(['read', 'write']));
});

const flagOn = () => { process.env.MCP_OAUTH = 'on'; };

describe('protected resource metadata (RFC 9728)', () => {
    let listener;
    const serve = async (env) => {
        const app = express();
        routes.init(app, env);
        await new Promise((resolve) => { listener = app.listen(0, '127.0.0.1', resolve); });
        return `http://127.0.0.1:${listener.address().port}`;
    };
    afterEach(async () => { if (listener) await new Promise((resolve) => listener.close(resolve)); listener = null; });

    it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])('serves %s with the flag on', async (path) => {
        const base = await serve({ MCP_OAUTH: 'on', APIURL: `${ISSUER}/` });
        const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
        expect(res.status).toBe(200);
        const doc = await res.json();
        expect(doc).toMatchObject({
            resource: `${ISSUER}/mcp`,
            authorization_servers: [ISSUER],
            scopes_supported: ALL_SCOPES,
            bearer_methods_supported: ['header'],
        });
    });

    it('names MCP_OAUTH_ISSUER over APIURL, as the authorization server does', async () => {
        const base = await serve({ MCP_OAUTH: 'on', APIURL: 'http://internal:4000/', MCP_OAUTH_ISSUER: 'https://mcp.example.org/' });
        const doc = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
        expect(doc.resource).toBe('https://mcp.example.org/mcp');
        expect(doc.authorization_servers).toEqual(['https://mcp.example.org']);
    });

    it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])('answers 404 for %s with the flag off', async (path) => {
        const base = await serve({ APIURL: `${ISSUER}/` });
        const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
        expect(res.status).toBe(404);
    });
});

describe('the 401 challenge', () => {
    it('is exactly beta\'s with the flag off', async () => {
        apiTokens.verifyToken.mockResolvedValue(null);
        const res = await post(request({ body: call('task.comment') }));
        expect(res.statusCode).toBe(401);
        expect(res.headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="alianhub-mcp"' });
        expect(res.body).toEqual(BETA_401_BODY);
    });

    it('carries resource_metadata and the default read scopes for discovery with the flag on', async () => {
        flagOn();
        const res = await post(request({ authorization: '' }));
        expect(res.statusCode).toBe(401);
        const header = res.headers['WWW-Authenticate'];
        expect(header.startsWith('Bearer ')).toBe(true);
        expect(challengeParams(header)).toEqual({ realm: 'alianhub-mcp', resource_metadata: METADATA_URL, scope: READ_SCOPES });
        expect(res.body).toEqual(BETA_401_BODY);
    });

    it('names the scope the requested tool needs, and invalid_token for a rejected token', async () => {
        flagOn();
        apiTokens.verifyToken.mockResolvedValue(null);
        const res = await post(request({ body: call('timelog.start') }));
        expect(res.statusCode).toBe(401);
        expect(challengeParams(res.headers['WWW-Authenticate'])).toEqual({
            realm: 'alianhub-mcp', error: 'invalid_token', resource_metadata: METADATA_URL, scope: 'time:write',
        });
    });

    it('challenges the GET probe the same way', async () => {
        flagOn();
        const res = response();
        await server.get(request({ authorization: '', body: undefined }), res);
        expect(res.statusCode).toBe(401);
        expect(challengeParams(res.headers['WWW-Authenticate']).resource_metadata).toBe(METADATA_URL);
    });
});

describe('403 insufficient_scope', () => {
    it('refuses a write with a read-only token, names the needed scope, and runs nothing', async () => {
        flagOn();
        apiTokens.verifyToken.mockResolvedValue(tokenWith(['read']));
        const res = await post(request({ body: call('task.comment', 7) }));
        expect(res.statusCode).toBe(403);
        const params = challengeParams(res.headers['WWW-Authenticate']);
        expect(params.error).toBe('insufficient_scope');
        expect(params.scope.split(' ')).toContain('tasks:write');
        expect(params.scope.split(' ')).toEqual(expect.arrayContaining(READ_SCOPES.split(' ')));
        expect(params.resource_metadata).toBe(METADATA_URL);
        expect(res.body).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32004, data: { error: 'insufficient_scope', requiredScopes: ['tasks:write'] } } });
        expect(res.body.error.message).toMatch(/tasks:write/);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('refuses a whole batch before any of it runs', async () => {
        flagOn();
        apiTokens.verifyToken.mockResolvedValue(tokenWith(['read']));
        const res = await post(request({ body: [call('tasks.search', 1), call('timelog.stop', 2)] }));
        expect(res.statusCode).toBe(403);
        expect(res.body.error.data.requiredScopes).toEqual(['time:write']);
        expect(tools.call).not.toHaveBeenCalled();
    });

    it('lets the same read-only token read', async () => {
        flagOn();
        apiTokens.verifyToken.mockResolvedValue(tokenWith(['read']));
        const res = await post(request({ body: call('tasks.search') }));
        expect(res.statusCode).toBe(200);
        expect(tools.call).toHaveBeenCalledTimes(1);
    });

    it('keeps beta\'s in-band refusal with the flag off', async () => {
        apiTokens.verifyToken.mockResolvedValue(tokenWith(['read']));
        const res = await post(request({ body: call('task.comment') }));
        expect(res.statusCode).toBe(200);
        expect(res.headers['WWW-Authenticate']).toBeUndefined();
        expect(tools.call).toHaveBeenCalledTimes(1);
    });
});

describe('protocol version negotiation', () => {
    const initialize = (protocolVersion) => ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 't', version: '1' } } });

    it.each([
        ['2025-11-25', '2025-11-25'],
        ['2025-06-18', '2025-06-18'],
        ['1999-01-01', '2025-11-25'],
    ])('with the flag on, a client asking %s is answered %s', async (asked, answered) => {
        flagOn();
        const res = await post(request({ body: initialize(asked) }));
        expect(res.body.result.protocolVersion).toBe(answered);
    });

    it('with the flag off, answers 2025-06-18 whatever is asked', async () => {
        const res = await post(request({ body: initialize('2025-11-25') }));
        expect(res.body.result.protocolVersion).toBe('2025-06-18');
    });
});

describe('tokens in the query string', () => {
    it.each([
        [{ access_token: RAW }],
        [{ key: RAW }],
    ])('are refused with the flag on, before any lookup (%o)', async (query) => {
        flagOn();
        const res = await post(request({ query }));
        expect(res.statusCode).toBe(400);
        expect(challengeParams(res.headers['WWW-Authenticate'])).toMatchObject({ error: 'invalid_request', resource_metadata: METADATA_URL });
        expect(apiTokens.verifyToken).not.toHaveBeenCalled();
    });

    it('are refused on the GET probe too', async () => {
        flagOn();
        const res = response();
        await server.get(request({ query: { access_token: RAW }, body: undefined }), res);
        expect(res.statusCode).toBe(400);
    });

    it('are ignored as on beta with the flag off', async () => {
        const res = await post(request({ query: { access_token: RAW } }));
        expect(res.statusCode).toBe(200);
    });
});
