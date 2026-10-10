/* Task 049: one GitHub sign-in per workspace, and each project picks its own repositories. */
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const mockAudit = [];
const mockRoles = {};
const mockVisible = {};
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
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: async (companyId, uid) => mockVisible[uid] || [],
    visibleProjects: async (companyId, uid) => (mockVisible[uid] || []).map((id) => ({ _id: id, ProjectName: `Project ${id.slice(-2)}` })),
}));
jest.mock('../Modules/Integrations/helpers/secretHandles', () => ({
    openSecrets: async ({ row }) => ({ ...row.config }),
    storeSecrets: async ({ config }) => ({ set: { config }, stale: [] }),
    retireSecrets: async () => {},
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Automations/engine/tools', () => ({
    ...jest.requireActual('../Modules/Automations/engine/tools'),
    addComment: jest.fn(async () => ({ changed: true })),
}));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ ...jest.requireActual('../Modules/Agents/engine/safeFetch'), safeFetch: (...a) => mockFetch(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const tools = require('../Modules/Automations/engine/tools');
const github = require('../Modules/Integrations/appConnections/githubConnect');
const hub = require('../Modules/Integrations/appConnections/controller');
const runner = require('../Modules/Integrations/appConnections/runner');
const backoff = require('../Modules/Integrations/appConnections/backoff');
const repoMap = require('../Modules/Integrations/appConnections/github/repoMap');
const { appConnectionEventsSchema } = require('../utils/mongo-handler/createSchema');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '200000000000000000000001';
const CONNECTOR = '200000000000000000000002';
const MEMBER = '200000000000000000000003';
const P1 = 'bbbbbbbbbbbbbbbbbbbbbb01';
const P2 = 'bbbbbbbbbbbbbbbbbbbbbb02';
const HIDDEN = 'bbbbbbbbbbbbbbbbbbbbbb03';
const PERSONAL = 'bbbbbbbbbbbbbbbbbbbbbb04';
const ELSEWHERE = 'bbbbbbbbbbbbbbbbbbbbbb09';
const TOKEN = 'gho_abcdefghijklmnopqrstuvwxyz0123456789';
const NOW = Date.parse('2026-10-10T12:00:00Z');
const CONN = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;
const ENV = { ...process.env };

const STATUSES = [{ key: 1, name: 'To Do', type: 'default_active' }, { key: 4, name: 'In Review', type: 'active' }];

const res = () => {
    const r = { code: 200, body: null, location: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.set = (h) => { Object.assign(r.headers, h); return r; };
    r.redirect = (code, url) => { r.location = url === undefined ? code : url; return r; };
    return r;
};
const call = async (handler, uid, { body = {}, params = {}, query = {}, headers = {} } = {}) => {
    const r = res();
    await handler(verified({ headers: { companyid: COMPANY, ...headers }, uid, sessionId: 'session-1', body, params, query }), r);
    return r;
};

let connection;
const rowOf = () => mockDb.store[CONN].find((c) => c._id === connection._id);
const id = () => String(connection._id);
const add = (uid, repo, projectId) => call(github.addRepo, uid, { params: { id: id() }, body: { repo, projectId } });
const remove = (uid, repo, projectId) => call(github.removeRepo, uid, { params: { id: id(), projectId }, query: { repo } });

const readable = (repos) => mockFetch.mockImplementation(async (url) => {
    const name = url.replace('https://api.github.com/repos/', '').toLowerCase();
    return repos.includes(name) ? { status: 200, headers: {}, body: '{}' } : { status: 404, headers: {}, body: '{}' };
});

beforeAll(() => mockDb.uniqueFromSchema(SCHEMA_TYPE.APP_CONNECTION_EVENTS, appConnectionEventsSchema));

beforeEach(() => {
    Object.assign(process.env, {
        JWT_SECRET: 'test-secret', APP_CONNECTIONS: 'true', APIURL: 'http://localhost:4000/', WEBURL: 'http://localhost:8080',
        GITHUB_CONNECT_CLIENT_ID: 'Iv1.connectclient', GITHUB_CONNECT_CLIENT_SECRET: 'connect-client-secret-value',
    });
    delete process.env.CORS_ORIGINS;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k] = []; });
    Object.assign(mockRoles, { [OWNER]: 1, [CONNECTOR]: 2, [MEMBER]: 3 });
    Object.assign(mockVisible, { [OWNER]: [P1, P2, HIDDEN], [CONNECTOR]: [P1, P2], [MEMBER]: [P1] });
    mockAudit.length = 0;
    tools.addComment.mockClear();
    socketEmitter.emit.mockClear();
    mockFetch.mockReset();
    readable(['acme/web', 'acme/api']);
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'Web', taskStatusData: STATUSES, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Api', taskStatusData: STATUSES, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: HIDDEN, ProjectName: 'Board', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PERSONAL, ProjectName: 'Mine', isPersonal: true, deletedStatusKey: 0 });
    connection = mockDb.seed(CONN, {
        type: 'github', name: 'GitHub', config: { token: TOKEN, auth: 'oauth', accountLogin: 'octo' }, status: 'connected', enabled: true, deletedStatusKey: 0,
        connectedBy: CONNECTOR, connectedAt: new Date('2026-10-01T00:00:00Z'),
    });
});
afterAll(() => { process.env = ENV; });

