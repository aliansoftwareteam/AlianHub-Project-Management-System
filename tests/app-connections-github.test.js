const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

const mockAudit = [];
const mockVisible = { ids: [] };
const mockRoles = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({
    recordAudit: (companyId, entry) => mockAudit.push({ companyId, ...entry }),
    recordAuditFromReq: (req, entry) => mockAudit.push({ actorId: req.uid, ...entry }),
}));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: async () => mockVisible.ids,
    visibleProjects: async () => mockVisible.ids.map((id) => ({ _id: id, ProjectName: id === 'bbbbbbbbbbbbbbbbbbbbbb01' ? 'Web' : 'Other' })),
}));
jest.mock('../Modules/Integrations/helpers/secretHandles', () => ({ openSecrets: async ({ row }) => ({ ...row.config }) }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/Automations/engine/tools', () => ({
    ...jest.requireActual('../Modules/Automations/engine/tools'),
    addComment: jest.fn(async () => ({ changed: true })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const tools = require('../Modules/Automations/engine/tools');
const keys = require('../Modules/Integrations/appConnections/github/keys');
const api = require('../Modules/Integrations/appConnections/github/api');
const backoff = require('../Modules/Integrations/appConnections/backoff');
const runner = require('../Modules/Integrations/appConnections/runner');
const scheduler = require('../Modules/Integrations/appConnections/scheduler');
const hub = require('../Modules/Integrations/appConnections/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PERSON = '200000000000000000000001';
const MEMBER = '200000000000000000000003';
const PROJECT = 'bbbbbbbbbbbbbbbbbbbbbb01';
const OTHER_PROJECT = 'bbbbbbbbbbbbbbbbbbbbbb02';
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const NOW = Date.parse('2026-10-09T12:00:00Z');
const CONN = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;

const STATUSES = [
    { key: 1, name: 'To Do', type: 'default_active' },
    { key: 4, name: 'In Review', type: 'active' },
    { key: 6, name: 'Done', type: 'close' },
];

const pull = (over = {}) => ({
    number: 12, title: 'AP-479 fix the login', body: '', state: 'open', merged_at: null, merge_commit_sha: null,
    html_url: 'https://github.com/acme/web/pull/12', user: { login: 'dev' }, head: { ref: 'fix/login' }, updated_at: '2026-10-09T11:00:00Z', ...over,
});

const github = (pages) => jest.fn(async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    const rows = pages[page - 1] || [];
    return { status: 200, body: JSON.stringify(rows), headers: {} };
});

let connection;
let task;
const T = SCHEMA_TYPE.TASKS;
const run = (get, now = NOW) => runner.syncConnection({ companyId: COMPANY, connection: mockDb.store[CONN].find((c) => c._id === connection._id), now, get });
const rowOf = () => mockDb.store[CONN].find((c) => c._id === connection._id);
const taskRow = () => mockDb.store[T].find((t) => t._id === task._id);

beforeEach(() => {
    mockAudit.length = 0;
    tools.addComment.mockClear();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k] = []; });
    mockVisible.ids = [PROJECT];
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Web', taskStatusData: STATUSES, deletedStatusKey: 0 });
    task = mockDb.seed(T, { TaskKey: 'AP-479', TaskName: 'Login', ProjectID: PROJECT, CompanyId: COMPANY, statusKey: 1, statusType: 'default_active', status: STATUSES[0], links: [], deletedStatusKey: 0 });
    connection = mockDb.seed(CONN, {
        type: 'github', name: 'GitHub', config: { token: TOKEN, repo: 'acme/web' }, status: 'connected', enabled: true, deletedStatusKey: 0,
        connectedBy: PERSON, connectedAt: new Date('2026-10-01T00:00:00Z'), projectIds: [PROJECT],
    });
});

describe('finding task keys in a pull request', () => {
    it('reads the title, branch and body, in any case, once each', () => {
        expect(keys.keysOfPull(pull({ title: 'ap-479: login', head: { ref: 'feature/AP-479-login' }, body: 'Also closes WEB-12 and WEB-12.' }))).toEqual(['AP-479', 'WEB-12']);
    });
    it('ignores words that only look like a key', () => {
        expect(keys.keysIn('1AP-479 and AP-4790123456789 and plain-text')).toEqual([]);
    });
    it('gives an opened event, and a merged one as well when the pull request is merged', () => {
        const merged = keys.eventsOfPull('acme/web', pull({ state: 'closed', merged_at: '2026-10-09T11:30:00Z', merge_commit_sha: 'abc1234def' }));
        expect(merged.map((e) => e.key)).toEqual(['github:acme/web#12:opened', 'github:acme/web#12:merged']);
        expect(keys.eventsOfPull('acme/web', pull({ state: 'closed' }))).toEqual([]);
    });
});

