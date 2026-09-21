const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockLogged = [];
const mockAudited = [];
const mockRoles = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => {
    const keep = (level) => (...args) => mockLogged.push([level, ...args]);
    return { info: keep('info'), error: keep('error'), warn: keep('warn'), debug: keep('debug') };
});
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn((...args) => mockAudited.push(args)) }));
jest.mock('../Config/jwt', () => ({
    verifyJWTTokenWithCV2: jest.fn((req, res, next) => {
        const signedIn = /^Bearer user:([a-f0-9]{24})$/.exec(String(req.headers.authorization || ''));
        if (!signedIn) return res.status(401).json({ status: false, error: 'Unauthorized' });
        req.uid = signedIn[1];
        if (req.headers['x-test-api-token']) req.apiToken = { _id: 'pat' };
        return next();
    }),
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => mockRoles[uid]),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => {
    const actual = jest.requireActual('../Modules/Agents/engine/safeFetch');
    return { ...actual, safeFetch: jest.fn(actual.safeFetch) };
});

const { recordAudit } = require('../Modules/Audit/recorder');
const jwt = require('../Config/jwt');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const createSchema = require('../utils/mongo-handler/createSchema');
const routes = require('../Modules/OAuthServer/routes');
const grants = require('../Modules/OAuthServer/grants');
const tokenHash = require('../Modules/OAuthServer/tokenHash');
const metadataDocument = require('../Modules/OAuthServer/metadataDocument');

const ISSUER = 'https://hub.s10s2.test';
const RESOURCE = `${ISSUER}/mcp`;
const CID = '6f00000000000000000000c1';
const OTHER_CID = '6f00000000000000000000c2';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const CIMD_ID = 'https://agent.s10s2.test/oauth/client.json';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const ENV_KEYS = ['APIURL', 'MCP_OAUTH', 'MCP_OAUTH_DCR', 'MCP_OAUTH_ISSUER', 'MCP_OAUTH_ACCESS_TOKEN_MINUTES', 'MCP_OAUTH_REFRESH_TOKEN_DAYS', 'MCP_OAUTH_GRANT_MAX_DAYS', 'MCP_OAUTH_RATE_LIMIT_PER_MIN', 'MCP_OAUTH_TOKEN_SECRET', 'NODE_ENV'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

let server;
let base;
const seen = [];

const start = async (env = {}) => {
    Object.assign(process.env, { MCP_OAUTH: 'on', MCP_OAUTH_ISSUER: ISSUER, MCP_OAUTH_TOKEN_SECRET: 's10s2-token-secret', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000', ...env });
    const app = express();
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());
    try {
        routes.init(app, process.env);
    } finally {
        process.env.NODE_ENV = 'test';
    }
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    return app;
};

const stop = () => new Promise((resolve) => (server ? server.close(() => { server = null; resolve(); }) : resolve()));

beforeEach(() => {
    mockDb = fakeMongo.create();
    mockDb.uniqueFromSchema(SCHEMA_TYPE.OAUTH_TOKENS, createSchema.oauthTokensSchema);
    Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 });
    metadataDocument.forget();
    jest.clearAllMocks();
    delete process.env.MCP_OAUTH_DCR;
    delete process.env.MCP_OAUTH_ACCESS_TOKEN_MINUTES;
    delete process.env.MCP_OAUTH_REFRESH_TOKEN_DAYS;
    delete process.env.MCP_OAUTH_GRANT_MAX_DAYS;
    process.env.NODE_ENV = 'test';
});

afterEach(stop);

afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined)).toString();

const post = async (path, body, headers = {}) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};

const authorizeUrl = (params) => `${base}/oauth/authorize?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined))}`;

const consentHeaders = (uid = OWNER, companyId = CID, answer = 'approve') => ({ authorization: `Bearer user:${uid}`, companyid: companyId, 'x-oauth-test-consent': answer });

const authorize = async (params, headers = consentHeaders()) => {
    const res = await fetch(authorizeUrl(params), { redirect: 'manual', headers });
    const location = res.headers.get('location');
    const text = location ? '' : await res.text();
    return { status: res.status, location: location ? new URL(location) : null, body: text ? JSON.parse(text) : null };
};

const registerPublicClient = async (overrides = {}) => {
    const { client } = await require('../Modules/OAuthServer/clients').register({
        kind: 'dynamic', name: 'S10S2 public', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'none', ...overrides,
    });
    return client;
};

const validParams = (client, verifier, over = {}) => ({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT,
    scope: 'tasks:read projects:read',
    state: 'st-s10s2',
    code_challenge: challengeOf(verifier),
    code_challenge_method: 'S256',
    resource: RESOURCE,
    ...over,
});

const codeFor = async (client, verifier = newVerifier(), over = {}) => {
    const res = await authorize(validParams(client, verifier, over));
    expect(res.status).toBe(302);
    const code = res.location.searchParams.get('code');
    expect(code).toBeTruthy();
    seen.push(code, verifier);
    return { code, verifier };
};

const exchange = (client, { code, verifier }, over = {}) => post('/oauth/token', {
    grant_type: 'authorization_code', client_id: client.clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE, ...over,
});

const tokensFor = async (client) => {
    const res = await exchange(client, await codeFor(client));
    expect(res.status).toBe(200);
    seen.push(res.body.access_token, res.body.refresh_token);
    return res.body;
};

const rows = (type) => mockDb.store[type] || [];

