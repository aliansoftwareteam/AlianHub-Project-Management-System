const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Company/helpers/companyCounters', () => ({
    stepCompanyCounters: jest.fn(async () => ({})),
    releaseMemberSeat: jest.fn(async () => ({})),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { releaseMemberSeat } = require('../Modules/Company/helpers/companyCounters');
const ctrl = require('../Modules/settings/Members/controller');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const TRACKED = '6f0000000000000000000013';
const INVITEE = '6f0000000000000000000005';

const rowOf = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((r) => r.userId === userId);

const call = async (uid, body) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await ctrl.updateMember({ uid, headers: { companyid: CID }, body, params: {}, query: {} }, res);
    return res;
};

const member = (userId, roleType, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId, roleType, status: 2, isDelete: false, companyId: CID, userEmail: `${userId}@e2e.test`, ...extra,
});

/* The two requests Settings > Members sends. */
const removal = (userId) => ({ id: rowOf(userId)._id, data: { isDelete: true, isTrackerUser: false } });
const cancellation = (userId) => ({ id: rowOf(userId)._id, data: { status: 3, isDelete: true } });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    member(OWNER, 1);
    member(ADMIN, 2);
    member(MEMBER, 3);
    member(TRACKED, 3, { isTrackerUser: true });
    member(INVITEE, 3, { status: 1 });
});

describe('removing a member gives the seat back on the server', () => {
    it('releases one seat when a member is removed', async () => {
        const res = await call(ADMIN, removal(MEMBER));

        expect(res.code).toBe(200);
        expect(rowOf(MEMBER).isDelete).toBe(true);
        expect(releaseMemberSeat.mock.calls).toEqual([[CID, { tracker: false }]]);
    });

    it('releases the time tracker seat too when the member held one', async () => {
        await call(OWNER, removal(TRACKED));

        expect(releaseMemberSeat.mock.calls).toEqual([[CID, { tracker: true }]]);
        expect(rowOf(TRACKED).isTrackerUser).toBe(false);
    });

    it('releases one seat when an invitation is cancelled', async () => {
        await call(ADMIN, cancellation(INVITEE));

        expect(rowOf(INVITEE)).toMatchObject({ status: 3, isDelete: true });
        expect(releaseMemberSeat.mock.calls).toEqual([[CID, { tracker: false }]]);
    });

    it('releases nothing when the same removal arrives twice', async () => {
        await call(ADMIN, removal(MEMBER));
        await call(ADMIN, removal(MEMBER));

        expect(releaseMemberSeat).toHaveBeenCalledTimes(1);
    });

    it('releases nothing for a change that keeps the seat', async () => {
        await call(OWNER, { id: rowOf(MEMBER)._id, data: { roleType: 0 } });
        await call(MEMBER, { id: rowOf(MEMBER)._id, data: { dashboardLocked: true } });

        expect(releaseMemberSeat).not.toHaveBeenCalled();
    });

    it('releases nothing when the removal is refused', async () => {
        const res = await call(MEMBER, removal(TRACKED));

        expect(res.code).toBe(403);
        expect(rowOf(TRACKED).isDelete).toBe(false);
        expect(releaseMemberSeat).not.toHaveBeenCalled();
    });
});
