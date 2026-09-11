jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn() }));
jest.mock('../Modules/settings/Members/controller', () => ({ updateMemberFunction: jest.fn() }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn(), getUserByQueyFun: jest.fn() }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(), insertAuthFun: jest.fn() }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ sendVerificationEmailPromise: jest.fn(async () => undefined) }));
jest.mock('../Modules/storage/server/helpers/bucket.helper.js', () => ({}));

const path = require('path');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { importUserNotifications } = require('../utils/data');
const { getRoleType } = require('../Config/permissionGuard');
const { mongoOperation } = require('../Modules/Auth/controller/mongoOperation');
const { updateTask } = require('../Modules/Tasks/helpers/getTasksData');
const { resolveBucketFile } = require('../Modules/storage/server/controller');
const { importSettingsNotification } = require('../Modules/ImportSettings/controller');
const { changePassword } = require('../Modules/Auth/controller/password');
const { deleteUserSpecificSession } = require('../Modules/Auth/session');
const createUser = require('../Modules/Auth/controller/createUser');
const { invitationPreview } = require('../Modules/Auth/controller/invitationPreview');
const trackerPermission = require('../Modules/trackerUserPermission/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const USER = '6f0000000000000000000001';
const OTHER_USER = '6f0000000000000000000002';
const MEMBER_ROW = '6f00000000000000000000a1';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const request = ({ body = {}, params = {}, companyId = COMPANY, uid = USER } = {}) => ({ body, params, headers: { companyid: companyId }, uid });
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockResolvedValue([]);
});

describe('mongoOperation reads only the caller company', () => {
    const body = (overrides) => ({ dbName: COMPANY, collection: 'tasks', methodName: 'find', dataObj: [{}], ...overrides });

    it('refuses another database', async () => {
        const res = response();
        await mongoOperation(request({ body: body({ dbName: 'global', collection: 'users' }) }), res);
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses another company database', async () => {
        const res = response();
        await mongoOperation(request({ body: body({ dbName: OTHER_COMPANY }) }), res);
        expect(res.statusCode).toBe(403);
    });

    it.each(['deleteMany', 'updateMany', 'findOneAndUpdate', 'save', 'insertMany'])('refuses %s', async (methodName) => {
        const res = response();
        await mongoOperation(request({ body: body({ methodName }) }), res);
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it.each(['$out', '$merge'])('refuses a pipeline that writes with %s', async (stage) => {
        const res = response();
        await mongoOperation(request({ body: body({ methodName: 'aggregate', dataObj: [[{ $match: {} }, { [stage]: 'copy' }]] }) }), res);
        expect(res.statusCode).toBe(403);
    });

    it('runs a read on the caller company', async () => {
        const res = response();
        await mongoOperation(request({ body: body({ methodName: 'aggregate', dataObj: [[{ $match: { TicketID: 't1' } }]] }) }), res);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ type: 'tasks' }), 'aggregate');
        expect(res.body).toEqual({ status: true, statusText: [] });
    });
});

