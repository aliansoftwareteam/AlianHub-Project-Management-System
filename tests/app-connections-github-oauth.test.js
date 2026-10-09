const jwt = require('jsonwebtoken');
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const mockAudit = [];
const mockRoles = {};
const mockFetch = jest.fn();
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({
    recordAudit: (companyId, entry) => mockAudit.push({ companyId, ...entry }),
    recordAuditFromReq: (req, entry) => mockAudit.push({ actorId: req.uid, ...entry }),
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: async () => [], visibleProjects: async () => [] }));
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
const socketEmitter = require('../event/socketEventEmitter');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_COMPANY = 'cccccccccccccccccccccccc';
const OWNER = '200000000000000000000001';
const MEMBER = '200000000000000000000003';
const TOKEN = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
const CONN = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const ENV = { ...process.env };

const res = () => {
    const r = { code: 200, body: null, location: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.redirect = (url) => { r.location = url; return r; };
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, query = {}, headers = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: COMPANY, ...headers }, uid, body, params, query }), r);
    return r;
};
const callback = async (query) => { const r = res(); await github.callback({ query, headers: {} }, r); return r; };
const outcomeOf = (r) => new URL(r.location).searchParams.get('github');
const stateFor = async (uid = OWNER) => {
    const r = await call(github.authorize, uid, { headers: { origin: 'http://localhost:8080' } });
    return new URL(r.body.data.url).searchParams.get('state');
};
const rows = () => (mockDb.store[CONN] || []).filter((row) => row.deletedStatusKey !== 1);

beforeEach(() => {
    Object.assign(process.env, {
        JWT_SECRET: 'test-secret', APP_CONNECTIONS: 'true', APIURL: 'http://localhost:4000/', WEBURL: 'http://localhost:8080',
        GITHUB_CONNECT_CLIENT_ID: 'Iv1.connectclient', GITHUB_CONNECT_CLIENT_SECRET: 'connect-client-secret-value',
    });
    Object.assign(mockRoles, { [OWNER]: 1, [MEMBER]: 3 });
    mockDb.store[CONN] = [];
    mockAudit.length = 0;
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { access_token: TOKEN, scope: 'repo', token_type: 'bearer' } });
    mockFetch.mockReset();
    socketEmitter.emit.mockClear();
});
afterAll(() => { process.env = ENV; });

describe('the GitHub sign-in state', () => {
    it('round-trips company, person and a nonce', () => {
        const d = oauth.decodeState(oauth.encodeState({ companyId: COMPANY, userId: OWNER }));
        expect(d).toMatchObject({ companyId: COMPANY, userId: OWNER, nonce: expect.stringMatching(/^[a-f0-9]{32}$/) });
    });

    it('expires after ten minutes', () => {
        const now = Date.now();
        const state = oauth.encodeState({ companyId: COMPANY, userId: OWNER }, now);
        expect(oauth.decodeState(state, now + 9 * 60 * 1000)).not.toBeNull();
        expect(oauth.decodeState(state, now + 11 * 60 * 1000)).toBeNull();
    });

    it('refuses a tampered state, one signed with another secret, and a session token', () => {
        const state = oauth.encodeState({ companyId: COMPANY, userId: OWNER });
        const [head, , sig] = state.split('.');
        const forgedBody = Buffer.from(JSON.stringify({ ...jwt.decode(state), companyId: OTHER_COMPANY })).toString('base64url');
        expect(oauth.decodeState(`${head}.${forgedBody}.${sig}`)).toBeNull();
        expect(oauth.decodeState(jwt.sign({ companyId: COMPANY, userId: OWNER, nonce: 'n' }, 'other', { audience: 'alianhub:app-connections:github' }))).toBeNull();
        expect(oauth.decodeState(jwt.sign({ companyId: COMPANY, userId: OWNER, nonce: 'n' }, 'test-secret'))).toBeNull();
    });
});