describe('flag off', () => {
    it('registers no route at all, so every path answers 404 as on beta', async () => {
        const app = await start({ MCP_OAUTH: 'off' });
        const paths = (app._router ? app._router.stack : []).map((layer) => layer.route && layer.route.path).filter(Boolean);
        expect(paths).toEqual([]);
        for (const [method, path] of [['GET', '/.well-known/oauth-authorization-server'], ['GET', '/oauth/authorize'], ['POST', '/oauth/token'], ['POST', '/oauth/revoke'], ['POST', '/oauth/register'], ['GET', '/api/v2/oauth-clients']]) {
            const res = await fetch(base + path, { method });
            expect([method, path, res.status]).toEqual([method, path, 404]);
        }
    });

    it('is off unless MCP_OAUTH says on', () => {
        const { isOn, dcrOn } = require('../Modules/OAuthServer/config');
        expect(isOn({})).toBe(false);
        expect(isOn({ MCP_OAUTH: 'off' })).toBe(false);
        expect(isOn({ MCP_OAUTH: 'on' })).toBe(true);
        expect(dcrOn({ MCP_OAUTH: 'on' })).toBe(false);
        expect(dcrOn({ MCP_OAUTH: 'off', MCP_OAUTH_DCR: 'on' })).toBe(false);
    });
});

describe('issuer', () => {
    it.each([
        ['empty', { MCP_OAUTH_ISSUER: '', APIURL: '' }],
        ['not a URL', { MCP_OAUTH_ISSUER: 'hub.s10s2.test' }],
        ['plain http on a public host', { MCP_OAUTH_ISSUER: 'http://hub.s10s2.test' }],
        ['plain http on loopback in production', { MCP_OAUTH_ISSUER: 'http://127.0.0.1:4000', NODE_ENV: 'production' }],
        ['with a path', { MCP_OAUTH_ISSUER: 'https://hub.s10s2.test/tenant1' }],
        ['with a query', { MCP_OAUTH_ISSUER: 'https://hub.s10s2.test/?a=1' }],
    ])('refuses to start when it is %s', async (label, env) => {
        await expect(start(env)).rejects.toThrow(/MCP_OAUTH/);
    });

    it.each([
        ['https', { MCP_OAUTH_ISSUER: 'https://hub.s10s2.test/' }, 'https://hub.s10s2.test'],
        ['APIURL when no issuer is set', { MCP_OAUTH_ISSUER: '', APIURL: 'https://api.s10s2.test/' }, 'https://api.s10s2.test'],
        ['http on loopback outside production', { MCP_OAUTH_ISSUER: 'http://127.0.0.1:4000/', NODE_ENV: 'development' }, 'http://127.0.0.1:4000'],
    ])('starts with %s', async (label, env, issuer) => {
        const savedApiUrl = process.env.APIURL;
        try {
            await start(env);
            expect((await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()).issuer).toBe(issuer);
        } finally {
            if (savedApiUrl === undefined) delete process.env.APIURL;
            else process.env.APIURL = savedApiUrl;
        }
    });

    it('does not start with MCP_OAUTH off, whatever the issuer', async () => {
        await expect(start({ MCP_OAUTH: 'off', MCP_OAUTH_ISSUER: 'http://hub.s10s2.test' })).resolves.toBeDefined();
    });
});