describe('mapping repositories to projects', () => {
    it('adds a repository to a project, then another project to the same repository, whatever its case', async () => {
        const first = await add(OWNER, 'acme/web', P1);
        expect(first.body).toMatchObject({ status: true, data: { repo: 'acme/web', projectId: P1 } });
        await add(OWNER, 'Acme/Web', P2);
        expect(rowOf().repos).toEqual([{ repo: 'acme/web', projectIds: [P1, P2], sync: { cursor: expect.any(String) } }]);
        expect(mockAudit.filter((a) => a.action === 'app_connection.repo_added')).toHaveLength(2);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'integrationConnections', companyId: COMPANY }));
        expect(require('../utils/commonFunctions').removeCache).toHaveBeenCalledWith(`integration_connections:${COMPANY}`);
    });

    it('lets a project take several repositories, and removes one pair at a time', async () => {
        await add(OWNER, 'acme/web', P1);
        await add(OWNER, 'acme/api', P1);
        await add(OWNER, 'acme/api', P2);
        expect(repoMap.reposOfProject(rowOf(), P1).map((e) => e.repo)).toEqual(['acme/web', 'acme/api']);
        expect((await remove(OWNER, 'acme/api', P1)).body.status).toBe(true);
        expect(repoMap.reposOf(rowOf()).map((e) => [e.repo, e.projectIds])).toEqual([['acme/web', [P1]], ['acme/api', [P2]]]);
        await remove(OWNER, 'acme/web', P1);
        expect(rowOf().repos.map((e) => e.repo)).toEqual(['acme/api']);
        expect((await remove(OWNER, 'acme/web', P1)).code).toBe(404);
        expect(mockAudit.filter((a) => a.action === 'app_connection.repo_removed')).toHaveLength(2);
    });

    it('lets only an owner or admin change it', async () => {
        expect((await add(MEMBER, 'acme/web', P1)).code).toBe(403);
        await add(OWNER, 'acme/web', P1);
        expect((await remove(MEMBER, 'acme/web', P1)).code).toBe(403);
        expect(rowOf().repos).toHaveLength(1);
    });

    it('refuses a project of another workspace, a personal one, one the connector cannot open, and an unreadable repository, writing nothing', async () => {
        expect((await add(OWNER, 'acme/web', ELSEWHERE)).body.statusText).toMatch(/does not exist in this workspace/);
        expect((await add(OWNER, 'acme/web', PERSONAL)).code).toBe(400);
        const unreachable = await add(OWNER, 'acme/web', HIDDEN);
        expect(unreachable.code).toBe(400);
        expect(unreachable.body.statusText).toMatch(/cannot open that project/);
        const unreadable = await add(OWNER, 'acme/secret', P1);
        expect(unreadable.code).toBe(400);
        expect(unreadable.body.statusText).toMatch(/cannot read that repository/);
        expect((await add(OWNER, '../etc', P1)).code).toBe(400);
        expect((await add(OWNER, 'acme/web', 'nope')).code).toBe(400);
        expect(rowOf().repos).toBeUndefined();
        expect(mockAudit).toHaveLength(0);
    });

    it('upgrades a row still holding one repository, keeping its cursor', async () => {
        Object.assign(rowOf(), { projectIds: [P1], sync: { cursor: '2026-10-05T00:00:00Z', failures: 0 } });
        rowOf().config.repo = 'acme/web';
        await add(OWNER, 'acme/api', P2);
        expect(rowOf().repos).toEqual([
            { repo: 'acme/web', projectIds: [P1], sync: { cursor: '2026-10-05T00:00:00Z' } },
            { repo: 'acme/api', projectIds: [P2], sync: { cursor: expect.any(String) } },
        ]);
        expect(rowOf().config.repo).toBeUndefined();
        expect(rowOf().projectIds).toBeUndefined();
        expect(rowOf().config.token).toBe(TOKEN);
    });

    it('no longer takes the whole-connection project list once each repository has its own', async () => {
        await add(OWNER, 'acme/web', P1);
        const r = await call(hub.setProjects, OWNER, { params: { id: id() }, body: { projectIds: [P2] } });
        expect(r.code).toBe(400);
        expect(rowOf().repos[0].projectIds).toEqual([P1]);
    });
});

