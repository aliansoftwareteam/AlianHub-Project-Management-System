require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const mockRoles = {};
/* A stand-in for an MCP app that signs clients up itself, and for an app that takes a person's own token. Nothing
 * here is a real server, client or token. */
const mockServer = {
    registrations: [], tokenCalls: [], codes: new Map(), issued: [], forgetClients: false,
    reset() {
        this.registrations = []; this.tokenCalls = []; this.codes = new Map(); this.issued = []; this.forgetClients = false;
    },
    consent(url) {
        const asked = Object.fromEntries(new URL(url).searchParams);
        const code = `code-${crypto.randomBytes(8).toString('hex')}`;
        this.codes.set(code, asked);
        return { code, state: asked.state, asked };
    },
    async fetch(url, opts = {}) {
        const target = new URL(url);
        const at = `${target.origin}${target.pathname}`;
        const json = (status, body) => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const header = Object.entries(opts.headers || {}).find(([name]) => name.toLowerCase() === 'authorization');
        const bearer = header ? String(header[1]).replace(/^Bearer /, '') : '';
        if (at === 'https://auth.selfreg.test/register') {
            this.registrations.push(JSON.parse(opts.data));
            return json(201, { client_id: `reg-${this.registrations.length}` });
        }
        if (at === 'https://auth.selfreg.test/token') {
            const form = Object.fromEntries(new URLSearchParams(opts.data));
            this.tokenCalls.push(form);
            if (this.forgetClients) return json(401, { error: 'invalid_client' });
            const asked = this.codes.get(form.code);
            this.codes.delete(form.code);
            if (!asked || asked.client_id !== form.client_id) return json(400, { error: 'invalid_grant' });
            const access = `at-${crypto.randomBytes(8).toString('hex')}`;
            this.issued.push(access);
            return json(200, { access_token: access, refresh_token: `rt-${crypto.randomBytes(8).toString('hex')}`, expires_in: 3600, token_type: 'Bearer' });
        }
        if (at === 'https://api.selfreg.test/me') return this.issued.includes(bearer) ? json(200, { id: 'acct-1', name: 'Prisha at Selfreg' }) : json(401, { error: 'invalid_token' });
        if (at === 'https://api.pat.test/user') return ['good-pat', 'other-pat'].includes(bearer) ? json(200, { id: bearer === 'good-pat' ? 42 : 43, login: 'prisha' }) : json(401, { message: 'Bad credentials' });
        if (at === 'https://mcp.selfreg.test/.well-known/oauth-protected-resource/mcp') {
            return json(200, { resource: 'https://mcp.selfreg.test/mcp', authorization_servers: ['https://auth.selfreg.test'], scopes_supported: ['read', 'write'] });
        }
        if (at === 'https://auth.selfreg.test/.well-known/oauth-authorization-server') {
            return json(200, {
                issuer: 'https://auth.selfreg.test', authorization_endpoint: 'https://auth.selfreg.test/authorize', token_endpoint: 'https://auth.selfreg.test/token',
                registration_endpoint: 'https://auth.selfreg.test/register', code_challenge_methods_supported: ['S256'],
            });
        }
        return json(404, {});
    },
};

jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors-signin') }), createRegistry: actual.createRegistry, SIGN_IN: actual.SIGN_IN };
});
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => { const roles = mockRoles[companyId] || {}; return uid in roles ? roles[uid] : null; }),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true || p === 1 || p === 2, isReadable: (p) => p !== null && p !== undefined && p !== 0,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((url, opts) => mockServer.fetch(url, opts)),
}));

const logger = require('../Config/loggerConfig');
const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Connectors/connectorsController');
const registry = require('../Modules/Connectors/registry');
const { validate } = require('../Modules/Connectors/validate');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');
const { discover } = require('../Modules/Connectors/mcpAuth');