describe('authorization server metadata (RFC 8414)', () => {
    it('names the issuer, the endpoints, S256 only, the scopes and client ID metadata documents', async () => {
        await start();
        const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
        expect(res.status).toBe(200);
        const doc = await res.json();
        expect(doc).toMatchObject({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/oauth/authorize`,
            token_endpoint: `${ISSUER}/oauth/token`,
            revocation_endpoint: `${ISSUER}/oauth/revoke`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write'],
            client_id_metadata_document_supported: true,
        });
        expect(doc.registration_endpoint).toBeUndefined();
    });

    it('advertises registration only while MCP_OAUTH_DCR is on', async () => {
        await start({ MCP_OAUTH_DCR: 'on' });
        const doc = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
        expect(doc.registration_endpoint).toBe(`${ISSUER}/oauth/register`);
    });
});

describe('/oauth/authorize', () => {
    it('refuses an unknown client without redirecting', async () => {
        await start();
        const res = await authorize(validParams({ clientId: 'ahc_000000000000000000000000' }, newVerifier()));
        expect(res.status).toBe(400);
        expect(res.location).toBeNull();
        expect(res.body.error).toBe('invalid_client');
    });

    it.each([
        ['a trailing slash', `${REDIRECT}/`],
        ['a case change', REDIRECT.replace('callback', 'Callback')],
        ['an extra query', `${REDIRECT}?next=1`],
        ['a fragment', `${REDIRECT}#frag`],
        ['a loopback path change', 'http://127.0.0.1:33418/other'],
        ['a loopback query change', 'http://127.0.0.1:33418/callback?x=1'],
        ['a loopback host change', 'http://localhost:33418/callback'],
        ['a parser-rewritten form', 'http://127.0.0.1:33418/./callback'],
        ['no redirect_uri', undefined],
    ])('refuses a redirect_uri with %s, and never redirects to it', async (label, redirectUri) => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier(), { redirect_uri: redirectUri }));
        expect(res.status).toBe(400);
        expect(res.location).toBeNull();
        expect(res.body.error).toBe('invalid_request');
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it.each([
        ['127.0.0.1', 'http://127.0.0.1:33418/callback', 'http://127.0.0.1:51234/callback'],
        ['[::1]', 'http://[::1]:33418/callback', 'http://[::1]:40000/callback'],
        ['localhost', 'http://localhost:33418/callback', 'http://localhost:40001/callback'],
        ['a loopback URI registered without a port', 'http://127.0.0.1/callback', 'http://127.0.0.1:40002/callback'],
    ])('accepts any port on an http loopback redirect on %s (OAuth 2.1 section 2.3.1, RFC 8252 section 7.3)', async (label, registered, presented) => {
        await start();
        const client = await registerPublicClient({ redirectUris: [registered] });
        const res = await authorize(validParams(client, newVerifier(), { redirect_uri: presented }));
        expect(res.status).toBe(302);
        expect(res.location.origin + res.location.pathname).toBe(presented.replace(/\?.*$/, ''));
        expect(res.location.searchParams.get('code')).toBeTruthy();
    });

    it.each([
        ['a non-loopback https port change', 'https://app.s10s2.test/cb', 'https://app.s10s2.test:8443/cb'],
        ['https://localhost, which gets no exception', 'https://localhost:33418/cb', 'https://localhost:33419/cb'],
        ['http on a loopback host registered as https', 'https://localhost/cb', 'http://localhost/cb'],
    ])('keeps exact matching for %s', async (label, registered, presented) => {
        await start();
        const client = await registerPublicClient({ redirectUris: [registered] });
        const res = await authorize(validParams(client, newVerifier(), { redirect_uri: presented }));
        expect(res.status).toBe(400);
        expect(res.location).toBeNull();
    });

    it('binds the code to the redirect_uri actually used, port included', async () => {
        await start();
        const client = await registerPublicClient();
        const verifier = newVerifier();
        const used = 'http://127.0.0.1:51234/callback';
        const res = await authorize(validParams(client, verifier, { redirect_uri: used }));
        const code = res.location.searchParams.get('code');
        expect((await exchange(client, { code, verifier }, { redirect_uri: REDIRECT })).body.error).toBe('invalid_grant');
        const again = await authorize(validParams(client, verifier, { redirect_uri: used }));
        const ok = await exchange(client, { code: again.location.searchParams.get('code'), verifier }, { redirect_uri: used });
        expect(ok.status).toBe(200);
        seen.push(ok.body.access_token, ok.body.refresh_token);
    });

    it.each([
        ['a backslash', 'https://evil.s10s2.test\\@good.s10s2.test/cb'],
        ['userinfo', 'https://user@good.s10s2.test/cb'],
        ['a fragment', 'https://good.s10s2.test/cb#x'],
        ['surrounding whitespace', ' https://good.s10s2.test/cb'],
        ['an upper-case scheme', 'HTTPS://good.s10s2.test/cb'],
        ['a missing path', 'https://good.s10s2.test'],
        ['javascript:', 'javascript:alert(1)'],
        ['data:', 'data:text/html,hi'],
    ])('refuses to register a redirect URI with %s', async (label, uri) => {
        const clients = require('../Modules/OAuthServer/clients');
        await expect(clients.register({ kind: 'dynamic', name: 'x', redirectUris: [uri], tokenEndpointAuthMethod: 'none' })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
    });

    it('refuses repeated parameters', async () => {
        await start();
        const client = await registerPublicClient();
        const params = new URLSearchParams(validParams(client, newVerifier()));
        params.append('scope', 'tasks:write');
        const res = await fetch(`${base}/oauth/authorize?${params}`, { redirect: 'manual', headers: consentHeaders() });
        const location = new URL(res.headers.get('location'));
        expect(location.searchParams.get('error')).toBe('invalid_request');
        expect(location.searchParams.get('code')).toBeNull();
    });

    it.each([
        ['no code_challenge', { code_challenge: undefined }],
        ['code_challenge_method plain', { code_challenge_method: 'plain' }],
        ['no code_challenge_method', { code_challenge_method: undefined }],
        ['a challenge that is not a SHA-256 digest', { code_challenge: 'short' }],
    ])('requires PKCE S256: %s is refused', async (label, over) => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier(), over));
        expect(res.status).toBe(302);
        expect(res.location.searchParams.get('error')).toBe('invalid_request');
        expect(res.location.searchParams.get('state')).toBe('st-s10s2');
        expect(res.location.searchParams.get('code')).toBeNull();
    });

    it.each([
        ['missing', undefined],
        ['another server', 'https://other.s10s2.test/mcp'],
        ['with a trailing slash', `${RESOURCE}/`],
        ['the issuer without /mcp', ISSUER],
        ['with a fragment', `${RESOURCE}#x`],
    ])('requires resource to be the canonical /mcp URI: %s is invalid_target', async (label, resource) => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier(), { resource }));
        expect(res.location.searchParams.get('error')).toBe('invalid_target');
        expect(res.location.searchParams.get('code')).toBeNull();
    });

    it('accepts the resource with an upper-case scheme and host', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier(), { resource: RESOURCE.replace('https://hub', 'HTTPS://HUB') }));
        expect(res.location.searchParams.get('code')).toBeTruthy();
    });

    it('refuses an unknown or empty scope', async () => {
        await start();
        const client = await registerPublicClient();
        for (const scope of ['', 'tasks:read admin']) {
            const res = await authorize(validParams(client, newVerifier(), { scope }));
            expect(res.location.searchParams.get('error')).toBe('invalid_scope');
        }
    });

    const grantedWithoutScope = async (client) => {
        const verifier = newVerifier();
        const res = await authorize(validParams(client, verifier, { scope: undefined }));
        const tokens = await exchange(client, { code: res.location.searchParams.get('code'), verifier });
        seen.push(tokens.body.access_token, tokens.body.refresh_token);
        return tokens.body.scope;
    };

    it('grants the resource default read scopes when scope is omitted and the client named none', async () => {
        await start();
        expect(await grantedWithoutScope(await registerPublicClient())).toBe('tasks:read projects:read docs:read time:read');
    });

    it('grants the read scopes the client registered when scope is omitted', async () => {
        await start();
        const client = await registerPublicClient({ scopes: ['tasks:read', 'tasks:write', 'time:read'] });
        expect(await grantedWithoutScope(client)).toBe('tasks:read time:read');
    });

    it('echoes state and the issuer with the code', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier()));
        expect(res.location.origin + res.location.pathname).toBe(REDIRECT);
        expect(res.location.searchParams.get('state')).toBe('st-s10s2');
        expect(res.location.searchParams.get('iss')).toBe(ISSUER);
        expect(tokenHash.looksLike('code', res.location.searchParams.get('code'))).toBe(true);
    });

    it('answers "consent not available" when no consent was given, and issues nothing', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier()), {});
        expect(res.location.searchParams.get('error')).toBe('temporarily_unavailable');
        expect(res.location.searchParams.get('state')).toBe('st-s10s2');
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it('sends access_denied when the user declines', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier()), consentHeaders(OWNER, CID, 'deny'));
        expect(res.location.searchParams.get('error')).toBe('access_denied');
    });

    it('never lets an API token consent', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await authorize(validParams(client, newVerifier()), { ...consentHeaders(), 'x-test-api-token': '1' });
        expect(res.status).toBe(403);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });

    it.each(['production', 'development', 'staging', '', 'Test', 'test ', undefined])('keeps the test-only consent path unreachable when NODE_ENV is %p', async (nodeEnv) => {
        await start();
        const client = await registerPublicClient();
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
        const res = await authorize(validParams(client, newVerifier()));
        expect(res.location.searchParams.get('error')).toBe('temporarily_unavailable');
        expect(jwt.verifyJWTTokenWithCV2).not.toHaveBeenCalled();
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });
});

