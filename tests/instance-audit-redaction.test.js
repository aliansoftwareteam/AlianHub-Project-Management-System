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
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
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
const redact = require('../Modules/Audit/redact');
const { ACTION, CODE } = require('../Modules/Instance/auditRedaction');

/* Redacting a person's audit rows is its own instance-owner action, confirmed by typing the person's id. */

const GLOBAL = 'global';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const ALICE = '6f0000000000000000000011';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const MISSING_CID = '6f00000000000000000000fe';
const BASE = '/api/v2/instance/audit';
const KEY = 'instance-admin-key-for-tests';
const saved = { INSTANCE_ADMIN_KEY: process.env.INSTANCE_ADMIN_KEY, AUDIT_CHAIN: process.env.AUDIT_CHAIN };

const g = () => mockDbFor(GLOBAL);
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const auditRows = (companyId) => mockDbFor(companyId).store.audit_logs || [];
const byAction = (companyId, action) => auditRows(companyId).filter((row) => row.action === action);
const seedAliceRow = (companyId) => mockDbFor(companyId).seed('audit_logs', {
    actorId: ALICE, actorName: 'Alice Doe', action: 'member.update', entityType: 'member', entityId: MEMBER, entityName: 'Max Member', meta: {}, ip: '10.0.0.7', createdAt: new Date(),
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

afterAll(() => {
    Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    return new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    delete process.env.INSTANCE_ADMIN_KEY;
    delete process.env.AUDIT_CHAIN;
    myCache.flushAll();
    g().seed('users', { _id: OWNER, Employee_Name: 'Olivia Owner', isProductOwner: true });
    g().seed('users', { _id: ADMIN, Employee_Name: 'Ada Admin' });
    g().seed('users', { _id: MEMBER, Employee_Name: 'Max Member' });
    g().seed('users', { _id: ALICE, Employee_Name: 'Alice Doe', Employee_Email: 'alice@example.com' });
    g().seed('company_users', { userId: ADMIN, companyId: CID_A, roleType: 2, status: 2 });
    g().seed('companies', { _id: CID_A, Cst_CompanyName: 'Acme' });
    g().seed('companies', { _id: CID_B, Cst_CompanyName: 'Bolt' });
});

const call = async (method, path, { uid, body, apiToken, adminKey } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (uid) headers['x-uid'] = uid;
    if (apiToken) headers['x-api-token'] = apiToken;
    if (adminKey) headers.adminkey = adminKey;
    const res = await fetch(baseURL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};
const redactAs = (uid, companyId, body) => call('POST', `${BASE}/${companyId}/redact-person`, { uid, body });

describe('who may redact a person in audit rows', () => {
    it.each([['a member', MEMBER], ['a workspace admin', ADMIN]])('refuses %s', async (_, uid) => {
        const row = seedAliceRow(CID_A);
        const res = await redactAs(uid, CID_A, { userId: ALICE, confirm: ALICE });
        expect(res.status).toBe(403);
        expect(row.actorName).toBe('Alice Doe');
    });

    it("refuses an API token, even the owner's", async () => {
        seedAliceRow(CID_A);
        expect((await call('POST', `${BASE}/${CID_A}/redact-person`, { uid: OWNER, apiToken: 'tok', body: { userId: ALICE, confirm: ALICE } })).status).toBe(403);
    });

    it('answers 401 without a session', async () => {
        expect((await call('POST', `${BASE}/${CID_A}/redact-person`, { body: { userId: ALICE, confirm: ALICE } })).status).toBe(401);
    });

    it('lets the instance admin key in and names it on the audit row', async () => {
        process.env.INSTANCE_ADMIN_KEY = KEY;
        seedAliceRow(CID_A);
        const res = await call('POST', `${BASE}/${CID_A}/redact-person`, { adminKey: KEY, body: { userId: ALICE, confirm: ALICE } });
        expect(res.status).toBe(200);
        await settle();
        expect(byAction(CID_A, ACTION)).toEqual([expect.objectContaining({ actorId: 'instance-admin-key', meta: expect.objectContaining({ via: 'admin_key' }) })]);
    });
});

describe('redacting a person in a workspace\'s audit rows', () => {
    it('needs the person\'s id typed back, in either case', async () => {
        const row = seedAliceRow(CID_A);
        const wrong = await redactAs(OWNER, CID_A, { userId: ALICE, confirm: 'Acme' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe(CODE.CONFIRMATION_MISMATCH);
        expect(row.actorName).toBe('Alice Doe');

        const res = await redactAs(OWNER, CID_A, { userId: ALICE, confirm: ALICE.toUpperCase() });
        expect(res.status).toBe(200);
        expect(row.actorName).toBe(redact.pseudonymOf(ALICE));
    });

    it('redacts only that workspace, answers with counts and the pseudonym, and audits who asked', async () => {
        const row = seedAliceRow(CID_A);
        const elsewhere = seedAliceRow(CID_B);

        const res = await redactAs(OWNER, CID_A, { userId: ALICE.toUpperCase(), confirm: ALICE });

        const alias = redact.pseudonymOf(ALICE);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ rows: 1, fields: 2, pseudonym: alias });
        expect(row).toMatchObject({ actorName: alias, ip: alias, entityName: 'Max Member' });
        expect(elsewhere).toMatchObject({ actorName: 'Alice Doe', ip: '10.0.0.7' });
        expect(byAction(CID_A, redact.REDACTED_ACTION)).toEqual([expect.objectContaining({ actorId: OWNER, entityId: alias, meta: expect.objectContaining({ reason: ACTION, rows: 1, fields: 2 }) })]);
        await settle();
        const [audited] = byAction(CID_A, ACTION);
        expect(audited).toMatchObject({ actorId: OWNER, actorName: 'Olivia Owner', entityType: 'user', entityId: alias, meta: { rows: 1, fields: 2 } });
        expect(JSON.stringify(audited)).not.toContain(ALICE);
        expect(byAction(CID_B, ACTION)).toEqual([]);
    });

    it.each([['nope'], [''], [{ $ne: '' }]])('refuses a person id that is not an id: %j', async (userId) => {
        const res = await redactAs(OWNER, CID_A, { userId, confirm: userId });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODE.INVALID_USER_ID);
    });

    it('refuses a workspace id that is not an id, and a workspace that does not exist', async () => {
        const bad = await redactAs(OWNER, 'nope', { userId: ALICE, confirm: ALICE });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe(CODE.INVALID_COMPANY_ID);
        const missing = await redactAs(OWNER, MISSING_CID, { userId: ALICE, confirm: ALICE });
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe(CODE.UNKNOWN_WORKSPACE);
        expect(mockDbs[MISSING_CID] ? auditRows(MISSING_CID) : []).toEqual([]);
    });

    it('answers 409 with a stable code while another run holds the lease', async () => {
        const row = seedAliceRow(CID_A);
        mockDbFor(CID_A).seed('audit_redactions', { _id: redact.pseudonymOf(ALICE), owner: 'elsewhere', leaseUntil: new Date(Date.now() + 60000), startedAt: new Date(), finishedAt: null, after: '', rows: 0, fields: 0 });

        const res = await redactAs(OWNER, CID_A, { userId: ALICE, confirm: ALICE });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe(CODE.REDACTION_RUNNING);
        expect(row.actorName).toBe('Alice Doe');
    });
});
