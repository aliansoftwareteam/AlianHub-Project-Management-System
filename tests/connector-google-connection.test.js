const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

// Made here on every run, so no client secret or token sits in the repository; none of them is real.
const CLIENT_ID = `${crypto.randomBytes(6).toString('hex')}.apps.googleusercontent.test`;
const CLIENT_SECRET = crypto.randomBytes(18).toString('base64url');
const SIGN_IN_CLIENT_ID = `${crypto.randomBytes(6).toString('hex')}.signin.googleusercontent.test`;
const mockGoogle = require('./fixtures/fakeGoogle').create({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
const mockRoles = {};
const mockRoleLookup = { fails: false };

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
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((url, opts) => mockGoogle.fetch(url, opts)),
}));

const logger = require('../Config/loggerConfig');
const socketEmitter = require('../event/socketEventEmitter');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const flag = require('../Modules/Agents/connectors/flag');
const google = require('../Modules/Agents/connectors/googleConnection');
const ctrl = require('../Modules/Connectors/googleController');
const routes = require('../Modules/Connectors/routes');
const { AUTH_URL, TOKEN_URL, REVOKE_URL } = require('./fixtures/fakeGoogle');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const COLLEAGUE = '6f0000000000000000000a05';
const SESSION = Object.fromEntries([OWNER, ADMIN, MEMBER, GUEST, COLLEAGUE].map((uid, i) => [uid, `6e000000000000000000000${i + 1}`]));
const OTHER_SESSION = '6e00000000000000000000ff';
const G = 'google_calendar';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const API = 'http://localhost:4000';
const WEB = 'http://localhost:8080';
const CALLBACK = `${API}/api/v1/connector-oauth/google/callback`;
const SCOPES = [
    'openid', 'email',
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar.events.owned',
];
const ENV = {
    CONNECTORS: G, SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_GOOGLE_CLIENT_ID: CLIENT_ID, CONNECTOR_GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    GOOGLE_CLIENT_ID: SIGN_IN_CLIENT_ID, GOOGLE_CLIENT_SECRET: crypto.randomBytes(18).toString('base64url'),
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

const startAs = (uid, request = {}) => call(ctrl.connect, uid, { params: { connector: G }, ...request });
const consentAs = async (uid, who = {}, request = {}) => {
    const started = await startAs(uid, request);
    expect(started.code).toBe(200);
    return mockGoogle.consent(started.body.data.url, who);
};
const completeAs = (uid, { state, code }, request = {}) => call(ctrl.complete, uid, { params: { connector: G }, body: { state, code }, ...request });
const connectAs = async (uid, who = {}) => {
    const out = await completeAs(uid, await consentAs(uid, who));
    expect(out.code).toBe(200);
    return out;
};
const handleFor = (uid, companyId = C) => google.usableTokenHandle({ companyId, userId: uid, connector: G });
const expire = (uid) => { rowOf(uid).accessExpiresAt = new Date(Date.now() - 1000); };
const landed = (location) => {
    const [base, rest = ''] = String(location).split('#');
    const [path, query = ''] = rest.split('?');
    return { base, path, query: Object.fromEntries(new URLSearchParams(query)) };
};

/* Everything the server wrote to the database, answered, logged or emitted in this test, as one text to search
 * for a secret. The writes are read from the calls, so a value that a later write removed is still found. */
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
    mockGoogle.reset();
    mockRoleLookup.fails = false;
    Object.keys(mockRoles).forEach((k) => delete mockRoles[k]);
    mockRoles[C] = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0, [COLLEAGUE]: 3 };
    mockRoles[OTHER_COMPANY] = { [MEMBER]: 3 };
});

afterAll(() => {
    Object.keys(ENV).forEach((k) => { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; });
});

