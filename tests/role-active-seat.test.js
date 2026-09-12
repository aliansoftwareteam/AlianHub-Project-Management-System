const mockDb = require('./fixtures/fakeMongo').create();
const mockCache = new Map();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({
    myCache: {
        get: (key) => mockCache.get(key),
        set: (key, value) => mockCache.set(key, value),
        del: (key) => mockCache.delete(key),
        keys: () => [...mockCache.keys()],
        getTtl: () => 0,
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType, evaluateMany, invalidateRoleCache, requireCompanyAdmin } = require('../Config/permissionGuard');
const audit = require('../Modules/Audit/controller');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const REMOVED = '6f0000000000000000000003';
const PENDING = '6f0000000000000000000004';
const CANCELLED = '6f0000000000000000000005';

const listAuditLogs = async (uid) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    await audit.listAuditLogs({ uid, headers: { companyid: CID }, query: {}, body: {} }, res);
    return res;
};

const runCompanyAdmin = async (uid) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    let passed = false;
    await requireCompanyAdmin()({ uid, headers: { companyid: CID }, body: {} }, res, () => { passed = true; });
    return { passed, code: res.code, body: res.body };
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockCache.clear();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: REMOVED, roleType: 2, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: PENDING, roleType: 2, status: 1, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: CANCELLED, roleType: 2, status: 3, isDelete: false });
});

describe('getRoleType resolves a role only from a live seat', () => {
    it('gives an active member their role', async () => {
        expect(await getRoleType(CID, OWNER)).toBe(1);
        expect(await getRoleType(CID, ADMIN)).toBe(2);
    });

    it.each([
        ['a removed member', REMOVED],
        ['a pending invitee', PENDING],
        ['a cancelled invitation', CANCELLED],
    ])('gives %s no role at all', async (_name, uid) => {
        expect(await getRoleType(CID, uid)).toBeNull();
    });

    it('reads a pending row only when the caller asks for the invited seat', async () => {
        expect(await getRoleType(CID, PENDING, { seat: 'invited' })).toBe(2);
        expect(await getRoleType(CID, REMOVED, { seat: 'invited' })).toBeNull();
    });

    it('reads a removed row only when the caller asks for any seat', async () => {
        expect(await getRoleType(CID, REMOVED, { seat: 'any' })).toBe(2);
        expect(await getRoleType(CID, CANCELLED, { seat: 'any' })).toBe(2);
    });

    it('caches each seat scope apart, and forgets all of them together', async () => {
        expect(await getRoleType(CID, REMOVED)).toBeNull();
        expect(await getRoleType(CID, REMOVED, { seat: 'any' })).toBe(2);
        invalidateRoleCache(CID, REMOVED);
        expect([...mockCache.keys()].filter((key) => key.includes(REMOVED))).toEqual([]);
    });
});

describe('a route that is not the company update', () => {
    it('shows the audit log to an admin who still holds a seat', async () => {
        const res = await listAuditLogs(ADMIN);
        expect(res.body.status).toBe(true);
    });

    it.each([
        ['a removed admin', REMOVED],
        ['an admin who has not accepted the invitation', PENDING],
    ])('refuses the audit log to %s', async (_name, uid) => {
        const res = await listAuditLogs(uid);
        expect(res.code).toBe(403);
        expect(res.body).toMatchObject({ status: false, statusText: 'Owner/admin only.' });
    });

    it.each([
        ['a removed admin', REMOVED],
        ['an admin who has not accepted the invitation', PENDING],
    ])('refuses company settings to %s', async (_name, uid) => {
        const res = await runCompanyAdmin(uid);
        expect(res.passed).toBe(false);
        expect(res.code).toBe(403);
    });

    it('reports no permission at all for a removed admin', async () => {
        const { roleType, permissions } = await evaluateMany(CID, REMOVED, ['task.task_create']);
        expect(roleType).toBeNull();
        expect(permissions['task.task_create']).toBeNull();
    });
});