describe('listing pull requests updated since the cursor', () => {
    it('stops at the cursor and answers oldest first', async () => {
        const get = github([[pull({ number: 3, updated_at: '2026-10-09T11:00:00Z' }), pull({ number: 2, updated_at: '2026-10-09T10:00:00Z' }), pull({ number: 1, updated_at: '2026-10-01T10:00:00Z' })]]);
        const { pulls, truncated } = await api.listPulls({ repo: 'acme/web', token: TOKEN, since: '2026-10-09T09:00:00Z', get });
        expect(pulls.map((p) => p.number)).toEqual([2, 3]);
        expect(truncated).toBe(false);
        expect(get.mock.calls[0][0]).toContain('/repos/acme/web/pulls?state=all&sort=updated&direction=desc');
        expect(get.mock.calls[0][1].token).toBe(TOKEN);
    });
    it('reports a list cut by the page limit, so the cursor is not moved past what was not seen', async () => {
        const full = (n) => Array.from({ length: api.PAGE_SIZE }, (_, i) => pull({ number: n * 100 + i, updated_at: '2026-10-09T11:00:00Z' }));
        const get = jest.fn(async () => ({ status: 200, body: JSON.stringify(full(1)), headers: {} }));
        const { truncated } = await api.listPulls({ repo: 'acme/web', token: TOKEN, since: '2026-10-01T00:00:00Z', get });
        expect(truncated).toBe(true);
        expect(get).toHaveBeenCalledTimes(api.MAX_PAGES);
    });
});

describe('a pull request is opened', () => {
    it('adds the link and one comment, and does nothing the second time', async () => {
        const get = github([[pull()]]);
        const first = await run(get);
        expect(first).toMatchObject({ events: 1, acted: 1, failed: 0 });
        expect(taskRow().links).toHaveLength(1);
        expect(taskRow().links[0]).toMatchObject({ url: 'https://github.com/acme/web/pull/12', kind: 'pr' });
        expect(tools.addComment).toHaveBeenCalledTimes(1);
        expect(tools.addComment.mock.calls[0][3]).toMatchObject({ actingUserId: PERSON });

        await run(get, NOW + 6 * 60 * 1000);
        expect(taskRow().links).toHaveLength(1);
        expect(tools.addComment).toHaveBeenCalledTimes(1);
        expect(mockAudit.filter((a) => a.action === 'app_connection.task_linked')).toHaveLength(1);
    });

    it('escapes what the pull request title says before it becomes a comment', async () => {
        await run(github([[pull({ title: 'AP-479 <img src=x onerror=alert(1)>' })]]));
        expect(tools.addComment.mock.calls[0][2]).not.toContain('<img');
    });

    it('leaves a task in a project that is not linked to the repo alone', async () => {
        const stray = mockDb.seed(T, { TaskKey: 'ZZ-1', TaskName: 'Other', ProjectID: OTHER_PROJECT, CompanyId: COMPANY, statusKey: 1, statusType: 'default_active', links: [], deletedStatusKey: 0 });
        mockVisible.ids = [PROJECT, OTHER_PROJECT];
        await run(github([[pull({ title: 'ZZ-1 something' })]]));
        expect(stray.links).toHaveLength(0);
        expect(tools.addComment).not.toHaveBeenCalled();
    });

    it('leaves a linked project alone when the person who connected cannot open it', async () => {
        mockVisible.ids = [];
        const out = await run(github([[pull()]]));
        expect(out.events).toBe(0);
        expect(taskRow().links).toHaveLength(0);
        expect(rowOf().sync.lastError).toMatch(/can no longer open/);
    });
});

describe('a pull request is merged', () => {
    const merged = pull({ state: 'closed', merged_at: '2026-10-09T11:30:00Z', merge_commit_sha: 'abc1234def5678' });

    it('comments with the merge commit and moves the task to In review, once', async () => {
        const get = github([[merged]]);
        await run(get);
        const texts = tools.addComment.mock.calls.map((c) => c[2]);
        expect(texts.some((t) => t.includes('abc1234') && t.includes('merged'))).toBe(true);
        expect(taskRow().status).toMatchObject({ text: 'In Review', key: 4 });
        expect(taskRow().statusKey).toBe(4);

        const before = tools.addComment.mock.calls.length;
        await run(get, NOW + 6 * 60 * 1000);
        expect(tools.addComment.mock.calls.length).toBe(before);
    });

    it('never moves a task to Done, and leaves a finished task where it is', async () => {
        taskRow().statusKey = 6;
        taskRow().statusType = 'close';
        await run(github([[merged]]));
        expect(taskRow().statusKey).toBe(6);
        expect(mockAudit.find((a) => a.action === 'app_connection.task_moved').meta).toMatchObject({ moved: false, reason: 'finished' });
    });

    it('does not touch the status of a project that has no In Review', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS][0].taskStatusData = [STATUSES[0], STATUSES[2]];
        await run(github([[merged]]));
        expect(taskRow().statusKey).toBe(1);
    });
});

