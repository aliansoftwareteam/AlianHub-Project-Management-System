require('./fixtures/mcpFlagsOff');
const path = require('path');
const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const CLIENT_ID = `${crypto.randomBytes(6).toString('hex')}.apps.fake.test`;
const CLIENT_SECRET = crypto.randomBytes(18).toString('base64url');
const mockProvider = require('./fixtures/fakeProvider').create({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
const mockRoles = {};
const mockRoleLookup = { fails: false };

jest.mock('../Modules/Connectors/registry', () => {
    const actual = jest.requireActual('../Modules/Connectors/registry');
    return { ...actual.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors') }), createRegistry: actual.createRegistry };
});
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => {
        if (mockRoleLookup.fails) throw new Error('the member list could not be read');
        const roles = mockRoles[companyId] || {};
        return uid in roles ? roles[uid] : null;
    }),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true || p === 1 || p === 2, isReadable: (p) => p !== null && p !== undefined && p !== 0,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((url, opts) => mockProvider.fetch(url, opts)),
}));

const logger = require('../Config/loggerConfig');
const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const ctrl = require('../Modules/Connectors/connectorsController');
const routes = require('../Modules/Connectors/routes');
const { resolveConnection, markBackoff, CODE } = require('../Modules/Connectors/resolveConnection');
const { AUTH_URL, TOKEN_URL, REVOKE_URL } = require('./fixtures/fakeProvider');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const COLLEAGUE = '6f0000000000000000000a05';
const SESSION = Object.fromEntries([OWNER, ADMIN, MEMBER, GUEST, COLLEAGUE].map((uid, i) => [uid, `6e000000000000000000000${i + 1}`]));
const OTHER_SESSION = '6e00000000000000000000ff';
const P = 'fake';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const CALLBACK = `${API}/api/v1/connector-oauth/fake/callback`;
const BASE_SCOPE = ['profile'];
const ENV = {
    CONNECTORS: P, SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_FAKE_CLIENT_ID: CLIENT_ID, CONNECTOR_FAKE_CLIENT_SECRET: CLIENT_SECRET,
    APIURL: `${API}/`, WEBURL: WEB, CORS_ORIGINS: '', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};

const rows = (type) => mockDb.store[type] || [];
const rowOf = (uid, companyId = C) => rows(T).find((r) => r.userId === uid && r.deletedStatusKey !== 1 && (r.companyId === undefined || r.companyId === companyId));
const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((a) => a.action === action);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const sealed = () => rows(SCHEMA_TYPE.SECRETS).filter((s) => s.ciphertext);

const res = () => {
    const r = { code: 200, body: null, location: '' };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    r.set = () => r;
    r.redirect = (code, url) => { r.code = url ? code : 302; r.location = url || code; return r; };
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, query = {}, headers = {}, sessionId, companyId = C, apiToken, aud } = {}) => {
    const r = res();
    await handler(verified({
        headers: { companyid: companyId, origin: WEB, ...headers }, uid, sessionId: sessionId === undefined ? SESSION[uid] : sessionId,
        body, params, query, ...(aud ? { aud } : {}), ...(apiToken ? { apiToken } : {}),
    }), r);
    return r;
};

const startAs = (uid, request = {}) => call(ctrl.connect, uid, { params: { provider: P }, ...request });
const consentAs = async (uid, who = {}, request = {}) => {
    const started = await startAs(uid, request);
    expect(started.code).toBe(200);
    return mockProvider.consent(started.body.data.url, who);
};
const completeAs = (uid, { state, code }, request = {}) => call(ctrl.complete, uid, { params: { provider: P }, body: { state, code }, ...request });
const connectAs = async (uid, who = {}) => {
    const out = await completeAs(uid, await consentAs(uid, who));
    expect(out.code).toBe(200);
    return out;
};
const disconnectId = (uid, id, request = {}) => call(ctrl.disconnect, uid, { params: { id }, ...request });
const tokenFor = (uid, companyId = C) => resolveConnection({ companyId, userId: uid, provider: P });
const expire = (uid) => { rowOf(uid).accessExpiresAt = new Date(Date.now() - 1000); };
const landed = (location) => {
    const [base, rest = ''] = String(location).split('#');
    const [pathPart, query = ''] = rest.split('?');
    return { base, path: pathPart, query: Object.fromEntries(new URLSearchParams(query)) };
};

