const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/jwt', () => ({
    verifyJWTTokenV2: (req, res, next) => {
        const uid = req.headers['x-uid'];
        if (!uid) return res.status(401).send({ status: false, statusText: 'No session.' });
        req.uid = uid;
        if (req.headers['x-api-token']) req.apiToken = { id: req.headers['x-api-token'] };
        return next();
    },
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Instance/controller', () => new Proxy({}, { get: () => (req, res) => res.status(200).json({ status: true, reached: true }) }));
jest.mock('../Modules/Agents/metricsController', () => ({ instanceMetrics: (req, res) => res.json({ status: true }) }));

const express = require('express');
const { myCache } = require('../Config/config');
const socketEmitter = require('../event/socketEventEmitter');
const instanceSettings = require('../Config/instanceSettings');
const { REASONS } = require('../Config/permissionDecisions');
const { init } = require('../Modules/Instance/routes');
const { readiness, READY_AFTER_DAYS, MODE_CHANGED_ACTION } = require('../Modules/Instance/enforcement');

const GLOBAL = 'global';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const U1 = '6f0000000000000000000011';
const U2 = '6f0000000000000000000012';
const UNKNOWN_USER = '6f00000000000000000000ff';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const CID_C = '6f00000000000000000000c1';
const CID_D = '6f00000000000000000000d1';
const CID_E = '6f00000000000000000000e1';
const MISSING_CID = '6f00000000000000000000fe';
const BASE = '/api/v2/instance/enforcement';
const DAY = 24 * 60 * 60 * 1000;
const ENV_KEYS = ['PERMISSION_ENFORCEMENT_MODE', 'DISABLE_PERMISSION_ENFORCEMENT', 'PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS'];

const g = () => mockDbFor(GLOBAL);
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const utcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const decision = (over = {}) => {
    const lastSeen = over.lastSeen || daysAgo(1);
    return {
        day: utcDay(lastSeen), mode: 'report', method: 'PATCH', route: '/api/v2/tasks', permission: 'task.task_priority',
        role: 3, scope: 'global', reason: REASONS.DENIED, count: 1, firstSeen: over.firstSeen || lastSeen, lastSeen, userIds: [],
        ...over,
    };
};

const seedPeople = () => {
    g().seed('users', { _id: OWNER, Employee_Name: 'Olivia Owner', isProductOwner: true });
    g().seed('users', { _id: ADMIN, Employee_Name: 'Ada Admin' });
    g().seed('users', { _id: MEMBER, Employee_Name: 'Max Member' });
    g().seed('users', { _id: U1, Employee_Name: 'Uma One' });
    g().seed('users', { _id: U2, Employee_Name: 'Uri Two' });
    g().seed('company_users', { userId: ADMIN, companyId: CID_A, roleType: 2, status: 1 });
    g().seed('company_users', { userId: MEMBER, companyId: CID_A, roleType: 3, status: 1 });
};

const seedCompany = (id, name, permissionEnforcement) => g().seed('companies', {
    _id: id, Cst_CompanyName: name, createdAt: daysAgo(100), ...(permissionEnforcement === undefined ? {} : { permissionEnforcement }),
});

let server;
let baseURL;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    init(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
    instanceSettings._resetForTests();
    myCache.flushAll();
    jest.clearAllMocks();
    seedPeople();
});

afterAll(() => ENV_KEYS.forEach((key) => { delete process.env[key]; }));

