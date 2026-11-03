require('./fixtures/mcpFlagsOff');
const crypto = require('crypto');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const CLIENT_ID = '1234567890.0987654321';
const CLIENT_SECRET = crypto.randomBytes(16).toString('hex');
const mockRoles = {};
const mockSlack = { fetch: null };

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
    safeFetch: jest.fn((url, opts) => mockSlack.fetch(url, opts)),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const ctrl = require('../Modules/Connectors/connectorsController');
const connection = require('../Modules/Connectors/connection');
const { resolveConnection, CODE } = require('../Modules/Connectors/resolveConnection');

/* The real Slack definition through the real connect, refresh and disconnect lifecycle, against a fake Slack that
 * behaves as docs.slack.dev describes: user tokens under authed_user, refusals as 200 with ok:false, a refresh token
 * used once, auth.revoke taking only an access token, and a code_verifier refused when the consent sent no challenge. */

const C = '6f0000000000000000000c01';
const MEMBER = '6f0000000000000000000a03';
const SESSION = '6e0000000000000000000003';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const API = 'https://pm.example.test';
const CALLBACK = `${API}/api/v1/connector-oauth/slack/callback`;
const ENV = {
    CONNECTORS: 'slack', SECRETS_STORE: 'true', SECRETS_KEY: crypto.randomBytes(24).toString('hex'), AGENT_TAINT_ROUTING: 'on',
    CONNECTOR_SLACK_CLIENT_ID: CLIENT_ID, CONNECTOR_SLACK_CLIENT_SECRET: CLIENT_SECRET,
    APIURL: `${API}/`, WEBURL: 'https://pm.example.test', JWT_SECRET: crypto.randomBytes(24).toString('hex'),
};
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body), bytes: 0, hops: [] });
const slackOk = (body) => json(200, { ok: true, ...body });
const slackNo = (error) => json(200, { ok: false, error });

const fakeSlack = () => {
    const s = { calls: [], codes: new Map(), refreshes: new Map(), live: new Set(), revoked: [], rotation: true, refreshShape: 'authed_user', n: 0 };
    const issue = () => {
        s.n += 1;
        const access = `xoxe.xoxp-1-${s.n}`;
        const refresh = `xoxe-1-${s.n}`;
        s.live.add(access);
        if (s.rotation) s.refreshes.set(refresh, false);
        return { access, refresh };
    };
    s.consent = (authUrl, { scope } = {}) => {
        const asked = Object.fromEntries(new URL(authUrl).searchParams);
        const code = `code-${crypto.randomBytes(6).toString('hex')}`;
        s.codes.set(code, { asked, scope: scope || asked.user_scope });
        return { code, state: asked.state, asked };
    };
    const access = (form) => {
        if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) return slackNo('invalid_client_id');
        if (form.grant_type === 'refresh_token') {
            if (s.refreshes.get(form.refresh_token) !== false) return slackNo('invalid_refresh_token');
            s.refreshes.set(form.refresh_token, true);
            const t = issue();
            const user = { id: 'U0MAYA0001', scope: 'channels:read,chat:write', access_token: t.access, refresh_token: t.refresh, expires_in: 43200, token_type: 'user' };
            return slackOk(s.refreshShape === 'authed_user' ? { authed_user: user, team: { id: 'T0ACME0001' } } : { ...user, user_id: user.id });
        }
        const grant = s.codes.get(form.code);
        s.codes.delete(form.code);
        if (!grant) return slackNo('invalid_code');
        if (form.code_verifier) return slackNo('pkce_not_allowed');
        if (form.redirect_uri !== grant.asked.redirect_uri) return slackNo('bad_redirect_uri');
        const t = issue();
        return slackOk({
            app_id: 'A0APP00001', team: { id: 'T0ACME0001', name: 'Acme' },
            authed_user: { id: 'U0MAYA0001', scope: grant.scope, access_token: t.access, token_type: 'user', ...(s.rotation ? { refresh_token: t.refresh, expires_in: 43200 } : {}) },
        });
    };
    const revoke = (form) => {
        if (!s.live.has(form.token)) return slackNo('invalid_auth');
        s.live.delete(form.token);
        s.revoked.push(form.token);
        return slackOk({ revoked: true });
    };
    s.fetch = async (url, opts = {}) => {
        const form = Object.fromEntries(new URLSearchParams(opts.data || ''));
        const method = String(url).replace('https://slack.com/api/', '');
        s.calls.push({ method, form });
        if (method === 'oauth.v2.access') return access(form);
        if (method === 'auth.revoke') return revoke(form);
        return slackNo('unknown_method');
    };
    return s;
};

let slack;
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
const start = () => call(ctrl.connect, { params: { provider: 'slack' } });
const complete = ({ state, code }) => call(ctrl.complete, { params: { provider: 'slack' }, body: { state, code } });
const connect = async (consent = {}) => {
    const started = await start();
    expect(started.code).toBe(200);
    const out = await complete(slack.consent(started.body.data.url, consent));
    return out;
};
const expire = () => { rowOf().accessExpiresAt = new Date(Date.now() - 1000); };
const tokenNow = () => resolveConnection({ companyId: C, userId: MEMBER, provider: 'slack' }).then((c) => c.getAccessToken());