const captured = (...extra) => JSON.stringify([
    mockDb.store,
    mockDb.calls.map((c) => c.data),
    [logger.info, logger.error, logger.warn, logger.debug].map((fn) => fn.mock.calls),
    socketEmitter.emit.mock.calls,
    extra,
]);

const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockProvider.reset();
    mockRoleLookup.fails = false;
    Object.keys(mockRoles).forEach((k) => delete mockRoles[k]);
    mockRoles[C] = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0, [COLLEAGUE]: 3 };
    mockRoles[OTHER_COMPANY] = { [MEMBER]: 3 };
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe('connecting through the generic lifecycle', () => {
    it('sends the person to the provider with the company app, the per-provider callback, the ticked scopes, a PKCE challenge and no include_granted_scopes', async () => {
        const out = await startAs(MEMBER, { body: { products: ['notes'] }, headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
        expect(out.code).toBe(200);
        expect(Object.keys(out.body.data)).toEqual(['url']);
        const url = new URL(out.body.data.url);
        expect(`${url.origin}${url.pathname}`).toBe(AUTH_URL);
        const asked = Object.fromEntries(url.searchParams);
        expect(asked).toMatchObject({
            client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: 'code', scope: 'profile notes.read notes.write', code_challenge_method: 'S256',
        });
        expect(asked.include_granted_scopes).toBeUndefined();
        expect(asked.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(out.body.data.url).not.toContain(CLIENT_SECRET);
        expect(mockProvider.calls).toHaveLength(0);

        const [row] = rows(T);
        expect(row).toMatchObject({ provider: P, userId: MEMBER, status: 'pending', handles: {}, products: ['notes'], app: { source: 'instance', appId: null } });
        expect(row.oauth.sessionId).toBe(SESSION[MEMBER]);
        expect(crypto.createHash('sha256').update(row.oauth.verifier).digest('base64url')).toBe(asked.code_challenge);
    });

    it('completing it exchanges the code with the verifier, keeps both tokens by handle, stores only granted scopes and labels the account', async () => {
        const { state, code } = await consentAs(MEMBER, { accountId: 'acc-maya', email: 'maya@example.test', scope: 'profile notes.read' });
        const out = await completeAs(MEMBER, { state, code });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: P, connected: true, status: 'connected', account: { label: 'maya@example.test' }, scopes: ['profile', 'notes.read'] });

        const [sent] = mockProvider.calls;
        expect(sent).toMatchObject({ url: TOKEN_URL, verb: 'post', redirects: 0, workspace: C, authorization: undefined });
        expect(sent.form).toMatchObject({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: CALLBACK });

        const row = rowOf(MEMBER);
        expect(Object.keys(row.handles).sort()).toEqual(['access', 'refresh']);
        expect(row.oauth).toBeUndefined();
        expect(row.account).toEqual({ id: 'acc-maya', label: 'maya@example.test' });
        expect(row.scopes).toEqual(['profile', 'notes.read']);
        const [access, refresh] = mockProvider.issued;
        expect(await store.resolve({ companyId: C, handle: row.handles.access })).toBe(access);
        expect(await store.resolve({ companyId: C, handle: row.handles.refresh })).toBe(refresh);
        await settle();
        expect(audits('connector.connect')).toEqual([expect.objectContaining({ actorId: MEMBER, entityId: P })]);
    });

    it('refuses no refresh token, a reused state and an expired state', async () => {
        const noOffline = await consentAs(MEMBER, { offline: false });
        expect((await completeAs(MEMBER, noOffline)).body.code).toBe('no_refresh_token');
        expect(rows(SCHEMA_TYPE.SECRETS)).toHaveLength(0);

        const { state, code } = await consentAs(MEMBER);
        expect((await completeAs(MEMBER, { state, code })).code).toBe(200);
        expect((await completeAs(MEMBER, { state, code })).body.code).toBe('state_used');

        const again = await consentAs(MEMBER);
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
        try {
            expect((await completeAs(MEMBER, again)).body.code).toBe('state_invalid');
        } finally { clock.mockRestore(); }
    });

    it('a different session or person cannot complete it', async () => {
        const { state, code } = await consentAs(MEMBER);
        expect((await completeAs(MEMBER, { state, code }, { sessionId: OTHER_SESSION })).body.code).toBe('state_invalid');
        expect((await completeAs(ADMIN, { state, code })).body.code).toBe('state_invalid');
    });

    it('the public callback hands the code to the signed-in page and exchanges nothing itself', async () => {
        const { state, code } = await consentAs(MEMBER);
        const back = await call(ctrl.callback, undefined, { params: { provider: P }, query: { state, code }, headers: { host: 'evil.example', origin: 'https://evil.example' } });
        expect(back.code).toBe(302);
        expect(landed(back.location)).toEqual({ base: `${WEB}/`, path: `/${C}/connections`, query: { connector: P, state, code } });
        expect(mockProvider.calls).toHaveLength(0);
        expect(rowOf(MEMBER).status).toBe('pending');
        // The same code then completes under the person's own session, closing the four-step flow.
        expect((await completeAs(MEMBER, { state, code })).code).toBe(200);
    });

    it('a callback error ends the attempt, and an unknown provider or state falls back without the code', async () => {
        const { state } = await consentAs(MEMBER);
        const denied = await call(ctrl.callback, undefined, { params: { provider: P }, query: { state, error: 'access_denied' } });
        expect(landed(denied.location)).toEqual({ base: `${WEB}/`, path: `/${C}/connections`, query: { connector: P, result: 'error', reason: 'access_denied' } });
        expect(rowOf(MEMBER).oauth).toBeUndefined();
        const lost = await call(ctrl.callback, undefined, { params: { provider: P }, query: { state: 'a.b.c', code: 'a-code' } });
        expect(landed(lost.location)).toMatchObject({ query: { connector: P, result: 'error', reason: 'state' } });
        expect(lost.location).not.toContain('a-code');
        const unknown = await call(ctrl.callback, undefined, { params: { provider: 'ghost' }, query: { state: 'a.b.c', code: 'a-code' } });
        expect(landed(unknown.location).query).toMatchObject({ result: 'error' });
        expect(mockProvider.calls).toHaveLength(0);
    });
});

describe('two people, two accounts', () => {
    it('each reaches only their own account, and a reconnect to a new account revokes the old grant', async () => {
        await connectAs(MEMBER, { accountId: 'acc-1', email: 'one@example.test' });
        await connectAs(COLLEAGUE, { accountId: 'acc-2', email: 'two@example.test' });

        const mine = await tokenFor(MEMBER);
        const theirs = await tokenFor(COLLEAGUE);
        expect(mine.connectionId).toBe(String(rowOf(MEMBER)._id));
        expect(await mine.getAccessToken()).toBe(await store.resolve({ companyId: C, handle: rowOf(MEMBER).handles.access }));
        expect(theirs.connectionId).not.toBe(mine.connectionId);

        const handles = { ...rowOf(MEMBER).handles };
        const firstRefresh = mockProvider.issued[1];
        mockProvider.calls.length = 0;
        await connectAs(MEMBER, { accountId: 'acc-1b', email: 'again@example.test' });
        expect(mockProvider.endpoints()).toEqual(['token:authorization_code', 'revoke:revoke']);
        expect(mockProvider.calls[1].form.token).toBe(firstRefresh);
        expect(rowOf(MEMBER).handles).toEqual(handles);
        expect(rowOf(MEMBER).account.id).toBe('acc-1b');
        expect(rows(T).filter((r) => r.userId === MEMBER && r.deletedStatusKey !== 1)).toHaveLength(1);
    });

    it('a reconnect to the same account revokes nothing', async () => {
        await connectAs(MEMBER, { accountId: 'acc-1' });
        mockProvider.calls.length = 0;
        await connectAs(MEMBER, { accountId: 'acc-1' });
        expect(mockProvider.endpoints()).toEqual(['token:authorization_code']);
    });
});

describe('resolveConnection and getAccessToken (063 §5)', () => {
    it('refuses with the contract codes', async () => {
        await expect(tokenFor(MEMBER)).rejects.toMatchObject({ name: 'ConnectorError', code: CODE.NOT_CONNECTED, provider: P });
        await connectAs(MEMBER);
        delete mockRoles[C][MEMBER];
        await expect(tokenFor(MEMBER)).rejects.toMatchObject({ code: CODE.NOT_MEMBER });
        mockRoles[C][MEMBER] = 3;
        process.env.CONNECTORS = 'slack';
        await expect(tokenFor(MEMBER)).rejects.toMatchObject({ code: CODE.PROVIDER_OFF });
    });

    it('hands out a fresh token, refreshes an expired one once, and breaks on a dead grant', async () => {
        await connectAs(MEMBER);
        const conn = await tokenFor(MEMBER);
        expect(conn.scopes).toEqual(rowOf(MEMBER).scopes);
        mockProvider.calls.length = 0;
        expect(await conn.getAccessToken()).toBe(await store.resolve({ companyId: C, handle: rowOf(MEMBER).handles.access }));
        expect(mockProvider.calls).toHaveLength(0);

        expire(MEMBER);
        const refreshed = await (await tokenFor(MEMBER)).getAccessToken();
        expect(mockProvider.endpoints()).toEqual(['token:refresh_token']);
        expect(refreshed).toBe(await store.resolve({ companyId: C, handle: rowOf(MEMBER).handles.access }));

        mockProvider.grants.forEach((grant) => { grant.revoked = true; });
        expire(MEMBER);
        await expect((await tokenFor(MEMBER)).getAccessToken()).rejects.toMatchObject({ code: CODE.BROKEN });
        expect(rowOf(MEMBER)).toMatchObject({ status: 'broken', lastError: 'invalid_grant' });
        await settle();
        expect(audits('connector.broken')).toHaveLength(1);
    });
});

describe('disconnecting', () => {
    it('revokes the grant once, clears both tokens and closes the row', async () => {
        await connectAs(MEMBER);
        const refresh = mockProvider.issued[1];
        const handles = Object.values(rowOf(MEMBER).handles);
        const id = String(rowOf(MEMBER)._id);
        mockProvider.calls.length = 0;
        const out = await disconnectId(MEMBER, id);
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: P, connected: false, account: null });
        expect(mockProvider.calls).toHaveLength(1);
        expect(mockProvider.calls[0]).toMatchObject({ url: REVOKE_URL, workspace: C });
        expect(mockProvider.calls[0].form).toEqual({ token: refresh });
        expect(sealed()).toHaveLength(0);
        for (const handle of handles) expect(await store.resolve({ companyId: C, handle })).toBeNull();
        expect(rows(T)[0]).toMatchObject({ status: 'revoked', handles: {}, deletedStatusKey: 1, disconnectedBy: 'self' });
        await settle();
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ actorId: MEMBER, entityId: P })]);
        expect((await disconnectId(MEMBER, id)).code).toBe(404);
    });

    it('lets an admin end a member\'s connection but a colleague cannot', async () => {
        await connectAs(MEMBER);
        const id = String(rowOf(MEMBER)._id);
        expect((await disconnectId(COLLEAGUE, id)).code).toBe(404);
        expect(rowOf(MEMBER).status).toBe('connected');
        mockProvider.calls.length = 0;
        const out = await disconnectId(ADMIN, id);
        expect(out.code).toBe(200);
        expect(mockProvider.endpoints()).toEqual(['revoke:revoke']);
        await settle();
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ actorId: ADMIN, meta: expect.objectContaining({ by: 'admin' }) })]);
    });
});