const call = async (method, path, { uid, body, apiToken } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (uid) headers['x-uid'] = uid;
    if (apiToken) headers['x-api-token'] = apiToken;
    const res = await fetch(baseURL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};
const asOwner = (method, path, body) => call(method, path, { uid: OWNER, body });

const workspace = (data, id) => data.workspaces.find((w) => w.companyId === id);

describe('who may open the console', () => {
    const ROUTES = [
        ['GET', BASE, undefined],
        ['GET', `${BASE}/${CID_A}/decisions`, undefined],
        ['PUT', `${BASE}/${CID_A}/mode`, { mode: 'report' }],
        ['PUT', `${BASE}/default`, { mode: 'report' }],
    ];

    beforeEach(() => seedCompany(CID_A, 'Acme'));

    it('lets the instance owner read the summary', async () => {
        const res = await asOwner('GET', BASE);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data.workspaces)).toBe(true);
    });

    it.each(ROUTES)('refuses a member on %s %s', async (method, path, body) => {
        const res = await call(method, path, { uid: MEMBER, body });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false });
        expect(g().store.companies[0].permissionEnforcement).toBeUndefined();
    });

    it.each(ROUTES)('refuses a workspace admin on %s %s', async (method, path, body) => {
        const res = await call(method, path, { uid: ADMIN, body });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false });
    });

    it.each(ROUTES)('refuses an API token, even the owner\'s, on %s %s', async (method, path, body) => {
        const res = await call(method, path, { uid: OWNER, apiToken: 'tok', body });
        expect(res.status).toBe(403);
    });

    it.each(ROUTES)('answers 401 without a session on %s %s', async (method, path, body) => {
        expect((await call(method, path, { body })).status).toBe(401);
    });
});