describe('authorize', () => {
    it('gives an owner the GitHub URL with the callback on APIURL and the repo scope, and never the secret', async () => {
        const r = await call(github.authorize, OWNER);
        expect(r.body.status).toBe(true);
        const url = new URL(r.body.data.url);
        expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
        expect(url.searchParams.get('client_id')).toBe('Iv1.connectclient');
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/v1/github-connect/callback');
        expect(url.searchParams.get('scope')).toBe('repo');
        expect(JSON.stringify(r.body)).not.toContain('connect-client-secret-value');
    });

    it('refuses a member', async () => {
        const r = await call(github.authorize, MEMBER);
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
    });

    it('refuses when the server has no GitHub app, and the hub offers the paste form instead', async () => {
        for (const key of ['GITHUB_CONNECT_CLIENT_ID', 'GITHUB_CONNECT_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) delete process.env[key];
        expect((await call(github.authorize, OWNER)).code).toBe(409);
        const app = (await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github');
        expect(app.oneClick).toBe(false);
        expect(app.fields.map((f) => f.key)).toEqual(['token', 'repo']);
    });

    it('falls back to the sign-in GitHub app when no connect app is set', async () => {
        delete process.env.GITHUB_CONNECT_CLIENT_ID;
        delete process.env.GITHUB_CONNECT_CLIENT_SECRET;
        Object.assign(process.env, { GITHUB_CLIENT_ID: 'Iv1.signin', GITHUB_CLIENT_SECRET: 'signin-secret' });
        const r = await call(github.authorize, OWNER);
        expect(new URL(r.body.data.url).searchParams.get('client_id')).toBe('Iv1.signin');
        expect((await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github').oneClick).toBe(true);
    });
});

describe('the callback', () => {
    it('stores the token sealed, exchanges with the secret server-side, and sends the person back to App connections', async () => {
        const state = await stateFor();
        const r = await callback({ code: 'code-1', state });
        expect(r.location).toBe(`http://localhost:8080/${COMPANY}/app-connections?github=connected`);
        expect(axios.post).toHaveBeenCalledWith('https://github.com/login/oauth/access_token', expect.objectContaining({ client_secret: 'connect-client-secret-value', code: 'code-1' }), expect.anything());
        expect(rows()).toHaveLength(1);
        const row = rows()[0];
        expect(JSON.stringify(row)).not.toContain(TOKEN);
        expect(isEncrypted(row.config.token)).toBe(true);
        expect(row).toMatchObject({ type: 'github', status: 'connected', enabled: true, connectedBy: OWNER, config: { auth: 'oauth' } });
        expect(r.location).not.toContain(TOKEN);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'integrationConnections', companyId: COMPANY }));
        expect(mockAudit).toEqual([expect.objectContaining({ companyId: COMPANY, actorId: OWNER, action: 'app_connection.connected' })]);

        const hubRes = await call(hub.hub, OWNER);
        const conn = hubRes.body.data.apps.find((a) => a.key === 'github').connections[0];
        expect(conn).toMatchObject({ viaOAuth: true, target: '', secrets: { token: true } });
        expect(JSON.stringify(hubRes.body)).not.toContain(TOKEN);
    });

    it('replaces the token of an existing GitHub connection and keeps its repository', async () => {
        await callback({ code: 'code-1', state: await stateFor() });
        rows()[0].config.repo = 'acme/web';
        rows()[0].projectIds = ['bbbbbbbbbbbbbbbbbbbbbb01'];
        axios.post.mockResolvedValue({ data: { access_token: 'gho_second0000000000000000000000000000000' } });
        await callback({ code: 'code-2', state: await stateFor() });
        expect(rows()).toHaveLength(1);
        expect(rows()[0].config.repo).toBe('acme/web');
        expect(rows()[0].projectIds).toEqual(['bbbbbbbbbbbbbbbbbbbbbb01']);
        expect(JSON.stringify(rows()[0])).not.toContain('gho_second');
    });

    it('refuses a state used twice', async () => {
        const state = await stateFor();
        expect(outcomeOf(await callback({ code: 'code-1', state }))).toBe('connected');
        expect(outcomeOf(await callback({ code: 'code-1', state }))).toBe('expired');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('refuses a forged or missing state without writing or calling GitHub', async () => {
        const r = await callback({ code: 'c', state: jwt.sign({ companyId: COMPANY, userId: OWNER, nonce: 'x' }, 'guess', { audience: 'alianhub:app-connections:github' }) });
        expect(outcomeOf(r)).toBe('expired');
        expect(r.location.startsWith('http://localhost:4000/?')).toBe(true);
        expect(outcomeOf(await callback({ code: 'c' }))).toBe('expired');
        expect(axios.post).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
    });

    it('reads the rights again: an owner demoted before the callback writes nothing', async () => {
        const state = await stateFor();
        mockRoles[OWNER] = 3;
        expect(outcomeOf(await callback({ code: 'c', state }))).toBe('rights');
        expect(axios.post).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
    });

    it('reports a sign-in the person cancelled, and a failed exchange, without storing anything', async () => {
        expect(outcomeOf(await callback({ error: 'access_denied', state: await stateFor() }))).toBe('denied');
        axios.post.mockResolvedValue({ data: { error: 'bad_verification_code' } });
        expect(outcomeOf(await callback({ code: 'c', state: await stateFor() }))).toBe('failed');
        expect(rows()).toHaveLength(0);
    });

    it('reports the server switched off when the app was unset after the sign-in began', async () => {
        const state = await stateFor();
        delete process.env.GITHUB_CONNECT_CLIENT_ID;
        delete process.env.GITHUB_CLIENT_ID;
        expect(outcomeOf(await callback({ code: 'c', state }))).toBe('off');
        expect(rows()).toHaveLength(0);
    });
});

describe('the repository picker', () => {
    const connected = async () => { await callback({ code: 'c', state: await stateFor() }); return String(rows()[0]._id); };

    it('lists the repositories the token can see, a page at a time', async () => {
        const id = await connected();
        mockFetch.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify([{ full_name: 'acme/web', private: true }, { full_name: 'acme/api', private: false }]) });
        const r = await call(github.repos, OWNER, { params: { id }, query: { page: '2' } });
        expect(r.body).toMatchObject({ status: true, data: { repos: [{ fullName: 'acme/web', private: true }, { fullName: 'acme/api', private: false }], page: 2, hasMore: false } });
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('https://api.github.com/user/repos?');
        expect(url).toContain('page=2');
        expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    });

    it('caps the page it asks for', async () => {
        const id = await connected();
        mockFetch.mockResolvedValue({ status: 200, headers: {}, body: '[]' });
        await call(github.repos, OWNER, { params: { id }, query: { page: '9999' } });
        expect(mockFetch.mock.calls[0][0]).toContain('page=10');
    });

    it('saves a repository the token can read, resets the sync, and audits it', async () => {
        const id = await connected();
        rows()[0].sync = { cursor: 'old' };
        mockFetch.mockResolvedValue({ status: 200, headers: {}, body: JSON.stringify({ full_name: 'acme/web' }) });
        const r = await call(github.setRepo, OWNER, { params: { id }, body: { repo: 'acme/web' } });
        expect(r.body).toMatchObject({ status: true, data: { id, repo: 'acme/web' } });
        expect(rows()[0].config.repo).toBe('acme/web');
        expect(isEncrypted(rows()[0].config.token)).toBe(true);
        expect(rows()[0].sync).toEqual({});
        expect(mockAudit.map((a) => a.action)).toContain('app_connection.repo');
    });

    it('refuses a repository the token cannot read, a malformed one, and a member', async () => {
        const id = await connected();
        mockFetch.mockResolvedValue({ status: 404, headers: {}, body: '{}' });
        expect((await call(github.setRepo, OWNER, { params: { id }, body: { repo: 'acme/secret' } })).code).toBe(400);
        expect((await call(github.setRepo, OWNER, { params: { id }, body: { repo: '../etc' } })).code).toBe(400);
        expect((await call(github.setRepo, MEMBER, { params: { id }, body: { repo: 'acme/web' } })).code).toBe(403);
        expect((await call(github.repos, MEMBER, { params: { id } })).code).toBe(403);
        expect(rows()[0].config.repo).toBeUndefined();
    });
});
