process.env.JWT_SECRET = 'unverified-login-session-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { finalizeSession } = require('../Modules/Auth/controller/loginSession');

const VERIFIED = '6f00000000000000000000e0';
const UNVERIFIED = '6f00000000000000000000e1';
const MISSING = '6f00000000000000000000e2';

const sessionsOf = (userId) => (mockDb.store[dbCollections.SESSIONS] || []).filter((s) => String(s.userId) === userId);

const signIn = (uid) => new Promise((resolve) => {
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', body: {} };
    const res = { cookie: jest.fn() };
    res.status = jest.fn(() => res);
    res.json = jest.fn((body) => resolve({ req, res, body, refused: false }));
    finalizeSession(req, res, uid, () => resolve({ req, res, refused: true }));
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockDb.seed(dbCollections.USERS, { _id: VERIFIED, Employee_Email: 'verified@example.test', isEmailVerified: true, AssignCompany: [] });
    mockDb.seed(dbCollections.USERS, { _id: UNVERIFIED, Employee_Email: 'unverified@example.test', isEmailVerified: false, AssignCompany: [], verificationToken: 'verify-secret' });
});

describe('finalizeSession', () => {
    it('opens no session for an unverified account and answers with the auth view', async () => {
        const { req, res, refused } = await signIn(UNVERIFIED);
        expect(refused).toBe(true);
        expect(req.errorMessageObject).toEqual({
            status: false,
            isLogout: true,
            isEmailVerified: false,
            userData: { _id: UNVERIFIED, Employee_Email: 'unverified@example.test', isEmailVerified: false, AssignCompany: [] },
            message: 'Email is not verified.',
        });
        expect(sessionsOf(UNVERIFIED)).toHaveLength(0);
        expect(res.cookie).not.toHaveBeenCalled();
    });

    it('opens no session for an account that does not exist', async () => {
        const { req, refused } = await signIn(MISSING);
        expect(refused).toBe(true);
        expect(req.errorMessageObject).toEqual({ status: false, isLogout: true, message: 'user not found.' });
        expect(sessionsOf(MISSING)).toHaveLength(0);
    });

    it('still opens a session for a verified account', async () => {
        const { body, refused } = await signIn(VERIFIED);
        expect(refused).toBe(false);
        expect(body.uid).toBe(VERIFIED);
        expect(sessionsOf(VERIFIED)).toHaveLength(1);
    });
});
