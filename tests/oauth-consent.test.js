const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const fakeMongo = require('./fixtures/fakeMongo');
const flow = require('./fixtures/oauthConsent');

let mockDb;
const mockSeats = {};
const mockNotified = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({
    handleNotificationtFun: jest.fn(async (req) => { mockNotified.push(req.body); return { status: true }; }),
}));
jest.mock('../Config/jwt', () => {
    const who = (req) => {
        const header = /^Bearer user:([a-f0-9]{24})$/.exec(String(req.headers.authorization || ''));
        if (header) return header[1];
        const cookie = /(?:^|;\s*)accessToken=user:([a-f0-9]{24})(?:;|$)/.exec(String(req.headers.cookie || ''));
        return cookie ? cookie[1] : null;
    };
    const guard = (req, res, next) => {
        const uid = who(req);
        if (!uid) return res.status(401).json({ status: false, error: 'Unauthorized' });
        req.uid = uid;
        if (req.headers['x-test-api-token']) req.apiToken = { _id: 'pat' };
        return next();
    };
    return { verifyJWTTokenWithCV2: jest.fn(guard), verifyJWTTokenV2: jest.fn(guard) };
});
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => {
        const seat = (mockSeats[companyId] || {})[uid];
        return seat === undefined ? null : seat;
    }),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ safeFetch: jest.fn() }));

const { recordAudit } = require('../Modules/Audit/recorder');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const createSchema = require('../utils/mongo-handler/createSchema');
const routes = require('../Modules/OAuthServer/routes');
const grants = require('../Modules/OAuthServer/grants');
const metadataDocument = require('../Modules/OAuthServer/metadataDocument');

const ISSUER = 'https://hub.s10s3.test';
const RESOURCE = `${ISSUER}/mcp`;
const ALPHA = '6f00000000000000000000c1';
const BETA = '6f00000000000000000000c2';
const GAMMA = '6f00000000000000000000c3';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const HTTPS_REDIRECT = 'https://agent.s10s3.test/oauth/callback';
const CIMD_ID = 'https://agent.s10s3.test/oauth/client.json';
const ENV_KEYS = ['MCP_OAUTH', 'MCP_OAUTH_ISSUER', 'MCP_OAUTH_TOKEN_SECRET', 'MCP_OAUTH_RATE_LIMIT_PER_MIN', 'MCP_OAUTH_DCR', 'CSP_MODE', 'NODE_ENV'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const INDEX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 's10s3-consent-'));
const INDEX_FILE = path.join(INDEX_DIR, 'index.html');
fs.writeFileSync(INDEX_FILE, '<!doctype html><title>s10s3 app shell</title><div id="app"></div>');

const session = (uid) => `accessToken=user:${uid}`;
const bearer = (uid, extra = {}) => ({ authorization: `Bearer user:${uid}`, companyid: ALPHA, 'content-type': 'application/json', ...extra });
const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

let server;
let base;

const start = async (env = {}) => {
    Object.assign(process.env, { MCP_OAUTH: 'on', MCP_OAUTH_ISSUER: ISSUER, MCP_OAUTH_TOKEN_SECRET: 's10s3-token-secret', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000', ...env });
    const app = express();
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
    routes.init(app, process.env, { indexFile: INDEX_FILE });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    return app;
};

const stop = () => new Promise((resolve) => (server ? server.close(() => { server = null; resolve(); }) : resolve()));

beforeEach(() => {
    mockDb = fakeMongo.create();
    mockDb.uniqueFromSchema(SCHEMA_TYPE.OAUTH_TOKENS, createSchema.oauthTokensSchema);
    mockDb.uniqueFromSchema(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, createSchema.oauthClientApprovalsSchema);
    for (const key of Object.keys(mockSeats)) delete mockSeats[key];
    Object.assign(mockSeats, {
        [ALPHA]: { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 },
        [BETA]: { [OWNER]: 1, [MEMBER]: 3 },
        [GAMMA]: { [ADMIN]: 1 },
    });
    const users = [[OWNER, [ALPHA, BETA]], [ADMIN, [ALPHA, GAMMA]], [MEMBER, [ALPHA, BETA]], [GUEST, [ALPHA]]];
    for (const [uid, companies] of users) mockDb.seed(SCHEMA_TYPE.USERS, { _id: uid, AssignCompany: companies });
    for (const [id, name] of [[ALPHA, 'Alpha Works'], [BETA, 'Beta Labs'], [GAMMA, 'Gamma Corp']]) mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: id, Cst_CompanyName: name });
    for (const [uid, roleType] of [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [GUEST, 0]]) mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: uid, roleType, status: 2, isDelete: false });
    mockNotified.length = 0;
    metadataDocument.forget();
    jest.clearAllMocks();
    delete process.env.CSP_MODE;
    delete process.env.MCP_OAUTH_DCR;
});

