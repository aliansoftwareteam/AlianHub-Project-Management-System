require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const CLIENT_ID = '11112222-bbbb-3333-cccc-4444dddd5555';
const CLIENT_SECRET = crypto.randomBytes(16).toString('hex');
const mockRoles = {};
const mockMicrosoft = { fetch: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => {}) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => ((mockRoles[companyId] || {})[uid] ?? null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => true), isWritable: (p) => p === true || p === 1 || p === 2, isReadable: (p) => p !== null && p !== undefined && p !== 0,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn((url, opts) => mockMicrosoft.fetch(url, opts)),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const logger = require('../Config/loggerConfig');
const flag = require('../Modules/Agents/connectors/flag');
const ctrl = require('../Modules/Connectors/connectorsController');
const connection = require('../Modules/Connectors/connection');
const runner = require('../Modules/Connectors/toolRunner');
const { resolveConnection, CODE } = require('../Modules/Connectors/resolveConnection');
const fakeMicrosoft = require('./fixtures/fakeMicrosoft');

/* The real Outlook definition through the real connect, refresh and disconnect lifecycle, against a fake Microsoft
 * identity platform that checks the client, the redirect address and the PKCE verifier, answers granted Graph scopes
 * as full addresses, and has no revoke endpoint. */

const C = '6f0000000000000000000c01';
const MEMBER = '6f0000000000000000000a03';
const SESSION = '6e0000000000000000000003';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const API = 'https://pm.example.test';
const CALLBACK = `${API}/api/v1/connector-oauth/outlook/callback`;
const ENV = {
    CONNECTORS: 'outlook', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_OUTLOOK_CLIENT_ID: CLIENT_ID, CONNECTOR_OUTLOOK_CLIENT_SECRET: CLIENT_SECRET,
    APIURL: `${API}/`, WEBURL: 'https://pm.example.test', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const GRANTED = 'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite openid profile offline_access';

let microsoft;
const rowOf = () => (mockDb.store[T] || []).find((r) => r.userId === MEMBER && r.deletedStatusKey !== 1);
const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    r.set = () => r;
    r.redirect = (code, url) => { r.code = url ? code : 302; r.location = url || code; return r; };
    return r;
};
const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: C, origin: ENV.WEBURL }, uid: MEMBER, sessionId: SESSION, body, params, query }), r);
    return r;
};
const start = (body = {}) => call(ctrl.connect, { params: { provider: 'outlook' }, body });
const complete = ({ state, code }) => call(ctrl.complete, { params: { provider: 'outlook' }, body: { state, code } });
const connect = async (consent = { granted: GRANTED }, body) => {
    const started = await start(body);
    expect(started.code).toBe(200);
    return complete(microsoft.identity.consent(started.body.data.url, consent));
};
const expire = () => { rowOf().accessExpiresAt = new Date(Date.now() - 1000); };
const tokenNow = () => resolveConnection({ companyId: C, userId: MEMBER, provider: 'outlook' }).then((c) => c.getAccessToken());
const refreshes = () => microsoft.identity.calls.filter((c) => c.form.grant_type === 'refresh_token');

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    microsoft = fakeMicrosoft.create({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    mockMicrosoft.fetch = microsoft.fetch;
    mockRoles[C] = { [MEMBER]: 3 };
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('switching Outlook on', () => {
    it('is a connector this server knows, and says at startup that it is on', () => {
        expect(flag.requested()).toEqual(['outlook']);
        expect(flag.status('outlook')).toEqual({ requested: true, on: true, problems: [] });
        flag.logBootState();
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('outlook connector on'));
    });

    it('says when there is no instance app, so only a workspace\'s own Microsoft app can connect it', () => {
        delete process.env.CONNECTOR_OUTLOOK_CLIENT_SECRET;
        flag.logBootState();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('outlook has no instance app (CONNECTOR_OUTLOOK_CLIENT_ID and CONNECTOR_OUTLOOK_CLIENT_SECRET)'));
    });

    it('stays off without the secrets store, and says why', () => {
        delete process.env.SECRETS_STORE;
        expect(flag.status('outlook')).toMatchObject({ requested: true, on: false });
        flag.logBootState();
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/names outlook but it stays off: SECRETS_STORE/));
    });
});

