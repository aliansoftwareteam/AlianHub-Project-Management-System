const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const ctrl = require('../Modules/settings/Members/controller');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const COLLEAGUE = '6f0000000000000000000013';
const LISTER = '6f0000000000000000000023';
const GUEST = '6f0000000000000000000004';
const REMOVED = '6f0000000000000000000033';
const INVITED_ACCOUNT = '6f0000000000000000000005';
const LISTER_ROLE = 5;
const LINK = 'b'.repeat(64);
const INVITED_EMAIL = 'invited@e2e.test';

const SHARED = ['_id', 'companyId', 'designation', 'isDelete', 'managerId', 'roleType', 'status', 'userEmail', 'userId'];
const OWN_ONLY = ['ProjectRequiredComponent', 'embedViews', 'dashboardLocked', 'aiRequestedCount'];
const MANAGED = ['workloadCapacity', 'isTrackerUser', 'isRestrict', 'sendInvitationTime', 'scimExternalId', 'createdAt'];

const rows = () => mockDb.store[SCHEMA_TYPE.COMPANY_USERS];
const stored = (userId) => rows().find((row) => row.userId === userId);

const call = async (handler, { uid, body = {}, params = {} }) => {
    const res = { code: 200, set: () => res };
    res.status = (code) => { res.code = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = res.json;
    await handler({ uid, headers: { companyid: CID }, body, params, query: {} }, res, () => {});
    return { code: res.code, body: res.body };
};

const seat = (userId, roleType, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId,
    roleType,
    status: 2,
    isDelete: false,
    companyId: CID,
    designation: 4,
    userEmail: `${userId}@e2e.test`,
    managerId: OWNER,
    linkId: '',
    sendInvitationTime: 1700000000,
    isTrackerUser: true,
    isRestrict: false,
    dashboardLocked: true,
    aiRequestedCount: 12,
    scimExternalId: `scim-${userId}`,
    workloadCapacity: { points: { value: 8, per: 'day' } },
    embedViews: { board: 'embed' },
    ProjectRequiredComponent: [{ id: `view-${userId}`, name: `Plan of ${userId}`, isPrivate: true, settings: { filter: 'mine' } }],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
});

const seedRules = (memberListRoles) => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'settings', name: 'settings', isParent: true, roles: [] });
    mockDb.seed(SCHEMA_TYPE.RULES, {
        key: 'settings_member_list', name: 'settings_member_list', isParent: false, parentId: String(parent._id), roles: memberListRoles,
    });
};

const list = async (uid) => (await call(ctrl.getMembers, { uid })).body.data;
const rowIn = (data, userId) => data.find((row) => row.userId === userId);
const byId = async (uid, id) => (await call(ctrl.getMembersById, { uid, params: { id } })).body;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    socketEmitter.emit.mockClear();
    seedRules([{ key: 3, permission: false }, { key: 0, permission: false }, { key: LISTER_ROLE, permission: true }]);
    seat(OWNER, 1, { managerId: '' });
    seat(ADMIN, 2);
    seat(MEMBER, 3);
    seat(COLLEAGUE, 3);
    seat(LISTER, LISTER_ROLE);
    seat(GUEST, 0);
    seat(REMOVED, 3, { isDelete: true });
    seat(INVITED_ACCOUNT, 3, { status: 1, linkId: LINK, userEmail: INVITED_EMAIL });
});

describe('GET /api/v1/members', () => {
    it('gives a member the fields the app shows of a colleague', async () => {
        const row = rowIn(await list(MEMBER), COLLEAGUE);

        expect(Object.keys(row).sort()).toEqual(SHARED);
        expect(row).toMatchObject({ userId: COLLEAGUE, roleType: 3, designation: 4, status: 2, isDelete: false, managerId: OWNER });
    });

    it('gives a member their own row with their own views and preferences', async () => {
        const row = rowIn(await list(MEMBER), MEMBER);

        expect(row.ProjectRequiredComponent).toEqual(stored(MEMBER).ProjectRequiredComponent);
        expect(row).toMatchObject({ dashboardLocked: true, aiRequestedCount: 12, workloadCapacity: stored(MEMBER).workloadCapacity, sendInvitationTime: 1700000000 });
        expect(row).not.toHaveProperty('linkId');
    });

    it('keeps one list for every row and names a removed member by id and role only', async () => {
        const data = await list(MEMBER);
        const removed = rowIn(data, REMOVED);

        expect(data).toHaveLength(rows().length);
        expect(Object.keys(removed).sort()).toEqual(['_id', 'companyId', 'designation', 'isDelete', 'roleType', 'status', 'userId']);
    });

    it('gives a member the state of an open invitation and nothing else', async () => {
        const data = await list(MEMBER);
        const invitation = data.find((row) => row.status === 1);

        expect(Object.keys(invitation).sort()).toEqual(['_id', 'companyId', 'isDelete', 'status']);
        expect(JSON.stringify(data)).not.toContain(LINK);
        expect(JSON.stringify(data)).not.toContain(INVITED_EMAIL);
    });

    it('gives a guest the people picker fields of a member', async () => {
        const row = rowIn(await list(GUEST), COLLEAGUE);

        expect(Object.keys(row).sort()).toEqual(['_id', 'companyId', 'designation', 'isDelete', 'roleType', 'status', 'userId']);
    });

    it('gives a guest their own row in full', async () => {
        const row = rowIn(await list(GUEST), GUEST);

        expect(row.ProjectRequiredComponent).toEqual(stored(GUEST).ProjectRequiredComponent);
        expect(row.userEmail).toBe(stored(GUEST).userEmail);
    });

    it.each([['owner', OWNER], ['admin', ADMIN]])('gives an %s the member management fields and the invitation link', async (label, uid) => {
        const data = await list(uid);
        const row = rowIn(data, COLLEAGUE);
        const invitation = data.find((entry) => entry.status === 1);

        MANAGED.forEach((field) => expect(row).toHaveProperty(field));
        OWN_ONLY.forEach((field) => expect(row).not.toHaveProperty(field));
        expect(invitation).toMatchObject({ userEmail: INVITED_EMAIL, linkId: LINK, roleType: 3, designation: 4 });
        expect(invitation).not.toHaveProperty('userId');
    });

    it('gives a role that may open the member list the management fields without the invitation link', async () => {
        const data = await list(LISTER);
        const row = rowIn(data, COLLEAGUE);
        const invitation = data.find((entry) => entry.status === 1);

        MANAGED.forEach((field) => expect(row).toHaveProperty(field));
        OWN_ONLY.forEach((field) => expect(row).not.toHaveProperty(field));
        expect(invitation.userEmail).toBe(INVITED_EMAIL);
        expect(invitation).not.toHaveProperty('linkId');
    });

    it('gives a caller without a seat the picker fields only', async () => {
        const row = rowIn(await list('6f00000000000000000000ff'), COLLEAGUE);

        expect(Object.keys(row).sort()).toEqual(['_id', 'companyId', 'designation', 'isDelete', 'roleType', 'status', 'userId']);
    });
});

