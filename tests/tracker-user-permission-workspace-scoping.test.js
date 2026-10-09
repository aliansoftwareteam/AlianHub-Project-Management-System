jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
const mockUpdateCompany = jest.fn(async () => ({ data: { trackerUsers: 1 } }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: (...a) => mockUpdateCompany(...a) }));
const mockUpdateMember = jest.fn(async () => ({}));
jest.mock('../Modules/settings/Members/controller.js', () => ({ updateMemberFunction: (...a) => mockUpdateMember(...a) }));

const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const GUEST = '6f00000000000000000000a4';
const PATH = '/api/v1/manageTrackerUserPermission';
const body = (extra = {}) => ({ DataObj: { ops: true, data: { status: 2, userId: MEMBER } }, ...extra });

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/trackerUserPermission/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockUpdateCompany.mockClear();
    mockUpdateMember.mockClear();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(dbCollections.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false, companyId: WORKSPACE });
    mockDb.calls.length = 0;
});

describe(`POST ${PATH}`, () => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call('POST', PATH, { companyId: WORKSPACE, body: body() });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
        expect(mockUpdateCompany).not.toHaveBeenCalled();
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call('POST', PATH, { token: tokenFor(OWNER, [OTHER_WORKSPACE]), companyId: WORKSPACE, body: body() });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
        expect(mockUpdateCompany).not.toHaveBeenCalled();
    });

    it.each([[OWNER], [ADMIN]])('lets an owner or admin change tracker access, only in the header\'s workspace (%s)', async (uid) => {
        const res = await app.call('POST', PATH, { token: tokenFor(uid), companyId: WORKSPACE, body: body() });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(mockUpdateCompany).toHaveBeenCalledTimes(1);
        expect(mockUpdateCompany.mock.calls[0][3]).toBe(WORKSPACE);
        expect(mockUpdateMember).toHaveBeenCalledTimes(1);
        expect(mockUpdateMember.mock.calls[0][0]).toBe(WORKSPACE);
    });

    it.each([[MEMBER, 'a member'], [GUEST, 'a guest']])('refuses %s with 403, and changes nothing', async (uid) => {
        const res = await app.call('POST', PATH, { token: tokenFor(uid), companyId: WORKSPACE, body: body() });
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(mockUpdateCompany).not.toHaveBeenCalled();
        expect(mockUpdateMember).not.toHaveBeenCalled();
    });

    it('refuses a body that names another workspace, and changes nothing', async () => {
        const res = await app.call('POST', PATH, { token: tokenFor(OWNER, [WORKSPACE, OTHER_WORKSPACE]), companyId: WORKSPACE, body: body({ companyId: OTHER_WORKSPACE }) });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(mockUpdateCompany).not.toHaveBeenCalled();
        expect(mockUpdateMember).not.toHaveBeenCalled();
    });
});
