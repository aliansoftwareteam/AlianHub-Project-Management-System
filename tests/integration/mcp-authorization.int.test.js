const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { answerAuthorization, authorizeWithSdk, memoryProvider, sdkAuth } = require('../support/mcpOAuthClient');

/* Sprint 10 slice S9: the MCP 2025-11-25 authorization flow end to end, driven by the official SDK's
 * client auth where it has a piece for the step and by plain HTTP where the step is an attack. Each
 * refusal here is listed with its rule in docs/security/mcp-checklist.md. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const REDIRECT = 'http://127.0.0.1:47303/callback';
const DOCUMENT_HOST = 'agent.s10s9.test';
const DOCUMENT_ID = `https://${DOCUMENT_HOST}/oauth/client.json`;
const SHIM = path.join(__dirname, '..', 'support', 'clientMetadataHosts.js');

const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');
const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined)).toString();
const basic = (id, secret) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const list = (id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });

let server;
let documentServer;
let documentHits = [];
let mongo;
let session;
let base;
let mcpUrl;

const mcp = async (message, { token, headers = {}, query = '' } = {}) => {
    const res = await fetch(`${mcpUrl}${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: JSON.stringify(message),
    });
    const text = await res.text();
    return { res, status: res.status, body: text ? JSON.parse(text) : null };
};
const payloadOf = (out) => JSON.parse(out.body.result.content[0].text);

const tokenEndpoint = (body, headers = {}) => fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body),
}).then(async (res) => ({ status: res.status, body: await res.json() }));

/* A public client's authorization by hand, for the steps where the request itself is the attack. */
const authorizeByHand = (params) => answerAuthorization(`${base}/oauth/authorize?${new URLSearchParams(Object.entries({
    response_type: 'code', client_id: DOCUMENT_ID, redirect_uri: REDIRECT, scope: 'tasks:read', state: 's10s9', resource: mcpUrl, ...params,
}).filter(([, v]) => v !== undefined))}`, session);

const exchangeByHand = (code, verifier, extra = {}) => tokenEndpoint({
    grant_type: 'authorization_code', client_id: DOCUMENT_ID, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: mcpUrl, ...extra,
});

const publicToken = async (scope = 'tasks:read') => {
    const verifier = newVerifier();
    const answered = await authorizeByHand({ scope, code_challenge: challengeOf(verifier), code_challenge_method: 'S256' });
    expect(answered.code).toBeTruthy();
    const out = await exchangeByHand(answered.code, verifier);
    expect(out.status).toBe(200);
    return out.body;
};

const documentProvider = () => memoryProvider({
    redirectUrl: REDIRECT,
    clientMetadataUrl: DOCUMENT_ID,
    clientMetadata: { client_name: 'S10S9 metadata document agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] },
});

beforeAll(async () => {
    documentServer = http.createServer((req, res) => {
        documentHits.push(req.url);
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({
            client_id: DOCUMENT_ID,
            client_name: 'S10S9 metadata document agent',
            redirect_uris: [REDIRECT],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
        }));
    });
    await new Promise((resolve) => documentServer.listen(0, '127.0.0.1', resolve));
    mongo = await MongoClient.connect(resolveMongoUrl());
    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'mcp-authorization-server.log'),
        env: {
            MCP_OAUTH: 'both',
            NODE_ENV: 'test',
            MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000',
            MCP_TEST_CLIENT_METADATA_HOSTS: `${DOCUMENT_HOST}=127.0.0.1:${documentServer.address().port}`,
            NODE_OPTIONS: `--require "${SHIM}"`,
        },
    });
    base = server.baseURL;
    mcpUrl = `${base}/mcp`;
    session = { ...(await login(base, emailFor('owner'))), companyId: state.companyId };
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    if (server) await server.stop();
    if (mongo) await mongo.close();
    if (documentServer) await new Promise((done) => documentServer.close(done));
}, BOOT_TIMEOUT_MS);

