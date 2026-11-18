require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const mockRoles = {};
const SERVICE = 'https://connect.alian.test';
const INSTANCE = 'ins_abcdefghijklmnopqrstu';
const KEY = crypto.randomBytes(24).toString('hex');
const SERVICE_CLIENT = 'alian-fake-client';
const SERVICE_CALLBACK = `${SERVICE}/oauth/fake/callback`;

/* A stand-in for Alian's sign-in service: it checks each request's signature with the instance's key, answers its
 * apps, and makes the token calls with a secret the instance never sees. Nothing here is a real key or token. */
const mockService = {
    requests: [], codes: new Map(), down: false, badSignatures: 0, revoked: [],
    reset() { this.requests = []; this.codes = new Map(); this.down = false; this.badSignatures = 0; this.revoked = []; },
    signed(path, opts) {
        const header = (name) => String((opts.headers || {})[name] || '');
        const expected = crypto.createHmac('sha256', KEY).update(`${header('X-Timestamp')}.${path}.${opts.data || ''}`).digest('base64url');
        return header('X-Instance-Id') === INSTANCE && header('X-Signature') === expected;
    },
    /* What the service does when the provider returns the person to it: check the envelope, find the instance. */
    forward(consentUrl) {
        const asked = Object.fromEntries(new URL(consentUrl).searchParams);
        const [payload, mac] = String(asked.state).split('.');
        if (crypto.createHmac('sha256', KEY).update(payload).digest('base64url') !== mac) throw new Error('forged envelope');
        const { i, s } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const code = `code-${crypto.randomBytes(6).toString('hex')}`;
        this.codes.set(code, { redirectUri: asked.redirect_uri, challenge: asked.code_challenge });
        return { instance: i, state: s, code, asked };
    },
    async fetch(url, opts = {}) {
        const target = new URL(url);
        const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });
        if (target.origin !== SERVICE) return json(404, { error: 'not_the_service' });
        if (this.down) throw new Error('connect ECONNREFUSED');
        const body = opts.data ? JSON.parse(opts.data) : null;
        this.requests.push({ path: target.pathname, method: opts.method, body });
        if (!this.signed(target.pathname, opts)) { this.badSignatures += 1; return json(401, { error: 'bad_signature' }); }
        if (target.pathname === '/v1/apps') return json(200, { apps: { fake: { clientId: SERVICE_CLIENT, redirectUri: SERVICE_CALLBACK } } });
        if (target.pathname === '/v1/token' && body.grantType === 'authorization_code') {
            const grant = this.codes.get(body.code);
            this.codes.delete(body.code);
            if (!grant || grant.redirectUri !== body.redirectUri) return json(400, { error: 'invalid_grant' });
            if (crypto.createHash('sha256').update(String(body.codeVerifier)).digest('base64url') !== grant.challenge) return json(400, { error: 'invalid_grant' });
            return json(200, { access_token: `at-${crypto.randomBytes(6).toString('hex')}`, refresh_token: 'rt-hosted', expires_in: 3600, scope: 'profile notes.read', account_id: 'acc-9', email: 'prisha@example.test' });
        }
        if (target.pathname === '/v1/token' && body.grantType === 'refresh_token') {
            return body.refreshToken === 'rt-hosted' ? json(200, { access_token: 'at-refreshed', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
        }
        if (target.pathname === '/v1/revoke') { this.revoked.push(body.token); return json(200, {}); }
        return json(404, { error: 'unknown_route' });
    },
};

jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors') }), createRegistry: actual.createRegistry, SIGN_IN: actual.SIGN_IN };
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
    safeFetch: jest.fn((url, opts) => mockService.fetch(url, opts)),
}));

const jwt = require('jsonwebtoken');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const ctrl = require('../Modules/Connectors/connectorsController');
const registry = require('../Modules/Connectors/registry');
const hosted = require('../Modules/Connectors/hostedSignIn');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection } = require('../Modules/Connectors/resolveConnection');

const C = '6f0000000000000000000c21';
const MEMBER = '6f0000000000000000000a21';
const SESSION = '6e0000000000000000000021';
const API = 'https://acme-tasks.example.test';
const WEB = 'https://acme-tasks.example.test';
const ENV = {
    CONNECTORS: 'fake', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    APIURL: `${API}/`, WEBURL: WEB, CORS_ORIGINS: '', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
    HOSTING_MODE: 'managed', INSTANCE_ID: INSTANCE, PLATFORM_API_KEY: KEY, CONNECTOR_SIGNIN_URL: SERVICE, CONNECTOR_SIGNIN_PROVIDERS: 'fake',
    CONNECTOR_FAKE_CLIENT_ID: '', CONNECTOR_FAKE_CLIENT_SECRET: '',
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const rows = (type) => mockDb.store[type] || [];
const liveRow = () => rows(SCHEMA_TYPE.CONNECTOR_CONNECTIONS).find((r) => r.userId === MEMBER && r.deletedStatusKey !== 1);
const res = () => {
    const r = { code: 200, body: null, location: '' };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    r.set = () => r;
    r.redirect = (code, url) => { r.code = code; r.location = url; return r; };
    return r;
};
const call = async (handler, { body = {}, params = { provider: 'fake' }, query = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C, origin: WEB }, uid: MEMBER, sessionId: SESSION, body, params, query }), r);
    return r;
};
const connect = async () => {
    const started = await call(ctrl.connect);
    expect(started.code).toBe(200);
    const forwarded = mockService.forward(started.body.data.url);
    const landed = await call(ctrl.callback, { query: { code: forwarded.code, state: forwarded.state } });
    expect(landed.location).toContain(`code=${forwarded.code}`);
    return { started, forwarded, done: await call(ctrl.complete, { body: { state: forwarded.state, code: forwarded.code } }) };
};

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockService.reset();
    hosted.forget();
    mockRoles[C] = { [MEMBER]: 3 };
});

