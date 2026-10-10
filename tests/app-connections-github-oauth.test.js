const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const mockAudit = [];
const mockRoles = {};
const mockFetch = jest.fn();
jest.mock('axios', () => ({ post: jest.fn(), delete: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({
    recordAudit: (companyId, entry) => mockAudit.push({ companyId, ...entry }),
    recordAuditFromReq: (req, entry) => mockAudit.push({ actorId: req.uid, ...entry }),
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: async () => ['bbbbbbbbbbbbbbbbbbbbbb01'], visibleProjects: async () => [] }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ ...jest.requireActual('../Modules/Agents/engine/safeFetch'), safeFetch: (...a) => mockFetch(...a) }));

const axios = require('axios');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { isEncrypted } = require('../utils/secretField');
const oauth = require('../Modules/Integrations/appConnections/github/oauth');
const github = require('../Modules/Integrations/appConnections/githubConnect');
const hub = require('../Modules/Integrations/appConnections/controller');
const integrations = require('../Modules/Integrations/controller');
const runner = require('../Modules/Integrations/appConnections/runner');
const socketEmitter = require('../event/socketEventEmitter');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_COMPANY = 'cccccccccccccccccccccccc';
const OWNER = '200000000000000000000001';
const OTHER_OWNER = '200000000000000000000002';
const MEMBER = '200000000000000000000003';
const SESSION = 'session-1';
const TOKEN = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
const SECOND = 'gho_second0000000000000000000000000000000';
const CONN = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const ENV = { ...process.env };

const res = () => {
    const r = { code: 200, body: null, location: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.set = (h) => { Object.assign(r.headers, h); return r; };
    r.redirect = (code, url) => { r.location = url === undefined ? code : url; return r; };
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, query = {}, headers = {}, company = COMPANY, sessionId = SESSION } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: company, ...headers }, uid, sessionId, body, params, query }), r);
    return r;
};
const callback = (query) => { const r = res(); github.callback({ query, headers: {} }, r); return r; };
const returned = (r) => new URLSearchParams(r.location.split('#')[1].split('?')[1]);
const stateFor = async (uid = OWNER, company = COMPANY) => {
    const r = await call(github.authorize, uid, { company, headers: { origin: 'http://localhost:8080' } });
    return new URL(r.body.data.url).searchParams.get('state');
};
const complete = async (state, opts = {}) => call(github.complete, opts.uid || OWNER, { body: { state, code: opts.code || 'code-1' }, ...opts });
const rows = () => (mockDb.store[CONN] || []).filter((row) => row.deletedStatusKey !== 1);

const fetchAs = ({ account = { id: 7, login: 'octo' }, readable = true } = {}) => mockFetch.mockImplementation(async (url) => {
    if (url === 'https://api.github.com/user') return { status: 200, headers: {}, body: JSON.stringify(account) };
    if (url.startsWith('https://api.github.com/repos/')) return readable ? { status: 200, headers: {}, body: '{}' } : { status: 404, headers: {}, body: '{}' };
    return { status: 200, headers: {}, body: '[]' };
});

beforeEach(() => {
    Object.assign(process.env, {
        JWT_SECRET: 'test-secret', APP_CONNECTIONS: 'true', APIURL: 'http://localhost:4000/', WEBURL: 'http://localhost:8080',
        GITHUB_CONNECT_CLIENT_ID: 'Iv1.connectclient', GITHUB_CONNECT_CLIENT_SECRET: 'connect-client-secret-value',
    });
    for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'CORS_ORIGINS']) delete process.env[key];
    Object.assign(mockRoles, { [OWNER]: 1, [OTHER_OWNER]: 1, [MEMBER]: 3 });
    mockDb.store[CONN] = [];
    mockAudit.length = 0;
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { access_token: TOKEN, scope: 'repo', token_type: 'bearer' } });
    axios.delete.mockReset();
    axios.delete.mockResolvedValue({ status: 204 });
    mockFetch.mockReset();
    fetchAs();
    socketEmitter.emit.mockClear();
});
afterAll(() => { process.env = ENV; });