describe('connecting a Google account', () => {
    it('sends the person to Google with the connector client, the configured callback, the calendar scopes, offline access and a PKCE challenge', async () => {
        const out = await startAs(MEMBER, { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } });
        expect(out.code).toBe(200);
        expect(Object.keys(out.body.data)).toEqual(['url']);
        const url = new URL(out.body.data.url);
        expect(`${url.origin}${url.pathname}`).toBe(AUTH_URL);
        const asked = Object.fromEntries(url.searchParams);
        expect(asked).toMatchObject({
            client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: 'code', scope: SCOPES.join(' '),
            access_type: 'offline', prompt: 'consent', code_challenge_method: 'S256',
        });
        expect(asked.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(out.body.data.url).not.toContain(SIGN_IN_CLIENT_ID);
        expect(out.body.data.url).not.toContain(CLIENT_SECRET);
        expect(mockGoogle.calls).toHaveLength(0);

        const [row] = rows(T);
        expect(row).toMatchObject({ connector: G, userId: MEMBER, status: 'pending', secretHandles: {} });
        expect(row.oauth.sessionId).toBe(SESSION[MEMBER]);
        expect(JSON.stringify(row)).not.toContain(asked.state);
        expect(crypto.createHash('sha256').update(row.oauth.verifier).digest('base64url')).toBe(asked.code_challenge);
        expect(out.body.data.url).not.toContain(row.oauth.verifier);
    });

    it('the callback hands the code to the page the person is signed in on, and exchanges nothing itself', async () => {
        const { state, code } = await consentAs(MEMBER);
        const back = await call(ctrl.callback, undefined, { query: { state, code }, headers: { host: 'evil.example', origin: 'https://evil.example' } });
        expect(back.code).toBe(302);
        expect(landed(back.location)).toEqual({ base: `${WEB}/`, path: `/${C}/connections`, query: { connector: G, state, code } });
        expect(mockGoogle.calls).toHaveLength(0);
        expect(rowOf(MEMBER).status).toBe('pending');
    });

    it('completing it exchanges the code with the verifier, keeps both tokens by handle and labels the connection with the account', async () => {
        const { state, code } = await consentAs(MEMBER, { email: 'maya@example.test', sub: '4242' });
        const out = await completeAs(MEMBER, { state, code });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ connector: G, connected: true, status: 'connected', account: { email: 'maya@example.test' }, scopes: SCOPES });
        expect(out.body.data.connectedAt).toBeInstanceOf(Date);

        expect(mockGoogle.calls).toHaveLength(1);
        const [sent] = mockGoogle.calls;
        expect(sent).toMatchObject({ url: TOKEN_URL, verb: 'post', redirects: 0, workspace: C, authorization: undefined });
        expect(sent.form).toMatchObject({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: CALLBACK });
        expect(sent.form.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

        const row = rowOf(MEMBER);
        expect(Object.keys(row.secretHandles).sort()).toEqual(['access_token', 'refresh_token']);
        expect(row.oauth).toBeUndefined();
        expect(row.account).toEqual({ email: 'maya@example.test', sub: '4242' });
        expect(row.accessExpiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(rows(SCHEMA_TYPE.SECRETS).map((s) => s.kind)).toEqual(['connector', 'connector']);
        const [access, refresh] = mockGoogle.issued;
        expect(await store.resolve({ companyId: C, handle: row.secretHandles.access_token })).toBe(access);
        expect(await store.resolve({ companyId: C, handle: row.secretHandles.refresh_token })).toBe(refresh);
        await settle();
        expect(audits('connector.connect')).toEqual([expect.objectContaining({ actorId: MEMBER, entityId: G })]);
    });

    it('shows the person their own connection, and nobody else\'s', async () => {
        await connectAs(MEMBER, { email: 'maya@example.test' });
        const mine = await call(ctrl.mine, MEMBER);
        expect(mine.body.data.connections).toEqual([expect.objectContaining({ connector: G, on: true, connected: true, status: 'connected', account: { email: 'maya@example.test' } })]);
        const theirs = await call(ctrl.mine, COLLEAGUE);
        expect(theirs.body.data.connections).toEqual([expect.objectContaining({ connector: G, on: true, connected: false, account: null })]);
        expect(JSON.stringify(theirs.body)).not.toContain('maya@example.test');
    });

    it('keeps nothing when Google sends no refresh token', async () => {
        const { state, code } = await consentAs(MEMBER, { offline: false });
        const out = await completeAs(MEMBER, { state, code });
        expect(out.code).toBe(409);
        expect(out.body.code).toBe('no_refresh_token');
        expect(rows(SCHEMA_TYPE.SECRETS)).toHaveLength(0);
        expect((await call(ctrl.mine, MEMBER)).body.data.connections[0].connected).toBe(false);
    });

    it('reconnecting with another Google account ends the first account\'s grant and replaces the tokens under the same handles', async () => {
        await connectAs(MEMBER, { email: 'first@example.test', sub: '1' });
        const handles = { ...rowOf(MEMBER).secretHandles };
        const [, firstRefresh] = mockGoogle.issued;
        mockGoogle.calls.length = 0;
        await connectAs(MEMBER, { email: 'second@example.test', sub: '2' });
        expect(mockGoogle.endpoints()).toEqual(['token:authorization_code', 'revoke:revoke']);
        expect(mockGoogle.calls[1].form.token).toBe(firstRefresh);
        expect(rowOf(MEMBER).secretHandles).toEqual(handles);
        expect(rowOf(MEMBER).account.email).toBe('second@example.test');
        expect(rows(T)).toHaveLength(1);
    });

    it('reconnecting with the same account revokes nothing, because that would end the new grant too', async () => {
        await connectAs(MEMBER, { sub: '1' });
        mockGoogle.calls.length = 0;
        await connectAs(MEMBER, { sub: '1' });
        expect(mockGoogle.endpoints()).toEqual(['token:authorization_code']);
    });
});