afterEach(stop);

afterAll(() => {
    fs.rmSync(INDEX_DIR, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

const rows = (type) => mockDb.store[type] || [];
const audited = (action) => recordAudit.mock.calls.filter(([, entry]) => entry.action === action);

const registerPublicClient = async (overrides = {}) => {
    const { client } = await require('../Modules/OAuthServer/clients').register({
        kind: 'dynamic', name: 'S10S3 agent', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none', ...overrides,
    });
    return client;
};

const authorizeUrl = (clientId, over = {}, verifier = newVerifier()) => `${base}/oauth/authorize?${new URLSearchParams(Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'tasks:read projects:read', state: 'st-s10s3',
    code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: RESOURCE, ...over,
}).filter(([, v]) => v !== undefined))}`;

const approvals = {
    approve: (uid, body, headers = {}) => fetch(`${base}/api/v2/oauth-client-approvals/approve`, { method: 'POST', headers: bearer(uid, headers), body: JSON.stringify(body) }),
    deny: (uid, body, headers = {}) => fetch(`${base}/api/v2/oauth-client-approvals/deny`, { method: 'POST', headers: bearer(uid, headers), body: JSON.stringify(body) }),
    revoke: (uid, body, headers = {}) => fetch(`${base}/api/v2/oauth-client-approvals/revoke`, { method: 'POST', headers: bearer(uid, headers), body: JSON.stringify(body) }),
    list: (uid, headers = {}) => fetch(`${base}/api/v2/oauth-client-approvals`, { headers: bearer(uid, headers) }),
};

const approve = async (clientId, { companyId = ALPHA, uid = OWNER, scopes, privateSprints } = {}) => {
    const res = await approvals.approve(uid, { clientId, scopes, privateSprints }, { companyid: companyId });
    expect(res.status).toBe(200);
    return (await res.json()).data;
};

const exchange = (clientId, code, verifier) => fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: flow.form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE }),
}).then((res) => res.json());

const consentedTokens = async (clientId, { uid = OWNER, workspace = ALPHA, scope } = {}) => {
    const verifier = newVerifier();
    const done = await flow.consentThrough(authorizeUrl(clientId, scope ? { scope } : {}, verifier), { session: session(uid), workspace });
    expect(done.status).toBe(303);
    const code = done.location.searchParams.get('code');
    expect(code).toBeTruthy();
    const tokens = await exchange(clientId, code, verifier);
    expect(tokens.access_token).toBeTruthy();
    return tokens;
};

describe('flag off', () => {
    it('registers none of the consent, approval or grant routes', async () => {
        await start({ MCP_OAUTH: 'off' });
        for (const [method, p] of [['GET', '/oauth/consent?request=x'], ['GET', '/oauth/consent/details'], ['POST', '/oauth/consent'], ['POST', '/oauth/consent/approval-request'],
            ['GET', '/api/v2/oauth-client-approvals'], ['POST', '/api/v2/oauth-client-approvals/approve'], ['GET', '/api/v2/oauth-grants'], ['DELETE', '/api/v2/oauth-grants/x']]) {
            const res = await fetch(base + p, { method, headers: bearer(OWNER) });
            expect([method, p, res.status]).toEqual([method, p, 404]);
        }
    });
});

