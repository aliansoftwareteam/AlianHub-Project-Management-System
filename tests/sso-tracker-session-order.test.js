process.env.JWT_SECRET = 'sso-tracker-session-order-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Auth/helpers/trackerCode', () => ({ redeemTrackerCode: jest.fn() }));

const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { redeemTrackerCode } = require('../Modules/Auth/helpers/trackerCode');
const { loginAuthTracker } = require('../Modules/Auth/controller/loginSession');
const { finalizeSsoSession } = require('../Modules/SSO/ssoSession');

const VERIFIED = '6f00000000000000000000e0';
const UNVERIFIED = '6f00000000000000000000e1';
const MISSING = '6f00000000000000000000e2';

const sessionsOf = (userId) => (mockDb.store[dbCollections.SESSIONS] || []).filter((s) => String(s.userId) === userId);

const ssoReq = () => ({ headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' });
const ssoSignIn = (uid) => new Promise((resolve) => {
    const res = { cookie: jest.fn(), redirect: jest.fn((url) => resolve({ url })) };
    finalizeSsoSession(ssoReq(), res, uid, '/home');
});

const trackerSignIn = (uid) => new Promise((resolve) => {
    redeemTrackerCode.mockResolvedValueOnce({ ok: true, userId: uid });
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', body: { code: 'code' } };
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn((body) => resolve({ status: res.status.mock.calls[0][0], body }));
    loginAuthTracker(req, res);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb.seed(dbCollections.USERS, { _id: VERIFIED, Employee_Email: 'verified@example.test', isEmailVerified: true, AssignCompany: [] });
    mockDb.seed(dbCollections.USERS, { _id: UNVERIFIED, Employee_Email: 'unverified@example.test', isEmailVerified: false, AssignCompany: [], verificationToken: 'verify-secret' });
});

describe('finalizeSsoSession', () => {
    it.each([[UNVERIFIED], [MISSING]])('opens no session for %s and refuses like a failed token mint', async (uid) => {
        const { url } = await ssoSignIn(uid);
        expect(url).toBe('/login?ssoError=token');
        expect(sessionsOf(uid)).toHaveLength(0);
    });

    it('still opens a session for a verified account', async () => {
        const { url } = await ssoSignIn(VERIFIED);
        expect(url).toBe('/home');
        expect(sessionsOf(VERIFIED)).toHaveLength(1);
    });
});

describe('loginAuthTracker', () => {
    it.each([[UNVERIFIED], [MISSING]])('opens no session for %s and answers invalid', async (uid) => {
        const { status, body } = await trackerSignIn(uid);
        expect(status).toBe(400);
        expect(body).toEqual({ message: 'Invalid or expired tracker sign-in code' });
        expect(sessionsOf(uid)).toHaveLength(0);
    });

    it('still opens a session for a verified account', async () => {
        const { status, body } = await trackerSignIn(VERIFIED);
        expect(status).toBe(200);
        expect(body.uid).toBe(VERIFIED);
        expect(body.accessToken).toBeTruthy();
        expect(sessionsOf(VERIFIED)).toHaveLength(1);
    });
});
