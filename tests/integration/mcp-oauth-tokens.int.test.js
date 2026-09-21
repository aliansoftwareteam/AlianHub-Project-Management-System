const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

/* Sprint 10 slice S4: a scripted OAuth client against /mcp on the real app and database. The consent step
 * is the test-only path until slice S3 ships the consent screen, so the server runs with NODE_ENV=test. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const REDIRECT = 'http://127.0.0.1:47292/callback';
const ALLOWLIST_KEY = 'WEBHOOK_ALLOWED_PRIVATE_HOSTS';

const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');
const challengeParams = (header) => Object.fromEntries([...String(header).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

async function waitFor(check, { timeoutMs = 20000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

const received = [];
let sink;
let server;
let mongo;
let owner;
let project;
let webhookId;
const tokens = [];

const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined)).toString();

const authorizeAndExchange = async (clientId, scope) => {
    const verifier = newVerifier();
    const query = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 's10s4',
        code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
    });
    const authorized = await fetch(`${server.baseURL}/oauth/authorize?${query}`, {
        redirect: 'manual',
        headers: { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'x-oauth-test-consent': 'approve' },
    });
    expect(authorized.status).toBe(302);
    const code = new URL(authorized.headers.get('location')).searchParams.get('code');
    const res = await fetch(`${server.baseURL}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${server.baseURL}/mcp` }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    tokens.push(body.access_token, body.refresh_token);
    return body.access_token;
};

const mcp = async (accessToken, message, headers = {}) => {
    const res = await fetch(`${server.baseURL}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...headers },
        body: JSON.stringify(message),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};
const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const payloadOf = (res) => JSON.parse(res.body.result.content[0].text);

beforeAll(async () => {
    await new Promise((resolve) => {
        const listener = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => { received.push({ url: req.url, headers: req.headers, body }); res.end('ok'); });
        });
        listener.listen(0, '127.0.0.1', () => { sink = { listener, port: listener.address().port }; resolve(); });
    });
    mongo = await MongoClient.connect(resolveMongoUrl());
    const admin = await loginAs('owner');
    expect((await admin.api.put('/api/v2/instance/settings', { [ALLOWLIST_KEY]: '127.0.0.1' })).status).toBe(200);
    const hook = await admin.api.post('/api/v2/webhooks', { name: `S10S4 ${uniqueSuffix()}`, url: `http://127.0.0.1:${sink.port}/hook/s10s4`, events: ['task.created'] });
    expect(hook.body.status).toBe(true);
    webhookId = hook.body.data._id;
    project = await createProject(admin.api, { assigneeIds: [admin.uid], createdBy: admin.uid });

    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'mcp-oauth-tokens-server.log'),
        env: { MCP_OAUTH: 'both', MCP_OAUTH_DCR: 'on', NODE_ENV: 'test', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000' },
    });
    owner = await login(server.baseURL, emailFor('owner'));
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    if (server) await server.stop();
    const admin = await loginAs('owner');
    if (webhookId) await admin.api.delete(`/api/v2/webhooks/${webhookId}`);
    await admin.api.put('/api/v2/instance/settings', { [ALLOWLIST_KEY]: '' });
    if (mongo) await mongo.close();
    if (sink) await new Promise((done) => sink.listener.close(done));
}, BOOT_TIMEOUT_MS);

describe('an OAuth client on /mcp with MCP_OAUTH=both', () => {
    let clientId;

    beforeAll(async () => {
        const res = await fetch(`${server.baseURL}/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: 'S10S4 scripted agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }),
        });
        expect(res.status).toBe(201);
        clientId = (await res.json()).client_id;
    });

    it('reads with tasks:read, is refused a write with insufficient_scope, and writes after stepping up', async () => {
        const reader = await authorizeAndExchange(clientId, 'tasks:read');
        const init = await mcp(reader, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 's10s4', version: '1' } } });
        expect(init.status).toBe(200);
        expect(init.body.result.protocolVersion).toBe('2025-11-25');

        const read = await mcp(reader, call('tasks.search', { query: 'E2E' }), { 'mcp-protocol-version': '2025-11-25' });
        expect(read.status).toBe(200);
        expect(read.body.result.isError).toBeUndefined();
        expect(Array.isArray(payloadOf(read).tasks)).toBe(true);

        const refused = await mcp(reader, call('task.create', { projectId: String(project._id), title: 'S10S4 refused' }, 2));
        expect(refused.status).toBe(403);
        expect(challengeParams(refused.headers.get('www-authenticate'))).toMatchObject({
            error: 'insufficient_scope', scope: 'tasks:read tasks:write', resource_metadata: `${server.baseURL}/.well-known/oauth-protected-resource/mcp`,
        });

        const writer = await authorizeAndExchange(clientId, 'tasks:read tasks:write');
        const title = `S10S4 filed ${uniqueSuffix()}`;
        const wrote = await mcp(writer, call('task.create', { projectId: String(project._id), title }, 3));
        expect(wrote.status).toBe(200);
        const out = payloadOf(wrote);
        expect(out).toMatchObject({ ok: true });

        const db = mongo.db(state.companyId);
        const row = await waitFor(() => db.collection('audit_logs').findOne({ action: 'agent.action', 'meta.action': 'task.create', 'meta.clientId': clientId }));
        expect(row).toMatchObject({ actorId: clientId, meta: { viaAccount: 'external', delegatedBy: owner.uid, onBehalfOf: owner.uid, tainted: true } });
        expect(row.meta.grantId).toMatch(/^[a-f0-9]{32}$/);
        const activity = await db.collection('apiActivityLogs').findOne({ clientId });
        expect(activity).toMatchObject({ path: '/mcp', grantId: expect.any(String), userId: owner.uid });

        const delivered = await waitFor(() => received.find((r) => r.body.includes(title)));
        expect(delivered).toBeTruthy();
        const everything = JSON.stringify(received);
        for (const token of tokens) expect(everything).not.toContain(token);
    });

    it('refuses a companyId naming another workspace', async () => {
        const reader = await authorizeAndExchange(clientId, 'tasks:read');
        const res = await mcp(reader, call('tasks.search', {}), { companyid: '6f0000000000000000000fff' });
        expect(res.status).toBe(403);
    });

    it('answers 400 to an unknown MCP-Protocol-Version', async () => {
        const reader = await authorizeAndExchange(clientId, 'tasks:read');
        const res = await mcp(reader, call('tasks.search', {}), { 'mcp-protocol-version': '1999-01-01' });
        expect(res.status).toBe(400);
    });

    it('takes neither a signed-in session cookie nor an Mcp-Session-Id as authorization', async () => {
        const login = await fetch(`${server.baseURL}/api/v2/auth/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: emailFor('owner'), password: state.password }),
        });
        const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
        expect(cookies).not.toBe('');
        const withCookie = await mcp(null, call('tasks.search', {}), { cookie: cookies, companyid: state.companyId });
        expect(withCookie.status).toBe(401);
        const withSession = await mcp(null, call('tasks.search', {}), { 'mcp-session-id': crypto.randomUUID(), companyid: state.companyId });
        expect(withSession.status).toBe(401);
    });

    it('stops honouring a token once its grant is revoked', async () => {
        const reader = await authorizeAndExchange(clientId, 'tasks:read');
        expect((await mcp(reader, call('tasks.search', {}))).status).toBe(200);
        const grant = await mongo.db('global').collection('oauth_tokens').findOne({ kind: 'access', clientId }, { sort: { createdAt: -1 } });
        await mongo.db('global').collection('oauth_grants').updateOne({ grantId: grant.grantId }, { $set: { revokedAt: new Date(), revokedReason: 's10s4' } });
        const res = await mcp(reader, call('tasks.search', {}));
        expect(res.status).toBe(401);
        expect(challengeParams(res.headers.get('www-authenticate')).error).toBe('invalid_token');
    });

    it('still takes a personal access token under both', async () => {
        const res = await fetch(`${server.baseURL}/api/v2/api-tokens`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId },
            body: JSON.stringify({ name: `[QA s10s4] ${uniqueSuffix()}`, scopes: ['read'], expiresInDays: 1 }),
        });
        const pat = (await res.json()).data;
        const out = await mcp(pat.token, call('tasks.search', {}), { companyid: state.companyId });
        expect(out.status).toBe(200);
        await fetch(`${server.baseURL}/api/v2/api-tokens/${pat._id}`, { method: 'DELETE', headers: { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId } });
    });
});