afterAll(() => Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }));

describe('a hosted instance on its own domain', () => {
    it('offers a provider the service has an app for, with nothing set for it on the instance', () => {
        expect(registry.signIns('fake', { companyApps: [] })).toEqual(['oauth']);
    });

    it('sends the person to the provider with the service\'s app and callback, and an envelope only this instance could sign', async () => {
        const { started, forwarded } = await connect();
        expect(forwarded.asked).toMatchObject({ client_id: SERVICE_CLIENT, redirect_uri: SERVICE_CALLBACK, code_challenge_method: 'S256' });
        expect(forwarded.instance).toBe(INSTANCE);
        expect(started.body.data.url).not.toContain(API);
    });

    it('connects through the service, which makes the token call; the instance holds the member\'s tokens and no app secret', async () => {
        const { done } = await connect();
        expect(done.code).toBe(200);
        expect(done.body.data).toMatchObject({ provider: 'fake', connected: true, account: { label: 'prisha@example.test' } });
        expect(liveRow()).toMatchObject({ app: { source: 'hosted', appId: null }, signIn: 'registered_app' });
        const token = mockService.requests.find((r) => r.path === '/v1/token');
        expect(token.body).toMatchObject({ provider: 'fake', grantType: 'authorization_code', redirectUri: SERVICE_CALLBACK, codeVerifier: expect.any(String) });
        expect(safeFetch.mock.calls.every(([url]) => new URL(url).origin === SERVICE)).toBe(true);
        expect(mockService.badSignatures).toBe(0);
        const kept = await Promise.all(rows(SCHEMA_TYPE.SECRETS).map((s) => store.resolve({ companyId: C, handle: s.handle })));
        expect(kept.filter(Boolean).every((value) => value.startsWith('at-') || value === 'rt-hosted')).toBe(true);
    });

    it('refuses a code forwarded with a state this instance did not sign', async () => {
        const started = await call(ctrl.connect);
        const forwarded = mockService.forward(started.body.data.url);
        const foreign = jwt.sign({ companyId: C, userId: MEMBER, provider: 'fake', jti: 'x' }, 'another-instance-secret::connector-oauth-state', { audience: 'alianhub:connector-oauth', expiresIn: 600 });
        const out = await call(ctrl.complete, { body: { state: foreign, code: forwarded.code } });
        expect(out.code).toBe(400);
        expect(liveRow().status).toBe('pending');
    });

    it('refreshes and revokes through the service too', async () => {
        await connect();
        liveRow().accessExpiresAt = new Date(Date.now() - 1000);
        expect(await (await resolveConnection({ companyId: C, userId: MEMBER, provider: 'fake' })).getAccessToken()).toBe('at-refreshed');
        expect(mockService.requests.filter((r) => r.path === '/v1/token').map((r) => r.body.grantType)).toEqual(['authorization_code', 'refresh_token']);
        const ended = await call(ctrl.disconnect, { params: { id: String(liveRow()._id) } });
        expect(ended.code).toBe(200);
        expect(mockService.revoked).toEqual(['rt-hosted']);
    });
});

describe('when the service cannot be reached', () => {
    it('tells the person why at sign-in', async () => {
        mockService.down = true;
        const out = await call(ctrl.connect);
        expect(out.code).toBe(503);
        expect(out.body.code).toBe('service_unreachable');
    });

    it('fails a call that needs a refresh, and leaves the connection as it was', async () => {
        await connect();
        liveRow().accessExpiresAt = new Date(Date.now() - 1000);
        mockService.down = true;
        await expect((await resolveConnection({ companyId: C, userId: MEMBER, provider: 'fake' })).getAccessToken()).rejects.toMatchObject({ code: 'refresh_failed' });
        expect(liveRow().status).toBe('connected');
    });
});

describe('off hosted', () => {
    it('never uses the service, even with its address set', async () => {
        process.env.HOSTING_MODE = 'self';
        process.env.CONNECTOR_FAKE_CLIENT_ID = 'own-client';
        process.env.CONNECTOR_FAKE_CLIENT_SECRET = 'own-secret';
        const started = await call(ctrl.connect);
        expect(started.code).toBe(200);
        const asked = Object.fromEntries(new URL(started.body.data.url).searchParams);
        expect(asked).toMatchObject({ client_id: 'own-client', redirect_uri: `${API}/api/v1/connector-oauth/fake/callback` });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('offers nothing when neither the service nor an app is there', () => {
        process.env.HOSTING_MODE = 'self';
        expect(registry.signIns('fake', { companyApps: [] })).toEqual([]);
    });
});
