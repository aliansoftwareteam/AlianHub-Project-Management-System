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
const { init } = require('../Modules/Instance/routes');
const store = require('../Modules/Agents/engine/egressAllowlist');
const { LIST_CHANGED_ACTION, WINDOW_DAYS } = require('../Modules/Instance/egress');

const GLOBAL = 'global';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const MISSING_CID = '6f00000000000000000000fe';
const BASE = '/api/v2/instance/egress';
const ENV_KEY = 'AGENT_EGRESS_ALLOWLIST';
const DAY = 24 * 60 * 60 * 1000;

const g = () => mockDbFor(GLOBAL);
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const listOf = (companyId) => (mockDbFor(companyId).store[store.COLLECTION] || [])[0];
const seedList = (companyId, hosts, over = {}) => mockDbFor(companyId).seed(store.COLLECTION, { _id: store.DOC_ID, hosts, updatedBy: OWNER, updatedAt: daysAgo(1), ...over });
const seedRefusal = (companyId, at) => mockDbFor(companyId).seed('audit_logs', { action: store.REFUSED_ACTION, entityType: 'host', entityId: 'x.example.com', createdAt: at });
const changeAudits = (companyId) => (mockDbFor(companyId).store.audit_logs || []).filter((row) => row.action === LIST_CHANGED_ACTION);

const seedPeople = () => {
    g().seed('users', { _id: OWNER, Employee_Name: 'Olivia Owner', isProductOwner: true });
    g().seed('users', { _id: ADMIN, Employee_Name: 'Ada Admin' });
    g().seed('users', { _id: MEMBER, Employee_Name: 'Max Member' });
    g().seed('company_users', { userId: ADMIN, companyId: CID_A, roleType: 2, status: 1 });
    g().seed('company_users', { userId: MEMBER, companyId: CID_A, roleType: 3, status: 1 });
};
const seedCompany = (id, name) => g().seed('companies', { _id: id, Cst_CompanyName: name, createdAt: daysAgo(100) });

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
    delete process.env[ENV_KEY];
    myCache.flushAll();
    jest.clearAllMocks();
    seedPeople();
    seedCompany(CID_A, 'Acme');
    seedCompany(CID_B, 'Bolt');
});

afterAll(() => { delete process.env[ENV_KEY]; });

const call = async (method, path, { uid, body, apiToken } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (uid) headers['x-uid'] = uid;
    if (apiToken) headers['x-api-token'] = apiToken;
    const res = await fetch(baseURL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};
const asOwner = (method, path, body) => call(method, path, { uid: OWNER, body });
const workspace = (data, id) => data.workspaces.find((w) => w.companyId === id);

const ROUTES = [
    ['GET', BASE, undefined],
    ['PUT', `${BASE}/${CID_A}`, { hosts: ['docs.example.com'] }],
];

describe('with the flag off', () => {
    it.each(ROUTES)('answers 404 to the owner on %s %s and names the flag', async (method, path, body) => {
        const res = await asOwner(method, path, body);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ status: false, statusText: expect.stringContaining(ENV_KEY), data: { flag: { on: false, envKey: ENV_KEY } } });
        expect(listOf(CID_A)).toBeUndefined();
    });

    it.each(ROUTES)('still refuses a member on %s %s', async (method, path, body) => {
        expect((await call(method, path, { uid: MEMBER, body })).status).toBe(403);
    });
});

