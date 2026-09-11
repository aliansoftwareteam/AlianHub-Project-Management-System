const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/settings/Members/controller');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const SECOND_OWNER = '6f0000000000000000000011';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const OTHER_MEMBER = '6f0000000000000000000013';
const GUEST = '6f0000000000000000000004';
const INVITEE = '6f0000000000000000000005';

const rows = () => mockDb.store[SCHEMA_TYPE.COMPANY_USERS];
const rowOf = (userId) => rows().find((r) => r.userId === userId);
const rowByEmail = (email) => rows().find((r) => r.userEmail === email);

const call = async (handler, { uid, body = {}, companyId = CID, headers = {} }) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    let passed = false;
    await handler({ uid, headers: { companyid: companyId, ...headers }, body, params: {}, query: {} }, res, () => { passed = true; });
    return { code: res.code, body: res.body, passed };
};

const member = (userId, roleType, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId, roleType, status: 2, isDelete: false, companyId: CID, designation: 0, userEmail: `${userId}@e2e.test`, ...extra,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    member(OWNER, 1);
    member(ADMIN, 2);
    member(MEMBER, 3, { ProjectRequiredComponent: [] });
    member(OTHER_MEMBER, 3, { ProjectRequiredComponent: [{ id: 'mine', name: 'Mine' }] });
    member(GUEST, 0);
});

describe('INS-01 PUT /api/v1/members', () => {
    it('refuses a member promoting themselves to owner', async () => {
        const res = await call(ctrl.updateMember, { uid: MEMBER, body: { id: rowOf(MEMBER)._id, data: { roleType: 1 } } });
        expect(res.code).toBe(403);
        expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
        expect(rowOf(MEMBER).roleType).toBe(3);
    });

    it('refuses a guest changing their own status or deletion flag', async () => {
        const res = await call(ctrl.updateMember, { uid: GUEST, body: { id: rowOf(GUEST)._id, data: { status: 2, isDelete: false, roleType: 0 } } });
        expect(res.code).toBe(403);
    });

    it('refuses a member changing another member', async () => {
        const res = await call(ctrl.updateMember, { uid: MEMBER, body: { id: rowOf(OTHER_MEMBER)._id, data: { dashboardLocked: true } } });
        expect(res.code).toBe(403);
        expect(rowOf(OTHER_MEMBER).dashboardLocked).toBeUndefined();
    });

    it('lets a member lock their own dashboard', async () => {
        const res = await call(ctrl.updateMember, { uid: MEMBER, body: { id: rowOf(MEMBER)._id, data: { dashboardLocked: true } } });
        expect(res.code).toBe(200);
        expect(res.body.status).toBe(true);
        expect(rowOf(MEMBER).dashboardLocked).toBe(true);
    });

    it.each([[1], [2]])('refuses an admin granting role %s', async (roleType) => {
        const res = await call(ctrl.updateMember, { uid: ADMIN, body: { id: rowOf(MEMBER)._id, data: { roleType } } });
        expect(res.code).toBe(403);
        expect(rowOf(MEMBER).roleType).toBe(3);
    });

    it('lets the owner make a member an admin', async () => {
        const res = await call(ctrl.updateMember, { uid: OWNER, body: { id: rowOf(MEMBER)._id, data: { roleType: 2 } } });
        expect(res.code).toBe(200);
        expect(rowOf(MEMBER).roleType).toBe(2);
    });

    it('lets an admin make a member a guest and change a designation', async () => {
        const res = await call(ctrl.updateMember, { uid: ADMIN, body: { id: rowOf(MEMBER)._id, data: { roleType: 0, designation: 2 } } });
        expect(res.code).toBe(200);
        expect(rowOf(MEMBER)).toMatchObject({ roleType: 0, designation: 2 });
    });

    it('refuses the owner changing their own role', async () => {
        const res = await call(ctrl.updateMember, { uid: OWNER, body: { id: rowOf(OWNER)._id, data: { roleType: 2 } } });
        expect(res.code).toBe(403);
        expect(rowOf(OWNER).roleType).toBe(1);
    });

    it('refuses an admin removing or changing the owner', async () => {
        const removed = await call(ctrl.updateMember, { uid: ADMIN, body: { id: rowOf(OWNER)._id, data: { isDelete: true } } });
        const demoted = await call(ctrl.updateMember, { uid: ADMIN, body: { id: rowOf(OWNER)._id, data: { roleType: 3 } } });
        expect([removed.code, demoted.code]).toEqual([403, 403]);
        expect(rowOf(OWNER)).toMatchObject({ roleType: 1, isDelete: false });
    });

    it('refuses removing the last owner', async () => {
        const res = await call(ctrl.updateMember, { uid: OWNER, body: { id: rowOf(OWNER)._id, data: { isDelete: true } } });
        expect(res.code).toBe(403);
        expect(rowOf(OWNER).isDelete).toBe(false);
    });

    it('lets an owner demote another owner while one owner remains', async () => {
        member(SECOND_OWNER, 1);
        const res = await call(ctrl.updateMember, { uid: OWNER, body: { id: rowOf(SECOND_OWNER)._id, data: { roleType: 2 } } });
        expect(res.code).toBe(200);
        expect(rowOf(SECOND_OWNER).roleType).toBe(2);
    });

    it('lets an admin remove a member', async () => {
        const res = await call(ctrl.updateMember, { uid: ADMIN, body: { id: rowOf(MEMBER)._id, data: { isDelete: true, isTrackerUser: false } } });
        expect(res.code).toBe(200);
        expect(rowOf(MEMBER).isDelete).toBe(true);
    });

    it('refuses moving a row to another user or company, even for the owner', async () => {
        const res = await call(ctrl.updateMember, { uid: OWNER, body: { id: rowOf(MEMBER)._id, data: { userId: GUEST, companyId: '6f00000000000000000000c2' } } });
        expect(res.code).toBe(403);
        expect(rowOf(MEMBER).userId).toBe(MEMBER);
    });
});