describe('PUT /api/v1/task only updates', () => {
    const body = (key) => ({ firstParameter: { _id: 't1' }, secondParameter: { $set: { a: 1 } }, key });

    it.each(['deleteMany', 'find', 'aggregate', 'findOneAndDelete'])('refuses %s', async (key) => {
        const res = response();
        await updateTask(request({ body: body(key) }), res);
        expect(res.statusCode).toBe(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('runs updateMany', async () => {
        const res = response();
        await updateTask(request({ body: body('updateMany') }), res);
        expect(MongoDbCrudOpration).toHaveBeenCalledWith(COMPANY, expect.anything(), 'updateMany');
    });
});

describe('storage download stays inside its bucket', () => {
    it('resolves a file in the bucket', () => {
        expect(resolveBucketFile(COMPANY, 'project/a.png')).toMatch(new RegExp(`storage\\${path.sep}${COMPANY}\\${path.sep}project`));
    });

    it.each([
        ['USER_PROFILES', `../${COMPANY}/project/a.png`],
        [COMPANY, '../../package.json'],
        [COMPANY, '/etc/passwd'],
        ['..', 'package.json'],
        [COMPANY, ''],
    ])('refuses bucket %s with path %s', (bucketId, filepath) => {
        expect(resolveBucketFile(bucketId, filepath)).toBe('');
    });
});

describe('importSettingsNotification only imports for the caller', () => {
    it('refuses another user', () => {
        const res = response();
        importSettingsNotification(request({ body: { companyId: COMPANY, userId: OTHER_USER } }), res);
        expect(res.statusCode).toBe(403);
        expect(importUserNotifications).not.toHaveBeenCalled();
    });

    it('refuses another company', () => {
        const res = response();
        importSettingsNotification(request({ body: { companyId: OTHER_COMPANY, userId: USER } }), res);
        expect(res.statusCode).toBe(403);
    });

    it('imports for the caller', async () => {
        const res = response();
        importSettingsNotification(request({ body: { companyId: COMPANY, userId: USER } }), res);
        await settle();
        expect(importUserNotifications).toHaveBeenCalledWith(COMPANY, USER);
        expect(res.body.status).toBe(true);
    });
});

describe('a session acts only on its own account', () => {
    it("refuses changing another user's password", () => {
        const res = response();
        changePassword(request({ params: { id: OTHER_USER }, body: { oldPassword: 'a', newPassword: 'b' } }), res);
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it("refuses ending another user's sessions", () => {
        const res = response();
        deleteUserSpecificSession(request({ params: { id: OTHER_USER } }), res);
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});

describe('signup honours assignCompany only with a pending invitation', () => {
    it('does not look up malformed ids', async () => {
        expect(await createUser.findPendingInvitation({ companyId: 'global', email: 'a@b.c' })).toBeNull();
        expect(await createUser.findPendingInvitation({ companyId: COMPANY, email: 'a@b.c', companyUserId: '{"$ne":null}' })).toBeNull();
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('matches the pending row for the lower-cased email', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: MEMBER_ROW });
        await createUser.findPendingInvitation({ companyId: COMPANY, email: 'New@Example.com', companyUserId: MEMBER_ROW });
        const [db, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(db).toBe(COMPANY);
        expect(method).toBe('findOne');
        expect(query.data[0]).toMatchObject({ userEmail: 'new@example.com', status: 1 });
        expect(String(query.data[0]._id)).toBe(MEMBER_ROW);
    });

    it('drops the company and the verified flag without an invitation', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const admitted = await createUser.admitInvitee({ email: 'x@y.z', assignCompany: COMPANY, isInvitation: true });
        expect(admitted).toMatchObject({ assignCompany: '', isInvitation: false });
    });

    it('keeps the company for an invited email', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: MEMBER_ROW });
        const admitted = await createUser.admitInvitee({ email: 'x@y.z', assignCompany: COMPANY, isInvitation: true });
        expect(admitted).toMatchObject({ assignCompany: COMPANY, isInvitation: true });
    });

    it('never marks a plain signup verified', async () => {
        const admitted = await createUser.admitInvitee({ email: 'x@y.z' });
        expect(admitted.isInvitation).toBe(false);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});

describe('invitationPreview', () => {
    it('refuses malformed ids', async () => {
        const res = response();
        await invitationPreview(request({ body: { companyId: 'global', memberId: MEMBER_ROW } }), res);
        expect(res.body.status).toBe(false);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('shows the email of a pending invitation', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ Cst_CompanyName: 'Acme' }).mockResolvedValueOnce({ status: 1, userEmail: 'new@example.com' });
        const res = response();
        await invitationPreview(request({ body: { companyId: COMPANY, memberId: MEMBER_ROW } }), res);
        expect(res.body.data).toEqual({ workspaceName: 'Acme', status: 1, email: 'new@example.com' });
    });

    it('withholds the email once the invitation is used', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ Cst_CompanyName: 'Acme' }).mockResolvedValueOnce({ status: 2, userEmail: 'new@example.com' });
        const res = response();
        await invitationPreview(request({ body: { companyId: COMPANY, memberId: MEMBER_ROW } }), res);
        expect(res.body.data.email).toBe('');
    });
});

describe('manageTrackerUserPermission', () => {
    const body = { CompanyId: OTHER_COMPANY, DataObj: { userId: OTHER_USER } };

    it('refuses a member', async () => {
        getRoleType.mockResolvedValue(3);
        const spy = jest.spyOn(trackerPermission, 'updateTrackerUsersAndUser').mockResolvedValue({ status: true });
        const res = response();
        trackerPermission.handleTrackerUserPermission(request({ body }), res);
        await settle();
        expect(res.statusCode).toBe(403);
        expect(spy).not.toHaveBeenCalled();
    });

    it('lets an admin change the session company, whatever the body says', async () => {
        getRoleType.mockResolvedValue(2);
        const spy = jest.spyOn(trackerPermission, 'updateTrackerUsersAndUser').mockResolvedValue({ status: true });
        const res = response();
        trackerPermission.handleTrackerUserPermission(request({ body }), res);
        await settle();
        expect(getRoleType).toHaveBeenCalledWith(COMPANY, USER);
        expect(spy).toHaveBeenCalledWith(body.DataObj, COMPANY);
    });
});