describe('/oauth/authorize hands a valid request to the consent screen', () => {
    it('redirects to the consent page with a CSRF cookie bound to the request, and issues nothing', async () => {
        await start();
        const client = await registerPublicClient();
        const started = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect(started.status).toBe(302);
        expect(started.consent).not.toBeNull();
        expect(started.location.hash).toBe('#/oauth/consent');
        expect(started.consent.request).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        const { cookie } = started.consent;
        expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(cookie.attributes).toEqual(expect.arrayContaining(['Path=/oauth', 'HttpOnly', 'SameSite=Strict', 'Secure']));
        expect(started.consent.request).not.toContain(cookie.value);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.OAUTH_TOKENS)).toHaveLength(0);
    });

    it('still refuses a bad request before any consent, back to the client', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await flow.startAuthorization(authorizeUrl(client.clientId, { code_challenge_method: 'plain' }));
        expect(res.consent).toBeNull();
        expect(res.location.searchParams.get('error')).toBe('invalid_request');
    });
});

describe('the consent page', () => {
    const page = (request) => fetch(`${base}/oauth/consent?request=${encodeURIComponent(request)}`, { headers: { accept: 'text/html' } });
    const directives = (value) => Object.fromEntries(String(value || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources];
    }));

    it('sends its own policy: form-action to itself and the validated redirect URI only, never framed', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await page(consent.request);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('s10s3 app shell');
        const policy = directives(res.headers.get('content-security-policy'));
        expect(policy['form-action']).toEqual(["'self'", REDIRECT]);
        expect(policy['frame-ancestors']).toEqual(["'none'"]);
        expect(res.headers.get('x-frame-options')).toBe('DENY');
        expect(res.headers.get('referrer-policy')).toBe('no-referrer');
        expect(res.headers.get('cache-control')).toMatch(/no-store/);
    });

    it('keeps the app policy under CSP_MODE=enforce and replaces only form-action and frame-ancestors', async () => {
        await start({ CSP_MODE: 'enforce' });
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId, { redirect_uri: 'http://127.0.0.1:51234/callback' }));
        const res = await page(consent.request);
        const header = res.headers.get('content-security-policy');
        const policy = directives(header);
        expect(policy['script-src']).toContain("'self'");
        expect(policy['object-src']).toEqual(["'none'"]);
        expect(policy['form-action']).toEqual(["'self'", 'http://127.0.0.1:51234/callback']);
        expect(policy['frame-ancestors']).toEqual(["'none'"]);
        expect(header.match(/form-action/g)).toHaveLength(1);
    });

    it('names the https redirect URI without its query', async () => {
        await start();
        const client = await registerPublicClient({ redirectUris: [`${HTTPS_REDIRECT}?tenant=a`] });
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId, { redirect_uri: `${HTTPS_REDIRECT}?tenant=a` }));
        const policy = directives((await page(consent.request)).headers.get('content-security-policy'));
        expect(policy['form-action']).toEqual(["'self'", HTTPS_REDIRECT]);
    });

    it.each([
        ['a forged request', (request) => `${request.split('.')[0]}.${Buffer.from('forged').toString('base64url')}`],
        ['an altered request', (request) => {
            const [body, mac] = request.split('.');
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
            payload.r = 'https://evil.s10s3.test/cb';
            return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${mac}`;
        }],
        ['no request', () => ''],
    ])('refuses %s without serving the app or allowing any form target', async (label, mangle) => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await page(mangle(consent.request));
        expect(res.status).toBe(400);
        expect(await res.text()).not.toContain('s10s3 app shell');
        const policy = directives(res.headers.get('content-security-policy'));
        expect(policy['form-action']).toEqual(["'none'"]);
        expect(policy['frame-ancestors']).toEqual(["'none'"]);
    });

    it('refuses an expired request', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
        try {
            expect((await page(consent.request)).status).toBe(400);
            expect((await flow.answer(consent, { session: session(OWNER), workspace: ALPHA })).status).toBe(400);
        } finally {
            clock.mockRestore();
        }
    });
});

describe('what the consent screen shows', () => {
    it('shows the client, its redirect hostname with a loopback warning, the scopes, and only the person\'s workspaces', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: ALPHA });
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await flow.details(consent, { session: session(MEMBER) });
        expect(res.status).toBe(200);
        const { data } = res.body;
        expect(data.client).toMatchObject({ clientId: client.clientId, name: 'S10S3 agent', redirectHost: '127.0.0.1', loopback: true });
        expect(data.scopes).toEqual(['tasks:read', 'projects:read']);
        expect(data.csrf).toBe(consent.cookie.value);
        expect(data.workspaces).toEqual([
            expect.objectContaining({ id: ALPHA, name: 'Alpha Works', approval: 'approved', eligible: true }),
            expect.objectContaining({ id: BETA, name: 'Beta Labs', approval: 'none', eligible: false }),
        ]);
        expect(JSON.stringify(data)).not.toContain(GAMMA);
    });

    it('shows the client ID host of a metadata document client and no loopback warning for an https redirect', async () => {
        await start();
        safeFetch.mockImplementation(async () => ({ status: 200, headers: {}, body: JSON.stringify({ client_id: CIMD_ID, client_name: 'Doc agent', redirect_uris: [HTTPS_REDIRECT] }), bytes: 10, url: CIMD_ID }));
        const { consent } = await flow.startAuthorization(authorizeUrl(CIMD_ID, { redirect_uri: HTTPS_REDIRECT }));
        const { data } = (await flow.details(consent, { session: session(OWNER) })).body;
        expect(data.client).toMatchObject({ clientId: CIMD_ID, kind: 'metadata_document', clientHost: 'agent.s10s3.test', redirectHost: 'agent.s10s3.test', loopback: false });
    });

    it('marks a workspace whose approval does not cover the requested scopes as not eligible', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { scopes: ['tasks:read'] });
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const { data } = (await flow.details(consent, { session: session(OWNER) })).body;
        expect(data.workspaces.find((w) => w.id === ALPHA)).toMatchObject({ approval: 'approved', eligible: false, reason: 'scope_ceiling' });
    });

    it('answers only the browser that started the request, and never an API token', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.details({ ...consent, cookie: null }, { session: session(OWNER) })).status).toBe(403);
        expect((await flow.details(consent, { session: session(OWNER), headers: { 'x-test-api-token': '1' } })).status).toBe(403);
        expect((await flow.details(consent, {})).status).toBe(401);
    });
});

describe('per-workspace client approval', () => {
    it('refuses consent for an unapproved client and creates an approval request, notifying owners and admins', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await flow.answer(consent, { session: session(MEMBER), workspace: ALPHA });
        expect(res.status).toBe(403);
        expect(res.location).toBeNull();
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
        const [row] = rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS);
        expect(row).toMatchObject({ companyId: ALPHA, clientId: client.clientId, clientName: 'S10S3 agent', status: 'pending', requestedBy: MEMBER, requestedScopes: ['tasks:read', 'projects:read'], privateSprints: false });
        expect(mockNotified).toHaveLength(1);
        expect(mockNotified[0]).toMatchObject({ companyId: ALPHA, changeType: 'oauth_client_approval' });
        expect([...mockNotified[0].assigneeUsers].sort()).toEqual([OWNER, ADMIN].sort());
        expect(audited('oauth.client_approval_requested')).toEqual([[ALPHA, expect.objectContaining({ actorId: MEMBER, entityId: client.clientId })]]);
    });

    it('lets a member ask for approval from the consent screen, once', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const first = await flow.requestApproval(consent, { session: session(MEMBER), workspace: ALPHA });
        expect(first.status).toBe(200);
        expect(first.body.data).toMatchObject({ approval: 'pending' });
        const again = await flow.requestApproval(consent, { session: session(OWNER), workspace: ALPHA });
        expect(again.status).toBe(200);
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toHaveLength(1);
        expect(mockNotified).toHaveLength(1);
        expect((await flow.requestApproval(consent, { session: session(MEMBER), workspace: GAMMA })).status).toBe(403);
        expect((await flow.requestApproval(consent, { session: session(MEMBER), workspace: ALPHA, csrf: 'x'.repeat(43) })).status).toBe(403);
    });

    it('binds an approved client\'s grant to the one chosen workspace', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: ALPHA });
        await approve(client.clientId, { companyId: BETA });
        const verifier = newVerifier();
        const done = await flow.consentThrough(authorizeUrl(client.clientId, {}, verifier), { session: session(MEMBER), workspace: BETA });
        expect(done.status).toBe(303);
        expect(done.location.origin + done.location.pathname).toBe(REDIRECT);
        expect(done.location.searchParams.get('state')).toBe('st-s10s3');
        expect(done.location.searchParams.get('iss')).toBe(ISSUER);
        const tokens = await exchange(client.clientId, done.location.searchParams.get('code'), verifier);
        expect(await grants.introspect(tokens.access_token)).toMatchObject({ active: true, companyId: BETA, userId: MEMBER, scopes: ['tasks:read', 'projects:read'] });
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toEqual([expect.objectContaining({ companyId: BETA, userId: MEMBER })]);
    });

    it('refuses a workspace the person is not in, even where the client is approved', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: GAMMA, uid: ADMIN });
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await flow.answer(consent, { session: session(MEMBER), workspace: GAMMA });
        expect(res.status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).filter((r) => r.status === 'pending')).toHaveLength(0);
    });

    it('refuses a workspace where the client is not approved, even when it is approved in another', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: ALPHA });
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { session: session(MEMBER), workspace: BETA })).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('refuses scopes beyond what the workspace approved', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { scopes: ['tasks:read'] });
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { session: session(OWNER), workspace: ALPHA })).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
        await consentedTokens(client.clientId, { scope: 'tasks:read' });
    });

    it('refuses a denied client', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        await flow.requestApproval(consent, { session: session(MEMBER), workspace: ALPHA });
        expect((await approvals.deny(ADMIN, { clientId: client.clientId })).status).toBe(200);
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)[0]).toMatchObject({ status: 'denied', decidedBy: ADMIN });
        expect((await flow.answer(consent, { session: session(OWNER), workspace: ALPHA })).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('carries the private-sprint opt-in on the approval, off unless an admin sets it', async () => {
        await start();
        const client = await registerPublicClient();
        expect(await approve(client.clientId)).toMatchObject({ status: 'approved', privateSprints: false, scopes: ['tasks:read', 'projects:read', 'docs:read', 'time:read'] });
        expect(await approve(client.clientId, { privateSprints: true, scopes: ['tasks:read', 'tasks:write'] })).toMatchObject({ privateSprints: true, scopes: ['tasks:read', 'tasks:write'] });
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toEqual([expect.objectContaining({ privateSprints: true, scopes: ['tasks:read', 'tasks:write'] })]);
        const listed = (await (await approvals.list(OWNER)).json()).data;
        expect(listed).toEqual([expect.objectContaining({ clientId: client.clientId, clientName: 'S10S3 agent', status: 'approved', privateSprints: true })]);
    });

    it('refuses an unknown scope in an approval', async () => {
        await start();
        const client = await registerPublicClient();
        expect((await approvals.approve(OWNER, { clientId: client.clientId, scopes: ['tasks:read', 'admin'] })).status).toBe(400);
        expect((await approvals.approve(OWNER, { clientId: client.clientId, privateSprints: 'yes' })).status).toBe(400);
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toHaveLength(0);
    });

    it('approves a pre-registered client in the workspace that registered it, audited, and nowhere else', async () => {
        await start();
        const res = await fetch(`${base}/api/v2/oauth-clients`, { method: 'POST', headers: bearer(OWNER), body: JSON.stringify({ name: 'S10S3 CI', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none', scopes: ['tasks:read'] }) });
        const { data } = await res.json();
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toEqual([expect.objectContaining({ companyId: ALPHA, clientId: data.clientId, status: 'approved', scopes: ['tasks:read'], decidedBy: OWNER })]);
        expect(audited('oauth.client_approved')).toEqual([[ALPHA, expect.objectContaining({ actorId: OWNER, entityId: data.clientId })]]);
        await consentedTokens(data.clientId, { scope: 'tasks:read' });
        const { consent } = await flow.startAuthorization(authorizeUrl(data.clientId, { scope: 'tasks:read' }));
        expect((await flow.answer(consent, { session: session(OWNER), workspace: BETA })).status).toBe(403);
        expect((await approvals.approve(OWNER, { clientId: data.clientId }, { companyid: BETA })).status).toBe(400);
    });
});

describe('CSRF on the consent answer', () => {
    it('requires the token in the form', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { session: session(OWNER), workspace: ALPHA, csrf: '' })).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('requires the cookie, so a cross-site post carrying only the form cannot answer', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { workspace: ALPHA, cookie: session(OWNER) })).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('binds the token to its own request: another request\'s cookie and token do not answer this one', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const mine = (await flow.startAuthorization(authorizeUrl(client.clientId))).consent;
        const theirs = (await flow.startAuthorization(authorizeUrl(client.clientId))).consent;
        const res = await flow.answer(theirs, { session: session(OWNER), workspace: ALPHA, request: mine.request });
        expect(res.status).toBe(403);
        const swapped = await flow.answer(mine, { session: session(OWNER), workspace: ALPHA, cookie: `${mine.cookie.name}=${theirs.cookie.value}; ${session(OWNER)}`, csrf: theirs.cookie.value });
        expect(swapped.status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('needs a signed-in person and never an API token', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { workspace: ALPHA })).status).toBe(401);
        expect((await flow.answer(consent, { session: session(OWNER), workspace: ALPHA, headers: { 'x-test-api-token': '1' } })).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('answers a request once: the cookie is cleared with the redirect', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await fetch(`${base}/oauth/consent`, {
            method: 'POST', redirect: 'manual',
            headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${consent.cookie.name}=${consent.cookie.value}; ${session(OWNER)}` },
            body: flow.form({ request: consent.request, csrf: consent.cookie.value, decision: 'approve', workspace: ALPHA }),
        });
        expect(res.status).toBe(303);
        expect(res.headers.getSetCookie().some((line) => line.startsWith(`${consent.cookie.name}=;`) && /Expires=Thu, 01 Jan 1970/.test(line))).toBe(true);
    });
});