describe('INS-02 PUT /api/v1/root-members', () => {
    const seedInvite = (extra = {}) => {
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: INVITEE, Employee_Email: 'invitee@e2e.test', Employee_Name: 'In Vitee' });
        return mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
            userId: '', roleType: 2, status: 1, isDelete: false, companyId: CID, designation: 0, userEmail: 'invitee@e2e.test', ...extra,
        });
    };

    it('refuses a guest promoting themselves to admin', async () => {
        const res = await call(ctrl.rootUpdateMember, { uid: GUEST, companyId: undefined, body: { id: rowOf(GUEST)._id, data: { roleType: 2 }, companyId: CID } });
        expect(res.code).toBe(403);
        expect(res.body.status).toBe(false);
        expect(rowOf(GUEST).roleType).toBe(0);
    });

    it('accepts an invitation with the role stored on the invitation', async () => {
        const invite = seedInvite();
        const res = await call(ctrl.rootUpdateMember, { uid: INVITEE, companyId: undefined, body: { id: invite._id, data: { userId: INVITEE, status: 2 }, companyId: CID } });
        expect(res.code).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { roleType: 2, status: 2, userId: INVITEE } });
        expect(rowByEmail('invitee@e2e.test')).toMatchObject({ roleType: 2, status: 2, userId: INVITEE });
    });

    it('refuses a role sent with the acceptance', async () => {
        const invite = seedInvite({ roleType: 3 });
        const res = await call(ctrl.rootUpdateMember, { uid: INVITEE, companyId: undefined, body: { id: invite._id, data: { userId: INVITEE, status: 2, roleType: 1 }, companyId: CID } });
        expect(res.code).toBe(403);
        expect(rowByEmail('invitee@e2e.test')).toMatchObject({ roleType: 3, status: 1 });
    });

    it('refuses accepting an invitation sent to someone else', async () => {
        const invite = seedInvite();
        const res = await call(ctrl.rootUpdateMember, { uid: MEMBER, companyId: undefined, body: { id: invite._id, data: { userId: MEMBER, status: 2 }, companyId: CID } });
        expect(res.code).toBe(403);
        expect(rowByEmail('invitee@e2e.test').status).toBe(1);
    });

    it('refuses linking the invitation to another account', async () => {
        const invite = seedInvite();
        const res = await call(ctrl.rootUpdateMember, { uid: INVITEE, companyId: undefined, body: { id: invite._id, data: { userId: MEMBER, status: 2 }, companyId: CID } });
        expect(res.code).toBe(403);
        expect(rowByEmail('invitee@e2e.test').userId).toBe('');
    });

    it('refuses a cancelled invitation', async () => {
        const invite = seedInvite({ status: 3, isDelete: true });
        const res = await call(ctrl.rootUpdateMember, { uid: INVITEE, companyId: undefined, body: { id: invite._id, data: { userId: INVITEE, status: 2 }, companyId: CID } });
        expect(res.code).toBe(403);
        expect(rowByEmail('invitee@e2e.test').status).toBe(3);
    });
});