describe('/oauth/token: authorization code', () => {
    it('exchanges a code for audience-bound tokens with the documented lifetimes', async () => {
        await start();
        const client = await registerPublicClient();
        const before = Date.now();
        const body = await tokensFor(client);
        expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'tasks:read projects:read' });
        expect(tokenHash.looksLike('access', body.access_token)).toBe(true);
        expect(tokenHash.looksLike('refresh', body.refresh_token)).toBe(true);

        const grant = rows(SCHEMA_TYPE.OAUTH_GRANTS)[0];
        expect(new Date(grant.expiresAt).getTime() - new Date(grant.createdAt).getTime()).toBe(90 * DAY);
        expect(new Date(grant.purgeAt).getTime() - new Date(grant.expiresAt).getTime()).toBe(30 * DAY);
        const refresh = rows(SCHEMA_TYPE.OAUTH_TOKENS).find((row) => row.kind === 'refresh');
        expect(new Date(refresh.expiresAt).getTime() - before).toBeGreaterThanOrEqual(30 * DAY - 1000);
        expect(new Date(refresh.expiresAt).getTime() - before).toBeLessThanOrEqual(30 * DAY + 5000);

        const claims = await grants.introspect(body.access_token);
        expect(claims).toMatchObject({ active: true, aud: RESOURCE, companyId: CID, userId: OWNER, scopes: ['tasks:read', 'projects:read'], clientId: client.clientId, grantId: grant.grantId });
        expect(claims.exp * 1000 - before).toBeLessThanOrEqual(15 * MINUTE + 5000);
    });

    it('takes its lifetimes from the environment, and caps every token at the grant', async () => {
        await start({ MCP_OAUTH_ACCESS_TOKEN_MINUTES: '5', MCP_OAUTH_REFRESH_TOKEN_DAYS: '2', MCP_OAUTH_GRANT_MAX_DAYS: '1' });
        const client = await registerPublicClient();
        const body = await tokensFor(client);
        expect(body.expires_in).toBe(300);
        const grant = rows(SCHEMA_TYPE.OAUTH_GRANTS)[0];
        const refresh = rows(SCHEMA_TYPE.OAUTH_TOKENS).find((row) => row.kind === 'refresh');
        expect(new Date(grant.expiresAt).getTime() - new Date(grant.createdAt).getTime()).toBe(DAY);
        expect(new Date(refresh.expiresAt).getTime()).toBe(new Date(grant.expiresAt).getTime());
    });

    it('refuses a wrong verifier and spends the code, so the right one cannot follow', async () => {
        await start();
        const client = await registerPublicClient();
        const issued = await codeFor(client);
        const wrong = await exchange(client, { code: issued.code, verifier: newVerifier() });
        expect(wrong.status).toBe(400);
        expect(wrong.body.error).toBe('invalid_grant');
        const right = await exchange(client, issued);
        expect(right.body.error).toBe('invalid_grant');
        expect(right.body.access_token).toBeUndefined();
    });

    it.each([
        ['no verifier', undefined],
        ['a verifier too short', 'a'.repeat(42)],
        ['a verifier too long', 'a'.repeat(129)],
        ['a verifier outside the RFC 7636 alphabet', `${'a'.repeat(43)}+/`],
    ])('refuses an exchange with %s before spending the code', async (label, verifier) => {
        await start();
        const client = await registerPublicClient();
        const issued = await codeFor(client);
        const res = await exchange(client, { code: issued.code, verifier });
        expect(res.body.error).toBe('invalid_grant');
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0].revokedAt).toBeFalsy();
        const ok = await exchange(client, issued);
        expect(ok.status).toBe(200);
        seen.push(ok.body.access_token, ok.body.refresh_token);
    });

    it.each([
        ['dots and tildes', () => `${crypto.randomBytes(32).toString('base64url')}.~._~`],
        ['128 characters', () => `${'~'.repeat(64)}${'.'.repeat(64)}`],
    ])('accepts a verifier with %s (RFC 7636 section 4.1)', async (label, make) => {
        await start();
        const client = await registerPublicClient();
        const res = await exchange(client, await codeFor(client, make()));
        expect(res.status).toBe(200);
        seen.push(res.body.access_token, res.body.refresh_token);
    });

    it('lets exactly one of two parallel first redemptions of a code succeed, and the other revokes it', async () => {
        await start();
        const client = await registerPublicClient();
        const issued = await codeFor(client);
        const results = await Promise.all([exchange(client, issued), exchange(client, issued)]);
        const won = results.filter((r) => r.status === 200);
        expect(won).toHaveLength(1);
        expect(results.filter((r) => r.body.error === 'invalid_grant')).toHaveLength(1);
        seen.push(won[0].body.access_token, won[0].body.refresh_token);
        expect((await grants.introspect(won[0].body.access_token)).active).toBe(false);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'code_reuse' });
    });

    it.each([
        ['missing', undefined],
        ['another server', 'https://other.s10s2.test/mcp'],
        ['with a trailing slash', `${RESOURCE}/`],
    ])('checks resource again at the token endpoint: %s is invalid_target', async (label, resource) => {
        await start();
        const client = await registerPublicClient();
        const res = await exchange(client, await codeFor(client), { resource });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_target');
        expect(res.body.access_token).toBeUndefined();
    });

    it('refuses a redirect_uri other than the one the code was issued for', async () => {
        await start();
        const client = await registerPublicClient({ redirectUris: [REDIRECT, 'http://127.0.0.1:33420/callback'] });
        const res = await exchange(client, await codeFor(client), { redirect_uri: 'http://127.0.0.1:33420/callback' });
        expect(res.body.error).toBe('invalid_grant');
    });

    it('refuses a code issued to another client', async () => {
        await start();
        const client = await registerPublicClient();
        const other = await registerPublicClient();
        const res = await exchange(other, await codeFor(client));
        expect(res.body.error).toBe('invalid_grant');
    });

    it('refuses an expired code', async () => {
        await start();
        const client = await registerPublicClient();
        const issued = await codeFor(client);
        rows(SCHEMA_TYPE.OAUTH_TOKENS).find((row) => row.kind === 'code').expiresAt = new Date(Date.now() - 1000);
        const res = await exchange(client, issued);
        expect(res.body.error).toBe('invalid_grant');
    });

    it('uses a code once; a second use revokes the grant and the tokens the first one issued', async () => {
        await start();
        const client = await registerPublicClient();
        const issued = await codeFor(client);
        const first = await exchange(client, issued);
        expect(first.status).toBe(200);
        expect((await grants.introspect(first.body.access_token)).active).toBe(true);

        const replay = await exchange(client, issued);
        expect(replay.status).toBe(400);
        expect(replay.body.error).toBe('invalid_grant');
        expect((await grants.introspect(first.body.access_token)).active).toBe(false);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'code_reuse' });
        const refreshed = await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.clientId, refresh_token: first.body.refresh_token, resource: RESOURCE });
        expect(refreshed.body.error).toBe('invalid_grant');
    });

    it('refuses an unsupported grant type', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await post('/oauth/token', { grant_type: 'password', client_id: client.clientId, resource: RESOURCE });
        expect(res.body.error).toBe('unsupported_grant_type');
    });
});