const C = '6f0000000000000000000c11';
const OWNER = '6f0000000000000000000a11';
const MEMBER = '6f0000000000000000000a12';
const COLLEAGUE = '6f0000000000000000000a13';
const SESSION = { [OWNER]: '6e0000000000000000000011', [MEMBER]: '6e0000000000000000000012', [COLLEAGUE]: '6e0000000000000000000013' };
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const ENV = {
    CONNECTORS: 'selfreg,pat', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    APIURL: `${API}/`, WEBURL: WEB, CORS_ORIGINS: '', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const rows = (type) => mockDb.store[type] || [];
const liveRow = (uid, provider) => rows(SCHEMA_TYPE.CONNECTOR_CONNECTIONS).find((r) => r.userId === uid && r.provider === provider && r.deletedStatusKey !== 1);
const registrationRows = () => rows(SCHEMA_TYPE.CONNECTOR_REGISTRATIONS);

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    r.set = () => r;
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, sessionId } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C, origin: WEB }, uid, sessionId: sessionId === undefined ? SESSION[uid] : sessionId, body, params, query: {} }), r);
    return r;
};
const start = (uid, provider = 'selfreg', request = {}) => call(ctrl.connect, uid, { params: { provider }, ...request });
const connect = async (uid, request = {}) => {
    const started = await start(uid, 'selfreg', request);
    expect(started.code).toBe(200);
    const { code, state } = mockServer.consent(started.body.data.url);
    return call(ctrl.complete, uid, { params: { provider: 'selfreg' }, body: { state, code }, ...request });
};
const paste = (uid, token, provider = 'pat') => call(ctrl.saveToken, uid, { params: { provider }, body: { token } });
const captured = () => JSON.stringify([mockDb.store, [logger.info, logger.error, logger.warn].map((fn) => fn.mock.calls), socketEmitter.emit.mock.calls]);

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockServer.reset();
    mockRoles[C] = { [OWNER]: 1, [MEMBER]: 3, [COLLEAGUE]: 3 };
});

afterAll(() => Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }));

describe('a definition that signs in without a registered app', () => {
    const selfreg = require('./fixtures/connectors-signin/selfreg');
    const pat = require('./fixtures/connectors-signin/pat');

    it('is accepted with a registration address among its hosts, or with a token and an account to read', () => {
        expect(validate(selfreg)).toEqual([]);
        expect(validate(pat)).toEqual([]);
    });

    it('refuses a registration without PKCE or off its hosts, and a pasted token with no account to read', () => {
        expect(validate({ ...selfreg, auth: { ...selfreg.auth, pkce: null } })).toContain('auth.registration needs pkce S256');
        expect(validate({ ...selfreg, auth: { ...selfreg.auth, registrationUrl: 'https://elsewhere.test/register' } })).toContain('auth.registrationUrl host elsewhere.test is not in egressHosts');
        expect(validate({ ...selfreg, auth: { ...selfreg.auth, registration: 'static' } })).toContain('auth.registration must be dynamic or left out');
        expect(validate({ ...pat, account: undefined })).toEqual(expect.arrayContaining(['readAccount is not a function', 'auth.personalToken needs account, to name the account a pasted token belongs to']));
    });

    it('is offered with nothing set for it, each with the sign-in it supports', () => {
        expect(registry.signIns('selfreg', { companyApps: [] })).toEqual(['oauth']);
        expect(registry.signIns('pat', { companyApps: [] })).toEqual(['token']);
        expect(registry.isOffered('selfreg', { companyApps: [] })).toBe(true);
        process.env.CONNECTORS = 'pat';
        expect(registry.isOffered('selfreg', { companyApps: [] })).toBe(false);
    });
});

describe('an app that registers itself', () => {
    it('connects with nothing in .env, as a public client bound by PKCE, and names the account with one call', async () => {
        const out = await connect(MEMBER);
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: 'selfreg', connected: true, signIn: 'self_register', account: { label: 'Prisha at Selfreg' } });
        expect(mockServer.registrations).toEqual([expect.objectContaining({ client_name: 'AlianHub', redirect_uris: [`${API}/api/v1/connector-oauth/selfreg/callback`], token_endpoint_auth_method: 'none' })]);
        expect(mockServer.tokenCalls[0]).toMatchObject({ client_id: 'reg-1', code_verifier: expect.any(String) });
        expect(mockServer.tokenCalls[0]).not.toHaveProperty('client_secret');
        expect(liveRow(MEMBER, 'selfreg')).toMatchObject({ signIn: 'self_register', kind: 'mcp', account: { id: 'acct-1' }, app: { source: 'registered' } });
    });

    it('registers once per workspace: a second member and a second session reuse it', async () => {
        await connect(MEMBER);
        await connect(COLLEAGUE);
        await connect(MEMBER);
        expect(mockServer.registrations).toHaveLength(1);
        expect(registrationRows()).toHaveLength(1);
        expect(mockServer.tokenCalls.every((form) => form.client_id === 'reg-1')).toBe(true);
    });

    it('registers again once when the server has forgotten the client, never in a loop', async () => {
        await connect(MEMBER);
        mockServer.forgetClients = true;
        const refused = await connect(COLLEAGUE);
        expect(refused.code).toBe(409);
        expect(refused.body.code).toBe('registration_dropped');
        expect(registrationRows()).toHaveLength(0);
        mockServer.forgetClients = false;
        expect((await connect(COLLEAGUE)).code).toBe(200);
        expect(mockServer.registrations).toHaveLength(2);
        expect(registrationRows()).toEqual([expect.objectContaining({ clientId: 'reg-2' })]);
    });

    it('registers again when the callback address changed', async () => {
        await connect(MEMBER);
        process.env.APIURL = 'https://hub.example.test/';
        await start(COLLEAGUE);
        expect(mockServer.registrations).toHaveLength(2);
        expect(registrationRows()).toEqual([expect.objectContaining({ redirectUri: 'https://hub.example.test/api/v1/connector-oauth/selfreg/callback' })]);
    });

    it('hands each member only their own token', async () => {
        await connect(MEMBER);
        await connect(COLLEAGUE);
        const mine = await (await resolveConnection({ companyId: C, userId: MEMBER, provider: 'selfreg' })).getAccessToken();
        const theirs = await (await resolveConnection({ companyId: C, userId: COLLEAGUE, provider: 'selfreg' })).getAccessToken();
        expect(mine).not.toBe(theirs);
        expect(mockServer.issued).toEqual(expect.arrayContaining([mine, theirs]));
    });
});