describe('deny', () => {
    it('returns access_denied with state and iss to the redirect URI, and issues nothing', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await flow.answer(consent, { session: session(MEMBER), decision: 'deny' });
        expect(res.status).toBe(303);
        expect(res.location.origin + res.location.pathname).toBe(REDIRECT);
        expect(res.location.searchParams.get('error')).toBe('access_denied');
        expect(res.location.searchParams.get('state')).toBe('st-s10s3');
        expect(res.location.searchParams.get('iss')).toBe(ISSUER);
        expect(res.location.searchParams.get('code')).toBeNull();
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('still needs the CSRF token, so a forged deny cannot bounce a person to the client', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        const res = await flow.answer(consent, { session: session(MEMBER), decision: 'deny', csrf: '' });
        expect(res.status).toBe(403);
        expect(res.location).toBeNull();
    });

    it('refuses an unknown decision', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { session: session(OWNER), workspace: ALPHA, decision: 'maybe' })).status).toBe(400);
    });
});

describe('revoking an approval', () => {
    it('revokes every grant of that client in that workspace, and their tokens stop working on the next request', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: ALPHA });
        await approve(client.clientId, { companyId: BETA });
        const alpha = await consentedTokens(client.clientId, { uid: MEMBER, workspace: ALPHA });
        const alphaOwner = await consentedTokens(client.clientId, { uid: OWNER, workspace: ALPHA });
        const beta = await consentedTokens(client.clientId, { uid: MEMBER, workspace: BETA });

        const res = await approvals.revoke(ADMIN, { clientId: client.clientId });
        expect(res.status).toBe(200);
        for (const tokens of [alpha, alphaOwner]) expect((await grants.introspect(tokens.access_token)).active).toBe(false);
        expect((await grants.introspect(beta.access_token)).active).toBe(true);
        const refreshed = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: flow.form({ grant_type: 'refresh_token', client_id: client.clientId, refresh_token: alpha.refresh_token, resource: RESOURCE }) }).then((r) => r.json());
        expect(refreshed.error).toBe('invalid_grant');
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS).find((r) => r.companyId === ALPHA)).toMatchObject({ status: 'revoked', revokedBy: ADMIN });
        expect(audited('oauth.client_approval_revoked')).toEqual([[ALPHA, expect.objectContaining({ actorId: ADMIN, entityId: client.clientId })]]);

        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        expect((await flow.answer(consent, { session: session(MEMBER), workspace: ALPHA })).status).toBe(403);
    });

    it('also stops a code that was issued but not yet exchanged', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const verifier = newVerifier();
        const done = await flow.consentThrough(authorizeUrl(client.clientId, {}, verifier), { session: session(OWNER), workspace: ALPHA });
        await approvals.revoke(OWNER, { clientId: client.clientId });
        expect((await exchange(client.clientId, done.location.searchParams.get('code'), verifier)).error).toBe('invalid_grant');
    });

    it('answers 404 for a client with no approval to revoke', async () => {
        await start();
        expect((await approvals.revoke(OWNER, { clientId: 'ahc_000000000000000000000000' })).status).toBe(404);
    });
});