describe('the summary', () => {
    it('reports an instance default set in the environment as locked', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
        const { body } = await asOwner('GET', BASE);
        expect(body.data.instance).toEqual({ mode: 'report', source: 'env', locked: true, killSwitch: false });
    });

    it('reports a default saved in the settings catalogue as changeable', async () => {
        g().seed('instance_settings', { _id: 'instance', values: { PERMISSION_ENFORCEMENT_MODE: 'enforce' } });
        await instanceSettings.loadInstanceSettings();
        const { body } = await asOwner('GET', BASE);
        expect(body.data.instance).toEqual({ mode: 'enforce', source: 'saved', locked: false, killSwitch: false });
    });

    it('falls back to the built-in default, off', async () => {
        const { body } = await asOwner('GET', BASE);
        expect(body.data.instance).toEqual({ mode: 'off', source: 'default', locked: false, killSwitch: false });
        expect(body.data.readyAfterDays).toBe(14);
        expect(body.data.cacheTtlSeconds).toBe(30);
    });

    it('reports the cache window the server actually uses', async () => {
        process.env.PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS = '7';
        const { body } = await asOwner('GET', BASE);
        expect(body.data.cacheTtlSeconds).toBe(7);
    });

    it('shows the kill switch and its effect on an enforcing workspace', async () => {
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        seedCompany(CID_A, 'Acme', { mode: 'enforce' });
        const { body } = await asOwner('GET', BASE);
        expect(body.data.instance.killSwitch).toBe(true);
        expect(workspace(body.data, CID_A)).toMatchObject({ mode: 'enforce', effectiveMode: 'report' });
    });

    it('lists every workspace with its own mode and the effective mode', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        seedCompany(CID_A, 'Acme', { mode: 'report' });
        seedCompany(CID_B, 'Bolt');
        seedCompany(CID_C, 'Crab', { mode: 'off' });
        seedCompany(CID_D, 'Dune', 'enforce');
        seedCompany(CID_E, 'Echo', { mode: 'strict' });
        const { body } = await asOwner('GET', BASE);
        const modes = Object.fromEntries(body.data.workspaces.map((w) => [w.name, [w.mode, w.effectiveMode]]));
        expect(modes).toEqual({
            Acme: ['report', 'report'],
            Bolt: ['inherit', 'enforce'],
            Crab: ['off', 'off'],
            Dune: ['enforce', 'enforce'],
            Echo: ['inherit', 'enforce'],
        });
        expect(workspace(body.data, CID_A)).toMatchObject({ companyId: CID_A, name: 'Acme' });
    });

    it('counts the rows of the last 30 days and dates the first report row and the last row', async () => {
        seedCompany(CID_A, 'Acme', { mode: 'report' });
        const db = mockDbFor(CID_A);
        db.seed('permission_decisions', decision({ lastSeen: daysAgo(20), firstSeen: daysAgo(21), count: 4 }));
        db.seed('permission_decisions', decision({ lastSeen: daysAgo(2), firstSeen: daysAgo(3), count: 2, permission: 'task.task_status' }));
        db.seed('permission_decisions', decision({ mode: 'enforce', lastSeen: daysAgo(25), firstSeen: daysAgo(26), count: 8, reason: REASONS.NO_SEAT }));
        db.seed('permission_decisions', decision({ lastSeen: daysAgo(40), firstSeen: daysAgo(41), count: 100, permission: 'task.old' }));
        const { body } = await asOwner('GET', BASE);
        const acme = workspace(body.data, CID_A);
        expect(acme.rows30d).toBe(14);
        expect(new Date(acme.lastRowAt).getTime()).toBeCloseTo(daysAgo(2).getTime(), -4);
        expect(new Date(acme.firstReportRowAt).getTime()).toBeCloseTo(daysAgo(21).getTime(), -4);
        expect(acme.daysSinceFirstReportRow).toBe(21);
        expect(acme.streakDays).toBe(2);
        expect(acme.readyToEnforce).toBe(false);
    });

    it('a workspace with no rows has no dates and no streak yet', async () => {
        seedCompany(CID_A, 'Acme', { mode: 'report' });
        const { body } = await asOwner('GET', BASE);
        expect(workspace(body.data, CID_A)).toMatchObject({ rows30d: 0, lastRowAt: null, firstReportRowAt: null, daysSinceFirstReportRow: null, streakDays: null, readyToEnforce: false });
    });

    describe('readiness', () => {
        const cases = [
            ['report, last row exactly 14 days ago', { mode: 'report' }, [daysAgo(14)], 14, true],
            ['report, last row 13 days ago', { mode: 'report' }, [daysAgo(13)], 13, false],
            ['report, a row today', { mode: 'report' }, [new Date(Date.now() - 60000)], 0, false],
            ['report, rows 20 and 15 days ago', { mode: 'report' }, [daysAgo(20), daysAgo(15)], 15, true],
            ['report set 14 days ago from the console, no rows', { mode: 'report', since: daysAgo(14) }, [], 14, true],
            ['report set 3 days ago from the console, last row 20 days ago', { mode: 'report', since: daysAgo(3) }, [daysAgo(20)], 3, false],
            ['report, set by hand with no since and no rows', { mode: 'report' }, [], null, false],
            ['enforce with a 20-day quiet streak', { mode: 'enforce' }, [daysAgo(20)], 20, false],
            ['off with a 20-day quiet streak', { mode: 'off' }, [daysAgo(20)], 20, false],
        ];

        it.each(cases)('%s', async (_, stored, lastSeens, streakDays, ready) => {
            seedCompany(CID_A, 'Acme', stored);
            lastSeens.forEach((lastSeen, i) => mockDbFor(CID_A).seed('permission_decisions', decision({ lastSeen, permission: `task.k${i}` })));
            const { body } = await asOwner('GET', BASE);
            expect(workspace(body.data, CID_A)).toMatchObject({ streakDays, readyToEnforce: ready });
        });

        it('counts an inherited report mode, so a workspace on the instance default can be ready', async () => {
            process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
            seedCompany(CID_B, 'Bolt');
            mockDbFor(CID_B).seed('permission_decisions', decision({ lastSeen: daysAgo(15) }));
            const { body } = await asOwner('GET', BASE);
            expect(workspace(body.data, CID_B)).toMatchObject({ mode: 'inherit', effectiveMode: 'report', streakDays: 15, readyToEnforce: true });
        });

        it('the pure rule: exactly 14 quiet days is ready, 13 is not, a row today is not', () => {
            const now = new Date('2026-09-18T12:00:00.000Z');
            const at = (days) => new Date(now.getTime() - days * DAY);
            expect(READY_AFTER_DAYS).toBe(14);
            expect(readiness({ effectiveMode: 'report', lastRowAt: at(14), since: null, now })).toEqual({ streakDays: 14, readyToEnforce: true });
            expect(readiness({ effectiveMode: 'report', lastRowAt: at(13.999), since: null, now })).toEqual({ streakDays: 13, readyToEnforce: false });
            expect(readiness({ effectiveMode: 'report', lastRowAt: at(0), since: null, now })).toEqual({ streakDays: 0, readyToEnforce: false });
            expect(readiness({ effectiveMode: 'report', lastRowAt: null, since: at(14), now })).toEqual({ streakDays: 14, readyToEnforce: true });
            expect(readiness({ effectiveMode: 'report', lastRowAt: at(30), since: at(2), now })).toEqual({ streakDays: 2, readyToEnforce: false });
            expect(readiness({ effectiveMode: 'report', lastRowAt: null, since: null, now })).toEqual({ streakDays: null, readyToEnforce: false });
            expect(readiness({ effectiveMode: 'enforce', lastRowAt: at(30), since: null, now })).toEqual({ streakDays: 30, readyToEnforce: false });
            expect(readiness({ effectiveMode: 'off', lastRowAt: at(30), since: null, now })).toEqual({ streakDays: 30, readyToEnforce: false });
        });
    });

    it('sums the instance bucket, the rows that named no workspace', async () => {
        g().seed('permission_decisions', decision({ lastSeen: daysAgo(4), count: 3, scope: 'global', role: null, reason: REASONS.NO_SEAT }));
        g().seed('permission_decisions', decision({ lastSeen: daysAgo(9), count: 2, permission: 'settings.settings_member_list' }));
        const { body } = await asOwner('GET', BASE);
        expect(body.data.instanceBucket).toMatchObject({ companyId: 'instance', rows30d: 5 });
        expect(new Date(body.data.instanceBucket.lastRowAt).getTime()).toBeCloseTo(daysAgo(4).getTime(), -4);
    });
});