describe('discovery', () => {
    it('answers an unauthenticated call with 401 and a challenge naming the resource metadata', async () => {
        const out = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 's10s9', version: '1' } } });
        expect(out.status).toBe(401);
        const challenge = sdkAuth.extractWWWAuthenticateParams(out.res);
        expect(String(challenge.resourceMetadataUrl)).toBe(`${base}/.well-known/oauth-protected-resource/mcp`);
        expect(challenge.error).toBeUndefined();
        expect(challenge.scope.split(' ').every((scope) => scope.endsWith(':read'))).toBe(true);
    });

    it('publishes resource metadata, then server metadata that requires S256', async () => {
        const resource = await sdkAuth.discoverOAuthProtectedResourceMetadata(mcpUrl, { resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource/mcp` });
        expect(resource).toMatchObject({ resource: mcpUrl, authorization_servers: [base], bearer_methods_supported: ['header'] });
        const metadata = await sdkAuth.discoverAuthorizationServerMetadata(resource.authorization_servers[0]);
        expect(metadata.issuer).toBe(base);
        expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
        expect(metadata.client_id_metadata_document_supported).toBe(true);
        expect(metadata.registration_endpoint).toBeUndefined();
    });
});

describe('a pre-registered client stepping up from tasks:read', () => {
    let provider;
    let client;

    beforeAll(async () => {
        const res = await fetch(`${base}/api/v2/oauth-clients`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}`, companyid: session.companyId },
            body: JSON.stringify({ name: `S10S9 pre-registered ${uniqueSuffix()}`, redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'client_secret_basic' }),
        });
        expect(res.status).toBe(201);
        const { data } = await res.json();
        client = { client_id: data.clientId, client_secret: data.clientSecret, token_endpoint_auth_method: 'client_secret_basic' };
        provider = memoryProvider({ redirectUrl: REDIRECT, clientMetadata: { client_name: 'S10S9', redirect_uris: [REDIRECT] }, clientInformation: client });
    });

    it('authorizes with PKCE and resource, and lists tools through the SDK client', async () => {
        const tokens = await authorizeWithSdk(provider, { serverUrl: mcpUrl, scope: 'tasks:read', session });
        expect(tokens.scope).toBe('tasks:read');
        const sdkClient = new Client({ name: 's10s9', version: '1' });
        await sdkClient.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: provider }));
        const { tools } = await sdkClient.listTools();
        expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['tasks.search', 'task.create']));
        await sdkClient.close();
    });

    it('refuses a write with 403 insufficient_scope, then writes after stepping up', async () => {
        const write = call('task.create', { projectId: state.projects.shared._id, title: `S10S9 step-up ${uniqueSuffix()}` }, 2);
        const refused = await mcp(write, { token: provider.saved.tokens.access_token });
        expect(refused.status).toBe(403);
        expect(refused.body.error.data).toMatchObject({ error: 'insufficient_scope', requiredScopes: ['tasks:write'] });
        const challenge = sdkAuth.extractWWWAuthenticateParams(refused.res);
        expect(challenge).toMatchObject({ error: 'insufficient_scope', scope: 'tasks:read tasks:write' });
        expect(String(challenge.resourceMetadataUrl)).toBe(`${base}/.well-known/oauth-protected-resource/mcp`);

        const stepped = await authorizeWithSdk(provider, { serverUrl: mcpUrl, scope: challenge.scope, session });
        expect(stepped.scope).toBe('tasks:read tasks:write');
        const wrote = await mcp(write, { token: stepped.access_token });
        expect(wrote.status).toBe(200);
        expect(payloadOf(wrote)).toMatchObject({ ok: true });
    });

    it('rotates the refresh token, and a replayed one revokes the whole family', async () => {
        const metadata = await sdkAuth.discoverAuthorizationServerMetadata(base);
        const first = provider.saved.tokens;
        const second = await sdkAuth.refreshAuthorization(base, { metadata, clientInformation: client, refreshToken: first.refresh_token, resource: new URL(mcpUrl) });
        expect(second.refresh_token).not.toBe(first.refresh_token);
        expect((await mcp(list(), { token: second.access_token })).status).toBe(200);

        await expect(sdkAuth.refreshAuthorization(base, { metadata, clientInformation: client, refreshToken: first.refresh_token, resource: new URL(mcpUrl) }))
            .rejects.toThrow();
        const afterReplay = await tokenEndpoint({ grant_type: 'refresh_token', refresh_token: second.refresh_token, resource: mcpUrl }, { authorization: basic(client.client_id, client.client_secret) });
        expect(afterReplay).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
        const stale = await mcp(list(), { token: second.access_token });
        expect(stale.status).toBe(401);
        expect(sdkAuth.extractWWWAuthenticateParams(stale.res).error).toBe('invalid_token');
    });
});

describe('a client ID metadata document client', () => {
    let provider;

    it('is fetched from the document the test serves and completes the flow', async () => {
        documentHits = [];
        provider = documentProvider();
        const tokens = await authorizeWithSdk(provider, { serverUrl: mcpUrl, scope: 'tasks:read', session });
        expect(provider.saved.clientInformation.client_id).toBe(DOCUMENT_ID);
        expect(documentHits).toEqual(['/oauth/client.json']);
        expect((await mcp(list(), { token: tokens.access_token })).status).toBe(200);
    });

    it('is never fetched from a loopback or private address', async () => {
        documentHits = [];
        const port = documentServer.address().port;
        for (const clientId of [`https://127.0.0.1:${port}/oauth/client.json`, `https://localhost:${port}/oauth/client.json`, 'https://169.254.169.254/latest/meta-data/client.json']) {
            const out = await answerAuthorization(`${base}/oauth/authorize?${new URLSearchParams({
                response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(newVerifier()), code_challenge_method: 'S256', resource: mcpUrl,
            })}`, session);
            expect([clientId, out.status, out.error]).toEqual([clientId, 400, 'invalid_client']);
        }
        expect(documentHits).toEqual([]);
    });
});