describe('listing and products', () => {
    it('GET /api/v2/connectors shows the offered providers and the person\'s own connection', async () => {
        await connectAs(MEMBER, { email: 'maya@example.test' });
        const out = await call(ctrl.list, MEMBER);
        expect(out.body.data.providers).toEqual([{ provider: P, products: ['notes', 'files'] }]);
        expect(out.body.data.connections).toEqual([expect.objectContaining({ provider: P, connected: true, account: { label: 'maya@example.test' } })]);
        const theirs = await call(ctrl.list, COLLEAGUE);
        expect(theirs.body.data.connections[0]).toMatchObject({ connected: false, account: null });
        expect(JSON.stringify(theirs.body)).not.toContain('maya@example.test');
    });

    it('ticking a new product re-consents for only the union of scopes', async () => {
        await connectAs(MEMBER, { scope: 'profile notes.read notes.write' });
        const id = String(rowOf(MEMBER)._id);
        const out = await call(ctrl.setProducts, MEMBER, { params: { id }, body: { products: ['notes', 'files'] } });
        expect(out.code).toBe(200);
        const asked = Object.fromEntries(new URL(out.body.data.url).searchParams);
        expect(asked.scope).toBe('profile notes.read notes.write files.read');
        expect(rowOf(MEMBER).products).toEqual(['notes', 'files']);
        await settle();
        expect(audits('connector.products_changed')).toEqual([expect.objectContaining({ actorId: MEMBER, entityId: P, meta: expect.objectContaining({ products: ['notes', 'files'] }) })]);
    });
});

