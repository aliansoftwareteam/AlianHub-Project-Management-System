const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
/* The invitation path itself is covered end to end by the integration suite; here it only has to leave the row it leaves. */
jest.mock('../Modules/Auth/controller/sendInvitation', () => ({
    sendInvitationEmailFun: jest.fn(async ({ email, companyId, role, designation }) => {
        const { SCHEMA_TYPE: T } = require('../Config/schemaType');
        const account = (mockDbFor('global').store.users || []).find((u) => u.Employee_Email === email);
        const db = mockDbFor(String(companyId));
        const existing = (db.store[T.COMPANY_USERS] || []).find((r) => r.userEmail === email);
        if (existing) Object.assign(existing, { status: 1, isDelete: false, roleType: role, linkId: 'link' });
        const row = existing || db.seed(T.COMPANY_USERS, {
            companyId, userId: account ? String(account._id) : '', userEmail: email, roleType: role, designation, status: 1, isDelete: false, linkId: 'link',
        });
        return { status: false, statusText: 'mail is not configured', data: row };
    }),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { SEAT_ACTIVE, SEAT_PENDING } = require('../Config/seatStatus');
const { companyUserSchema } = require('../utils/mongo-handler/createSchema');
const { sendInvitationEmailFun } = require('../Modules/Auth/controller/sendInvitation');
const scim = require('../Modules/Scim/controller');

const A = '6f00000000000000000008a0';
const B = '6f00000000000000000008b0';
const OUTSIDER = '6f00000000000000000008e1';
const MEMBER = '6f00000000000000000008e2';
const ACME_USER = '6f00000000000000000008e3';

const globalDb = () => mockDbFor(dbCollections.GLOBAL);
const seatsIn = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.COMPANY_USERS] || [];
const rowFor = (companyId, email) => seatsIn(companyId).find((r) => r.userEmail === email);
const userRow = (uid) => (globalDb().store[dbCollections.USERS] || []).find((u) => String(u._id) === uid);
const snapshot = (value) => JSON.parse(JSON.stringify(value));

const seedAccount = (uid, email, companies, first, last) => {
    globalDb().seed(dbCollections.USER_AUTH, { _id: uid, email, isBlocked: false });
    globalDb().seed(dbCollections.USERS, {
        _id: uid, Employee_Email: email, Employee_FName: first, Employee_LName: last, Employee_Name: `${first} ${last}`,
        Employee_profileImage: 'https://cdn.test/private.png', AssignCompany: [...companies], isEmailVerified: true, isActive: true,
    });
};
const seedSeat = (companyId, uid, email, over = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, {
    companyId, userId: uid, userEmail: email, roleType: 3, designation: 0, status: SEAT_ACTIVE, isDelete: false, ...over,
});

const send = async (handler, { params = {}, body = {}, query = {} } = {}) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = res.json;
    await handler({ scimCompanyId: A, scimConfig: { defaultRoleType: 3 }, params, body, query, headers: {}, get: () => 'scim.test' }, res);
    return res;
};
const create = (email, givenName = 'Req', familyName = 'Name', extra = {}) => send(scim.createUser, {
    body: { userName: email, name: { givenName, familyName }, active: true, externalId: `ext-${email}`, ...extra },
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
    globalDb().seed(dbCollections.COMPANIES, { _id: A, Cst_CompanyName: 'Acme' });
    seedAccount(OUTSIDER, 'pat@outside.test', [B], 'Pat', 'Outside');
    seedSeat(B, OUTSIDER, 'pat@outside.test');
    seedAccount(MEMBER, 'max@member.test', [A, B], 'Max', 'Member');
    seedSeat(A, MEMBER, 'max@member.test');
    seedSeat(B, MEMBER, 'max@member.test');
    seedAccount(ACME_USER, 'ann@acme.test', [B], 'Ann', 'Acme');
    seedSeat(B, ACME_USER, 'ann@acme.test');
    mockDbFor(A).seed(SCHEMA_TYPE.SSO_CONFIGS, {
        provider: 'oidc', isEnabled: true, deletedStatusKey: 0, domains: ['acme.test', 'outside.test'],
        domainVerificationToken: 'a'.repeat(40), verifiedDomains: [{ domain: 'acme.test', verifiedAt: new Date('2026-09-01T00:00:00Z') }],
    });
});

describe('the company member schema', () => {
    it('declares the SCIM name and external id kept on the member row', () => {
        ['scimGivenName', 'scimFamilyName', 'scimExternalId'].forEach((path) => expect(companyUserSchema.path(path)).toBeTruthy());
    });
});

describe('SCIM create of an account from outside the company', () => {
    it('sends the normal invitation and leaves the account as it was', async () => {
        const before = snapshot(userRow(OUTSIDER));
        const res = await create('pat@outside.test');

        expect(res.code).toBe(201);
        expect(sendInvitationEmailFun).toHaveBeenCalledWith(expect.objectContaining({ email: 'pat@outside.test', companyId: A, companyName: 'Acme', role: 3 }));
        expect(rowFor(A, 'pat@outside.test')).toMatchObject({ status: SEAT_PENDING, isDelete: false });
        expect(seatsIn(A).some((r) => r.userEmail === 'pat@outside.test' && r.status === SEAT_ACTIVE)).toBe(false);
        expect(snapshot(userRow(OUTSIDER))).toEqual(before);
    });

    it('answers from the request, not from the account', async () => {
        const res = await create('pat@outside.test');
        const text = JSON.stringify(res.body);

        expect(res.body).toMatchObject({ userName: 'pat@outside.test', active: false, name: { givenName: 'Req', familyName: 'Name' }, externalId: 'ext-pat@outside.test' });
        expect(res.body.id).not.toBe(OUTSIDER);
        ['Pat', 'Outside', 'private.png', OUTSIDER].forEach((shared) => expect(text).not.toContain(shared));
    });

    it('keeps answering from the member row until the invitation is accepted', async () => {
        const { body: { id } } = await create('pat@outside.test');

        const read = await send(scim.getUser, { params: { id } });
        expect(read.code).toBe(200);
        expect(read.body.name).toMatchObject({ givenName: 'Req', familyName: 'Name' });
        expect(JSON.stringify(read.body)).not.toContain('Outside');

        const list = await send(scim.listUsers, { query: { filter: 'userName eq "pat@outside.test"' } });
        expect(list.body.Resources).toHaveLength(1);
        expect(JSON.stringify(list.body)).not.toContain('Outside');
    });

    it('does not let an activation skip the invitation', async () => {
        const { body: { id } } = await create('pat@outside.test');

        await send(scim.patchUser, { params: { id }, body: { Operations: [{ op: 'replace', value: { active: true } }] } });
        expect(rowFor(A, 'pat@outside.test').status).toBe(SEAT_PENDING);

        await send(scim.patchUser, { params: { id }, body: { Operations: [{ op: 'replace', value: { active: false } }] } });
        await send(scim.replaceUser, { params: { id }, body: { active: true } });
        expect(rowFor(A, 'pat@outside.test').status).not.toBe(SEAT_ACTIVE);
        expect(userRow(OUTSIDER).AssignCompany).toEqual([B]);
    });

    it('invites a brand-new address on a domain the company has not verified', async () => {
        const res = await create('new@outside.test');
        expect(res.code).toBe(201);
        expect(rowFor(A, 'new@outside.test')).toMatchObject({ status: SEAT_PENDING, userId: '' });
        expect((globalDb().store[dbCollections.USER_AUTH] || []).some((u) => u.email === 'new@outside.test')).toBe(false);
    });
});

describe('SCIM create on a verified domain', () => {
    it('gives an existing account an active seat without touching its shared name', async () => {
        const res = await create('ann@acme.test', 'Annie', 'Corp');

        expect(res.code).toBe(201);
        expect(sendInvitationEmailFun).not.toHaveBeenCalled();
        expect(rowFor(A, 'ann@acme.test')).toMatchObject({ status: SEAT_ACTIVE, isDelete: false, userId: ACME_USER });
        expect(userRow(ACME_USER).AssignCompany).toEqual([B, A]);
        expect(userRow(ACME_USER).Employee_Name).toBe('Ann Acme');
        expect(res.body).toMatchObject({ id: ACME_USER, active: true, name: { givenName: 'Annie', familyName: 'Corp' } });
    });

    it('creates a brand-new account with an active seat', async () => {
        const res = await create('new@acme.test', 'New', 'Hire');
        expect(res.code).toBe(201);
        expect(rowFor(A, 'new@acme.test')).toMatchObject({ status: SEAT_ACTIVE });
        expect(res.body).toMatchObject({ active: true, name: { givenName: 'New', familyName: 'Hire' } });
    });
});

describe('SCIM rename', () => {
    it.each([
        ['PATCH', () => send(scim.patchUser, { params: { id: MEMBER }, body: { Operations: [{ op: 'replace', path: 'name.givenName', value: 'Maxine' }, { op: 'replace', path: 'name.familyName', value: 'Renamed' }] } })],
        ['PUT', () => send(scim.replaceUser, { params: { id: MEMBER }, body: { name: { givenName: 'Maxine', familyName: 'Renamed' } } })],
    ])('by %s changes what this company reads, not what other companies see', async (verb, rename) => {
        const shared = snapshot(userRow(MEMBER));

        const res = await rename();
        expect(res.code).toBe(200);
        expect(res.body.name).toMatchObject({ givenName: 'Maxine', familyName: 'Renamed' });

        expect(snapshot(userRow(MEMBER))).toEqual(shared);
        expect(rowFor(A, 'max@member.test')).toMatchObject({ scimGivenName: 'Maxine', scimFamilyName: 'Renamed' });
        expect(rowFor(B, 'max@member.test').scimGivenName).toBeUndefined();

        const read = await send(scim.getUser, { params: { id: MEMBER } });
        expect(read.body.name).toMatchObject({ givenName: 'Maxine', familyName: 'Renamed', formatted: 'Maxine Renamed' });
    });

    it('still reads the shared name for a member the IdP never renamed', async () => {
        const read = await send(scim.getUser, { params: { id: MEMBER } });
        expect(read.body.name).toMatchObject({ givenName: 'Max', familyName: 'Member' });
    });
});

/* Before #911 a SCIM POST with active:false left a deactivated seat for any address. Such a row is not a
 * membership: only an invitation, ownership or a verified domain made someone one of the company's people. */
describe('a deactivated seat SCIM left for someone outside the company', () => {
    const SCIM_DEACTIVATED = 0;
    const leftByScim = (uid, email, over = {}) => seedSeat(A, uid, email, { status: SCIM_DEACTIVATED, isDelete: true, ...over });

    it('does not let a SCIM create seat the account; it gets the invitation', async () => {
        leftByScim(OUTSIDER, 'pat@outside.test');
        const before = snapshot(userRow(OUTSIDER));

        const res = await create('pat@outside.test');

        expect(res.code).toBe(201);
        expect(sendInvitationEmailFun).toHaveBeenCalledWith(expect.objectContaining({ email: 'pat@outside.test', companyId: A }));
        expect(rowFor(A, 'pat@outside.test').status).toBe(SEAT_PENDING);
        expect(snapshot(userRow(OUTSIDER))).toEqual(before);
    });

    it.each([
        ['PATCH', () => send(scim.patchUser, { params: { id: OUTSIDER }, body: { Operations: [{ op: 'replace', value: { active: true } }] } })],
        ['PUT', () => send(scim.replaceUser, { params: { id: OUTSIDER }, body: { active: true } })],
    ])('does not let a %s activation turn it into a seat', async (_verb, activate) => {
        leftByScim(OUTSIDER, 'pat@outside.test');

        const res = await activate();

        expect(res.code).toBe(200);
        expect(res.body.active).toBe(false);
        expect(rowFor(A, 'pat@outside.test')).toMatchObject({ status: SCIM_DEACTIVATED, isDelete: true });
    });

    it.each([
        ['came in through an invitation', 'pat@outside.test', OUTSIDER, { sendInvitationTime: Date.parse('2026-08-01T00:00:00Z') }],
        ['owns the company', 'pat@outside.test', OUTSIDER, { roleType: 1 }],
        ['is on a verified domain', 'ann@acme.test', ACME_USER, {}],
    ])('still reactivates a member who %s', async (_why, email, uid, over) => {
        leftByScim(uid, email, over);

        const created = await create(email);
        expect(created.code).toBe(201);
        expect(sendInvitationEmailFun).not.toHaveBeenCalled();
        expect(rowFor(A, email)).toMatchObject({ status: SEAT_ACTIVE, isDelete: false });

        await send(scim.patchUser, { params: { id: uid }, body: { Operations: [{ op: 'replace', value: { active: false } }] } });
        const again = await send(scim.patchUser, { params: { id: uid }, body: { Operations: [{ op: 'replace', value: { active: true } }] } });
        expect(again.body.active).toBe(true);
    });

    it('still reactivates a member SCIM deactivated from an active seat, whatever brought them in', async () => {
        seedSeat(A, OUTSIDER, 'pat@outside.test');

        await send(scim.patchUser, { params: { id: OUTSIDER }, body: { Operations: [{ op: 'replace', value: { active: false } }] } });
        expect(rowFor(A, 'pat@outside.test')).toMatchObject({ status: SCIM_DEACTIVATED, isDelete: true });

        const again = await send(scim.patchUser, { params: { id: OUTSIDER }, body: { Operations: [{ op: 'replace', value: { active: true } }] } });
        expect(again.body.active).toBe(true);
        expect(rowFor(A, 'pat@outside.test')).toMatchObject({ status: SEAT_ACTIVE, isDelete: false });
    });
});