describe('the state is bound to the session and the workspace that started it, once', () => {
    const untouched = async (uid = MEMBER) => {
        expect(mockGoogle.calls).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.SECRETS)).toHaveLength(0);
        expect((await call(ctrl.mine, uid)).body.data.connections[0].connected).toBe(false);
    };

    it('another session of the same person cannot complete it, and the attempt uses it up', async () => {
        const { state, code } = await consentAs(MEMBER);
        const out = await completeAs(MEMBER, { state, code }, { sessionId: OTHER_SESSION });
        expect(out.code).toBe(400);
        expect(out.body).toMatchObject({ status: false, code: 'state_invalid' });
        expect((await completeAs(MEMBER, { state, code })).body.code).toBe('state_used');
        await untouched();
    });

    it('a request without a session cannot start or complete it', async () => {
        expect((await startAs(MEMBER, { sessionId: '' })).code).toBe(403);
        const { state, code } = await consentAs(MEMBER);
        expect((await completeAs(MEMBER, { state, code }, { sessionId: '' })).code).toBe(400);
        await untouched();
    });

    it('another person cannot complete it, so a consent given under someone else\'s link connects nobody', async () => {
        const { state, code } = await consentAs(ADMIN, { email: 'victim@example.test' });
        const out = await completeAs(MEMBER, { state, code });
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('state_invalid');
        await untouched(MEMBER);
        await untouched(ADMIN);
    });

    it('it cannot be completed in another workspace the person belongs to', async () => {
        const { state, code } = await consentAs(MEMBER);
        const out = await completeAs(MEMBER, { state, code }, { companyId: OTHER_COMPANY });
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('state_invalid');
        await untouched();
    });

    it('it is used once', async () => {
        const { state, code } = await consentAs(MEMBER);
        expect((await completeAs(MEMBER, { state, code })).code).toBe(200);
        const again = await completeAs(MEMBER, { state, code });
        expect(again.code).toBe(400);
        expect(again.body.code).toBe('state_used');
        expect(mockGoogle.endpoints()).toEqual(['token:authorization_code']);
    });

    it('it expires after ten minutes', async () => {
        const { state, code } = await consentAs(MEMBER);
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 9 * 60 * 1000);
        try {
            expect(landed((await call(ctrl.callback, undefined, { query: { state, code } })).location).query.code).toBe(code);
            clock.mockReturnValue(now + 11 * 60 * 1000);
            expect(landed((await call(ctrl.callback, undefined, { query: { state, code } })).location).query).toEqual({ connector: 'google', result: 'error', reason: 'state' });
            const out = await completeAs(MEMBER, { state, code });
            expect(out.code).toBe(400);
            expect(out.body.code).toBe('state_invalid');
        } finally {
            clock.mockRestore();
        }
        await untouched();
    });

    it('a state signed with another key, or changed, is refused', async () => {
        const { state, code } = await consentAs(MEMBER);
        const [head, payload, signature] = state.split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const forged = [head, Buffer.from(JSON.stringify({ ...claims, userId: ADMIN })).toString('base64url'), signature].join('.');
        expect((await completeAs(ADMIN, { state: forged, code })).body.code).toBe('state_invalid');
        const resigned = require('jsonwebtoken').sign(claims, 'another-key', { algorithm: 'HS256' });
        expect((await completeAs(MEMBER, { state: resigned, code })).body.code).toBe('state_invalid');
        expect((await completeAs(MEMBER, { state: '', code })).body.code).toBe('state_invalid');
        await untouched();
    });

    it('a state whose PKCE verifier is gone is refused before Google is asked', async () => {
        const { state, code } = await consentAs(MEMBER);
        delete rowOf(MEMBER).oauth.verifier;
        const out = await completeAs(MEMBER, { state, code });
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('no_verifier');
        await untouched();
    });

    it('Google refuses the exchange when the verifier is not the one the challenge was made from', async () => {
        const { state, code } = await consentAs(MEMBER);
        rowOf(MEMBER).oauth.verifier = crypto.randomBytes(48).toString('base64url');
        const out = await completeAs(MEMBER, { state, code });
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('invalid_grant');
        expect(rows(SCHEMA_TYPE.SECRETS)).toHaveLength(0);
    });

    it('starting again replaces the earlier attempt', async () => {
        const first = await consentAs(MEMBER);
        const second = await consentAs(MEMBER);
        expect((await completeAs(MEMBER, first)).body.code).toBe('state_used');
        expect(mockGoogle.calls).toHaveLength(0);
        expect((await completeAs(MEMBER, second)).code).toBe(200);
    });

    it('a body that names another person or workspace changes nothing', async () => {
        const out = await startAs(MEMBER, { body: { userId: ADMIN, uid: ADMIN } });
        expect(out.code).toBe(200);
        expect(rows(T).map((r) => r.userId)).toEqual([MEMBER]);
        expect((await startAs(MEMBER, { body: { companyId: OTHER_COMPANY }, aud: `${C},${OTHER_COMPANY}` })).code).toBe(200);
        expect(rows(T).map((r) => r.userId)).toEqual([MEMBER]);
    });
});

