jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn() }));
jest.mock('../Modules/Company/eventController.js', () => ({ emitListener: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany.js', () => ({ updateCompanyFun: jest.fn(async () => ({})), getCompanyDataFun: jest.fn() }));
jest.mock('../Modules/settings/Members/controller.js', () => ({ updateMemberFunction: jest.fn(async () => ({})) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../Config/permissionGuard');
const { updateCompanyFun } = require('../Modules/Company/controller/updateCompany.js');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const invitation = require('../Modules/Auth/controller/sendInvitation');
const loginSession = require('../Modules/Auth/controller/loginSession');
const users = require('../Modules/Users/controller');

const COMPANY = '6f0000000000000000000d01';
const OTHER_COMPANY = '6f0000000000000000000d02';
const ADMIN = '6f0000000000000000000e01';
const MEMBER = '6f0000000000000000000e02';
const OTHER_USER = '6f0000000000000000000e03';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
};
const request = ({ body = {}, headers = { companyid: COMPANY }, uid = MEMBER, aud = COMPANY } = {}) => ({ body, headers, uid, aud });
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const roles = { [ADMIN]: 2, [MEMBER]: 3 };

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async () => null);
    updateCompanyFun.mockClear();
    getRoleType.mockReset();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY ? roles[uid] || null : null));
});

describe('POST /api/v1/checkSendInviatation takes the company from the verified request', () => {
    it('refuses a body company outside the session when no header names one', async () => {
        const res = response();
        await invitation.checkSendInviatation(request({ headers: {}, body: { email: 'x@example.com', companyId: OTHER_COMPANY } }), res);
        await settle();

        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('checks the header company for a normal call', async () => {
        const res = response();
        await invitation.checkSendInviatation(request({ body: { email: 'x@example.com', companyId: COMPANY } }), res);
        await settle();

        expect(res.body).toMatchObject({ status: true, furtherProceed: true });
        expect(MongoDbCrudOpration.mock.calls[0][0]).toBe(COMPANY);
    });
});

describe('POST /api/v2/sendInvitationEmail takes the company from the verified request', () => {
    const invite = (companyId) => ({ email: 'new@example.com', companyId, companyName: 'Acme', role: 3, designation: 'Dev' });

    it('refuses a body naming another company and counts no seat anywhere', async () => {
        const res = response();
        invitation.sendInvitationEmail(request({ uid: ADMIN, body: invite(OTHER_COMPANY) }), res);
        await settle();

        expect(res.statusCode).toBe(403);
        expect(updateCompanyFun).not.toHaveBeenCalled();
    });

    it('counts the seat in the header company for a normal call', async () => {
        invitation.sendInvitationEmail(request({ uid: ADMIN, body: invite(COMPANY) }), response());
        await settle();

        expect(updateCompanyFun).toHaveBeenCalled();
        expect(updateCompanyFun.mock.calls.every((call) => call[3] === COMPANY)).toBe(true);
    });
});

describe('POST /api/v1/removeUserNotification acts for the caller, or for others only as an admin', () => {
    const notify = (uid, body) => {
        const res = response();
        loginSession.removeUserNotification(request({ uid, body: { companyId: COMPANY, ...body } }), res);
        return settle().then(() => res);
    };
    const writes = () => MongoDbCrudOpration.mock.calls.filter(([, obj]) => obj.type === SCHEMA_TYPE.USERID);

    it('adds the caller to the notification count of the session company', async () => {
        await notify(MEMBER, { userId: MEMBER, type: 'Add' });

        expect(writes()).toHaveLength(1);
        expect(writes()[0][0]).toBe(COMPANY);
        expect(writes()[0][1].data).toEqual({ userId: MEMBER });
    });

    it('refuses adding someone else', async () => {
        const res = await notify(MEMBER, { userId: OTHER_USER, type: 'Add' });

        expect(res.statusCode).toBe(403);
        expect(writes()).toHaveLength(0);
    });

    it('refuses a member removing someone else', async () => {
        const res = await notify(MEMBER, { userId: OTHER_USER });

        expect(res.statusCode).toBe(403);
        expect(writes()).toHaveLength(0);
    });

    it('lets an admin remove a member they took out of the company', async () => {
        await notify(ADMIN, { userId: OTHER_USER });

        expect(writes()).toHaveLength(1);
        expect(writes()[0][0]).toBe(COMPANY);
        expect(writes()[0][2]).toBe('findOneAndDelete');
    });
});

describe('POST /api/v1/user/find takes the company from the verified request', () => {
    it('refuses a body company outside the session even for a member of it', async () => {
        myCache.set(`membership:${MEMBER}:${OTHER_COMPANY}`, true);
        const res = response();
        await users.getUserByQuey(request({ headers: {}, body: { query: {}, companyId: OTHER_COMPANY } }), res);

        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration.mock.calls.filter((call) => call[2] === 'aggregate')).toHaveLength(0);
    });

    it('lists the session company for a normal call', async () => {
        myCache.set(`membership:${MEMBER}:${COMPANY}`, true);
        MongoDbCrudOpration.mockImplementation(async (db, obj, method) => (method === 'aggregate' ? [] : null));
        const res = response();
        await users.getUserByQuey(request({ body: { query: {}, companyId: COMPANY } }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([]);
    });
});