describe('/oauth/token: refresh', () => {
    const refreshWith = (client, token, over = {}) => post('/oauth/token', { grant_type: 'refresh_token', client_id: client.clientId, refresh_token: token, resource: RESOURCE, ...over });

    it('rotates: every refresh spends the old refresh token and issues a new pair', async () => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        const second = await refreshWith(client, first.refresh_token);
        expect(second.status).toBe(200);
        expect(second.body.refresh_token).not.toBe(first.refresh_token);
        expect(second.body.access_token).not.toBe(first.access_token);
        seen.push(second.body.access_token, second.body.refresh_token);
        const third = await refreshWith(client, second.body.refresh_token);
        expect(third.status).toBe(200);
        seen.push(third.body.access_token, third.body.refresh_token);
    });

    it('revokes the whole family when an old refresh token comes back', async () => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        const second = (await refreshWith(client, first.refresh_token)).body;
        seen.push(second.access_token, second.refresh_token);

        const replay = await refreshWith(client, first.refresh_token);
        expect(replay.status).toBe(400);
        expect(replay.body.error).toBe('invalid_grant');
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'refresh_reuse' });
        expect((await grants.introspect(second.access_token)).active).toBe(false);
        expect((await refreshWith(client, second.refresh_token)).body.error).toBe('invalid_grant');
    });

    it.each([
        ['a wrong resource', { resource: 'https://other.s10s2.test/mcp' }],
        ['no resource', { resource: undefined }],
        ['a wider scope', { scope: 'tasks:read tasks:write' }],
    ])('revokes the family when a spent refresh token comes back with %s (OAuth 2.1 section 4.3.1)', async (label, over) => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        const second = (await refreshWith(client, first.refresh_token)).body;
        seen.push(second.access_token, second.refresh_token);
        const replay = await refreshWith(client, first.refresh_token, over);
        expect(replay.status).toBe(400);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'refresh_reuse' });
        expect((await grants.introspect(second.access_token)).active).toBe(false);
    });

    it('refuses a refresh token presented by another client, and revokes its grant', async () => {
        await start();
        const client = await registerPublicClient();
        const other = await registerPublicClient();
        const first = await tokensFor(client);
        const res = await refreshWith(other, first.refresh_token);
        expect(res.body.error).toBe('invalid_grant');
        expect(res.body.access_token).toBeUndefined();
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'refresh_wrong_client' });
        expect((await grants.introspect(first.access_token)).active).toBe(false);
    });

    it('may narrow the scopes but never widen them', async () => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        const wider = await refreshWith(client, first.refresh_token, { scope: 'tasks:read tasks:write' });
        expect(wider.body.error).toBe('invalid_scope');
        const narrower = await refreshWith(client, first.refresh_token, { scope: 'tasks:read' });
        expect(narrower.status).toBe(200);
        expect(narrower.body.scope).toBe('tasks:read');
    });

    it('checks resource on a refresh too', async () => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        expect((await refreshWith(client, first.refresh_token, { resource: 'https://other.s10s2.test/mcp' })).body.error).toBe('invalid_target');
        expect((await refreshWith(client, first.refresh_token, { resource: undefined })).body.error).toBe('invalid_target');
    });

    it('refuses an expired refresh token', async () => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        rows(SCHEMA_TYPE.OAUTH_TOKENS).find((row) => row.kind === 'refresh').expiresAt = new Date(Date.now() - 1000);
        expect((await refreshWith(client, first.refresh_token)).body.error).toBe('invalid_grant');
    });

    it('stops refreshing once the grant cap has passed', async () => {
        await start();
        const client = await registerPublicClient();
        const first = await tokensFor(client);
        rows(SCHEMA_TYPE.OAUTH_GRANTS)[0].expiresAt = new Date(Date.now() - 1000);
        expect((await refreshWith(client, first.refresh_token)).body.error).toBe('invalid_grant');
        expect((await grants.introspect(first.access_token)).active).toBe(false);
    });
});

