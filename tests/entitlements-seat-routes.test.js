process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (db) => (mockDbs[db] = mockDbs[db] || create());
const mockCrud = async (db, query, method) => mockDbFor(String(db)).crud(db, query, method);

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => {}) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: async (db, query, method) => ({ message: 'user updated', data: await mockCrud(db, query, method) }) }));
jest.mock('../Modules/settings/Members/controller', () => ({
    updateMemberFunction: async (companyId, data, method) => ({ data: (await mockCrud(companyId, { type: 'company_users', data }, method)) || {} }),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const hostingMode = require('../Config/hostingMode');
const platformState = require('../Modules/Platform/platformState');
const platformEntitlements = require('../Modules/Platform/entitlements');
const seats = require('../Modules/Entitlements/seats');
const { acceptSignedIn, checkPermission } = require('../Modules/Auth/controller/verifyInvitation');
const { jitProvisionUser } = require('../Modules/SSO/provisioning');

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const COMPANY = '6f0000000000000000000c01';
const SECOND = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000002';
const INVITEE = '6f0000000000000000000001';
const INVITATION = '6f0000000000000000000a01';
const TOKEN = 'a'.repeat(64);
const EMAIL = 'invitee@own.test';
const saved = { HOSTING_MODE: process.env.HOSTING_MODE };

const reply = () => {
    const res = { statusCode: 200, headersSent: false };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.headersSent = true; return res; };
    res.send = res.json;
    return res;
};
const invitation = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS].find((row) => String(row._id) === INVITATION);
const acceptOnThePage = async () => {
    const res = reply();
    await acceptSignedIn({ uid: INVITEE, body: { companyId: COMPANY, memberId: INVITATION, linkId: TOKEN } }, res);
    return res;
};
const followTheMailedLink = async () => {
    const res = reply();
    const id = Buffer.from(`userId=${INVITEE}&companyId=${COMPANY}&docId=${INVITATION}&linkId=${TOKEN}`).toString('base64');
    await checkPermission({ body: { id } }, res);
    return res;
};

const withSeats = async (limit, mode = 'managed') => {
    process.env.HOSTING_MODE = mode;
    hostingMode._resetForTests();
    platformState._useStoreForTests(platformState.memoryStore({ entitlements: { version: 1, payload: { version: 1, plan: 'starter', limits: { seats: limit, guests: 5 }, features: {} } } }));
    platformEntitlements._resetForTests();
    if (mode === 'managed') await platformEntitlements.loadEntitlements();
    seats.forgetSeats();
};

beforeEach(async () => {
    Object.keys(mockDbs).forEach((db) => delete mockDbs[db]);
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.USERS, { _id: INVITEE, Employee_Email: EMAIL, isEmailVerified: true, isActive: true, AssignCompany: [] });
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY, userId: OWNER, Cst_CompanyName: 'Acme' });
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: SECOND, userId: OWNER, Cst_CompanyName: 'Acme Labs' });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, userEmail: 'owner@own.test', roleType: 1, status: 2, isDelete: false });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, {
        _id: INVITATION, companyId: COMPANY, userId: '', userEmail: EMAIL, roleType: 3, status: 1, isDelete: false, linkId: TOKEN, sendInvitationTime: Date.now(),
    });
    await withSeats(1);
});

afterAll(() => {
    if (saved.HOSTING_MODE === undefined) delete process.env.HOSTING_MODE; else process.env.HOSTING_MODE = saved.HOSTING_MODE;
    hostingMode._resetForTests();
    platformState._useStoreForTests(null);
});

describe.each([
    ['on the invitation page', acceptOnThePage],
    ['by the mailed link', followTheMailedLink],
])('accepting an invitation %s on a full plan', (label, accept) => {
    it('is refused with seat_limit and the invitation still waits', async () => {
        const res = await accept();
        expect(res.body).toMatchObject({ status: false, code: 'seat_limit', limit: 1, used: 1 });
        expect(invitation()).toMatchObject({ status: 1, linkId: TOKEN });
    });

    it('goes through for someone who already holds a seat in another workspace', async () => {
        mockDbFor(SECOND).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITEE, userEmail: EMAIL, roleType: 3, status: 2, isDelete: false });
        mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS][0].status = 3;
        await withSeats(1);
        const res = await accept();
        expect(res.body.status).toBe(true);
        expect(invitation()).toMatchObject({ status: 2, userId: INVITEE });
    });

    it('goes through once the plan has room', async () => {
        await withSeats(2);
        expect((await accept()).body.status).toBe(true);
    });

    it('goes through self-hosted whatever the numbers', async () => {
        await withSeats(1, 'self');
        expect((await accept()).body.status).toBe(true);
    });
});

describe('SSO just-in-time sign-up on a full plan', () => {
    it('is refused before any account or seat is made', async () => {
        await expect(jitProvisionUser({ companyId: COMPANY, email: 'new@own.test' })).rejects.toMatchObject({ code: 'seat_limit', planLimit: true });
        expect(mockDbFor(GLOBAL).store[SCHEMA_TYPE.USER_AUTH] || []).toHaveLength(0);
    });

    it('links an existing member of another workspace without a new seat', async () => {
        mockDbFor(GLOBAL).seed(SCHEMA_TYPE.USER_AUTH, { _id: INVITEE, email: EMAIL });
        mockDbFor(SECOND).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITEE, userEmail: EMAIL, roleType: 3, status: 2, isDelete: false });
        mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS][0].status = 3;
        await withSeats(1);
        await expect(jitProvisionUser({ companyId: COMPANY, email: EMAIL })).resolves.toBe(INVITEE);
    });
});