describe('the decision rows of one workspace', () => {
    beforeEach(() => seedCompany(CID_A, 'Acme', { mode: 'report' }));

    it('returns each grouped row with its user names and nothing that could hold a body, a path or a query string', async () => {
        mockDbFor(CID_A).seed('permission_decisions', decision({ lastSeen: daysAgo(1), count: 7, userIds: [U1, U2, UNKNOWN_USER] }));
        const { status, body } = await asOwner('GET', `${BASE}/${CID_A}/decisions`);
        expect(status).toBe(200);
        expect(body.data).toMatchObject({ companyId: CID_A, days: 30 });
        expect(body.data.rows).toHaveLength(1);
        const [row] = body.data.rows;
        expect(row).toMatchObject({
            mode: 'report', method: 'PATCH', route: '/api/v2/tasks', permission: 'task.task_priority', role: 3, scope: 'global',
            reason: 'denied', knownDifference: false, count: 7,
            users: [{ id: U1, name: 'Uma One' }, { id: U2, name: 'Uri Two' }, { id: UNKNOWN_USER, name: '' }],
        });
        expect(Object.keys(row).sort()).toEqual(['count', 'day', 'firstSeen', 'id', 'knownDifference', 'lastSeen', 'method', 'mode', 'permission', 'reason', 'role', 'route', 'scope', 'users']);
        expect(JSON.stringify(body)).not.toMatch(/"(body|path|query|url|userIds)"/);
    });

    it('labels null_global_flag as the known difference and lists every reason for the filter', async () => {
        const db = mockDbFor(CID_A);
        db.seed('permission_decisions', decision({ reason: REASONS.NULL_GLOBAL_FLAG, scope: '6f0000000000000000000a03' }));
        db.seed('permission_decisions', decision({ reason: REASONS.DENIED, permission: 'task.task_status' }));
        const { body } = await asOwner('GET', `${BASE}/${CID_A}/decisions`);
        const byReason = Object.fromEntries(body.data.rows.map((r) => [r.reason, r.knownDifference]));
        expect(byReason).toEqual({ null_global_flag: true, denied: false });
        expect(body.data.knownDifferenceReasons).toEqual(['null_global_flag']);
        expect(body.data.reasons).toEqual(Object.values(REASONS));
    });

    it('filters by reason and by permission key, and refuses an unknown reason', async () => {
        const db = mockDbFor(CID_A);
        db.seed('permission_decisions', decision({ reason: REASONS.NO_SEAT, permission: 'settings.settings_member_list', role: null }));
        db.seed('permission_decisions', decision({ reason: REASONS.DENIED, permission: 'task.task_priority' }));
        db.seed('permission_decisions', decision({ reason: REASONS.DENIED, permission: 'task.task_status' }));
        const byReason = await asOwner('GET', `${BASE}/${CID_A}/decisions?reason=no_seat`);
        expect(byReason.body.data.rows.map((r) => r.permission)).toEqual(['settings.settings_member_list']);
        const byKey = await asOwner('GET', `${BASE}/${CID_A}/decisions?key=task.task_status`);
        expect(byKey.body.data.rows.map((r) => r.permission)).toEqual(['task.task_status']);
        const both = await asOwner('GET', `${BASE}/${CID_A}/decisions?reason=denied&key=task.task_status`);
        expect(both.body.data.rows).toHaveLength(1);
        const bad = await asOwner('GET', `${BASE}/${CID_A}/decisions?reason=because`);
        expect(bad.status).toBe(400);
        expect(bad.body.status).toBe(false);
    });

    it('keeps to the requested window, 1 to 30 days, newest last-seen first', async () => {
        const db = mockDbFor(CID_A);
        db.seed('permission_decisions', decision({ lastSeen: daysAgo(10), permission: 'task.ten' }));
        db.seed('permission_decisions', decision({ lastSeen: daysAgo(2), permission: 'task.two' }));
        db.seed('permission_decisions', decision({ lastSeen: daysAgo(5), permission: 'task.five' }));
        const week = await asOwner('GET', `${BASE}/${CID_A}/decisions?days=7`);
        expect(week.body.data.days).toBe(7);
        expect(week.body.data.rows.map((r) => r.permission)).toEqual(['task.two', 'task.five']);
        for (const raw of ['0', '99', 'abc', '']) {
            const res = await asOwner('GET', `${BASE}/${CID_A}/decisions?days=${raw}`);
            expect(res.body.data.days).toBe(30);
            expect(res.body.data.rows).toHaveLength(3);
        }
    });

    it('serves the instance bucket under the reserved id', async () => {
        g().seed('permission_decisions', decision({ reason: REASONS.NO_SEAT, role: null, permission: 'settings.settings_member_list', userIds: [U1] }));
        const { status, body } = await asOwner('GET', `${BASE}/instance/decisions`);
        expect(status).toBe(200);
        expect(body.data.companyId).toBe('instance');
        expect(body.data.rows).toHaveLength(1);
        expect(body.data.rows[0]).toMatchObject({ reason: 'no_seat', users: [{ id: U1, name: 'Uma One' }] });
    });

    it('refuses an id that names no workspace', async () => {
        expect((await asOwner('GET', `${BASE}/not-an-id/decisions`)).status).toBe(400);
        expect((await asOwner('GET', `${BASE}/${MISSING_CID}/decisions`)).status).toBe(404);
    });
});