describe('the callback', () => {
    it('an error from Google ends the attempt, and only a known reason is passed on', async () => {
        const { state } = await consentAs(MEMBER);
        const back = await call(ctrl.callback, undefined, { query: { state, error: 'access_denied' } });
        expect(landed(back.location)).toEqual({ base: `${WEB}/`, path: `/${C}/connections`, query: { connector: G, result: 'error', reason: 'access_denied' } });
        expect(rowOf(MEMBER).oauth).toBeUndefined();
        expect((await completeAs(MEMBER, { state, code: 'anything' })).body.code).toBe('state_used');
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it('does not repeat an error text it does not know', async () => {
        const { state } = await consentAs(MEMBER);
        const back = await call(ctrl.callback, undefined, { query: { state, error: '<script>alert(1)</script>' } });
        expect(landed(back.location).query).toEqual({ connector: G, result: 'error', reason: 'provider_error' });
        expect(back.location).not.toContain('script');
    });

    it('a callback without a code ends the attempt', async () => {
        const { state } = await consentAs(MEMBER);
        const back = await call(ctrl.callback, undefined, { query: { state } });
        expect(landed(back.location).query).toEqual({ connector: G, result: 'error', reason: 'no_code' });
        expect(rowOf(MEMBER).oauth).toBeUndefined();
    });

    it.each([['no state', undefined], ['a made-up state', 'abc.def.ghi'], ['a list', ['a', 'b']]])('with %s it returns to the configured address and passes no code on', async (label, state) => {
        const back = await call(ctrl.callback, undefined, { query: { state, code: 'a-code' }, headers: { host: 'evil.example', origin: 'https://evil.example' } });
        expect(back.code).toBe(302);
        expect(landed(back.location)).toEqual({ base: `${WEB}/`, path: '/', query: { connector: 'google', result: 'error', reason: 'state' } });
        expect(back.location).not.toContain('a-code');
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it('returns to an origin on the allow-list only; any other falls back to the configured address', async () => {
        process.env.CORS_ORIGINS = 'https://hub.example.test';
        const allowed = await consentAs(MEMBER, {}, { headers: { origin: 'https://hub.example.test' } });
        expect(landed((await call(ctrl.callback, undefined, { query: allowed })).location).base).toBe('https://hub.example.test/');
        const other = await consentAs(MEMBER, {}, { headers: { origin: 'https://evil.example', referer: 'https://evil.example/x' } });
        expect(landed((await call(ctrl.callback, undefined, { query: other })).location).base).toBe(`${WEB}/`);
    });

    it('refuses to start when APIURL is not set, because the callback address is never taken from the request', async () => {
        process.env.APIURL = '';
        const out = await startAs(MEMBER, { headers: { host: 'hub.example.test' } });
        expect(out.code).toBe(409);
        expect(out.body.code).toBe('apiurl_missing');
        expect(rows(T)).toHaveLength(0);
    });
});

describe('the access token is refreshed on use, once', () => {
    it('hands out the stored token while it is fresh, without asking Google', async () => {
        await connectAs(MEMBER);
        mockGoogle.calls.length = 0;
        const out = await handleFor(MEMBER);
        expect(out).toEqual({ handle: rowOf(MEMBER).secretHandles.access_token, reason: '' });
        expect(await store.resolve({ companyId: C, handle: out.handle })).toBe(mockGoogle.issued[0]);
        expect(mockGoogle.calls).toHaveLength(0);
        expect(rowOf(MEMBER).lastUsedAt).toBeInstanceOf(Date);
    });

    it('refreshes an expired token with one call and keeps the new one under the same handle', async () => {
        await connectAs(MEMBER);
        const [, refresh] = mockGoogle.issued;
        mockGoogle.calls.length = 0;
        expire(MEMBER);
        const out = await handleFor(MEMBER);
        expect(mockGoogle.endpoints()).toEqual(['token:refresh_token']);
        expect(mockGoogle.calls[0]).toMatchObject({ workspace: C, authorization: undefined, redirects: 0 });
        expect(mockGoogle.calls[0].form).toMatchObject({ refresh_token: refresh, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
        expect(out.handle).toBe(rowOf(MEMBER).secretHandles.access_token);
        expect(await store.resolve({ companyId: C, handle: out.handle })).toBe(mockGoogle.issued[3]);
        expect(rowOf(MEMBER).accessExpiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(await handleFor(MEMBER)).toEqual(out);
        expect(mockGoogle.calls).toHaveLength(1);
    });

    it('a refresh Google refuses breaks the connection, and it is not tried again until the person reconnects', async () => {
        await connectAs(MEMBER, { sub: '7' });
        mockGoogle.grants.forEach((grant) => { grant.revoked = true; });
        mockGoogle.calls.length = 0;
        expire(MEMBER);
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'broken' });
        expect(mockGoogle.endpoints()).toEqual(['token:refresh_token']);
        expect(rowOf(MEMBER)).toMatchObject({ status: 'broken', brokenReason: 'invalid_grant' });
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'broken' });
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'broken' });
        expect(mockGoogle.calls).toHaveLength(1);
        const seen = (await call(ctrl.mine, MEMBER)).body.data.connections[0];
        expect(seen).toMatchObject({ connected: true, status: 'broken', brokenReason: 'invalid_grant' });
        await settle();
        expect(audits('connector.broken')).toHaveLength(1);

        await connectAs(MEMBER, { sub: '7' });
        mockGoogle.calls.length = 0;
        expect((await handleFor(MEMBER)).handle).toBe(rowOf(MEMBER).secretHandles.access_token);
        expect(rowOf(MEMBER).status).toBe('connected');
    });

    it.each([
        ['Google cannot be reached', () => new Error('socket hang up')],
        ['Google answers with a server error', () => ({ status: 503, body: 'unavailable' })],
        ['Google limits the rate', () => ({ status: 429, body: {} })],
        ['the client is refused', () => ({ status: 401, body: { error: 'invalid_client' } })],
    ])('when %s the one attempt fails, nothing is retried and the connection is left as it was', async (label, answer) => {
        await connectAs(MEMBER);
        mockGoogle.calls.length = 0;
        expire(MEMBER);
        mockGoogle.answers.token = answer();
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'refresh_failed' });
        expect(mockGoogle.calls).toHaveLength(1);
        expect(rowOf(MEMBER).status).toBe('connected');
    });

    it('a token revoked from the stored-secrets screen reads as not connected', async () => {
        await connectAs(MEMBER);
        await store.revoke({ companyId: C, handle: rowOf(MEMBER).secretHandles.refresh_token, actor: OWNER });
        mockGoogle.calls.length = 0;
        expire(MEMBER);
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'token_unavailable' });
        expect(mockGoogle.calls).toHaveLength(0);
        expect((await call(ctrl.mine, MEMBER)).body.data.connections[0]).toMatchObject({ connected: false, account: null });
    });
});

