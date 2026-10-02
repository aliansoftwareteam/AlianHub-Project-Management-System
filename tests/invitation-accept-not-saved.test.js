const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockRefusals = [];
const mockDbFor = (db) => (mockDbs[db] = mockDbs[db] || create());
const mockCrud = async (db, query, method) => {
    if (mockRefusals.some((rule) => rule.db === String(db) && rule.type === query.type && rule.method === method)) {
        throw new Error(`the database refused ${method} on ${query.type}`);
    }
    return mockDbFor(String(db)).crud(db, query, method);
};

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => {}) }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: async (db, query, method) => ({ message: 'user updated', data: await mockCrud(db, query, method) }) }));
jest.mock('../Modules/settings/Members/controller', () => ({
    updateMemberFunction: async (companyId, data, method) => ({ data: (await mockCrud(companyId, { type: 'company_users', data }, method)) || {} }),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { importUserNotifications } = require('../utils/data');
const { acceptSignedIn, checkPermission } = require('../Modules/Auth/controller/verifyInvitation');

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const COMPANY = '6f0000000000000000000c01';
const INVITEE = '6f0000000000000000000001';
const FIRST_OWNER = '6f0000000000000000000002';
const INVITATION = '6f0000000000000000000a01';
const TOKEN = 'a'.repeat(64);
const EMAIL = 'invitee@own.test';

const reply = () => {
    const res = { statusCode: 200, headersSent: false };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.headersSent = true; return res; };
    return res;
};
const refuse = (db, type, method) => mockRefusals.push({ db, type, method });
const invitation = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.COMPANY_USERS][0];
const accountRow = () => mockDbFor(GLOBAL).store[SCHEMA_TYPE.USERS][0];
const companyRow = () => mockDbFor(GLOBAL).store[SCHEMA_TYPE.COMPANIES][0];

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
const invite = (roleType) => mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, {
    _id: INVITATION, companyId: COMPANY, userId: '', userEmail: EMAIL, roleType, status: 1, isDelete: false, linkId: TOKEN, sendInvitationTime: Date.now(),
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((db) => delete mockDbs[db]);
    mockRefusals.length = 0;
    importUserNotifications.mockClear();
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.USERS, { _id: INVITEE, Employee_Email: EMAIL, isEmailVerified: true, isActive: true, AssignCompany: [] });
    mockDbFor(GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY, userId: FIRST_OWNER, Cst_CompanyName: 'Acme' });
});

describe.each([
    ['on the invitation page', acceptOnThePage],
    ['by the mailed link', followTheMailedLink],
])('accepting %s', (label, accept) => {
    test('joins the workspace: the seat is taken and the account names the company', async () => {
        invite(3);

        const res = await accept();

        expect(res.body.status).toBe(true);
        expect(invitation()).toMatchObject({ status: 2, userId: INVITEE, linkId: '' });
        expect(accountRow().AssignCompany).toEqual([COMPANY]);
    });

    test('when the company cannot be put on the account, nothing says joined and the invitation still waits', async () => {
        invite(3);
        refuse(GLOBAL, SCHEMA_TYPE.USERS, 'updateOne');

        const res = await accept();

        expect(res.body.status).toBe(false);
        expect(res.statusCode).toBe(500);
        expect(invitation()).toMatchObject({ status: 1, userId: '', linkId: TOKEN });
        expect(accountRow().AssignCompany).toEqual([]);
        expect(importUserNotifications).not.toHaveBeenCalled();
    });

    test('the invitation that was not saved can be accepted on the next try', async () => {
        invite(3);
        refuse(GLOBAL, SCHEMA_TYPE.USERS, 'updateOne');
        await accept();
        mockRefusals.length = 0;

        const res = await accept();

        expect(res.body.status).toBe(true);
        expect(invitation()).toMatchObject({ status: 2, userId: INVITEE });
    });

    test('an owner invitation whose new owner cannot be recorded is not accepted, and the account does not name the company', async () => {
        invite(1);
        refuse(GLOBAL, SCHEMA_TYPE.COMPANIES, 'findOneAndUpdate');

        const res = await accept();

        expect(res.body.status).toBe(false);
        expect(res.statusCode).toBe(500);
        expect(invitation()).toMatchObject({ status: 1, userId: '', linkId: TOKEN });
        expect(accountRow().AssignCompany).toEqual([]);
        expect(String(companyRow().userId)).toBe(FIRST_OWNER);
    });

    test('an owner invitation records the new owner', async () => {
        invite(1);

        const res = await accept();

        expect(res.body.status).toBe(true);
        expect(String(companyRow().userId)).toBe(INVITEE);
    });
});