describe('setting a workspace mode', () => {
    const cacheKey = `permissionEnforcement:${CID_A}`;
    const stored = () => g().store.companies.find((c) => c._id === CID_A).permissionEnforcement;
    const audits = () => (mockDbFor(CID_A).store.audit_logs || []).filter((row) => row.action === MODE_CHANGED_ACTION);

    it.each([['strict'], [''], [null], [{ mode: 'report' }], [2]])('refuses %p', async (mode) => {
        seedCompany(CID_A, 'Acme');
        const res = await asOwner('PUT', `${BASE}/${CID_A}/mode`, { mode });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
        expect(stored()).toBeUndefined();
    });

    it('refuses a body without a mode', async () => {
        seedCompany(CID_A, 'Acme');
        expect((await asOwner('PUT', `${BASE}/${CID_A}/mode`, {})).status).toBe(400);
    });

    it('sets the row, stamps when, drops the cached mode and writes an audit row', async () => {
        seedCompany(CID_A, 'Acme');
        myCache.set(cacheKey, 'inherit', 30);
        const before = Date.now();
        const res = await asOwner('PUT', `${BASE}/${CID_A}/mode`, { mode: 'report' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ companyId: CID_A, mode: 'report', effectiveMode: 'report', cacheTtlSeconds: 30 });
        expect(stored()).toMatchObject({ mode: 'report', updatedBy: OWNER });
        expect(new Date(stored().since).getTime()).toBeGreaterThanOrEqual(before);
        expect(myCache.get(cacheKey)).toBeUndefined();
        await settle();
        expect(audits()).toHaveLength(1);
        expect(audits()[0]).toMatchObject({
            actorId: OWNER, actorName: 'Olivia Owner', entityType: 'company', entityId: CID_A, entityName: 'Acme',
            meta: { from: 'inherit', to: 'report', effectiveMode: 'report' },
        });
    });

    it('accepts the mode in any case and stores it lowercased', async () => {
        seedCompany(CID_A, 'Acme');
        const res = await asOwner('PUT', `${BASE}/${CID_A}/mode`, { mode: ' ENFORCE ' });
        expect(res.status).toBe(200);
        expect(stored().mode).toBe('enforce');
    });

    it('inherit unsets the field, so the instance default applies again', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
        seedCompany(CID_A, 'Acme', { mode: 'enforce', since: daysAgo(3) });
        myCache.set(cacheKey, 'enforce', 30);
        const res = await asOwner('PUT', `${BASE}/${CID_A}/mode`, { mode: 'inherit' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ mode: 'inherit', effectiveMode: 'report' });
        expect(stored()).toBeUndefined();
        expect(myCache.get(cacheKey)).toBeUndefined();
        await settle();
        expect(audits()[0].meta).toEqual({ from: 'enforce', to: 'inherit', effectiveMode: 'report' });
    });

    it('the same mode again keeps the stamp and writes no audit row', async () => {
        const since = daysAgo(10);
        seedCompany(CID_A, 'Acme', { mode: 'report', since });
        const res = await asOwner('PUT', `${BASE}/${CID_A}/mode`, { mode: 'report' });
        expect(res.status).toBe(200);
        expect(new Date(stored().since).getTime()).toBe(since.getTime());
        await settle();
        expect(audits()).toHaveLength(0);
    });

    it('reads a mode set by hand as a bare string and replaces it', async () => {
        seedCompany(CID_A, 'Acme', 'report');
        const res = await asOwner('PUT', `${BASE}/${CID_A}/mode`, { mode: 'off' });
        expect(res.status).toBe(200);
        expect(stored()).toMatchObject({ mode: 'off' });
        await settle();
        expect(audits()[0].meta).toMatchObject({ from: 'report', to: 'off' });
    });

    it('refuses an unknown workspace, a malformed id and the reserved id', async () => {
        seedCompany(CID_A, 'Acme');
        expect((await asOwner('PUT', `${BASE}/${MISSING_CID}/mode`, { mode: 'report' })).status).toBe(404);
        expect((await asOwner('PUT', `${BASE}/nope/mode`, { mode: 'report' })).status).toBe(400);
        expect((await asOwner('PUT', `${BASE}/instance/mode`, { mode: 'report' })).status).toBe(400);
    });
});