describe('roles on the approval routes', () => {
    it.each([['owner', OWNER], ['admin', ADMIN]])('lets an %s list, approve, deny and revoke', async (label, uid) => {
        await start();
        const client = await registerPublicClient();
        expect((await approvals.list(uid)).status).toBe(200);
        expect((await approvals.approve(uid, { clientId: client.clientId })).status).toBe(200);
        expect((await approvals.revoke(uid, { clientId: client.clientId })).status).toBe(200);
        expect((await approvals.deny(uid, { clientId: client.clientId })).status).toBe(200);
    });

    it.each([
        ['a member', MEMBER, {}],
        ['a guest', GUEST, {}],
        ['an API token of an owner', OWNER, { 'x-test-api-token': '1' }],
    ])('refuses %s', async (label, uid, headers) => {
        await start();
        const client = await registerPublicClient();
        expect((await approvals.list(uid, headers)).status).toBe(403);
        expect((await approvals.approve(uid, { clientId: client.clientId }, headers)).status).toBe(403);
        expect((await approvals.deny(uid, { clientId: client.clientId }, headers)).status).toBe(403);
        expect((await approvals.revoke(uid, { clientId: client.clientId }, headers)).status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS)).toHaveLength(0);
    });

    it('refuses a caller with no session', async () => {
        await start();
        expect((await fetch(`${base}/api/v2/oauth-client-approvals`, { headers: { companyid: ALPHA } })).status).toBe(401);
    });

    it('lists only the caller\'s workspace', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: GAMMA, uid: ADMIN });
        expect((await (await approvals.list(OWNER)).json()).data).toEqual([]);
    });
});