describe('client authentication', () => {
    const confidential = async (method) => {
        const clients = require('../Modules/OAuthServer/clients');
        const { client, secret } = await clients.register({ kind: 'preregistered', name: 'S10S2 confidential', redirectUris: [REDIRECT], tokenEndpointAuthMethod: method, companyId: CID });
        seen.push(secret);
        return { client, secret };
    };
    const basic = (id, secret) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

    it('lets a client_secret_basic client in with its secret and no other way', async () => {
        await start();
        const { client, secret } = await confidential('client_secret_basic');
        const issued = await codeFor(client);
        const params = { grant_type: 'authorization_code', code: issued.code, code_verifier: issued.verifier, redirect_uri: REDIRECT, resource: RESOURCE };

        const none = await post('/oauth/token', { ...params, client_id: client.clientId });
        expect(none.status).toBe(401);
        expect(none.body.error).toBe('invalid_client');
        const wrong = await post('/oauth/token', params, { authorization: basic(client.clientId, `${secret}x`) });
        expect(wrong.status).toBe(401);
        expect(wrong.headers.get('www-authenticate')).toMatch(/^Basic/);
        const inBody = await post('/oauth/token', { ...params, client_id: client.clientId, client_secret: secret });
        expect(inBody.status).toBe(401);

        const ok = await post('/oauth/token', params, { authorization: basic(client.clientId, secret) });
        expect(ok.status).toBe(200);
        seen.push(ok.body.access_token, ok.body.refresh_token);
    });

    it('lets a client_secret_post client in with its secret in the body', async () => {
        await start();
        const { client, secret } = await confidential('client_secret_post');
        const issued = await codeFor(client);
        const ok = await exchange(client, issued, { client_secret: secret });
        expect(ok.status).toBe(200);
        seen.push(ok.body.access_token, ok.body.refresh_token);
    });

    it('refuses a client that authenticates two ways at once', async () => {
        await start();
        const { client, secret } = await confidential('client_secret_basic');
        const issued = await codeFor(client);
        const res = await post('/oauth/token', { grant_type: 'authorization_code', code: issued.code, code_verifier: issued.verifier, redirect_uri: REDIRECT, resource: RESOURCE, client_secret: secret }, { authorization: basic(client.clientId, secret) });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('invalid_client');
    });

    it.each(['Bearer ahoa_x', 'Basic', 'Basic !!!', `Basic ${Buffer.from('no-colon').toString('base64')}`])('refuses a malformed Authorization header %p', async (header) => {
        await start();
        const client = await registerPublicClient();
        const issued = await codeFor(client);
        const res = await post('/oauth/token', { grant_type: 'authorization_code', client_id: client.clientId, code: issued.code, code_verifier: issued.verifier, redirect_uri: REDIRECT, resource: RESOURCE }, { authorization: header });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('invalid_client');
    });

    it('refuses a secret from a public client', async () => {
        await start();
        const client = await registerPublicClient();
        const res = await exchange(client, await codeFor(client), { client_secret: 'ahcs_whatever' });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('invalid_client');
    });

    it('binds a pre-registered client to the workspace that registered it', async () => {
        await start();
        const { client } = await confidential('client_secret_basic');
        const res = await authorize(validParams(client, newVerifier()), consentHeaders(OWNER, OTHER_CID));
        expect(res.location.searchParams.get('error')).toBe('access_denied');
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)).toHaveLength(0);
    });
});

describe('/oauth/revoke (RFC 7009)', () => {
    const revoke = (client, token, hint) => post('/oauth/revoke', { client_id: client.clientId, token, token_type_hint: hint });

    it('revokes an access token at once and leaves its refresh token working', async () => {
        await start();
        const client = await registerPublicClient();
        const body = await tokensFor(client);
        const res = await revoke(client, body.access_token, 'access_token');
        expect(res.status).toBe(200);
        expect((await grants.introspect(body.access_token)).active).toBe(false);
        const refreshed = await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.clientId, refresh_token: body.refresh_token, resource: RESOURCE });
        expect(refreshed.status).toBe(200);
    });

    it('revokes the grant with a refresh token, so the access tokens go too', async () => {
        await start();
        const client = await registerPublicClient();
        const body = await tokensFor(client);
        expect((await revoke(client, body.refresh_token)).status).toBe(200);
        expect((await grants.introspect(body.access_token)).active).toBe(false);
        expect(rows(SCHEMA_TYPE.OAUTH_GRANTS)[0]).toMatchObject({ revokedReason: 'revoked_by_client' });
    });

    it('answers 200 for an unknown token and refuses a token of another client', async () => {
        await start();
        const client = await registerPublicClient();
        const other = await registerPublicClient();
        const body = await tokensFor(client);
        expect((await revoke(client, 'ahoa_nothing')).status).toBe(200);
        const theirs = await revoke(other, body.access_token);
        expect(theirs.status).toBe(400);
        expect(theirs.body.error).toBe('unauthorized_client');
        expect((await grants.introspect(body.access_token)).active).toBe(true);
    });
});

