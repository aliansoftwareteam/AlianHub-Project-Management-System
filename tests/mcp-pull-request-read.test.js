require('./fixtures/mcpFlagsOff');
/* AP-494: a connected agent reads the GitHub pull request linked to a task, through the workspace's GitHub connection,
   only for the repository linked to a project the person can open. GitHub is answered by a stub; its key never leaves the server. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockElsewhere = require('./fixtures/fakeMongo').create();
const mockOtherCompany = '6f00000000000000000000c2';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (String(companyId) === mockOtherCompany ? mockElsewhere : mockDb).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({ safeFetch: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');
const permissions = require('../Modules/Agents/permissions');
const logger = require('../Config/loggerConfig');

const { OWNER, INSIDER, OUTSIDER, P_OPEN, P_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, FLAGS, ctx, narrowed, settle } = world;
const { seed, stored, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'pull_request.get';
const SHA = 'abc1234def0000000000000000000000000000ff';
const TOKEN = 'ghp_TheWorkspaceKeyThatNeverLeaves0123456789';
const REPO = 'acme/web';
const CONNECTION = '6f0000000000000000000e01';

const PULL = {
    number: 42, title: 'WEB-7 Speed up the board', state: 'closed', merged: true, merged_at: '2026-10-08T10:00:00Z', draft: false,
    html_url: `https://github.com/${REPO}/pull/42`, user: { login: 'dev-ana' }, head: { ref: 'feat/web-7-board', sha: SHA }, base: { ref: 'beta' },
    created_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-08T10:00:00Z', closed_at: '2026-10-08T10:00:00Z',
    changed_files: 120, additions: 300, deletions: 40, body: `Closes WEB-7.\n${'x'.repeat(5000)}`,
};
const FILES = Array.from({ length: 50 }, (_, at) => ({ filename: `src/file${at}.js`, status: 'modified', additions: 2, deletions: 1, patch: `@@ secret diff ${at}` }));
const RUNS = { total_count: 2, check_runs: [{ name: 'unit', status: 'completed', conclusion: 'success' }, { name: 'e2e', status: 'completed', conclusion: 'failure' }] };
const STATUS = { state: 'success', statuses: [{ context: 'ci/legacy', state: 'success' }] };

const reply = (status, body, headers = {}) => ({ status, body: JSON.stringify(body), headers });
const github = (over = {}) => safeFetch.mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (over[path]) return over[path](url);
    if (path === `/repos/${REPO}/pulls/42`) return reply(200, PULL);
    if (path === `/repos/${REPO}/pulls/42/files`) return reply(200, FILES);
    if (path === `/repos/${REPO}/commits/${SHA}/check-runs`) return reply(200, RUNS);
    if (path === `/repos/${REPO}/commits/${SHA}/status`) return reply(200, STATUS);
    return reply(404, { message: 'Not Found' });
});

const connect = (db = mockDb, over = {}) => db.seed(SCHEMA_TYPE.INTEGRATION_CONNECTIONS, {
    _id: CONNECTION, type: 'github', name: 'GitHub', config: { token: TOKEN, repo: REPO }, projectIds: [P_OPEN], connectedBy: OWNER, status: 'connected', enabled: true, deletedStatusKey: 0, ...over,
});
const read = (caller, args) => rpc(caller, TOOL, args);
const NOT_LINKED = { error: 'Only a pull request linked to a task you can open can be read. It links itself when its title or branch carries the task key, or a person adds the link on the task.' };

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_WORK = 'off';
    process.env.MCP_TOOLS_DATA = 'on';
    process.env.APP_CONNECTIONS = 'on';
    Object.keys(mockElsewhere.store).forEach((type) => { mockElsewhere.store[type].length = 0; });
    mockElsewhere.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    Object.assign(stored(SCHEMA_TYPE.TASKS, T_OPEN), { TaskKey: 'WEB-7', links: [{ url: `https://github.com/${REPO}/pull/40`, kind: 'pr' }, { url: `https://github.com/${REPO}/pull/42`, kind: 'pr' }, { url: 'https://example.com/doc', kind: 'link' }] });
    Object.assign(stored(SCHEMA_TYPE.TASKS, T_PRIVATE), { TaskKey: 'PRI-3', links: [{ url: `https://github.com/${REPO}/pull/42`, kind: 'pr' }] });
    safeFetch.mockReset();
    github();
});
afterEach(settle);
afterAll(() => [...FLAGS, 'APP_CONNECTIONS'].forEach((flag) => { delete process.env[flag]; }));

describe('the tool', () => {
    it('is offered with the read tools while App connections are on, and only then', async () => {
        expect(await listed(ctx(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ write: false, risk: 'low', undoable: false });
        expect(actions.rating(TOOL)).toEqual({ write: false, reversible: true, scope: 'task', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:read');
        expect(tools.registered().find((tool) => tool.name === TOOL)).toMatchObject({ visibility: 'filtered', strict: true });
        process.env.APP_CONNECTIONS = 'off';
        expect(await listed(ctx(OWNER))).not.toContain(TOOL);
        expect(registry.has(TOOL)).toBe(false);
    });
});

describe('reading a pull request', () => {
    beforeEach(() => connect());

    it('reads the pull request linked to a task by its key, with the files, the checks and the description cut', async () => {
        const answer = await read(ctx(OUTSIDER), { taskKey: 'web-7' });
        expect(answer).toMatchObject({
            repo: REPO, number: 42, title: PULL.title, state: 'merged', author: 'dev-ana', branch: 'feat/web-7-board', base: 'beta', mergedAt: PULL.merged_at,
            task: { taskId: T_OPEN, key: 'WEB-7' }, linkedPullRequests: [40, 42],
            changedFiles: 120, filesPage: 1, nextFilesPage: 2,
            checks: { conclusion: 'failed', total: 3, passed: 2, failed: 1, pending: 0, notPassing: [{ name: 'e2e', conclusion: 'failure' }] },
            description: { cut: true, length: PULL.body.length },
        });
        expect(answer.files).toHaveLength(50);
        expect(answer.files[0]).toEqual({ path: 'src/file0.js', change: 'modified', additions: 2, deletions: 1 });
        expect(answer.description.text).toHaveLength(4000);
        const asked = safeFetch.mock.calls.map(([url]) => url);
        expect(asked[0]).toBe(`https://api.github.com/repos/${REPO}/pulls/42`);
        safeFetch.mock.calls.forEach(([, options]) => expect(options).toMatchObject({ headers: { Authorization: `Bearer ${TOKEN}` }, companyId: world.CID }));
    });

    it('never puts the key in what it answers, whatever GitHub says', async () => {
        github({ [`/repos/${REPO}/commits/${SHA}/check-runs`]: () => { throw new Error(`socket hang up for ${TOKEN}`); } });
        const answer = await read(ctx(OUTSIDER), { taskId: T_OPEN });
        expect(answer.checks).toMatchObject({ conclusion: 'unknown' });
        expect(JSON.stringify(answer)).not.toContain(TOKEN);
        expect(JSON.stringify(answer)).not.toContain('secret diff');
        safeFetch.mockReset();
        safeFetch.mockImplementation(async () => { throw new Error(`refused ${TOKEN}`); });
        logger.warn.mockClear();
        const failed = await read(ctx(OUTSIDER), { number: 42 });
        expect(failed).toEqual({ error: 'GitHub could not be read just now. Try again later.' });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('refused'));
        logger.warn.mock.calls.forEach(([line]) => expect(line).not.toContain(TOKEN));
    });

    it('reads by number or address, and the next page of files', async () => {
        expect(await read(ctx(OUTSIDER), { number: 42 })).toMatchObject({ number: 42, state: 'merged', task: { taskId: T_OPEN } });
        expect(await read(ctx(OUTSIDER), { url: `https://github.com/${REPO}/pull/42/files` })).toMatchObject({ number: 42 });
        const second = await read(ctx(OUTSIDER), { number: 42, filesPage: 3 });
        expect(second).toMatchObject({ filesPage: 3 });
        expect(second.nextFilesPage).toBeUndefined();
        expect(safeFetch.mock.calls.some(([url]) => url.endsWith('/pulls/42/files?per_page=50&page=3'))).toBe(true);
    });

    it('picks one of the pull requests linked to the task, and no other', async () => {
        github({ [`/repos/${REPO}/pulls/40`]: () => reply(200, { ...PULL, number: 40, state: 'open', merged: false, merged_at: null }), [`/repos/${REPO}/pulls/40/files`]: () => reply(200, []) });
        expect(await read(ctx(OUTSIDER), { taskId: T_OPEN, number: 40 })).toMatchObject({ number: 40, state: 'open', mergedAt: null });
        expect(await read(ctx(OUTSIDER), { taskId: T_OPEN, number: 7 })).toMatchObject({ error: expect.stringMatching(/not linked to this task/), linkedPullRequests: [40, 42] });
    });

    it('says when GitHub cannot find it, is rate limited, or does not answer in time', async () => {
        github({ [`/repos/${REPO}/pulls/42`]: () => reply(404, { message: 'Not Found' }) });
        expect(await read(ctx(OUTSIDER), { number: 42 })).toEqual({ error: expect.stringMatching(/cannot find that pull request/) });
        github({ [`/repos/${REPO}/pulls/42`]: () => reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791000000' }) });
        expect(await read(ctx(OUTSIDER), { number: 42 })).toMatchObject({ rateLimited: true, retryAt: new Date(1791000000 * 1000).toISOString() });
        github({ [`/repos/${REPO}/pulls/42`]: () => { throw new Error('fetch exceeded its time budget'); } });
        expect(await read(ctx(OUTSIDER), { number: 42 })).toEqual({ error: expect.stringMatching(/did not answer in time/) });
    });
});

describe('what the person cannot open is not read', () => {
    it('a repository linked only to a project the person cannot open is refused, and GitHub is not asked', async () => {
        connect(mockDb, { projectIds: [P_PRIVATE] });
        expect(await read(ctx(OUTSIDER), { number: 42 })).toEqual(NOT_LINKED);
        expect(await read(ctx(OUTSIDER), { url: `https://github.com/${REPO}/pull/42` })).toEqual(NOT_LINKED);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(await read(ctx(INSIDER), { number: 42 })).toMatchObject({ number: 42 });
    });

    it('a repository that is not the connected one is refused', async () => {
        connect();
        expect(await read(ctx(OWNER), { url: 'https://github.com/someone/else/pull/42' })).toMatchObject({ refused: true });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('a task the person cannot open is not found, and a task of a project not linked says so', async () => {
        connect();
        expect(await read(ctx(OUTSIDER), { taskKey: 'PRI-3' })).toEqual({ error: expect.stringMatching(/task was not found/) });
        expect(await read(ctx(INSIDER), { taskId: T_PRIVATE })).toEqual({ error: expect.stringMatching(/not linked to the GitHub repository/) });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('a connection kept to other projects is refused', async () => {
        connect();
        expect(await read(narrowed(OWNER, [P_PRIVATE]), { number: 42 })).toEqual(NOT_LINKED);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('another workspace never reaches this one\'s connection', async () => {
        connect();
        const elsewhere = ctx(OWNER, { companyId: mockOtherCompany });
        expect(await read(elsewhere, { number: 42 })).toEqual({ error: expect.stringMatching(/GitHub is not connected/) });
        expect(await read(elsewhere, { taskKey: 'WEB-7' })).toEqual({ error: expect.stringMatching(/GitHub is not connected/) });
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('the number and address paths follow the task list rules', () => {
    beforeEach(() => {
        connect();
        Object.assign(stored(SCHEMA_TYPE.TASKS, T_SECRET), { TaskKey: 'SEC-1', links: [{ url: `https://github.com/${REPO}/pull/43`, kind: 'pr' }] });
    });

    it('a pull request linked only to a task on a list hidden from the person is refused', async () => {
        expect(await read(ctx(OUTSIDER), { number: 43 })).toEqual(NOT_LINKED);
        expect(await read(ctx(OUTSIDER), { url: `https://github.com/${REPO}/pull/43` })).toEqual(NOT_LINKED);
        expect(safeFetch).not.toHaveBeenCalled();
        expect(await read(ctx(INSIDER), { number: 43 })).toEqual({ error: expect.stringMatching(/cannot find that pull request/) });
    });

    it('a pull request linked to no task gets the same answer as a hidden one', async () => {
        expect(await read(ctx(OWNER), { number: 99 })).toEqual(NOT_LINKED);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('a link to another pull request, or to the same number in another repository, is not taken for it', async () => {
        Object.assign(stored(SCHEMA_TYPE.TASKS, T_OPEN), { links: [
            { url: `https://github.com/${REPO}/pull/4`, kind: 'pr' },
            { url: `https://github.com/${REPO}/pull/420`, kind: 'pr' },
            { url: 'https://github.com/acme/web-old/pull/42', kind: 'pr' },
            { url: 'https://github.com/other/web/pull/42', kind: 'pr' },
        ] });
        expect(await read(ctx(OWNER), { number: 42 })).toEqual(NOT_LINKED);
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('a stored link with spaces around it still counts', async () => {
        stored(SCHEMA_TYPE.TASKS, T_OPEN).links = [{ url: `  https://github.com/${REPO}/pull/42/files \n`, kind: 'pr' }];
        expect(await read(ctx(OWNER), { number: 42 })).toMatchObject({ number: 42, task: { taskId: T_OPEN } });
    });

    it('an address naming a repository of dots only is not taken', async () => {
        expect(await read(ctx(OWNER), { url: 'https://github.com/acme/../pull/42' })).toEqual({ error: expect.stringMatching(/not the address/) });
    });
});

describe('the person who connected GitHub', () => {
    it('once they lose access to a linked project, its pull requests are not served', async () => {
        connect(mockDb, { connectedBy: INSIDER, projectIds: [P_OPEN, P_PRIVATE] });
        Object.assign(stored(SCHEMA_TYPE.TASKS, T_PRIVATE), { links: [{ url: `https://github.com/${REPO}/pull/44`, kind: 'pr' }] });
        github({ [`/repos/${REPO}/pulls/44`]: () => reply(200, { ...PULL, number: 44 }), [`/repos/${REPO}/pulls/44/files`]: () => reply(200, []) });
        expect(await read(ctx(OWNER), { taskId: T_PRIVATE })).toMatchObject({ number: 44 });
        expect(await read(ctx(OWNER), { number: 44 })).toMatchObject({ number: 44 });
        stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).AssigneeUserId = [];
        safeFetch.mockClear();
        expect(await read(ctx(OWNER), { taskId: T_PRIVATE })).toEqual({ error: expect.stringMatching(/not linked to the GitHub repository/) });
        expect(await read(ctx(OWNER), { number: 44 })).toEqual(NOT_LINKED);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('narrowed and in-app callers', () => {
    beforeEach(() => connect(mockDb, { projectIds: [P_OPEN, P_PRIVATE] }));

    it('a connection kept to other projects does not reach a task outside them', async () => {
        expect(await read(narrowed(OWNER, [P_PRIVATE]), { taskId: T_OPEN })).toEqual({ error: expect.stringMatching(/task was not found/) });
        expect(await read(narrowed(OWNER, [P_PRIVATE]), { taskKey: 'WEB-7' })).toEqual({ error: expect.stringMatching(/task was not found/) });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('the Ask agent is judged task by task: the first project refuses, a later one allows', async () => {
        const ask = { companyId: world.CID, userId: INSIDER, actor: { kind: 'agent', userId: INSIDER, agentId: null, agentName: 'Ask', viaAccount: 'workspace', tokenId: null, runId: null }, projectIds: [], ip: '1.1.1.1' };
        const real = permissions.holderMay;
        const spy = jest.spyOn(permissions, 'holderMay').mockImplementation((companyId, actor, action, params, options) => (
            action === TOOL && params && params.taskId === T_OPEN ? Promise.resolve({ allowed: false, reason: 'the project keeps its tasks from this person' }) : real(companyId, actor, action, params, options)));
        try {
            expect(await tools.readOwn(ask, TOOL, { number: 42 })).toMatchObject({ number: 42, task: { taskId: T_PRIVATE } });
            stored(SCHEMA_TYPE.TASKS, T_PRIVATE).links = [];
            await expect(tools.readOwn(ask, TOOL, { number: 42 })).rejects.toBeInstanceOf(actions.RefusedError);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('not connected', () => {
    it('says so with no connection, no repository picked, or the connection switched off', async () => {
        expect(await read(ctx(OWNER), { number: 42 })).toEqual({ error: expect.stringMatching(/GitHub is not connected/) });
        connect(mockDb, { config: { token: TOKEN } });
        expect(await read(ctx(OWNER), { number: 42 })).toEqual({ error: expect.stringMatching(/GitHub is not connected/) });
        stored(SCHEMA_TYPE.INTEGRATION_CONNECTIONS, CONNECTION).config.repo = REPO;
        stored(SCHEMA_TYPE.INTEGRATION_CONNECTIONS, CONNECTION).enabled = false;
        expect(await read(ctx(OWNER), { number: 42 })).toEqual({ error: expect.stringMatching(/GitHub is not connected/) });
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('asks for a task or a pull request when given neither', async () => {
        connect();
        expect(await read(ctx(OWNER), {})).toEqual({ error: expect.stringMatching(/Name a task/) });
    });
});