describe('audit', () => {
    it('records every request, approval, denial and revocation with the acting person', async () => {
        await start();
        const client = await registerPublicClient();
        const { consent } = await flow.startAuthorization(authorizeUrl(client.clientId));
        await flow.requestApproval(consent, { session: session(MEMBER), workspace: ALPHA });
        await approvals.deny(ADMIN, { clientId: client.clientId });
        await approvals.approve(OWNER, { clientId: client.clientId, privateSprints: true });
        await approvals.revoke(ADMIN, { clientId: client.clientId });
        const trail = recordAudit.mock.calls.filter(([, entry]) => entry.entityType === 'oauth_client').map(([companyId, entry]) => [companyId, entry.action, entry.actorId]);
        expect(trail).toEqual([
            [ALPHA, 'oauth.client_approval_requested', MEMBER],
            [ALPHA, 'oauth.client_approval_denied', ADMIN],
            [ALPHA, 'oauth.client_approved', OWNER],
            [ALPHA, 'oauth.client_approval_revoked', ADMIN],
        ]);
        expect(audited('oauth.client_approved')[0][1].meta).toMatchObject({ privateSprints: true, scopes: ['tasks:read', 'projects:read', 'docs:read', 'time:read'] });
    });
});

describe('a person\'s own grants', () => {
    const mine = (uid, headers = {}) => fetch(`${base}/api/v2/oauth-grants`, { headers: bearer(uid, headers) });
    const revokeMine = (uid, grantId, headers = {}) => fetch(`${base}/api/v2/oauth-grants/${grantId}`, { method: 'DELETE', headers: bearer(uid, headers) });

    it('lists the client, workspace, scopes and last use of each live grant, and nobody else\'s', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId, { companyId: ALPHA });
        await approve(client.clientId, { companyId: BETA });
        await consentedTokens(client.clientId, { uid: MEMBER, workspace: ALPHA });
        await consentedTokens(client.clientId, { uid: MEMBER, workspace: BETA, scope: 'tasks:read' });
        await consentedTokens(client.clientId, { uid: OWNER, workspace: ALPHA });
        const res = await mine(MEMBER);
        expect(res.status).toBe(200);
        const { data } = await res.json();
        expect(data).toHaveLength(2);
        expect(data).toEqual(expect.arrayContaining([
            expect.objectContaining({ clientId: client.clientId, clientName: 'S10S3 agent', companyId: ALPHA, workspaceName: 'Alpha Works', scopes: ['tasks:read', 'projects:read'] }),
            expect.objectContaining({ companyId: BETA, workspaceName: 'Beta Labs', scopes: ['tasks:read'] }),
        ]));
        for (const grant of data) expect(new Date(grant.lastUsedAt).getTime()).toBeGreaterThan(Date.now() - 60000);
        expect(JSON.stringify(data)).not.toMatch(/ahoa_|ahor_|tokenHash/);
    });

    it('lets a person revoke their own grant, which stops its tokens, audited as theirs', async () => {
        await start();
        const client = await registerPublicClient();
        await approve(client.clientId);
        const tokens = await consentedTokens(client.clientId, { uid: MEMBER });
        const [grant] = rows(SCHEMA_TYPE.OAUTH_GRANTS);
        expect((await revokeMine(OWNER, grant.grantId)).status).toBe(404);
        expect((await grants.introspect(tokens.access_token)).active).toBe(true);
        expect((await revokeMine(MEMBER, grant.grantId, { 'x-test-api-token': '1' })).status).toBe(403);
        const res = await revokeMine(MEMBER, grant.grantId);
        expect(res.status).toBe(200);
        expect((await grants.introspect(tokens.access_token)).active).toBe(false);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'revoked_by_user' });
        expect(audited('oauth.grant_revoked')).toEqual([[ALPHA, expect.objectContaining({ actorId: MEMBER, entityId: grant.grantId, meta: { reason: 'revoked_by_user' } })]]);
        expect((await (await mine(MEMBER)).json()).data).toEqual([]);
    });

    it('refuses an API token', async () => {
        await start();
        expect((await mine(MEMBER, { 'x-test-api-token': '1' })).status).toBe(403);
    });
});
