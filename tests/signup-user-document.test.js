process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => undefined), insertAuthFun: jest.fn() }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({ sendVerificationEmailPromise: jest.fn(async () => undefined) }));
jest.mock('../Modules/notification/defaults', () => ({ ensureNotificationDefaults: jest.fn() }));
jest.mock('../Modules/ImportSettings/controller', () => ({ importSettingsFunction: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn() }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Affiliate/controller', () => ({ storeRefferalCode: jest.fn() }));
jest.mock('../Modules/Setup/demoProject', () => ({ createDemoProject: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleCreateCompanyDataStorageFun: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { insertAuthFun } = require('../Modules/Auth/controller');
const createUser = require('../Modules/Auth/controller/createUser');
const { createOwner } = require('../Modules/Setup/createCompany');

const USER_ID = '6f0000000000000000000001';
const COMPANY = '6f0000000000000000000c01';
const USER_DOCUMENT_FIELDS = ['AssignCompany', 'Employee_Email', 'Employee_FName', 'Employee_LName', 'Employee_Name', 'Time_Format', 'isActive', 'isDeleted', 'isEmailVerified', 'isOnline'];
const PRIVILEGED = {
    isProductOwner: true,
    isEmailVerified: true,
    isVesionUpdate: true,
    AssignCompany: [COMPANY],
    customerId: 'cus_x',
    customerIds: ['cus_x'],
    webTokens: ['token'],
    verificationToken: 'token',
    forgotPasswordToken: 'token',
    agentAccount: { mode: 'x' },
    demo: true,
    _id: '6f00000000000000000000ff',
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    return res;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const savedUsers = () => MongoDbCrudOpration.mock.calls.filter(([, query, method]) => method === 'save' && query.type === 'users').map(([, query]) => query.data);

beforeEach(() => {
    jest.clearAllMocks();
    insertAuthFun.mockImplementation((data, cb) => cb({ status: true, data: { ...data, _id: USER_ID } }));
    MongoDbCrudOpration.mockImplementation(async (db, query, method) => (method === 'save' ? { ...query.data, _id: query.data._id || USER_ID } : null));
});

describe('buildUserDocument', () => {
    it('writes only the profile a registrant may set', () => {
        const doc = createUser.buildUserDocument({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: 'secret', ...PRIVILEGED, assignCompany: '', isInvitation: false });

        expect(Object.keys(doc).sort()).toEqual(USER_DOCUMENT_FIELDS);
        expect(doc).toMatchObject({ AssignCompany: [], Employee_Name: 'Ada Lovelace', isEmailVerified: false, isActive: true, isDeleted: false });
    });

    it('marks an admitted invitee verified in the invited company', () => {
        const doc = createUser.buildUserDocument({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', assignCompany: COMPANY, isInvitation: true });
        expect(doc).toMatchObject({ AssignCompany: [COMPANY], isEmailVerified: true });
    });
});

describe('registrantFields', () => {
    it('keeps the signup form fields and nothing else', () => {
        const picked = createUser.registrantFields({ firstName: 'Ada', lastName: 'L', email: 'a@b.c', password: 'p', assignCompany: COMPANY, isInvitation: true, ...PRIVILEGED });
        expect(Object.keys(picked).sort()).toEqual(['assignCompany', 'email', 'firstName', 'isInvitation', 'lastName', 'password']);
    });

    it('ignores inherited properties', () => {
        const body = Object.create({ isProductOwner: true, firstName: 'Inherited' });
        body.email = 'a@b.c';
        expect(createUser.registrantFields(body)).toEqual({ email: 'a@b.c' });
    });
});

describe('addUserMongodbV2', () => {
    it('never stores ownership even when a caller passes it', async () => {
        await createUser.addUserMongodbV2({ firstName: 'Ada', lastName: 'L', email: 'a@b.c', password: 'p', isInvitation: false, ...PRIVILEGED });

        const [doc] = savedUsers();
        expect(Object.keys(doc).sort()).toEqual([...USER_DOCUMENT_FIELDS, '_id'].sort());
        expect(String(doc._id)).toBe(USER_ID);
        expect(insertAuthFun.mock.calls[0][0]).toEqual({ email: 'a@b.c', password: 'p' });
    });
});

describe('POST /api/v2/createUser', () => {
    it('saves an anonymous signup without ownership, verification or billing fields', async () => {
        const res = response();
        createUser.createUserV2({ body: { firstName: 'Ada', lastName: 'L', email: 'a@b.c', password: 'p', ...PRIVILEGED } }, res);
        await settle();

        expect(res.body.status).toBe(true);
        const [doc] = savedUsers();
        expect(doc.isProductOwner).toBeUndefined();
        expect(doc.isEmailVerified).toBe(false);
        expect(doc.AssignCompany).toEqual([]);
        expect(Object.keys(doc).sort()).toEqual([...USER_DOCUMENT_FIELDS, '_id'].sort());
    });

    it.each([
        ['firstName', { lastName: 'L', email: 'a@b.c', password: 'p' }],
        ['lastName', { firstName: 'A', email: 'a@b.c', password: 'p' }],
        ['email', { firstName: 'A', lastName: 'L', email: { $ne: null }, password: 'p' }],
        ['password', { firstName: 'A', lastName: 'L', email: 'a@b.c' }],
    ])('answers once and creates nothing without a valid %s', async (field, body) => {
        const res = response();
        createUser.createUserV2({ body }, res);
        await settle();

        expect(res.send).toHaveBeenCalledTimes(1);
        expect(res.body.status).toBe(false);
        expect(insertAuthFun).not.toHaveBeenCalled();
        expect(savedUsers()).toEqual([]);
    });
});

describe.each([
    ['googleSignup', 'googleId'],
    ['githubSignup', 'githubId'],
    ['gitlabSignup', 'gitlabId'],
])('%s', (handler, idField) => {
    it('saves the user without ownership fields from the body', async () => {
        const res = response();
        await createUser[handler]({ body: { firstName: 'Ada', lastName: 'L', email: 'a@b.c', [idField]: 'provider-id', ...PRIVILEGED } }, res);

        expect(res.statusCode).toBe(200);
        const [doc] = savedUsers();
        expect(doc.isProductOwner).toBeUndefined();
        expect(Object.keys(doc).sort()).toEqual([...USER_DOCUMENT_FIELDS, '_id'].sort());
        const authSave = MongoDbCrudOpration.mock.calls.find(([, query, method]) => method === 'save' && query.type !== 'users');
        expect(Object.keys(authSave[1].data).sort()).toEqual(['email', 'isBlocked', idField].sort());
    });
});

describe('setup createOwner', () => {
    it('grants ownership in its own update after the shared insert', async () => {
        const ownerId = await createOwner({ firstName: 'Olivia', lastName: 'Owner', email: 'owner@example.com', password: 'p' });

        expect(ownerId).toBe(USER_ID);
        const [doc] = savedUsers();
        expect(doc.isProductOwner).toBeUndefined();
        const update = MongoDbCrudOpration.mock.calls.find(([, , method]) => method === 'findOneAndUpdate');
        expect(update[1].data[0]).toEqual({ _id: USER_ID });
        expect(update[1].data[1].$set).toMatchObject({ isProductOwner: true, isEmailVerified: true });
    });
});