describe('client ID metadata documents at /oauth/authorize', () => {
    const doc = (over = {}) => ({ client_id: CIMD_ID, client_name: 'S10S2 agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...over });
    const serve = (body, headers = {}) => safeFetch.mockImplementation(async () => ({ status: 200, headers, body: JSON.stringify(body), bytes: 10, url: CIMD_ID }));

    it('fetches the document through safeFetch with size, time and redirect caps, then completes the flow', async () => {
        await start();
        serve(doc());
        const client = { clientId: CIMD_ID };
        const res = await exchange(client, await codeFor(client));
        expect(res.status).toBe(200);
        expect(safeFetch).toHaveBeenCalledWith(CIMD_ID, expect.objectContaining({ timeoutMs: 5000, maxBytes: 5120, maxRedirects: 0 }));
        seen.push(res.body.access_token, res.body.refresh_token);
    });

    it('caches the document and fetches it again once the cache runs out', async () => {
        await start();
        serve(doc(), { 'cache-control': 'max-age=600' });
        await codeFor({ clientId: CIMD_ID });
        await codeFor({ clientId: CIMD_ID });
        expect(safeFetch).toHaveBeenCalledTimes(1);
        metadataDocument.forget();
        serve(doc(), { 'cache-control': 'no-store' });
        await codeFor({ clientId: CIMD_ID });
        await codeFor({ clientId: CIMD_ID });
        expect(safeFetch).toHaveBeenCalledTimes(3);
    });

    it.each([
        ['names another client_id', doc({ client_id: 'https://evil.s10s2.test/oauth/client.json' })],
        ['has no client_name', doc({ client_name: '' })],
        ['has no redirect_uris', doc({ redirect_uris: [] })],
        ['lists a plain http redirect on a public host', doc({ redirect_uris: ['http://agent.s10s2.test/cb'] })],
        ['asks for a client secret method', doc({ token_endpoint_auth_method: 'client_secret_basic' })],
        ['carries a client_secret', doc({ client_secret: 'x' })],
    ])('refuses a document that %s, without redirecting', async (label, body) => {
        await start();
        serve(body);
        const res = await authorize(validParams({ clientId: CIMD_ID }, newVerifier()));
        expect(res.status).toBe(400);
        expect(res.location).toBeNull();
        expect(res.body.error).toBe('invalid_client');
    });

    it('refuses a document served from another URL than its client_id', async () => {
        await start();
        safeFetch.mockImplementation(async () => ({ status: 200, headers: {}, body: JSON.stringify(doc()), bytes: 10, url: 'https://agent.s10s2.test/oauth/other.json' }));
        const res = await authorize(validParams({ clientId: CIMD_ID }, newVerifier()));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_client');
    });

    it('fetches one document once for concurrent authorizations', async () => {
        await start();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        safeFetch.mockImplementation(async () => { await gate; return { status: 200, headers: { 'cache-control': 'no-store' }, body: JSON.stringify(doc()), bytes: 10, url: CIMD_ID }; });
        const pending = [1, 2, 3, 4].map(() => authorize(validParams({ clientId: CIMD_ID }, newVerifier())));
        await new Promise((resolve) => setTimeout(resolve, 50));
        release();
        const results = await Promise.all(pending);
        expect(results.every((r) => r.status === 302 && r.location.searchParams.get('code'))).toBe(true);
        expect(safeFetch).toHaveBeenCalledTimes(1);
    });

    it('does not fetch a failing document again for a few seconds', async () => {
        await start();
        safeFetch.mockImplementation(async () => ({ status: 404, headers: {}, body: '', bytes: 0, url: CIMD_ID }));
        for (let i = 0; i < 5; i += 1) expect((await authorize(validParams({ clientId: CIMD_ID }, newVerifier()))).body.error).toBe('invalid_client');
        expect(safeFetch).toHaveBeenCalledTimes(1);
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now + metadataDocument.FAILURE_BACKOFF_MS + 1);
        try {
            serve(doc());
            const res = await authorize(validParams({ clientId: CIMD_ID }, newVerifier()));
            expect(res.location.searchParams.get('code')).toBeTruthy();
            expect(safeFetch).toHaveBeenCalledTimes(2);
        } finally {
            clock.mockRestore();
        }
    });

    it('grants the read scopes a document asks for when scope is omitted, and holds it to them', async () => {
        await start();
        serve(doc({ scope: 'tasks:read tasks:write other:scope' }));
        const verifier = newVerifier();
        const res = await authorize(validParams({ clientId: CIMD_ID }, verifier, { scope: undefined }));
        const tokens = await exchange({ clientId: CIMD_ID }, { code: res.location.searchParams.get('code'), verifier });
        expect(tokens.body.scope).toBe('tasks:read');
        seen.push(tokens.body.access_token, tokens.body.refresh_token);
        const wider = await authorize(validParams({ clientId: CIMD_ID }, newVerifier(), { scope: 'docs:read' }));
        expect(wider.location.searchParams.get('error')).toBe('invalid_scope');
    });

    it('refuses a redirect_uri the document does not list', async () => {
        await start();
        serve(doc({ redirect_uris: ['http://127.0.0.1:1/other'] }));
        const res = await authorize(validParams({ clientId: CIMD_ID }, newVerifier()));
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_request');
    });

    it.each(['http://agent.s10s2.test/client.json', 'https://agent.s10s2.test/', 'https://agent.s10s2.test/a/../client.json', 'https://user:pw@agent.s10s2.test/client.json'])('does not fetch a client_id that is not an https URL with a path: %s', async (clientId) => {
        await start();
        const res = await authorize(validParams({ clientId }, newVerifier()));
        expect(res.status).toBe(400);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('dynamic client registration (RFC 7591)', () => {
    it('does not exist while MCP_OAUTH_DCR is off', async () => {
        await start();
        const res = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: [REDIRECT] }) });
        expect(res.status).toBe(404);
    });

    it('registers a public client that can then complete the flow', async () => {
        await start({ MCP_OAUTH_DCR: 'on' });
        const res = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'S10S2 dcr', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }) });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.client_secret).toBeUndefined();
        const client = { clientId: body.client_id };
        const tokens = await exchange(client, await codeFor(client));
        expect(tokens.status).toBe(200);
        seen.push(tokens.body.access_token, tokens.body.refresh_token);
    });

    it('refuses a redirect URI that is neither https nor loopback', async () => {
        await start({ MCP_OAUTH_DCR: 'on' });
        const res = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['http://evil.s10s2.test/cb'] }) });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_redirect_uri');
    });
});