beforeEach(() => {
    Object.assign(process.env, ENV);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    slack = fakeSlack();
    mockSlack.fetch = slack.fetch;
    mockRoles[C] = { [MEMBER]: 3 };
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('connecting Slack', () => {
    it('sends the person to Slack with user scopes only, comma-separated, and no PKCE challenge', async () => {
        const started = await start();
        expect(started.code).toBe(200);
        const url = new URL(started.body.data.url);
        expect(`${url.origin}${url.pathname}`).toBe('https://slack.com/oauth/v2/authorize');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: CLIENT_ID, redirect_uri: CALLBACK, user_scope: 'channels:read,groups:read,channels:history,groups:history,chat:write' });
        expect(url.searchParams.has('scope')).toBe(false);
        expect(url.searchParams.has('code_challenge')).toBe(false);
    });

    it('completes without a code_verifier, keeps the user token from authed_user and names the account by workspace', async () => {
        const out = await connect({ scope: 'channels:read,channels:history,chat:write' });
        expect(out.code).toBe(200);
        expect(out.body.data).toMatchObject({ provider: 'slack', connected: true, account: { label: 'Acme' }, scopes: ['channels:read', 'channels:history', 'chat:write'] });
        const sent = slack.calls.find((c) => c.method === 'oauth.v2.access');
        expect(sent.form).toMatchObject({ grant_type: 'authorization_code', redirect_uri: CALLBACK });
        expect(sent.form.code_verifier).toBeUndefined();
        const row = rowOf();
        expect(row.account).toEqual({ id: 'T0ACME0001:U0MAYA0001', label: 'Acme' });
        expect(await store.resolve({ companyId: C, handle: row.handles.access })).toBe('xoxe.xoxp-1-1');
        expect(await store.resolve({ companyId: C, handle: row.handles.refresh })).toBe('xoxe-1-1');
        expect(new Date(row.accessExpiresAt).getTime()).toBeGreaterThan(Date.now() + 11 * 3600 * 1000);
    });

    it('refuses an app without token rotation, and keeps no token', async () => {
        slack.rotation = false;
        const out = await connect();
        expect(out.body.code).toBe('no_refresh_token');
        expect((mockDb.store[SCHEMA_TYPE.SECRETS] || []).filter((s) => s.ciphertext)).toHaveLength(0);
    });

    it('turns Slack\'s ok:false answer into a refusal, not a connection', async () => {
        const started = await start();
        const consent = slack.consent(started.body.data.url);
        slack.codes.clear();
        const out = await complete(consent);
        expect(out.code).toBe(400);
        expect(out.body.code).toBe('invalid_code');
        expect(rowOf().handles).toEqual({});
    });
});

describe('using a Slack connection', () => {
    it('hands out the stored token while it is fresh, with no call to Slack', async () => {
        await connect();
        slack.calls.length = 0;
        expect(await tokenNow()).toBe('xoxe.xoxp-1-1');
        expect(slack.calls).toHaveLength(0);
    });

    it.each(['authed_user', 'top level'])('refreshes an expired token once and keeps the new refresh token (answer %s)', async (shape) => {
        await connect();
        slack.refreshShape = shape;
        expire();
        expect(await tokenNow()).toBe('xoxe.xoxp-1-2');
        const row = rowOf();
        expect(await store.resolve({ companyId: C, handle: row.handles.refresh })).toBe('xoxe-1-2');
        expire();
        expect(await tokenNow()).toBe('xoxe.xoxp-1-3');
        expect(slack.calls.filter((c) => c.form.grant_type === 'refresh_token').map((c) => c.form.refresh_token)).toEqual(['xoxe-1-1', 'xoxe-1-2']);
    });

    it('marks the connection broken when Slack refuses the refresh token', async () => {
        await connect();
        slack.refreshes.set('xoxe-1-1', true);
        expire();
        await expect(tokenNow()).rejects.toMatchObject({ code: CODE.BROKEN });
        expect(rowOf()).toMatchObject({ status: 'broken', lastError: 'invalid_refresh_token' });
    });
});

describe('disconnecting Slack', () => {
    it('revokes the access token, never the refresh token, and drops both from the store', async () => {
        await connect();
        const { handles } = rowOf();
        const out = await call(ctrl.disconnect, { params: { id: String(rowOf()._id) } });
        expect(out.code).toBe(200);
        expect(slack.revoked).toEqual(['xoxe.xoxp-1-1']);
        expect(slack.calls.filter((c) => c.method === 'auth.revoke').map((c) => c.form.token)).toEqual(['xoxe.xoxp-1-1']);
        expect(await store.resolve({ companyId: C, handle: handles.refresh }).catch(() => null)).toBeNull();
        expect(await store.resolve({ companyId: C, handle: handles.access }).catch(() => null)).toBeNull();
    });

    it('refreshes an expired access token first, so the revoke reaches a live token', async () => {
        await connect();
        expire();
        const id = String(rowOf()._id);
        await call(ctrl.disconnect, { params: { id } });
        expect(slack.calls.map((c) => c.form.grant_type || c.method).slice(-2)).toEqual(['refresh_token', 'auth.revoke']);
        expect(slack.revoked).toEqual(['xoxe.xoxp-1-2']);
    });

    it('still ends the connection when Slack cannot be told', async () => {
        await connect();
        expire();
        slack.refreshes.set('xoxe-1-1', true);
        const id = String(rowOf()._id);
        const out = await call(ctrl.disconnect, { params: { id } });
        expect(out.code).toBe(200);
        expect(rowOf()).toBeUndefined();
        expect(slack.revoked).toEqual([]);
    });
});

describe('the Slack callback', () => {
    it('hands a refusal on Slack\'s consent screen back to the page as its error code', async () => {
        const started = await start();
        const { state } = slack.consent(started.body.data.url);
        const out = await connection.returnFor({ provider: 'slack', state, error: 'access_denied' });
        expect(out.query).toMatchObject({ connector: 'slack', result: 'error', reason: 'access_denied' });
    });
});
