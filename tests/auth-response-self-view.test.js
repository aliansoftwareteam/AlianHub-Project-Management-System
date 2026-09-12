process.env.JWT_SECRET = 'auth-response-self-view-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, mail, to, flag, cb) => cb({ status: true })) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const bcrypt = require('bcrypt');
const { dbCollections } = require('../Config/collections');
const rules = require('../Modules/Users/helpers/userAccessRules');
const loginSession = require('../Modules/Auth/controller/loginSession');
const sessionCtr = require('../Modules/Auth/session');
const { generateTokenV2Fun } = require('../Modules/Auth/controller/authHelpers');
const createUser = require('../Modules/Auth/controller/createUser');

const UNVERIFIED = '6f00000000000000000000a1';
const COMPANY = '6f0000000000000000000c01';
const EMAIL = 'unverified@example.test';
const PASSWORD = 'Sup3r-Secret!';

const SECRETS = {
    verificationToken: 'verify-secret',
    verificationTokenTime: new Date(),
    webTokens: ['push-secret'],
    forgotPasswordToken: 'reset-secret',
    forgotPasswordTokenTime: new Date(),
    customerId: 'cus_secret',
    customerIds: ['cus_secret'],
    isProductOwner: true,
};
const SECRET_FIELDS = Object.keys(SECRETS).concat('passwordHash');
const exposesSecret = (body) => SECRET_FIELDS.some((field) => JSON.stringify(body || {}).includes(`"${field}"`));

const response = () => {
    const res = { statusCode: 200, body: undefined, cookies: {} };
    res.done = new Promise((resolve) => { res.finish = resolve; });
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.finish(body); return res; };
    res.send = (body) => { res.body = body; res.finish(body); return res; };
    res.cookie = (name, value) => { res.cookies[name] = value; return res; };
    res.clearCookie = (name) => { res.cookies[name] = null; return res; };
    return res;
};

const seedUnverified = () => {
    mockDb.seed(dbCollections.USERS, {
        _id: UNVERIFIED,
        Employee_Email: EMAIL,
        Employee_FName: 'Una',
        Employee_LName: 'Verified',
        Employee_Name: 'Una Verified',
        AssignCompany: [COMPANY],
        isActive: true,
        isEmailVerified: false,
        ...SECRETS,
    });
    mockDb.seed(dbCollections.USER_AUTH, {
        _id: UNVERIFIED,
        email: EMAIL,
        passwordHash: bcrypt.hashSync(UNVERIFIED + PASSWORD, 10),
    });
};

const issueSession = (userId) => new Promise((resolve, reject) => {
    sessionCtr.insertSessionFun({ userId }, 'jest', '127.0.0.1', (out) => (out.status ? resolve(out.data) : reject(new Error(out.message))));
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type] = []; });
    mockDb.crud.mockClear();
});

describe('the auth view', () => {
    it('keeps what the login, OAuth and signup screens read', () => {
        const view = rules.toAuthView({ _id: UNVERIFIED, Employee_Email: EMAIL, Employee_Name: 'Una Verified', AssignCompany: [COMPANY], isEmailVerified: false, ...SECRETS });
        expect(view).toMatchObject({ _id: UNVERIFIED, Employee_Email: EMAIL, Employee_Name: 'Una Verified', AssignCompany: [COMPANY], isEmailVerified: false });
    });

    it('drops every secret, billing and ownership field', () => {
        expect(exposesSecret(rules.toAuthView({ _id: UNVERIFIED, ...SECRETS }))).toBe(false);
    });

    it('stays a subset of the self view', () => {
        expect(rules.AUTH_FIELDS.filter((field) => !rules.SELF_FIELDS.includes(field))).toEqual([]);
    });

    it('answers null for a missing account', () => {
        expect(rules.toAuthView(null)).toBeNull();
    });
});

describe('POST /api/v2/auth/login for an unverified account', () => {
    it('refuses without handing over the verification token', async () => {
        seedUnverified();
        const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', body: { email: EMAIL, password: PASSWORD } };
        const res = response();
        loginSession.loginAuth(req, res, () => res.status(400).json(req.errorMessageObject));
        await res.done;

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, isEmailVerified: false });
        expect(res.body.userData).toMatchObject({ _id: UNVERIFIED, Employee_Email: EMAIL, isEmailVerified: false, AssignCompany: [COMPANY] });
        expect(exposesSecret(res.body)).toBe(false);
    });
});

describe('generateTokenV2Fun', () => {
    it('sends only the auth view to the caller it turns away', async () => {
        seedUnverified();
        const { refreshToken } = await issueSession(UNVERIFIED);
        const out = await new Promise((resolve) => generateTokenV2Fun(UNVERIFIED, refreshToken, resolve));

        expect(out.status).toBe(false);
        expect(out.userData).toEqual(rules.toAuthView(mockDb.store[dbCollections.USERS][0]));
        expect(exposesSecret(out)).toBe(false);
    });
});

describe('POST /api/v2/generateToken', () => {
    it('refuses an unverified account without leaking its verification token', async () => {
        seedUnverified();
        const { refreshToken } = await issueSession(UNVERIFIED);
        const res = response();
        await loginSession.generateTokenV2({ headers: { 'refresh-token': refreshToken }, body: { uid: UNVERIFIED } }, res);
        await res.done;

        expect(res.statusCode).toBe(400);
        expect(res.body.isEmailVerified).toBe(false);
        expect(exposesSecret(res.body)).toBe(false);
    });
});

describe('POST /api/v2/createUser', () => {
    it('answers the registrant with a self view only', async () => {
        const res = response();
        createUser.createUserV2({ body: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', password: PASSWORD, ...SECRETS } }, res);
        await res.done;

        expect(res.body.status).toBe(true);
        expect(res.body.statusText).toMatchObject({ Employee_Email: 'ada@example.test', Employee_Name: 'Ada Lovelace', isEmailVerified: false });
        expect(String(res.body.statusText._id)).toBe(String(mockDb.store[dbCollections.USERS][0]._id));
        expect(Object.keys(res.body.statusText).filter((field) => !rules.AUTH_FIELDS.includes(field))).toEqual([]);
        expect(exposesSecret(res.body)).toBe(false);
    });
});

describe.each([
    ['googleSignup', 'googleId'],
    ['githubSignup', 'githubId'],
    ['gitlabSignup', 'gitlabId'],
])('POST /api/v2/%s', (handler, idField) => {
    it('answers the registrant with a self view only', async () => {
        const res = response();
        await createUser[handler]({ body: { firstName: 'Ada', lastName: 'Lovelace', email: `${idField}@example.test`, [idField]: 'provider-id', ...SECRETS } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toMatchObject({ Employee_Email: `${idField}@example.test`, isEmailVerified: true });
        expect(res.body.data._id).toBeDefined();
        expect(Object.keys(res.body.data).filter((field) => !rules.AUTH_FIELDS.includes(field))).toEqual([]);
        expect(exposesSecret(res.body)).toBe(false);
    });
});