describe('an app that fails', () => {
    it('keeps the error without the token, then backs off and doubles', async () => {
        const refusing = jest.fn(async () => ({ status: 401, body: '{}', headers: {} }));
        const out = await run(refusing);
        expect(out.failures).toBe(1);
        expect(rowOf().sync.lastError).toMatch(/refused the token/);
        expect(JSON.stringify(rowOf().sync)).not.toContain(TOKEN);
        expect(JSON.stringify(mockAudit)).not.toContain(TOKEN);
        expect(new Date(rowOf().sync.nextAttemptAt).getTime()).toBe(NOW + backoff.POLL_MS);

        expect(await run(refusing, NOW + 60 * 1000)).toMatchObject({ skipped: true, backoff: true });
        expect(refusing).toHaveBeenCalledTimes(1);

        await run(refusing, NOW + backoff.POLL_MS + 1000);
        expect(rowOf().sync.failures).toBe(2);
        expect(new Date(rowOf().sync.nextAttemptAt).getTime()).toBe(NOW + backoff.POLL_MS + 1000 + 2 * backoff.POLL_MS);
    });

    it('starts again from zero after one good poll', async () => {
        await run(jest.fn(async () => ({ status: 500, body: '', headers: {} })));
        await run(github([[]]), NOW + backoff.POLL_MS + 1000);
        expect(rowOf().sync).toMatchObject({ failures: 0, lastError: '', nextAttemptAt: null });
    });

    it('is not polled twice at once', async () => {
        rowOf().sync = { lockUntil: new Date(NOW + 60 * 1000) };
        const get = github([[pull()]]);
        expect(await run(get)).toMatchObject({ skipped: true, leased: true });
        expect(get).not.toHaveBeenCalled();
    });

    it('caps the delay', () => {
        expect(backoff.delayAfter(30)).toBe(backoff.MAX_DELAY_MS);
    });
});

describe('the scheduler', () => {
    const OLD = process.env.APP_CONNECTIONS;
    afterEach(() => { process.env.APP_CONNECTIONS = OLD; });

    it('does nothing while APP_CONNECTIONS is off', async () => {
        delete process.env.APP_CONNECTIONS;
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY });
        const spy = jest.spyOn(runner, 'syncCompany');
        await scheduler.runForAllCompanies();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('the App connections page', () => {
    const OLD = process.env.APP_CONNECTIONS;
    afterEach(() => { process.env.APP_CONNECTIONS = OLD; });
    Object.assign(mockRoles, { [PERSON]: 1, [MEMBER]: 3 });

    const res = () => {
        const r = { code: 200, body: null };
        r.status = (c) => { r.code = c; return r; };
        r.send = (b) => { r.body = b; return r; };
        return r;
    };
    const call = async (handler, uid, { body = {}, params = {} } = {}) => {
        const r = res();
        await handler(verified({ headers: { companyid: COMPANY }, uid, body, params, query: {} }), r);
        return r;
    };

    it('says it is off by default', async () => {
        delete process.env.APP_CONNECTIONS;
        const r = await call(hub.hub, MEMBER);
        expect(r.body.data).toEqual({ enabled: false, apps: [], projects: [] });
    });

    it('lists every app with its status, last sync, last error and projects, and never a secret', async () => {
        process.env.APP_CONNECTIONS = 'true';
        rowOf().sync = { lastSyncAt: new Date(NOW), lastError: 'GitHub rate limit reached; trying again later.', failures: 1, handled: ['a'], cursor: 'x', lockUntil: null };
        const r = await call(hub.hub, MEMBER);
        const gh = r.body.data.apps.find((a) => a.key === 'github');
        expect(r.body.data.apps.map((a) => a.key)).toEqual(expect.arrayContaining(['slack', 'github', 'gitlab', 'zapier']));
        expect(gh.syncs).toBe(true);
        expect(gh.connections[0]).toMatchObject({ target: 'acme/web', lastError: expect.stringMatching(/rate limit/), failures: 1, secrets: { token: true }, projects: [{ id: PROJECT, name: 'Web' }] });
        const text = JSON.stringify(r.body);
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain('handled');
        expect(text).not.toContain('lockUntil');
        expect(r.body.data.apps.find((a) => a.key === 'slack').syncs).toBe(false);
    });

    it('lets only an owner or admin link projects, and only real ones', async () => {
        process.env.APP_CONNECTIONS = 'true';
        const params = { id: String(connection._id) };
        expect((await call(hub.setProjects, MEMBER, { params, body: { projectIds: [PROJECT] } })).code).toBe(403);
        expect((await call(hub.setProjects, PERSON, { params, body: { projectIds: [OTHER_PROJECT] } })).code).toBe(400);
        expect((await call(hub.setProjects, PERSON, { params, body: { projectIds: 'x' } })).code).toBe(400);
        const ok = await call(hub.setProjects, PERSON, { params, body: { projectIds: [PROJECT] } });
        expect(ok.body.data.projectIds).toEqual([PROJECT]);
        expect(mockAudit.find((a) => a.action === 'app_connection.projects')).toBeTruthy();
    });
});