describe('mutations push a socket update and clear the cached list', () => {
    it('on connect, products and disconnect — with no token in the event', async () => {
        const { removeCache } = require('../utils/commonFunctions');
        const emitted = (change) => socketEmitter.emit.mock.calls.some(([name, payload]) => name === 'update' && payload.module === 'connector' && payload.data.change === change && payload.data.userId === MEMBER);
        await connectAs(MEMBER);
        expect(emitted('connected')).toBe(true);
        expect(removeCache).toHaveBeenCalledWith(`connectors:${C}:${MEMBER}`);
        await call(ctrl.setProducts, MEMBER, { params: { id: String(rowOf(MEMBER)._id) }, body: { products: ['notes', 'files'] } });
        expect(emitted('products_changed')).toBe(true);
        await disconnectId(MEMBER, String(rowOf(MEMBER)._id));
        expect(emitted('disconnected')).toBe(true);
        for (const token of mockProvider.issued) expect(JSON.stringify(socketEmitter.emit.mock.calls)).not.toContain(token);
    });
});

describe('the tokens never leave the secrets store', () => {
    it('are in no response, log line, audit row, event or database write', async () => {
        const responses = [];
        responses.push(await startAs(MEMBER));
        const granted = mockProvider.consent(responses[0].body.data.url, { email: 'maya@example.test' });
        responses.push(await completeAs(MEMBER, granted));
        responses.push(await call(ctrl.list, MEMBER));
        responses.push(await call(ctrl.members, ADMIN));
        const conn = await tokenFor(MEMBER);
        await conn.getAccessToken();
        expire(MEMBER);
        mockProvider.answers.token = (form) => ({ status: 400, body: { error: `leak ${form.refresh_token} ${form.client_secret}` } });
        await (await tokenFor(MEMBER)).getAccessToken().catch(() => {});
        delete mockProvider.answers.token;
        responses.push(await disconnectId(MEMBER, String(rowOf(MEMBER)._id)));
        await settle();

        const everything = captured(responses.map((r) => r.body || r));
        for (const secret of [...mockProvider.issued, CLIENT_SECRET]) {
            expect(everything.includes(secret)).toBe(false);
        }
    });
});