describe('GET /api/v1/members/:id', () => {
    it('gives a member the same colleague fields as the list', async () => {
        expect(Object.keys(await byId(MEMBER, COLLEAGUE)).sort()).toEqual(SHARED);
    });

    it('gives a member their own row', async () => {
        const row = await byId(MEMBER, MEMBER);

        expect(row).toMatchObject({ userId: MEMBER, roleType: 3 });
        expect(row.ProjectRequiredComponent).toEqual(stored(MEMBER).ProjectRequiredComponent);
    });

    it('gives an owner the management fields', async () => {
        const row = await byId(OWNER, COLLEAGUE);

        MANAGED.forEach((field) => expect(row).toHaveProperty(field));
        OWN_ONLY.forEach((field) => expect(row).not.toHaveProperty(field));
    });

    it('answers nothing for an account that has not accepted its invitation', async () => {
        expect(await byId(MEMBER, INVITED_ACCOUNT)).toBeNull();
    });
});

describe('POST /api/v1/members/count', () => {
    const count = (uid, query) => call(ctrl.getMembersCount, { uid, body: { query } });

    it('counts by role', async () => {
        const res = await count(MEMBER, { roleType: 3 });

        expect(res.code).toBe(200);
        expect(res.body[0].totalCount).toBe(4);
    });

    it('counts every row for an empty filter', async () => {
        expect((await count(MEMBER, {})).body[0].totalCount).toBe(rows().length);
    });

    it.each([
        ['a field outside the countable ones', { linkId: LINK }],
        ['a pattern', { userEmail: { $regex: '^inv' } }],
        ['a nested field', { 'ProjectRequiredComponent.name': `Plan of ${COLLEAGUE}` }],
        ['a logical operator', { $or: [{ linkId: LINK }] }],
        ['an expression', { $expr: { $eq: ['$linkId', LINK] } }],
        ['a pattern on a countable field', { roleType: { $regex: '3' } }],
    ])('refuses %s', async (label, query) => {
        const res = await count(MEMBER, query);

        expect(res.code).toBe(400);
        expect(res.body.status).toBe(false);
    });
});

describe('GET /api/v1/members/:key/:value', () => {
    const inUse = (key, value) => call(ctrl.checkRoleOrDesignationAssignedWithUsers, { uid: MEMBER, params: { key, value } });

    it('answers for a role and a designation', async () => {
        expect((await inUse('roleType', '3')).body).toEqual({ isUsed: true });
        expect((await inUse('designation', '9')).body).toEqual({ isUsed: false });
    });

    it.each([['linkId', LINK], ['userEmail', INVITED_EMAIL], ['roleType', 'abc']])('refuses %s', async (key, value) => {
        expect((await inUse(key, value)).code).toBe(400);
    });
});

describe('PUT /api/v1/members', () => {
    it('answers a member locking their dashboard with their own row', async () => {
        const res = await call(ctrl.updateMember, { uid: MEMBER, body: { id: stored(MEMBER)._id, data: { dashboardLocked: false } } });

        expect(res.code).toBe(200);
        expect(res.body.data).toMatchObject({ userId: MEMBER, dashboardLocked: false });
        expect(res.body.data).not.toHaveProperty('linkId');
    });

    it('announces a change with the fields every member reads', async () => {
        await call(ctrl.updateMember, { uid: OWNER, body: { id: stored(COLLEAGUE)._id, data: { designation: 2 } } });

        const announced = socketEmitter.emit.mock.calls.find(([, payload]) => payload.module === 'companyUsers')[1].data.data;
        expect(Object.keys(announced).sort()).toEqual(SHARED);
    });

    it('answers an owner with the management fields of the changed member', async () => {
        const res = await call(ctrl.updateMember, { uid: OWNER, body: { id: stored(COLLEAGUE)._id, data: { designation: 2 } } });

        expect(res.body.data).toMatchObject({ designation: 2, isTrackerUser: true });
        OWN_ONLY.forEach((field) => expect(res.body.data).not.toHaveProperty(field));
    });
});