describe('admin pre-registration', () => {
    const api = (uid, init = {}) => ({ authorization: `Bearer user:${uid}`, companyid: CID, 'content-type': 'application/json', ...init });
    const create = (uid, body, headers = {}) => fetch(`${base}/api/v2/oauth-clients`, { method: 'POST', headers: api(uid, headers), body: JSON.stringify(body) });
    const spec = { name: 'S10S2 CI agent', redirectUris: ['https://ci.s10s2.test/callback'], tokenEndpointAuthMethod: 'client_secret_basic', scopes: ['tasks:read'] };

    it('lets an owner or admin register a client, shows the secret once, keeps only its hash and audits it', async () => {
        await start();
        for (const uid of [OWNER, ADMIN]) {
            const res = await create(uid, spec);
            expect(res.status).toBe(201);
            const { data } = await res.json();
            expect(data.clientSecret).toMatch(/^ahcs_/);
            seen.push(data.clientSecret);
            const row = rows(SCHEMA_TYPE.OAUTH_CLIENTS).find((r) => r.clientId === data.clientId);
            expect(row).toMatchObject({ kind: 'preregistered', companyId: CID, createdBy: uid });
            expect(row.secretHash).toBe(tokenHash.hashOf(data.clientSecret));
            expect(JSON.stringify(row)).not.toContain(data.clientSecret);
        }
        expect(recordAudit).toHaveBeenCalledWith(CID, expect.objectContaining({ action: 'oauth.client_registered', actorId: OWNER, entityType: 'oauth_client' }));
        const list = await (await fetch(`${base}/api/v2/oauth-clients`, { headers: api(OWNER) })).json();
        expect(list.data).toHaveLength(2);
        expect(JSON.stringify(list.data)).not.toMatch(/secretHash|ahcs_/);
    });

    it('refuses a member, an API token and a caller with no session', async () => {
        await start();
        expect((await create(MEMBER, spec)).status).toBe(403);
        expect((await create(OWNER, spec, { 'x-test-api-token': '1' })).status).toBe(403);
        expect((await fetch(`${base}/api/v2/oauth-clients`, { method: 'POST', headers: { companyid: CID } })).status).toBe(401);
        expect(rows(SCHEMA_TYPE.OAUTH_CLIENTS)).toHaveLength(0);
    });

    it('revokes a client with every grant it holds, audited', async () => {
        await start();
        const { data } = await (await create(OWNER, { ...spec, tokenEndpointAuthMethod: 'none', redirectUris: [REDIRECT] })).json();
        const client = { clientId: data.clientId };
        const tokens = await exchange(client, await codeFor(client, newVerifier(), { scope: 'tasks:read' }));
        seen.push(tokens.body.access_token, tokens.body.refresh_token);
        const res = await fetch(`${base}/api/v2/oauth-clients/${data.clientId}`, { method: 'DELETE', headers: api(ADMIN) });
        expect(res.status).toBe(200);
        expect((await grants.introspect(tokens.body.access_token)).active).toBe(false);
        expect(recordAudit).toHaveBeenCalledWith(CID, expect.objectContaining({ action: 'oauth.client_revoked', actorId: ADMIN }));
        expect((await authorize(validParams(client, newVerifier(), { scope: 'tasks:read' }))).body.error).toBe('invalid_client');
    });

    it('holds a client to the scopes it was registered with', async () => {
        await start();
        const { data } = await (await create(OWNER, { ...spec, tokenEndpointAuthMethod: 'none', redirectUris: [REDIRECT] })).json();
        const res = await authorize(validParams({ clientId: data.clientId }, newVerifier(), { scope: 'tasks:read tasks:write' }));
        expect(res.location.searchParams.get('error')).toBe('invalid_scope');
    });
});

describe('rate limits', () => {
    it('limits the authorize and token endpoints per client address', async () => {
        await start({ MCP_OAUTH_RATE_LIMIT_PER_MIN: '3' });
        const statuses = [];
        for (let i = 0; i < 4; i += 1) statuses.push((await post('/oauth/token', { grant_type: 'refresh_token' })).status);
        expect(statuses.slice(-1)).toEqual([429]);
        const authorizeStatuses = [];
        for (let i = 0; i < 4; i += 1) authorizeStatuses.push((await fetch(`${base}/oauth/authorize`, { redirect: 'manual' })).status);
        expect(authorizeStatuses.slice(-1)).toEqual([429]);
    });
});

describe('secrets at rest and in logs', () => {
    it('stores codes, tokens and client secrets only as keyed hashes and never logs them', () => {
        const raw = seen.filter(Boolean);
        expect(raw.length).toBeGreaterThan(20);
        const logged = JSON.stringify(mockLogged);
        const audited = JSON.stringify(mockAudited);
        for (const value of raw) {
            expect(logged).not.toContain(value);
            expect(audited).not.toContain(value);
        }
    });

    it('keeps no raw value in any row it writes', async () => {
        await start();
        const client = await registerPublicClient();
        const body = await tokensFor(client);
        const stored = JSON.stringify(mockDb.store);
        for (const value of [body.access_token, body.refresh_token]) expect(stored).not.toContain(value);
        expect(stored).not.toMatch(/ahoc_|ahoa_|ahor_|ahcs_/);
        expect(rows(SCHEMA_TYPE.OAUTH_TOKENS).every((row) => /^[a-f0-9]{64}$/.test(row.tokenHash))).toBe(true);
    });
});