describe('what each screen is told', () => {
    beforeEach(() => { rowOf().repos = [{ repo: 'acme/web', projectIds: [P1, HIDDEN], sync: { lastError: 'GitHub refused access to the repository (403).' } }, { repo: 'acme/api', projectIds: [P2], sync: {} }]; });

    it('the App connections card lists each project and repository pair, a project the viewer cannot open by id to an admin alone', async () => {
        const owner = (await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github').connections[0];
        expect(owner.repos.map((r) => [r.repo, r.projectId, r.projectName])).toEqual([['acme/web', P1, 'Project 01'], ['acme/web', HIDDEN, 'Project 03'], ['acme/api', P2, 'Project 02']]);
        expect(owner.repos[0].lastError).toMatch(/403/);
        mockVisible[OWNER] = [P1, P2];
        const blind = (await call(hub.hub, OWNER)).body.data.apps.find((a) => a.key === 'github').connections[0];
        expect(blind.repos.find((r) => r.projectId === HIDDEN)).toMatchObject({ hidden: true, projectName: '' });
        const member = (await call(hub.hub, MEMBER)).body.data.apps.find((a) => a.key === 'github').connections[0];
        expect(member.repos.map((r) => r.projectId)).toEqual([P1]);
        expect(JSON.stringify(member)).not.toContain(TOKEN);
    });

    it('a project shows its repositories to anyone who can open it, and the changes to an owner or admin', async () => {
        const member = await call(github.projectView, MEMBER, { params: { projectId: P1 } });
        expect(member.body.data).toMatchObject({ enabled: true, canManage: false, connection: { id: id(), account: 'octo', reachable: true }, repos: [{ repo: 'acme/web', lastError: expect.stringMatching(/403/) }] });
        expect(JSON.stringify(member.body)).not.toContain(TOKEN);
        expect((await call(github.projectView, MEMBER, { params: { projectId: P2 } })).code).toBe(404);
        const owner = await call(github.projectView, OWNER, { params: { projectId: HIDDEN } });
        expect(owner.body.data).toMatchObject({ canManage: true, oneClick: true, connection: { reachable: false } });
    });

    it('a project in a workspace not yet signed in to GitHub says so', async () => {
        mockDb.store[CONN] = [];
        const r = await call(github.projectView, OWNER, { params: { projectId: P1 } });
        expect(r.body.data).toMatchObject({ enabled: true, canManage: true, connection: null, repos: [] });
    });

    it('says nothing while App connections are off', async () => {
        delete process.env.APP_CONNECTIONS;
        expect((await call(github.projectView, OWNER, { params: { projectId: P1 } })).body.data).toEqual({ enabled: false });
    });
});

describe('signing in from a project', () => {
    const stateFrom = (r) => new URL(r.body.data.url).searchParams.get('state');

    it('comes back to that project\'s details, on an allow-listed origin only', async () => {
        const r = await call(github.authorize, OWNER, { query: { projectId: P1 }, headers: { origin: 'http://localhost:8080' } });
        const back = res();
        github.callback({ query: { state: stateFrom(r), code: 'code-1' }, headers: {} }, back);
        const [origin, fragment] = back.location.split('/#');
        expect(origin).toBe('http://localhost:8080');
        const [path, qs] = fragment.split('?');
        expect(path).toBe(`/${COMPANY}/project/${P1}/p`);
        expect(Object.fromEntries(new URLSearchParams(qs))).toMatchObject({ tab: 'ProjectDetail', section: 'github', github: 'complete', code: 'code-1' });

        const evil = await call(github.authorize, OWNER, { query: { projectId: P1 }, headers: { origin: 'https://evil.example' } });
        const away = res();
        github.callback({ query: { state: stateFrom(evil), error: 'access_denied' }, headers: {} }, away);
        expect(away.location.startsWith('http://localhost:8080/#/')).toBe(true);
        expect(away.location).toContain('github=denied');
    });

    it('refuses a project that is not a live project of the workspace, and a member', async () => {
        expect((await call(github.authorize, OWNER, { query: { projectId: ELSEWHERE } })).code).toBe(400);
        expect((await call(github.authorize, OWNER, { query: { projectId: 'x' } })).code).toBe(400);
        expect((await call(github.authorize, MEMBER, { query: { projectId: P1 } })).code).toBe(403);
    });

    it('without a project still comes back to App connections', async () => {
        const r = await call(github.authorize, OWNER, { headers: { origin: 'http://localhost:8080' } });
        const back = res();
        github.callback({ query: { state: stateFrom(r), code: 'code-1' }, headers: {} }, back);
        expect(back.location).toContain(`/#/${COMPANY}/app-connections?github=complete`);
    });
});

describe('syncing each repository on its own', () => {
    const pull = (repo, over = {}) => ({
        number: 12, title: 'API-3 fix', body: '', state: 'open', merged_at: null, html_url: `https://github.com/${repo}/pull/12`, user: { login: 'dev' }, head: { ref: 'fix' }, updated_at: '2026-10-10T11:00:00Z', ...over,
    });
    const answers = (byRepo) => jest.fn(async (url) => {
        const repo = Object.keys(byRepo).find((name) => url.includes(`/repos/${name}/pulls`));
        const answer = byRepo[repo];
        if (!answer) return { status: 200, body: '[]', headers: {} };
        return typeof answer === 'function' ? answer() : { status: 200, body: JSON.stringify(answer), headers: {} };
    });
    const run = (get, now = NOW) => runner.syncConnection({ companyId: COMPANY, connection: rowOf(), now, get });
    let webTask;
    let apiTask;

    beforeEach(() => {
        webTask = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'WEB-1', TaskName: 'Board', ProjectID: P1, statusKey: 1, statusType: 'default_active', links: [], deletedStatusKey: 0 });
        apiTask = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskKey: 'API-3', TaskName: 'Login', ProjectID: P2, statusKey: 1, statusType: 'default_active', links: [], deletedStatusKey: 0 });
        rowOf().repos = [
            { repo: 'acme/web', projectIds: [P1], sync: { cursor: '2026-10-09T00:00:00Z' } },
            { repo: 'acme/api', projectIds: [P2], sync: { cursor: '2026-10-09T00:00:00Z' } },
        ];
    });

    it('a pull request of repository A never touches a project mapped only to B', async () => {
        await run(answers({ 'acme/web': [pull('acme/web', { title: 'API-3 and WEB-1' })] }));
        expect(webTask.links).toHaveLength(1);
        expect(apiTask.links).toHaveLength(0);
        await run(answers({ 'acme/api': [pull('acme/api')] }), NOW + 6 * 60 * 1000);
        expect(apiTask.links).toEqual([expect.objectContaining({ url: 'https://github.com/acme/api/pull/12' })]);
        expect(rowOf().repos.map((e) => e.sync.cursor)).toEqual(['2026-10-10T11:00:00Z', '2026-10-10T11:00:00Z']);
    });

    it('one repository failing backs off alone, while the other keeps syncing', async () => {
        const get = answers({ 'acme/web': () => ({ status: 401, body: '{}', headers: {} }), 'acme/api': [pull('acme/api')] });
        const out = await run(get);
        expect(out.repos['acme/web']).toMatchObject({ failures: 1 });
        const [web, api] = rowOf().repos;
        expect(web.sync).toMatchObject({ failures: 1, lastError: expect.stringMatching(/refused the token/) });
        expect(new Date(web.sync.nextAttemptAt).getTime()).toBe(NOW + backoff.POLL_MS);
        expect(api.sync).toMatchObject({ failures: 0, lastError: '' });
        expect(apiTask.links).toHaveLength(1);
        expect(rowOf().sync).toMatchObject({ failures: 0, nextAttemptAt: null, lastError: expect.stringMatching(/^acme\/web: GitHub refused the token/) });

        get.mockClear();
        await run(get, NOW + 60 * 1000);
        expect(get.mock.calls.map(([url]) => url).every((url) => url.includes('/repos/acme/api/'))).toBe(true);
        expect(JSON.stringify([rowOf().repos, rowOf().sync, mockAudit])).not.toContain(TOKEN);
    });

    it('backs the whole connection off only while every repository is failing', async () => {
        await run(answers({ 'acme/web': () => ({ status: 500, body: '', headers: {} }), 'acme/api': () => ({ status: 500, body: '', headers: {} }) }));
        expect(rowOf().sync).toMatchObject({ failures: 1 });
        expect(new Date(rowOf().sync.nextAttemptAt).getTime()).toBe(NOW + backoff.POLL_MS);
    });

    it('is waiting, not failing, with no repository mapped', async () => {
        rowOf().repos = [];
        const get = jest.fn();
        await run(get);
        expect(get).not.toHaveBeenCalled();
        expect(rowOf().sync).toMatchObject({ failures: 0, nextAttemptAt: null, lastError: 'No repository is picked yet.' });
    });

    it('leaves out a project the person who connected can no longer open', async () => {
        mockVisible[CONNECTOR] = [P1];
        const get = answers({ 'acme/api': [pull('acme/api')] });
        await run(get);
        expect(get.mock.calls.some(([url]) => url.includes('/repos/acme/api/'))).toBe(false);
        expect(apiTask.links).toHaveLength(0);
    });

});