describe('PKCE', () => {
    it('is required at the authorization endpoint, S256 only', async () => {
        const without = await authorizeByHand({});
        expect(without.location && without.location.origin + without.location.pathname).toBe(REDIRECT);
        expect(without.error).toBe('invalid_request');
        const plain = await authorizeByHand({ code_challenge: newVerifier(), code_challenge_method: 'plain' });
        expect(plain.error).toBe('invalid_request');
    });

    it('refuses a code exchanged with the wrong verifier, and the code is spent', async () => {
        const verifier = newVerifier();
        const answered = await authorizeByHand({ code_challenge: challengeOf(verifier), code_challenge_method: 'S256' });
        expect(answered.code).toBeTruthy();
        const wrong = await exchangeByHand(answered.code, newVerifier());
        expect(wrong).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
        const right = await exchangeByHand(answered.code, verifier);
        expect(right).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    });

    it('refuses a code exchanged without a verifier', async () => {
        const verifier = newVerifier();
        const answered = await authorizeByHand({ code_challenge: challengeOf(verifier), code_challenge_method: 'S256' });
        const none = await exchangeByHand(answered.code, undefined);
        expect(none).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    });
});

describe('audience binding', () => {
    it('will not issue a token for another resource', async () => {
        const verifier = newVerifier();
        const elsewhere = await authorizeByHand({ code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: 'https://elsewhere.example/mcp' });
        expect(elsewhere.error).toBe('invalid_target');
        const answered = await authorizeByHand({ code_challenge: challengeOf(verifier), code_challenge_method: 'S256' });
        const exchanged = await exchangeByHand(answered.code, verifier, { resource: `${mcpUrl}/` });
        expect(exchanged).toMatchObject({ status: 400, body: { error: 'invalid_target' } });
    });

    it.each(['https://elsewhere.example/mcp', 'TRAILING_SLASH'])('answers 401 to a live token whose audience is %s', async (audience) => {
        const tokens = await publicToken();
        expect((await mcp(list(), { token: tokens.access_token })).status).toBe(200);
        const row = await mongo.db('global').collection('oauth_tokens').findOne({ kind: 'access', clientId: DOCUMENT_ID }, { sort: { createdAt: -1 } });
        const resource = audience === 'TRAILING_SLASH' ? `${mcpUrl}/` : audience;
        await mongo.db('global').collection('oauth_tokens').updateOne({ _id: row._id }, { $set: { resource } });
        const out = await mcp(list(), { token: tokens.access_token });
        expect(out.status).toBe(401);
        expect(sdkAuth.extractWWWAuthenticateParams(out.res).error).toBe('invalid_token');
    });
});

describe('where a token is accepted', () => {
    let tokens;
    beforeAll(async () => { tokens = await publicToken(); });

    it.each(['access_token', 'token', 'bearer'])('refuses a token in the query string as %s', async (key) => {
        const alone = await mcp(list(), { query: `?${key}=${encodeURIComponent(tokens.access_token)}` });
        expect(alone.status).toBe(400);
        expect(sdkAuth.extractWWWAuthenticateParams(alone.res).error).toBe('invalid_request');
        const withHeader = await mcp(list(), { token: tokens.access_token, query: `?${key}=${encodeURIComponent(tokens.access_token)}` });
        expect(withHeader.status).toBe(400);
    });

    it('never takes an Mcp-Session-Id as authorization, whatever it holds', async () => {
        const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 's10s9', version: '1' } } }, { token: tokens.access_token });
        expect(init.status).toBe(200);
        const issued = init.res.headers.get('mcp-session-id');
        for (const sessionId of [issued, crypto.randomUUID(), tokens.access_token].filter(Boolean)) {
            const out = await mcp(list(), { headers: { 'mcp-session-id': sessionId, companyid: session.companyId } });
            expect(out.status).toBe(401);
        }
    });

    it('answers 401 mid-session once the grant is revoked', async () => {
        const provider = documentProvider();
        const live = await authorizeWithSdk(provider, { serverUrl: mcpUrl, scope: 'tasks:read', session });
        const sdkClient = new Client({ name: 's10s9-revoke', version: '1' });
        await sdkClient.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: provider }));
        expect((await sdkClient.listTools()).tools.length).toBeGreaterThan(0);

        const revoked = await fetch(`${base}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: DOCUMENT_ID, token: live.refresh_token }) });
        expect(revoked.status).toBe(200);

        const out = await mcp(list(), { token: live.access_token });
        expect(out.status).toBe(401);
        await expect(sdkClient.listTools()).rejects.toThrow();
        await sdkClient.close();
    });
});
