const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { requireRole } = require('../Config/permissionGuard');
const routes = require('../Modules/RecurringTasks/routes');

const C = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const NOBODY = '6f0000000000000000000009';

const seat = (userId, roleType) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
    seat(OWNER, 1);
    seat(MEMBER, 3);
});

afterEach(() => {
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
});

const res = () => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (body) => { r.body = body; return r; };
    return r;
};

const through = async (uid, over = {}) => {
    const r = res();
    let passed = false;
    await requireRole()({ headers: { companyid: C }, uid, ...over }, r, () => { passed = true; });
    return { passed, code: r.code, body: r.body };
};

describe('recurring run-due is an owner/admin act', () => {
    it('wires a role guard in front of the handler', () => {
        const posts = [];
        routes.init({ post: (path, ...handlers) => posts.push({ path, handlers }) });
        const runDue = posts.find((route) => route.path === '/api/v1/recurring-tasks/run-due');
        expect(runDue.handlers.length).toBe(2);
    });

    it.each([[OWNER], [MEMBER]])('lets an owner through and refuses a member (%s)', async (uid) => {
        const result = await through(uid);
        expect(result.passed).toBe(uid === OWNER);
        if (uid !== OWNER) expect(result).toMatchObject({ code: 403, body: { status: false } });
    });

    it('refuses a caller with no seat', async () => {
        expect(await through(NOBODY)).toMatchObject({ passed: false, code: 403 });
    });

    it('judges API tokens on the role alone', async () => {
        expect((await through(OWNER, { apiToken: { _id: 't' } })).passed).toBe(true);
        expect(await through(MEMBER, { apiToken: { _id: 't' } })).toMatchObject({ passed: false, code: 403 });
    });

    it('lets browser sessions through while enforcement is off, as before', async () => {
        delete process.env.PERMISSION_ENFORCEMENT_MODE;
        expect((await through(MEMBER)).passed).toBe(true);
    });
});