describe('setting the instance default', () => {
    const saved = () => (g().store.instance_settings || []).find((d) => d._id === 'instance');

    it('refuses with 409 while the environment sets the value', async () => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'report';
        const res = await asOwner('PUT', `${BASE}/default`, { mode: 'enforce' });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ status: false, data: { source: 'env' } });
        expect(saved()).toBeUndefined();
        expect(process.env.PERMISSION_ENFORCEMENT_MODE).toBe('report');
    });

    it('saves the value to the settings catalogue and applies it at once', async () => {
        seedCompany(CID_B, 'Bolt');
        const res = await asOwner('PUT', `${BASE}/default`, { mode: 'report' });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ mode: 'report', source: 'saved', locked: false, killSwitch: false });
        expect(saved().values.PERMISSION_ENFORCEMENT_MODE).toBe('report');
        expect(process.env.PERMISSION_ENFORCEMENT_MODE).toBe('report');
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ event: 'INSTANCE_SETTINGS_UPDATED', keys: ['PERMISSION_ENFORCEMENT_MODE'] }));
        const summary = await asOwner('GET', BASE);
        expect(summary.body.data.instance).toMatchObject({ mode: 'report', source: 'saved' });
        expect(workspace(summary.body.data, CID_B).effectiveMode).toBe('report');
    });

    it.each([['inherit'], ['strict'], [''], [null]])('refuses %p', async (mode) => {
        const res = await asOwner('PUT', `${BASE}/default`, { mode });
        expect(res.status).toBe(400);
        expect(saved()).toBeUndefined();
    });
});