describe('connecting Outlook', () => {
    it('sends the person to Microsoft\'s common endpoint with PKCE and the base and ticked scopes', async () => {
        const started = await start({ products: ['mail'] });
        expect(started.code).toBe(200);
        const url = new URL(started.body.data.url);
        expect(`${url.origin}${url.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: 'code', scope: 'openid profile offline_access Mail.ReadWrite', code_challenge_method: 'S256',
        });
        expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('completes with the verifier, keeps the tokens in the store and the scopes in the form the tools name', async () => {
        const out = await connect();
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: 'outlook', connected: true, account: { label: 'prisha@contoso.test' }, scopes: ['Mail.ReadWrite', 'Calendars.ReadWrite', 'openid', 'profile', 'offline_access'] });
        const sent = microsoft.identity.calls.find((c) => c.form.grant_type === 'authorization_code');
        expect(sent.form).toMatchObject({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: CALLBACK });
        expect(sent.form.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
        const row = rowOf();
        expect(row.account).toEqual({ id: `${fakeMicrosoft.TENANT}:${fakeMicrosoft.OID}`, label: 'prisha@contoso.test' });
        expect(await store.resolve({ companyId: C, handle: row.handles.access })).toBe(microsoft.identity.issued[0]);
        expect(JSON.stringify(row)).not.toContain(microsoft.identity.issued[0]);
    });

    it('refuses a grant without offline access, and keeps no token', async () => {
        const started = await start();
        const consent = microsoft.identity.consent(started.body.data.url.replace('offline_access', 'email'), { granted: 'Mail.ReadWrite openid profile' });
        const out = await complete(consent);
        expect(out.body.code).toBe('no_refresh_token');
        expect((mockDb.store[SCHEMA_TYPE.SECRETS] || []).filter((s) => s.ciphertext)).toHaveLength(0);
    });

    it('turns a code Microsoft does not accept into a refusal, not a connection', async () => {
        const started = await start();
        const consent = microsoft.identity.consent(started.body.data.url, { granted: GRANTED });
        microsoft.identity.codes.clear();
        const out = await complete(consent);
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('invalid_grant');
        expect(rowOf().handles).toEqual({});
    });

    it('a connection made this way passes the tools\' scope check and reads Graph with its own token', async () => {
        await connect();
        const out = await runner.read({ companyId: C, userId: MEMBER, via: runner.VIA.MCP, callerId: 'oauth:client-1', key: 'outlook.mail.search', input: { query: 'lunch' } });
        expect(out.text).toMatch(/Lunch\? \[id: AAMk-lunch_2\]/);
    });

    it('a connection without the calendar product is told to tick it', async () => {
        await connect({ granted: 'https://graph.microsoft.com/Mail.ReadWrite openid profile offline_access' }, { products: ['mail'] });
        await expect(runner.read({ companyId: C, userId: MEMBER, via: runner.VIA.MCP, callerId: 'oauth:client-1', key: 'outlook.calendar.events.list' }))
            .rejects.toMatchObject({ code: 'scope_missing', message: expect.stringContaining('Tick calendar on your Outlook connection') });
    });
});

describe('using an Outlook connection', () => {
    it('hands out the stored token while it is fresh, with no call to Microsoft', async () => {
        await connect();
        microsoft.identity.calls.length = 0;
        expect(await tokenNow()).toBe(microsoft.identity.issued[0]);
        expect(microsoft.identity.calls).toHaveLength(0);
    });

    it('refreshes an expired token once and keeps the new refresh token Microsoft hands back', async () => {
        await connect();
        const firstRefresh = await store.resolve({ companyId: C, handle: rowOf().handles.refresh });
        expire();
        const fresh = await tokenNow();
        expect(fresh).not.toBe(microsoft.identity.issued[0]);
        const nextRefresh = await store.resolve({ companyId: C, handle: rowOf().handles.refresh });
        expect(nextRefresh).not.toBe(firstRefresh);
        expect(refreshes().map((c) => c.form.refresh_token)).toEqual([firstRefresh]);
    });

    it.each(['invalid_grant', 'interaction_required'])('marks the connection broken when the refresh answers %s', async (error) => {
        await connect();
        const refresh = await store.resolve({ companyId: C, handle: rowOf().handles.refresh });
        microsoft.identity.grants.get(refresh).dead = error;
        expire();
        await expect(tokenNow()).rejects.toMatchObject({ code: CODE.BROKEN });
        expect(rowOf()).toMatchObject({ status: 'broken', lastError: error });
    });
});

describe('disconnecting Outlook', () => {
    it('drops both tokens from the store without calling Microsoft, which has no revoke endpoint', async () => {
        await connect();
        const { handles } = rowOf();
        microsoft.identity.calls.length = 0;
        const out = await call(ctrl.disconnect, { params: { id: String(rowOf()._id) } });
        expect(out.code).toBe(200);
        expect(microsoft.identity.calls).toHaveLength(0);
        expect(rowOf()).toBeUndefined();
        expect(await store.resolve({ companyId: C, handle: handles.refresh }).catch(() => null)).toBeNull();
        expect(await store.resolve({ companyId: C, handle: handles.access }).catch(() => null)).toBeNull();
    });
});

describe('the Outlook callback', () => {
    it.each(['access_denied', 'consent_required'])('hands %s back to the page as its reason, so it can name the admin route', async (error) => {
        const started = await start();
        const { state } = microsoft.identity.consent(started.body.data.url);
        const out = await connection.returnFor({ provider: 'outlook', state, error });
        expect(out.query).toMatchObject({ connector: 'outlook', result: 'error', reason: error });
    });
});