describe('the remaining branches have coverage', () => {
    it('markBackoff records backoffUntil on the connection, for B to honour a rate limit', async () => {
        await connectAs(MEMBER);
        const until = new Date(Date.now() + 60000);
        await markBackoff({ companyId: C, connectionId: String(rowOf(MEMBER)._id), until });
        expect(new Date(rowOf(MEMBER).backoffUntil).getTime()).toBe(until.getTime());
    });

    it('a seat that cannot be read is refused as not_member, not allowed through', async () => {
        await connectAs(MEMBER);
        mockRoleLookup.fails = true;
        try {
            await expect(tokenFor(MEMBER)).rejects.toMatchObject({ code: CODE.NOT_MEMBER });
        } finally { mockRoleLookup.fails = false; }
    });

    it('a connection marked reauth_required is refused as broken until the person reconnects', async () => {
        await connectAs(MEMBER);
        rowOf(MEMBER).status = 'reauth_required';
        await expect(tokenFor(MEMBER)).rejects.toMatchObject({ code: CODE.BROKEN });
    });

    it('a transient refresh failure fails that one call and leaves the connection connected', async () => {
        await connectAs(MEMBER);
        mockProvider.calls.length = 0;
        expire(MEMBER);
        mockProvider.answers.token = { status: 503, body: 'unavailable' };
        try {
            await expect((await tokenFor(MEMBER)).getAccessToken()).rejects.toBeDefined();
            expect(mockProvider.calls).toHaveLength(1);
            expect(rowOf(MEMBER).status).toBe('connected');
        } finally { delete mockProvider.answers.token; }
    });

    it('disconnect leaves the grant alone while another connection of the person shares the account', async () => {
        await connectAs(MEMBER, { accountId: 'acc-shared' });
        const id = String(rowOf(MEMBER)._id);
        mockDb.seed(T, { provider: P, userId: MEMBER, status: 'connected', account: { id: 'acc-shared', label: 'other' }, handles: { refresh: 'sec_000000000000000000000000', access: 'sec_000000000000000000000001' }, scopes: ['profile'], deletedStatusKey: 0 });
        mockProvider.calls.length = 0;
        expect((await disconnectId(MEMBER, id)).code).toBe(200);
        expect(mockProvider.calls).toHaveLength(0);
        expect(sealed()).toHaveLength(0);
    });

    it('the write routes carry an agentsRefused guard, so an agent or automation is turned away', () => {
        const captured = {};
        const record = (verb) => (path, ...handlers) => { captured[`${verb} ${path}`] = handlers; };
        routes.init({ get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE') });
        const refusesAs = (key) => (captured[key] || []).map((h) => h && h.refusesAs).find(Boolean);
        expect(refusesAs('POST /api/v2/connectors/:provider/connect')).toBe('connector.connect');
        expect(refusesAs('POST /api/v2/connectors/:provider/complete')).toBe('connector.connect');
        expect(refusesAs('PUT /api/v2/connectors/connections/:id/products')).toBe('connector.products_changed');
        expect(refusesAs('DELETE /api/v2/connectors/connections/:id')).toBe('connector.revoke');
        expect(refusesAs('GET /api/v2/connectors')).toBeUndefined();
    });
});

describe('the routes register only when a provider is offered', () => {
    const routesOf = () => {
        const seen = [];
        const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((verb) => [verb, (p) => seen.push(`${verb.toUpperCase()} ${p}`)]));
        routes.init(app);
        return seen.filter((r) => !r.includes('/slack') && !r.includes('/google') && !r.includes('/apps'));
    };

    it('registers the generic routes while CONNECTORS names a registry provider, and none otherwise', () => {
        expect(routesOf()).toEqual([
            'GET /api/v1/connector-oauth/:provider/callback',
            'GET /api/v2/connectors', 'GET /api/v2/connectors/members',
            'POST /api/v2/connectors/:provider/connect', 'POST /api/v2/connectors/:provider/complete',
            'PUT /api/v2/connectors/connections/:id/products', 'DELETE /api/v2/connectors/connections/:id',
        ]);
        process.env.CONNECTORS = 'slack';
        expect(routesOf()).toEqual([]);
    });
});