describe('a connection is usable only while the person has a seat', () => {
    it.each([
        ['was removed from the workspace', () => { delete mockRoles[C][MEMBER]; }],
        ['became a guest', () => { mockRoles[C][MEMBER] = 0; }],
    ])('no handle once the person %s', async (label, change) => {
        await connectAs(MEMBER);
        mockGoogle.calls.length = 0;
        expire(MEMBER);
        change();
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'no_seat' });
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it('no handle when the seat cannot be read', async () => {
        await connectAs(MEMBER);
        mockRoleLookup.fails = true;
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'no_seat' });
    });

    it('no handle in another workspace, for another person, or for someone who never connected', async () => {
        await connectAs(MEMBER);
        expect(await handleFor(MEMBER, OTHER_COMPANY)).toEqual({ handle: null, reason: 'not_connected' });
        expect(await handleFor(ADMIN)).toEqual({ handle: null, reason: 'not_connected' });
        expect(await handleFor(COLLEAGUE)).toEqual({ handle: null, reason: 'not_connected' });
    });
});

describe('disconnecting', () => {
    it('revokes the grant with Google once, clears both tokens from the store and ends the connection', async () => {
        await connectAs(MEMBER);
        const [, refresh] = mockGoogle.issued;
        const handles = Object.values(rowOf(MEMBER).secretHandles);
        mockGoogle.calls.length = 0;
        const out = await call(ctrl.disconnect, MEMBER, { params: { connector: G } });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ connector: G, connected: false, account: null });
        expect(mockGoogle.calls).toHaveLength(1);
        expect(mockGoogle.calls[0]).toMatchObject({ url: REVOKE_URL, workspace: C, authorization: undefined });
        expect(mockGoogle.calls[0].form).toEqual({ token: refresh });
        expect(sealed()).toHaveLength(0);
        for (const handle of handles) await expect(store.resolve({ companyId: C, handle })).rejects.toMatchObject({ code: 'revoked' });
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(rows(T)[0]).toMatchObject({ status: 'revoked', secretHandles: {}, deletedStatusKey: 1, disconnectedBy: 'self' });
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'not_connected' });
        await settle();
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ actorId: MEMBER, entityId: G })]);
        expect((await call(ctrl.disconnect, MEMBER, { params: { connector: G } })).code).toBe(404);
        expect(mockGoogle.calls).toHaveLength(1);
    });

    it.each([
        ['Google cannot be reached', () => new Error('socket hang up')],
        ['Google refuses the token', () => ({ status: 400, body: { error: 'invalid_token' } })],
    ])('still ends here when %s, after one attempt', async (label, answer) => {
        await connectAs(MEMBER);
        mockGoogle.calls.length = 0;
        mockGoogle.answers.revoke = answer();
        const out = await call(ctrl.disconnect, MEMBER, { params: { connector: G } });
        expect(out.code).toBe(200);
        expect(mockGoogle.calls).toHaveLength(1);
        expect(sealed()).toHaveLength(0);
        expect(rowOf(MEMBER)).toBeUndefined();
    });

    it('leaves the grant with Google alone while another connection of the person still uses the same account', async () => {
        await connectAs(MEMBER, { sub: '9' });
        mockDb.seed(T, { connector: 'gmail', userId: MEMBER, status: 'connected', account: { sub: '9' }, secretHandles: { refresh_token: 'sec_000000000000000000000000' }, deletedStatusKey: 0 });
        mockGoogle.calls.length = 0;
        expect((await call(ctrl.disconnect, MEMBER, { params: { connector: G } })).code).toBe(200);
        expect(mockGoogle.calls).toHaveLength(0);
        expect(sealed()).toHaveLength(0);
    });
});