describe('with the flag on', () => {
    beforeEach(() => { process.env[ENV_KEY] = 'true'; });

    describe('who may open the console', () => {
        it.each(ROUTES)('refuses a member on %s %s', async (method, path, body) => {
            const res = await call(method, path, { uid: MEMBER, body });
            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({ status: false });
            expect(listOf(CID_A)).toBeUndefined();
        });

        it.each(ROUTES)('refuses a workspace admin on %s %s', async (method, path, body) => {
            expect((await call(method, path, { uid: ADMIN, body })).status).toBe(403);
            expect(listOf(CID_A)).toBeUndefined();
        });

        it.each(ROUTES)('refuses an API token, even the owner\'s, on %s %s', async (method, path, body) => {
            expect((await call(method, path, { uid: OWNER, apiToken: 'tok', body })).status).toBe(403);
        });

        it.each(ROUTES)('answers 401 without a session on %s %s', async (method, path, body) => {
            expect((await call(method, path, { body })).status).toBe(401);
        });
    });

    describe('the summary', () => {
        it('lists every workspace with its hosts, who set them, and the refusals of the last 7 days', async () => {
            seedList(CID_A, ['docs.example.com', '*.api.example.com']);
            seedRefusal(CID_A, daysAgo(1));
            seedRefusal(CID_A, daysAgo(6));
            seedRefusal(CID_A, daysAgo(8));
            seedRefusal(CID_B, daysAgo(2));
            const { status, body } = await asOwner('GET', BASE);
            expect(status).toBe(200);
            expect(body.status).toBe(true);
            expect(body.data).toMatchObject({ flag: { on: true, envKey: ENV_KEY }, cacheTtlSeconds: 30, windowDays: 7, maxHosts: expect.any(Number) });
            expect(WINDOW_DAYS).toBe(7);
            expect(workspace(body.data, CID_A)).toMatchObject({ companyId: CID_A, name: 'Acme', hosts: ['docs.example.com', '*.api.example.com'], updatedBy: OWNER, updatedByName: 'Olivia Owner', refused7d: 2 });
            expect(new Date(workspace(body.data, CID_A).updatedAt).getTime()).toBeCloseTo(daysAgo(1).getTime(), -4);
            expect(workspace(body.data, CID_B)).toMatchObject({ companyId: CID_B, name: 'Bolt', hosts: [], updatedAt: null, updatedBy: '', updatedByName: '', refused7d: 1 });
        });

        it('reads the stored list, not the cache', async () => {
            myCache.set(`egressAllowlist:${CID_A}`, ['stale.example.com'], 30);
            seedList(CID_A, ['docs.example.com']);
            const { body } = await asOwner('GET', BASE);
            expect(workspace(body.data, CID_A).hosts).toEqual(['docs.example.com']);
        });
    });

    describe('replacing a workspace list', () => {
        const cacheKey = `egressAllowlist:${CID_A}`;

        it('validates, stores, drops the cached list and writes an audit row naming what changed', async () => {
            seedList(CID_A, ['old.example.com', 'kept.example.com']);
            myCache.set(cacheKey, ['old.example.com', 'kept.example.com'], 30);
            const before = Date.now();
            const res = await asOwner('PUT', `${BASE}/${CID_A}`, { hosts: ['Kept.example.com', '*.new.example.com', 'kept.example.com'] });
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ companyId: CID_A, hosts: ['kept.example.com', '*.new.example.com'], updatedBy: OWNER, cacheTtlSeconds: 30 });
            expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
            expect(listOf(CID_A)).toMatchObject({ _id: store.DOC_ID, hosts: ['kept.example.com', '*.new.example.com'], updatedBy: OWNER });
            expect(mockDbFor(CID_A).store[store.COLLECTION]).toHaveLength(1);
            expect(myCache.get(cacheKey)).toBeUndefined();
            await settle();
            expect(changeAudits(CID_A)).toHaveLength(1);
            expect(changeAudits(CID_A)[0]).toMatchObject({
                actorId: OWNER, actorName: 'Olivia Owner', entityType: 'company', entityId: CID_A, entityName: 'Acme',
                meta: { added: ['*.new.example.com'], removed: ['old.example.com'], count: 2 },
            });
            expect(changeAudits(CID_A)[0].meta).not.toHaveProperty('emptied');
        });

        it('creates the document for a workspace that had none', async () => {
            const res = await asOwner('PUT', `${BASE}/${CID_A}`, { hosts: ['docs.example.com'] });
            expect(res.status).toBe(200);
            expect(listOf(CID_A).hosts).toEqual(['docs.example.com']);
            await settle();
            expect(changeAudits(CID_A)[0].meta).toEqual({ added: ['docs.example.com'], removed: [], count: 1 });
        });

        it('an empty list clears the workspace back to today\'s behaviour, and the audit row says the list was emptied', async () => {
            seedList(CID_A, ['docs.example.com']);
            const res = await asOwner('PUT', `${BASE}/${CID_A}`, { hosts: [] });
            expect(res.status).toBe(200);
            expect(res.body.data.hosts).toEqual([]);
            expect(listOf(CID_A).hosts).toEqual([]);
            await settle();
            expect(changeAudits(CID_A)).toHaveLength(1);
            expect(changeAudits(CID_A)[0].meta).toEqual({ added: [], removed: ['docs.example.com'], count: 0, emptied: true });
        });

        it('the same list again writes nothing and no audit row', async () => {
            seedList(CID_A, ['docs.example.com']);
            const res = await asOwner('PUT', `${BASE}/${CID_A}`, { hosts: ['DOCS.example.com'] });
            expect(res.status).toBe(200);
            expect(res.body.data.hosts).toEqual(['docs.example.com']);
            expect(new Date(listOf(CID_A).updatedAt).getTime()).toBeCloseTo(daysAgo(1).getTime(), -4);
            await settle();
            expect(changeAudits(CID_A)).toHaveLength(0);
        });

        it.each([
            [['10.0.0.1'], 'address'], [['169.254.169.254'], 'address'], [['[::1]'], 'address'], [['0x7f000001'], 'address'],
            [['localhost'], 'private'], [['printer.local'], 'private'], [['vault.internal'], 'private'],
            [['https://docs.example.com'], 'scheme'], [['docs.example.com/api'], 'path'], [['192.168.0.0/16'], 'address'],
            [['*.com'], 'wildcard'], [['*.co.uk'], 'public_suffix'], [['*.github.io'], 'public_suffix'], [['*.s3.amazonaws.com'], 'public_suffix'], [['docs.example.com:99999'], 'port'], [['docs.example.com', 'not a host'], 'invalid'],
        ])('refuses %j as %s and leaves the list alone', async (hosts, reason) => {
            seedList(CID_A, ['docs.example.com']);
            const res = await asOwner('PUT', `${BASE}/${CID_A}`, { hosts });
            expect(res.status).toBe(400);
            expect(res.body.status).toBe(false);
            expect(res.body.data.errors).toEqual([{ entry: hosts[hosts.length - 1], reason }]);
            expect(listOf(CID_A).hosts).toEqual(['docs.example.com']);
            await settle();
            expect(changeAudits(CID_A)).toHaveLength(0);
        });

        it.each([[{}], [{ hosts: 'docs.example.com' }], [{ hosts: null }], [{ hosts: [{ host: 'docs.example.com' }] }]])('refuses a body of %j', async (body) => {
            const res = await asOwner('PUT', `${BASE}/${CID_A}`, body);
            expect(res.status).toBe(400);
            expect(listOf(CID_A)).toBeUndefined();
        });

        it('refuses an unknown workspace and a malformed id', async () => {
            expect((await asOwner('PUT', `${BASE}/${MISSING_CID}`, { hosts: ['docs.example.com'] })).status).toBe(404);
            expect((await asOwner('PUT', `${BASE}/nope`, { hosts: ['docs.example.com'] })).status).toBe(400);
            expect(listOf(MISSING_CID)).toBeUndefined();
        });

        it('never touches another workspace\'s list', async () => {
            seedList(CID_B, ['bolt.example.com']);
            await asOwner('PUT', `${BASE}/${CID_A}`, { hosts: ['acme.example.com'] });
            expect(listOf(CID_B).hosts).toEqual(['bolt.example.com']);
            expect(changeAudits(CID_B)).toHaveLength(0);
        });
    });
});