describe('the GitHub sign-in state', () => {
    it('round-trips company and person, and keeps the PKCE verifier unreadable', () => {
        const { state, challenge } = oauth.encodeState({ companyId: COMPANY, userId: OWNER, sessionId: SESSION });
        const d = oauth.decodeState(state);
        expect(d).toMatchObject({ companyId: COMPANY, userId: OWNER, nonce: expect.stringMatching(/^[a-f0-9]{32}$/) });
        const verifier = oauth.verifierOf(d);
        expect(crypto.createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
        expect(JSON.stringify(jwt.decode(state))).not.toContain(verifier);
        expect(oauth.sessionMatches(d, SESSION)).toBe(true);
        expect(oauth.sessionMatches(d, 'other')).toBe(false);
    });

    it('expires after ten minutes', () => {
        const now = Date.now();
        const { state } = oauth.encodeState({ companyId: COMPANY, userId: OWNER }, now);
        expect(oauth.decodeState(state, now + 9 * 60 * 1000)).not.toBeNull();
        expect(oauth.decodeState(state, now + 11 * 60 * 1000)).toBeNull();
    });

    it('refuses a tampered state, one signed with another secret, a session token and an overlong one', () => {
        const { state } = oauth.encodeState({ companyId: COMPANY, userId: OWNER });
        const [head, , sig] = state.split('.');
        const changed = Buffer.from(JSON.stringify({ ...jwt.decode(state), companyId: OTHER_COMPANY })).toString('base64url');
        expect(oauth.decodeState(`${head}.${changed}.${sig}`)).toBeNull();
        expect(oauth.decodeState(jwt.sign({ ...jwt.decode(state) }, 'other'))).toBeNull();
        expect(oauth.decodeState(jwt.sign({ companyId: COMPANY, userId: OWNER, nonce: 'n', pkce: 'p' }, 'test-secret'))).toBeNull();
        expect(oauth.decodeState('x'.repeat(oauth.MAX_STATE_LENGTH + 1))).toBeNull();
    });

    it('returns only to an allow-listed origin', () => {
        expect(oauth.returnOriginOf({ headers: { origin: 'http://localhost:8080' } })).toBe('http://localhost:8080');
        expect(oauth.returnOriginOf({ headers: { origin: 'https://elsewhere.example' } })).toBe('');
        expect(oauth.returnOriginOf({ headers: { referer: 'https://elsewhere.example/page' } })).toBe('');
        expect(oauth.returnOriginOf({ headers: { origin: 'https://elsewhere.example', referer: 'http://localhost:8080/#/x' } })).toBe('http://localhost:8080');
    });
});

describe('authorize', () => {
    it('gives an owner the GitHub URL with the callback on APIURL, the repo scope and an S256 challenge, never the secret', async () => {
        const r = await call(github.authorize, OWNER);
        const url = new URL(r.body.data.url);
        expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
        expect(url.searchParams.get('client_id')).toBe('Iv1.connectclient');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/v1/github-connect/callback');
        expect(url.searchParams.get('scope')).toBe('repo');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.stringify(r.body)).not.toContain('connect-client-secret-value');
    });

    it('refuses a member', async () => {
        expect((await call(github.authorize, MEMBER)).code).toBe(403);
    });

    it('refuses when the server has no GitHub app, and the hub offers the paste form instead', async () => {
        delete process.env.GITHUB_CONNECT_CLIENT_ID;
        delete process.env.GITHUB_CONNECT_CLIENT_SECRET;
        expect((await call(github.authorize, OWNER)).code).toBe(409);
        const app = (await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github');
        expect(app.oneClick).toBe(false);
        expect(app.fields.map((f) => f.key)).toEqual(['token', 'repo']);
        expect(app.setup).toEqual({ homepageUrl: 'http://localhost:8080', callbackUrl: 'http://localhost:4000/api/v1/github-connect/callback' });
    });

    it('gives the setup addresses to an owner alone, never with a secret, and drops them once the app is set', async () => {
        delete process.env.GITHUB_CONNECT_CLIENT_ID;
        process.env.GITHUB_CONNECT_CLIENT_SECRET = 'connect-client-secret-value';
        const owner = (await call(hub.hub, OWNER)).body;
        expect(Object.keys(owner.data.apps.find((a) => a.key === 'github').setup)).toEqual(['homepageUrl', 'callbackUrl']);
        expect(JSON.stringify(owner)).not.toContain('connect-client-secret-value');
        expect((await call(hub.hub, MEMBER)).body.data.apps.find((a) => a.key === 'github').setup).toBeUndefined();
        process.env.GITHUB_CONNECT_CLIENT_ID = 'Iv1.connectclient';
        expect((await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github').setup).toBeUndefined();
    });

    it('falls back to the sign-in GitHub app when no connect app is set', async () => {
        delete process.env.GITHUB_CONNECT_CLIENT_ID;
        delete process.env.GITHUB_CONNECT_CLIENT_SECRET;
        Object.assign(process.env, { GITHUB_CLIENT_ID: 'Iv1.signin', GITHUB_CLIENT_SECRET: 'signin-secret' });
        const r = await call(github.authorize, OWNER);
        expect(new URL(r.body.data.url).searchParams.get('client_id')).toBe('Iv1.signin');
    });
});

describe('the public callback', () => {
    it('exchanges and stores nothing; it hands code and state to the signed-in page in the fragment', async () => {
        const state = await stateFor();
        const r = callback({ code: 'code-1', state });
        expect(r.location.startsWith(`http://localhost:8080/#/${COMPANY}/app-connections?`)).toBe(true);
        expect(Object.fromEntries(returned(r))).toEqual({ github: 'complete', state, code: 'code-1' });
        expect(r.headers).toMatchObject({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        expect(axios.post).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
    });

    it('sends an unsigned state to the web address and a cancelled sign-in back with a reason', async () => {
        const r = callback({ code: 'c', state: 'nope' });
        expect(r.location).toBe('http://localhost:8080/#/?github=expired');
        expect(returned(callback({ error: 'access_denied', state: await stateFor() })).get('github')).toBe('denied');
        expect(returned(callback({ code: 'x'.repeat(oauth.MAX_CODE_LENGTH + 1), state: await stateFor() })).get('github')).toBe('failed');
    });
});

describe('completing the sign-in', () => {
    it('stores the token sealed, exchanges with the secret and verifier server-side, and never echoes the token', async () => {
        const r = await complete(await stateFor());
        expect(r.body).toMatchObject({ status: true, data: { repo: '', account: 'octo' } });
        const [url, sent] = axios.post.mock.calls[0];
        expect(url).toBe('https://github.com/login/oauth/access_token');
        expect(sent).toMatchObject({ client_secret: 'connect-client-secret-value', code: 'code-1', code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{64}$/) });
        expect(rows()).toHaveLength(1);
        const row = rows()[0];
        expect(JSON.stringify(row)).not.toContain(TOKEN);
        expect(isEncrypted(row.config.token)).toBe(true);
        expect(row).toMatchObject({ type: 'github', status: 'connected', enabled: true, connectedBy: OWNER, config: { auth: 'oauth', accountId: '7' } });
        expect(JSON.stringify(r.body)).not.toContain(TOKEN);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'integrationConnections', companyId: COMPANY }));
        expect(mockAudit).toEqual([expect.objectContaining({ actorId: OWNER, action: 'app_connection.connected' })]);
        const conn = (await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github').connections[0];
        expect(conn).toMatchObject({ viaOAuth: true, target: '', secrets: { token: true } });
    });

    it('refuses another owner, an owner of another workspace and another session, storing nothing', async () => {
        const state = await stateFor();
        expect((await complete(state, { uid: OTHER_OWNER })).code).toBe(400);
        expect((await complete(state, { company: OTHER_COMPANY })).code).toBe(400);
        expect((await complete(state, { sessionId: 'session-2' })).code).toBe(400);
        expect(axios.post).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
        expect(mockDb.store[CONN]).toHaveLength(0);
    });

    it('refuses a member, and an owner demoted since the sign-in began', async () => {
        const state = await stateFor();
        mockRoles[OWNER] = 3;
        expect((await complete(state)).code).toBe(403);
        expect(rows()).toHaveLength(0);
    });

    it('uses a state once', async () => {
        const state = await stateFor();
        expect((await complete(state)).body.status).toBe(true);
        expect((await complete(state)).code).toBe(400);
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('answers a failed exchange as an expired sign-in and stores nothing', async () => {
        axios.post.mockResolvedValue({ data: { error: 'bad_verification_code' } });
        expect((await complete(await stateFor())).code).toBe(400);
        expect(rows()).toHaveLength(0);
    });

    it('refuses when the app was unset after the sign-in began', async () => {
        const state = await stateFor();
        delete process.env.GITHUB_CONNECT_CLIENT_ID;
        expect((await complete(state)).code).toBe(409);
        expect(rows()).toHaveLength(0);
    });

    it('on reconnect with the same account keeps repository, projects and cursor, clears failures, and revokes the earlier grant', async () => {
        await complete(await stateFor());
        Object.assign(rows()[0].config, { repo: 'acme/web' });
        rows()[0].projectIds = ['bbbbbbbbbbbbbbbbbbbbbb01'];
        rows()[0].sync = { cursor: '2026-10-01T00:00:00Z', failures: 3, nextAttemptAt: new Date(), lastError: 'GitHub refused the token (401).' };
        axios.post.mockResolvedValue({ data: { access_token: SECOND } });
        await complete(await stateFor(), { code: 'code-2' });
        const row = rows()[0];
        expect(rows()).toHaveLength(1);
        expect(row.config.repo).toBe('acme/web');
        expect(row.projectIds).toEqual(['bbbbbbbbbbbbbbbbbbbbbb01']);
        expect(row.sync).toMatchObject({ cursor: '2026-10-01T00:00:00Z', failures: 0, nextAttemptAt: null, lastError: '' });
        expect(JSON.stringify(row)).not.toContain(SECOND);
        expect(axios.delete).toHaveBeenCalledWith('https://api.github.com/applications/Iv1.connectclient/token', expect.objectContaining({
            auth: { username: 'Iv1.connectclient', password: 'connect-client-secret-value' }, data: { access_token: TOKEN },
        }));
    });

    it('on reconnect as another account starts the cursor again, and drops a repository the new token cannot read', async () => {
        await complete(await stateFor());
        Object.assign(rows()[0].config, { repo: 'acme/web' });
        rows()[0].sync = { cursor: 'old', failures: 2 };
        fetchAs({ account: { id: 8, login: 'other' }, readable: false });
        axios.post.mockResolvedValue({ data: { access_token: SECOND } });
        await complete(await stateFor(), { code: 'code-2' });
        expect(rows()[0].config.repo).toBeUndefined();
        expect(rows()[0].config.accountId).toBe('8');
        expect(rows()[0].sync).toEqual({});
    });

    it('still connects when GitHub will not revoke the earlier grant', async () => {
        await complete(await stateFor());
        axios.delete.mockRejectedValue(new Error('network'));
        axios.post.mockResolvedValue({ data: { access_token: SECOND } });
        expect((await complete(await stateFor(), { code: 'code-2' })).body.status).toBe(true);
    });
});

describe('disconnecting', () => {
    it('revokes a sign-in grant at GitHub and still disconnects when that fails', async () => {
        await complete(await stateFor());
        const id = String(rows()[0]._id);
        axios.delete.mockRejectedValue(new Error('network'));
        const r = await call(integrations.disconnect, OWNER, { params: { id } });
        expect(r.body.status).toBe(true);
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/applications/Iv1.connectclient/token'), expect.objectContaining({ data: { access_token: TOKEN } }));
        expect(rows()).toHaveLength(0);
    });

    it('does not wait on GitHub', async () => {
        await complete(await stateFor());
        axios.delete.mockReturnValue(new Promise(() => {}));
        const r = await call(integrations.disconnect, OWNER, { params: { id: String(rows()[0]._id) } });
        expect(r.body.status).toBe(true);
        expect(axios.delete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 5000 }));
    });

    it('revokes with the app that issued the grant, and skips when that app is no longer configured', async () => {
        await complete(await stateFor());
        expect(rows()[0].config.clientId).toBe('Iv1.connectclient');
        Object.assign(process.env, { GITHUB_CONNECT_CLIENT_ID: 'Iv1.newer', GITHUB_CONNECT_CLIENT_SECRET: 'newer-secret' });
        await call(integrations.disconnect, OWNER, { params: { id: String(rows()[0]._id) } });
        expect(axios.delete).not.toHaveBeenCalled();
        expect(require('../Config/loggerConfig').warn).toHaveBeenCalledWith(expect.stringMatching(/no longer configured/));
    });

    it('asks GitHub nothing for a pasted token', async () => {
        await call(integrations.connect, OWNER, { body: { type: 'github', config: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', repo: 'acme/web' } } });
        await call(integrations.disconnect, OWNER, { params: { id: String(rows()[0]._id) } });
        expect(axios.delete).not.toHaveBeenCalled();
    });
});

describe('a connection with no repository yet', () => {
    it('is waiting, not failing', async () => {
        await complete(await stateFor());
        rows()[0].projectIds = ['bbbbbbbbbbbbbbbbbbbbbb01'];
        mockFetch.mockClear();
        await runner.syncConnection({ companyId: COMPANY, connection: rows()[0], now: Date.now() });
        expect(rows()[0].sync).toMatchObject({ failures: 0, nextAttemptAt: null, lastError: 'No repository is picked yet.' });
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe('the repository picker', () => {
    const connected = async () => { await complete(await stateFor()); return String(rows()[0]._id); };

    it('lists the repositories the token can see, a page at a time', async () => {
        const id = await connected();
        mockFetch.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify([{ full_name: 'acme/web', private: true }, { full_name: 'acme/api', private: false }]) });
        const r = await call(github.repos, OWNER, { params: { id }, query: { page: '2' } });
        expect(r.body).toMatchObject({ status: true, data: { repos: [{ fullName: 'acme/web', private: true }, { fullName: 'acme/api', private: false }], page: 2, hasMore: false } });
        const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        expect(url).toContain('https://api.github.com/user/repos?');
        expect(url).toContain('page=2');
        expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    });

    it('caps the page it asks for', async () => {
        const id = await connected();
        mockFetch.mockResolvedValue({ status: 200, headers: {}, body: '[]' });
        await call(github.repos, OWNER, { params: { id }, query: { page: '9999' } });
        expect(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0]).toContain('page=10');
    });

    it('saves a repository the token can read, resets the sync, and audits it', async () => {
        const id = await connected();
        rows()[0].sync = { cursor: 'old' };
        const r = await call(github.setRepo, OWNER, { params: { id }, body: { repo: 'acme/web' } });
        expect(r.body).toMatchObject({ status: true, data: { id, repo: 'acme/web' } });
        expect(rows()[0].config.repo).toBe('acme/web');
        expect(isEncrypted(rows()[0].config.token)).toBe(true);
        expect(rows()[0].sync).toEqual({});
        expect(mockAudit.map((a) => a.action)).toContain('app_connection.repo');
    });

    it('refuses a repository the token cannot read, a malformed one, and a member', async () => {
        const id = await connected();
        fetchAs({ readable: false });
        expect((await call(github.setRepo, OWNER, { params: { id }, body: { repo: 'acme/secret' } })).code).toBe(400);
        expect((await call(github.setRepo, OWNER, { params: { id }, body: { repo: '../etc' } })).code).toBe(400);
        expect((await call(github.setRepo, MEMBER, { params: { id }, body: { repo: 'acme/web' } })).code).toBe(403);
        expect((await call(github.repos, MEMBER, { params: { id } })).code).toBe(403);
        expect(rows()[0].config.repo).toBeUndefined();
    });

    it('answers an unexpected failure with a 500 in the usual shape', async () => {
        const id = await connected();
        mockFetch.mockRejectedValue(new Error('boom'));
        const r = await call(github.repos, OWNER, { params: { id } });
        expect(r.code).toBe(500);
        expect(r.body).toMatchObject({ status: false, statusText: 'Something went wrong.' });
    });
});

describe('a workspace egress allowlist without api.github.com', () => {
    const { EGRESS_UNLISTED } = jest.requireActual('../Modules/Agents/engine/safeFetch');
    const unlisted = () => Object.assign(new Error('api.github.com is not on this workspace\'s egress allowlist — the instance owner can allow it under Instance > Egress'), { code: EGRESS_UNLISTED, host: 'api.github.com' });
    const connected = async () => { await complete(await stateFor()); return String(rows()[0]._id); };

    it('answers the repository list with egress_blocked and the host, never a 500', async () => {
        const id = await connected();
        mockFetch.mockRejectedValue(unlisted());
        const r = await call(github.repos, OWNER, { params: { id } });
        expect(r.code).toBe(409);
        expect(r.body).toMatchObject({ status: false, code: 'egress_blocked', data: { host: 'api.github.com' } });
        expect(r.body.statusText).toMatch(/isn't allowed to reach api\.github\.com/);
    });

    it('answers a repository save the same way, and stores nothing', async () => {
        const id = await connected();
        mockFetch.mockRejectedValue(unlisted());
        const r = await call(github.setRepo, OWNER, { params: { id }, body: { repo: 'acme/web' } });
        expect(r.code).toBe(409);
        expect(r.body).toMatchObject({ code: 'egress_blocked', data: { host: 'api.github.com' } });
        expect(rows()[0].config.repo).toBeUndefined();
    });

    it('still completes the sign-in and says at once that the host is blocked', async () => {
        mockFetch.mockRejectedValue(unlisted());
        const r = await complete(await stateFor());
        expect(r.body).toMatchObject({ status: true, data: { egressBlocked: { host: 'api.github.com' } } });
        expect(rows()).toHaveLength(1);
    });

    it('the sync records it in plain words with the code, backs off, and clears it once GitHub is reached', async () => {
        await connected();
        Object.assign(rows()[0], { projectIds: ['bbbbbbbbbbbbbbbbbbbbbb01'], config: { ...rows()[0].config, repo: 'acme/web' } });
        mockFetch.mockRejectedValue(unlisted());
        const now = Date.now();
        await runner.syncConnection({ companyId: COMPANY, connection: rows()[0], now });
        expect(rows()[0].sync).toMatchObject({
            lastError: 'AlianHub isn\'t allowed to reach api.github.com yet. The instance owner can allow it under Settings > Instance > Egress.',
            errorCode: 'egress_blocked', blockedHost: 'api.github.com', failures: 1,
        });
        expect(new Date(rows()[0].sync.nextAttemptAt).getTime()).toBeGreaterThan(now);

        const shown = await call(hub.hub, OWNER);
        const card = shown.body.data.apps.find((a) => a.key === 'github').connections[0];
        expect(card).toMatchObject({ errorCode: 'egress_blocked', blockedHost: 'api.github.com' });

        mockFetch.mockResolvedValue({ status: 200, headers: {}, body: '[]' });
        rows()[0].sync.nextAttemptAt = null;
        await runner.syncConnection({ companyId: COMPANY, connection: rows()[0], now: now + 1 });
        expect(rows()[0].sync).toMatchObject({ errorCode: '', blockedHost: '', failures: 0 });
    });
});