describe('a token the person pastes', () => {
    it('is refused for a provider that signs in only through an app, and the connect step says how it connects', async () => {
        expect((await paste(MEMBER, 'good-pat', 'selfreg')).body.code).toBe('oauth_only');
        expect((await start(MEMBER, 'pat')).body.code).toBe('token_only');
    });

    it('is checked with one read before it is kept, and a token the app refuses is not kept', async () => {
        const out = await paste(MEMBER, 'not-a-token');
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('token_refused');
        expect(liveRow(MEMBER, 'pat')).toBeUndefined();
        expect(rows(SCHEMA_TYPE.SECRETS)).toHaveLength(0);
    });

    it('connects the account it names, is used as it is, and is never shown or logged', async () => {
        const out = await paste(MEMBER, 'good-pat');
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: 'pat', connected: true, signIn: 'personal_token', account: { label: 'prisha' }, scopes: ['repo'] });
        expect(liveRow(MEMBER, 'pat')).toMatchObject({ signIn: 'personal_token', account: { id: '42' }, handles: { access: expect.any(String) } });
        expect(liveRow(MEMBER, 'pat').handles.refresh).toBeUndefined();
        expect(await (await resolveConnection({ companyId: C, userId: MEMBER, provider: 'pat' })).getAccessToken()).toBe('good-pat');
        expect(JSON.stringify(out.body)).not.toContain('good-pat');
        expect(captured()).not.toContain('good-pat');
    });

    it('replaces the person\'s earlier connection, and is ended without a call to the app', async () => {
        await paste(MEMBER, 'good-pat');
        await paste(MEMBER, 'other-pat');
        expect(liveRow(MEMBER, 'pat').account.id).toBe('43');
        expect(rows(SCHEMA_TYPE.CONNECTOR_CONNECTIONS).filter((r) => r.userId === MEMBER && r.deletedStatusKey !== 1)).toHaveLength(1);
        const fetched = require('../Modules/Agents/engine/safeFetch').safeFetch.mock.calls.length;
        const ended = await call(ctrl.disconnect, MEMBER, { params: { id: String(liveRow(MEMBER, 'pat')._id) } });
        expect(ended.code).toBe(200);
        expect(require('../Modules/Agents/engine/safeFetch').safeFetch.mock.calls.length).toBe(fetched);
        expect(liveRow(MEMBER, 'pat')).toBeUndefined();
    });

    it('is listed as the way to connect it', async () => {
        const out = await call(ctrl.list, MEMBER);
        expect(out.body.data.providers).toEqual(expect.arrayContaining([
            expect.objectContaining({ provider: 'pat', signIn: ['token'] }),
            expect.objectContaining({ provider: 'selfreg', signIn: ['oauth'] }),
        ]));
    });
});

describe('finding where an MCP server signs clients in', () => {
    it('reads the server\'s and its authorization server\'s metadata and names every host it found', async () => {
        const found = await discover({ url: 'https://mcp.selfreg.test/mcp', companyId: C, actor: OWNER });
        expect(found).toEqual({
            ok: true,
            auth: { authorizeUrl: 'https://auth.selfreg.test/authorize', tokenUrl: 'https://auth.selfreg.test/token', pkce: 'S256', registration: 'dynamic', registrationUrl: 'https://auth.selfreg.test/register' },
            scopes: ['read', 'write'],
            hosts: ['mcp.selfreg.test', 'auth.selfreg.test'],
        });
    });

    it('refuses an address that is not https, and says when a server publishes nothing', async () => {
        expect(await discover({ url: 'http://mcp.selfreg.test/mcp', companyId: C })).toEqual({ ok: false, error: 'not_https' });
        expect(await discover({ url: 'https://quiet.test/mcp', companyId: C })).toEqual({ ok: false, error: 'no_metadata' });
    });
});