describe('when a person leaves the workspace', () => {
    it('their connection is ended: the grant revoked once, the tokens cleared, and the row closed', async () => {
        await connectAs(MEMBER);
        await connectAs(COLLEAGUE, { email: 'colleague@example.test', sub: '55' });
        mockGoogle.calls.length = 0;
        expect(await google.memberDeparted(C, MEMBER)).toBe(1);
        expect(mockGoogle.endpoints()).toEqual(['revoke:revoke']);
        expect(rowOf(MEMBER)).toBeUndefined();
        expect(rows(T).find((r) => r.userId === MEMBER)).toMatchObject({ status: 'revoked', disconnectedBy: 'member_removed', secretHandles: {} });
        expect(rowOf(COLLEAGUE).status).toBe('connected');
        expect(sealed()).toHaveLength(2);
        await settle();
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ entityId: G, meta: expect.objectContaining({ by: 'member_removed', userId: MEMBER }) })]);
    });

    it('an attempt they had started can no longer be completed', async () => {
        const { state, code } = await consentAs(MEMBER);
        await google.memberDeparted(C, MEMBER);
        expect((await completeAs(MEMBER, { state, code })).body.code).toBe('state_used');
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it('never throws into the removal, whatever fails', async () => {
        await connectAs(MEMBER);
        mockDb.crud.mockImplementationOnce(async () => { throw new Error('the database is away'); });
        await expect(google.memberDeparted(C, MEMBER)).resolves.toBe(0);
        await expect(google.memberDeparted('', MEMBER)).resolves.toBe(0);
    });

    it('does nothing, and reads nothing, while no Google connector is named', async () => {
        process.env.CONNECTORS = 'slack';
        mockDb.calls.length = 0;
        expect(await google.memberDeparted(C, MEMBER)).toBe(0);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('who may see and touch a connection', () => {
    const attempts = [
        ['reads their connections', ctrl.mine, {}],
        ['starts a connection', ctrl.connect, { params: { connector: G } }],
        ['completes a connection', ctrl.complete, { params: { connector: G }, body: { state: 'a.b.c', code: 'a-code' } }],
        ['disconnects', ctrl.disconnect, { params: { connector: G } }],
        ['lists the members\' connections', ctrl.members, {}],
        ['disconnects a member', ctrl.disconnectMember, { params: { connector: G, userId: MEMBER } }],
    ];
    const unchanged = async (run) => {
        await connectAs(MEMBER);
        mockGoogle.calls.length = 0;
        const stored = JSON.stringify(rows(T));
        const out = await run();
        expect(out.code).toBe(403);
        expect(out.body.status).toBe(false);
        expect(JSON.stringify(rows(T))).toBe(stored);
        expect(mockGoogle.calls).toHaveLength(0);
    };

    it.each(attempts)('a guest is refused when it %s', (what, handler, request) => unchanged(() => call(handler, GUEST, request)));

    it.each(attempts)('someone without a seat is refused when it %s', (what, handler, request) => unchanged(() => call(handler, '6f0000000000000000000a99', { ...request, sessionId: OTHER_SESSION })));

    it.each(attempts)('an API token is refused when it %s, even an owner\'s', (what, handler, request) => unchanged(() => call(handler, OWNER, { ...request, apiToken: { _id: 'tok1', userId: OWNER } })));

    it.each(attempts)('a request for a workspace the session does not hold is refused when it %s', (what, handler, request) => unchanged(() => call(handler, OWNER, { ...request, aud: OTHER_COMPANY })));

    it.each(attempts.slice(4))('a member is refused when it %s', (what, handler, request) => unchanged(() => call(handler, COLLEAGUE, request)));

    it('a member cannot end a colleague\'s connection through their own route', async () => {
        await connectAs(MEMBER);
        mockGoogle.calls.length = 0;
        const out = await call(ctrl.disconnect, COLLEAGUE, { params: { connector: G }, body: { userId: MEMBER }, query: { userId: MEMBER } });
        expect(out.code).toBe(404);
        expect(rowOf(MEMBER).status).toBe('connected');
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it.each([[OWNER, 'an owner'], [ADMIN, 'an admin']])('%s (%s) sees that a member has a connection, without the account or a handle', async (uid) => {
        await connectAs(MEMBER, { email: 'maya@example.test' });
        await startAs(COLLEAGUE);
        const out = await call(ctrl.members, uid);
        expect(out.code).toBe(200);
        expect(out.body.data.connections).toHaveLength(1);
        expect(Object.keys(out.body.data.connections[0]).sort()).toEqual(['brokenAt', 'connectedAt', 'connector', 'lastUsedAt', 'scopes', 'status', 'userId']);
        expect(out.body.data.connections[0]).toMatchObject({ userId: MEMBER, connector: G, status: 'connected', scopes: SCOPES });
        const text = JSON.stringify(out.body);
        expect(text).not.toContain('maya@example.test');
        expect(text).not.toContain('sec_');
    });

    it('an admin can end a member\'s connection, and cannot use it', async () => {
        await connectAs(MEMBER);
        expect(await handleFor(ADMIN)).toEqual({ handle: null, reason: 'not_connected' });
        mockGoogle.calls.length = 0;
        const out = await call(ctrl.disconnectMember, ADMIN, { params: { connector: G, userId: MEMBER } });
        expect(out.code).toBe(200);
        expect(out.body.data).toEqual({ connections: [] });
        expect(mockGoogle.endpoints()).toEqual(['revoke:revoke']);
        expect(sealed()).toHaveLength(0);
        expect((await call(ctrl.mine, MEMBER)).body.data.connections[0].connected).toBe(false);
        await settle();
        expect(audits('connector.revoke')).toEqual([expect.objectContaining({ actorId: ADMIN, meta: expect.objectContaining({ by: 'admin', userId: MEMBER }) })]);
        expect((await call(ctrl.disconnectMember, ADMIN, { params: { connector: G, userId: MEMBER } })).code).toBe(404);
        expect((await call(ctrl.disconnectMember, ADMIN, { params: { connector: G, userId: 'not-an-id' } })).code).toBe(400);
    });
});

describe('the tokens never leave the secrets store', () => {
    it('are in no response, log line, audit row, event or database write, in any state', async () => {
        const responses = [];
        const errors = [];
        responses.push(await startAs(MEMBER));
        const granted = mockGoogle.consent(responses[0].body.data.url, { email: 'maya@example.test' });
        responses.push(await completeAs(MEMBER, granted));
        responses.push(await call(ctrl.mine, MEMBER));
        responses.push(await call(ctrl.members, ADMIN));
        responses.push(await call(ctrl.mine, COLLEAGUE));
        await handleFor(MEMBER);

        expire(MEMBER);
        mockGoogle.answers.token = (form) => ({ status: 400, body: { error: `leak ${form.refresh_token} ${form.client_secret}`, error_description: form.refresh_token } });
        responses.push(await handleFor(MEMBER));
        mockGoogle.answers.token = new Error(`connect failed after sending client_secret=${CLIENT_SECRET}&refresh_token=${mockGoogle.issued[1]}`);
        responses.push(await handleFor(MEMBER));
        delete mockGoogle.answers.token;
        responses.push(await handleFor(MEMBER));

        const again = await consentAs(MEMBER);
        mockGoogle.answers.token = new Error(`socket hang up after sending client_secret=${CLIENT_SECRET}&code=${again.code}`);
        const unreachable = await completeAs(MEMBER, again);
        expect(unreachable.code).toBe(502);
        expect(unreachable.body.statusText).toContain('[hidden]');
        responses.push(unreachable);
        delete mockGoogle.answers.token;

        const crashing = await consentAs(MEMBER);
        mockDb.crud.mockImplementationOnce(async () => { throw new Error(`write failed near ${mockGoogle.issued[0]} ${CLIENT_SECRET}`); });
        const crashed = await completeAs(MEMBER, crashing);
        expect(crashed.body).toEqual({ status: false, statusText: 'Something went wrong.' });
        responses.push(crashed);

        mockGoogle.grants.forEach((grant) => { grant.revoked = true; });
        expire(MEMBER);
        responses.push(await handleFor(MEMBER));
        responses.push(await call(ctrl.mine, MEMBER));
        await google.complete({ companyId: C, userId: MEMBER, sessionId: SESSION[MEMBER], connector: G, state: 'x', code: 'y' }).catch((e) => errors.push(e.message));
        responses.push(await call(ctrl.disconnect, MEMBER, { params: { connector: G } }));
        await connectAs(COLLEAGUE, { sub: '55' });
        mockGoogle.answers.revoke = (form) => { throw new Error(`reset while sending token=${form.token}`); };
        responses.push(await call(ctrl.disconnectMember, OWNER, { params: { connector: G, userId: COLLEAGUE } }));
        await settle();

        expect(mockGoogle.issued.length).toBeGreaterThanOrEqual(7);
        expect(mockGoogle.calls.length).toBeGreaterThan(6);
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).length).toBeGreaterThan(6);
        const everything = captured(responses.map((r) => r.body || r), errors);
        for (const secret of [...mockGoogle.issued, CLIENT_SECRET]) {
            expect(everything.includes(secret)).toBe(false);
            expect(everything.includes(secret.slice(5, 21))).toBe(false);
        }
        for (const code of [again.code, crashing.code]) expect(captured().includes(code)).toBe(false);
        expect(everything).toContain('unreachable');
    });

    it('the search above finds a token that is stored in the clear, logged, emitted, or written and later removed', async () => {
        await connectAs(MEMBER);
        const [access, refresh, idToken] = mockGoogle.issued;
        mockDb.seed(T, { connector: G, leaked: access });
        expect(captured().includes(access)).toBe(true);
        logger.error(`refreshing with ${refresh}`);
        expect(captured().includes(refresh)).toBe(true);
        socketEmitter.emit('update', { token: idToken });
        expect(captured().includes(idToken)).toBe(true);
        await mockDb.crud(C, { type: T, data: [{ userId: MEMBER }, { $set: { leaked: CLIENT_SECRET } }] }, 'updateOne');
        await mockDb.crud(C, { type: T, data: [{ userId: MEMBER }, { $set: { leaked: '' } }] }, 'updateOne');
        expect(JSON.stringify(mockDb.store).includes(CLIENT_SECRET)).toBe(false);
        expect(captured().includes(CLIENT_SECRET)).toBe(true);
    });
});

describe('the flag', () => {
    const GOOGLE_ROUTES = [
        'GET /api/v1/connector-oauth/google/callback',
        'GET /api/v2/connectors/google/mine', 'GET /api/v2/connectors/google/members',
        'POST /api/v2/connectors/google/:connector/connect', 'POST /api/v2/connectors/google/:connector/complete',
        'DELETE /api/v2/connectors/google/:connector', 'DELETE /api/v2/connectors/google/:connector/members/:userId',
    ];
    const routesOf = () => {
        const seen = [];
        const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((verb) => [verb, (path) => seen.push(`${verb.toUpperCase()} ${path}`)]));
        routes.init(app);
        return seen;
    };
    const everyRoute = () => [
        [ctrl.mine, MEMBER, {}],
        [ctrl.connect, MEMBER, { params: { connector: G } }],
        [ctrl.complete, MEMBER, { params: { connector: G }, body: { state: 'a.b.c', code: 'a-code' } }],
        [ctrl.disconnect, MEMBER, { params: { connector: G } }],
        [ctrl.members, OWNER, {}],
        [ctrl.disconnectMember, OWNER, { params: { connector: G, userId: MEMBER } }],
    ];

    it('registers the Google routes only while the flag names the connector', () => {
        expect(routesOf()).toEqual(GOOGLE_ROUTES);
        process.env.CONNECTORS = 'slack';
        expect(routesOf().filter((r) => r.includes('google'))).toEqual([]);
        process.env.CONNECTORS = `slack, ${G}`;
        expect(routesOf().filter((r) => r.includes('google'))).toEqual(GOOGLE_ROUTES);
        expect(routesOf().filter((r) => r.includes('slack'))).toHaveLength(5);
    });

    it.each([undefined, 'off', 'slack'])('CONNECTORS=%s: no route, every handler refuses, no token is handed out and Google is never called', async (value) => {
        await connectAs(MEMBER);
        const { state, code } = await consentAs(MEMBER);
        mockGoogle.calls.length = 0;
        if (value === undefined) delete process.env.CONNECTORS; else process.env.CONNECTORS = value;
        expect(routesOf().filter((r) => r.includes('google'))).toEqual([]);
        expect(flag.status(G)).toEqual({ requested: false, on: false, problems: [] });
        for (const [handler, uid, request] of everyRoute()) expect((await call(handler, uid, request)).code).toBe(404);
        expect((await completeAs(MEMBER, { state, code })).code).toBe(404);
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'off' });
        expect(landed((await call(ctrl.callback, undefined, { query: { state, code } })).location).query).toEqual({ connector: 'google', result: 'error', reason: 'off' });
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it.each([
        ['the secrets store off', { SECRETS_STORE: '' }, ['secrets_store_off'], 'SECRETS_STORE'],
        ['a short key', { SECRETS_KEY: 'short' }, ['secrets_key_invalid'], 'SECRETS_KEY'],
        ['taint routing off', { AGENT_TAINT_ROUTING: '' }, ['taint_routing_off'], 'AGENT_TAINT_ROUTING'],
        ['no client id', { CONNECTOR_GOOGLE_CLIENT_ID: '' }, ['google_client_missing'], 'CONNECTOR_GOOGLE_CLIENT_ID'],
        ['no client secret', { CONNECTOR_GOOGLE_CLIENT_SECRET: '  ' }, ['google_client_missing'], 'CONNECTOR_GOOGLE_CLIENT_SECRET'],
        ['only the sign-in client', { CONNECTOR_GOOGLE_CLIENT_ID: '', CONNECTOR_GOOGLE_CLIENT_SECRET: '' }, ['google_client_missing'], 'CONNECTOR_GOOGLE_CLIENT_ID'],
    ])('named but with %s: it stays off, says why once at startup and on the screen, and every route refuses', async (label, change, codes, named) => {
        await connectAs(MEMBER);
        const { state, code } = await consentAs(MEMBER);
        mockGoogle.calls.length = 0;
        jest.clearAllMocks();
        Object.assign(process.env, change);

        const status = flag.status(G);
        expect(status).toMatchObject({ requested: true, on: false });
        expect(status.problems.map((p) => p.code)).toEqual(codes);
        flag.logBootState();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain(G);
        expect(logger.error.mock.calls[0][0]).toContain(named);
        expect(logger.error.mock.calls[0][0]).not.toContain(CLIENT_SECRET);
        expect(logger.info).not.toHaveBeenCalled();
        expect(routesOf()).toEqual(GOOGLE_ROUTES);

        expect((await call(ctrl.mine, ADMIN)).body.data.connections).toEqual([{ connector: G, on: false, problems: codes }]);
        expect((await call(ctrl.mine, MEMBER)).body.data.connections).toEqual([{ connector: G, on: false, problems: [] }]);
        for (const [handler, uid, request] of everyRoute().slice(1)) {
            const out = await call(handler, uid, request);
            expect(out.code).toBe(409);
            expect(out.body.status).toBe(false);
        }
        const asOwner = await call(ctrl.connect, OWNER, { params: { connector: G } });
        expect(asOwner.body.problems).toEqual(codes);
        expect(asOwner.body.statusText).toContain(named);
        const asMember = await call(ctrl.connect, MEMBER, { params: { connector: G } });
        expect(asMember.body.problems).toBeUndefined();
        expect(asMember.body.statusText).not.toContain(named);
        expect((await completeAs(MEMBER, { state, code })).code).toBe(409);
        expect(await handleFor(MEMBER)).toEqual({ handle: null, reason: 'off' });
        expect(mockGoogle.calls).toHaveLength(0);
    });

    it('with everything in place it is on, and says so once at startup without naming the secret', () => {
        expect(flag.status(G)).toEqual({ requested: true, on: true, problems: [] });
        flag.logBootState();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(logger.info.mock.calls[0][0]).toContain(G);
        expect(logger.info.mock.calls[0][0]).not.toContain(CLIENT_SECRET);
    });

    it('Slack does not need the Google client', () => {
        Object.assign(process.env, { CONNECTORS: 'slack', CONNECTOR_GOOGLE_CLIENT_ID: '', CONNECTOR_GOOGLE_CLIENT_SECRET: '' });
        expect(flag.status('slack')).toEqual({ requested: true, on: true, problems: [] });
    });

    it('an unknown connector name in the address is refused', async () => {
        for (const connector of ['gmail', 'slack', '__proto__', '']) {
            const out = await call(ctrl.connect, MEMBER, { params: { connector } });
            expect(out.code).toBe(404);
        }
        expect(rows(T)).toHaveLength(0);
    });

    it('this slice adds no agent action and no reader', () => {
        const registry = require('../Modules/Agents/registry');
        expect(registry.keys().filter((key) => /^(gcal|gmail|google)/.test(key))).toEqual([]);
    });
});