describe('INS-10 POST /api/v1/members/private-view', () => {
    it('refuses a member adding a view to another member', async () => {
        const res = await call(ctrl.handlePrivateView, { uid: MEMBER, body: { id: rowOf(OTHER_MEMBER)._id, operation: 'push', data: { id: 'x', name: 'Planted' } } });
        expect(res.code).toBe(403);
        expect(rowOf(OTHER_MEMBER).ProjectRequiredComponent).toEqual([{ id: 'mine', name: 'Mine' }]);
    });

    it('refuses the owner editing a member private view', async () => {
        const res = await call(ctrl.handlePrivateView, { uid: OWNER, body: { id: rowOf(OTHER_MEMBER)._id, operation: 'delete', data: { id: 'mine' } } });
        expect(res.code).toBe(403);
    });

    it('lets a member add a view to their own row', async () => {
        const res = await call(ctrl.handlePrivateView, { uid: MEMBER, body: { id: rowOf(MEMBER)._id, operation: 'push', data: { id: 'v1', name: 'Board' } } });
        expect(res.code).toBe(200);
        expect(rowOf(MEMBER).ProjectRequiredComponent).toEqual([{ id: 'v1', name: 'Board' }]);
    });
});

describe('invitations and imports grant roles only as the caller may', () => {
    const { guardInvitation, guardUserImport } = require('../Modules/settings/Members/membershipGuard');
    const invite = (role, companyId = CID) => ({ email: 'new@e2e.test', companyId, companyName: 'E2E', role, designation: 0 });

    it.each([[MEMBER], [GUEST]])('refuses %s sending an invitation', async (uid) => {
        expect((await call(guardInvitation, { uid, body: invite(3) })).code).toBe(403);
    });

    it('refuses an admin inviting an admin or an owner', async () => {
        expect((await call(guardInvitation, { uid: ADMIN, body: invite(2) })).code).toBe(403);
        expect((await call(guardInvitation, { uid: ADMIN, body: invite(1) })).code).toBe(403);
    });

    it('lets an admin invite a member and the owner invite an admin', async () => {
        expect((await call(guardInvitation, { uid: ADMIN, body: invite(3) })).passed).toBe(true);
        expect((await call(guardInvitation, { uid: OWNER, body: invite(2) })).passed).toBe(true);
    });

    it('refuses an invitation into a company other than the session company', async () => {
        expect((await call(guardInvitation, { uid: OWNER, body: invite(3, '6f00000000000000000000c2') })).code).toBe(403);
    });

    it('refuses an admin importing an admin and lets the owner do it', async () => {
        const body = { users: [invite(3), invite(2)], eventId: 'e' };
        expect((await call(guardUserImport, { uid: ADMIN, body })).code).toBe(403);
        expect((await call(guardUserImport, { uid: MEMBER, body: { users: [invite(3)] } })).code).toBe(403);
        expect((await call(guardUserImport, { uid: OWNER, body })).passed).toBe(true);
    });
});
