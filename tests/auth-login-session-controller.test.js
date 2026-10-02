process.env.JWT_SECRET = 'login-session-controller-secret';
process.env.JWT_EXP = '24h';

const mockVerifyAuth = jest.fn();
const mockRemoveSession = jest.fn();
const mockInsertSession = jest.fn();
const mockRefusalFor = jest.fn();
const mockTokenFun = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => ({})) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions.js', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/jwt.js', () => ({ removeCacheAndCookie: jest.fn() }));
jest.mock('../Modules/Auth/session.js', () => ({
    insertSessionFun: (...a) => mockInsertSession(...a),
    removeSession: (...a) => mockRemoveSession(...a),
}));
jest.mock('../Modules/Auth/helpers/refreshSession', () => ({ resolveRefreshSession: jest.fn(), rotateRefreshSession: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({
    addAndRemoveUserInMongodbNotificationCount: jest.fn(),
    verifyAuth: (...a) => mockVerifyAuth(...a),
    sessionRefusalFor: (...a) => mockRefusalFor(...a),
    generateTokenV2Fun: (...a) => mockTokenFun(...a),
}));

const logger = require('../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../utils/commonFunctions.js');
const { removeCacheAndCookie } = require('../Config/jwt.js');
const { dbCollections } = require('../Config/collections');
const { resolveRefreshSession, rotateRefreshSession } = require('../Modules/Auth/helpers/refreshSession');
const { verifyTempToken } = require('../Modules/Auth/helpers/twoFactorRules');
const ctrl = require('../Modules/Auth/controller/loginSession');

const UID = '6f0000000000000000000001';
const SESSION = '6f0000000000000000000f01';

const reply = () => {
    const res = { statusCode: 200, cookies: {}, cleared: [] };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.cookie = (name, value, options) => { res.cookies[name] = { value, options }; return res; };
    res.clearCookie = (name) => { res.cleared.push(name); return res; };
    res.req = { headers: {} };
    return res;
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRefusalFor.mockResolvedValue(null);
    mockInsertSession.mockImplementation((_data, _agent, _ip, cb) => cb({ status: true, data: { refreshToken: 'rt-1' } }));
    mockTokenFun.mockImplementation((_uid, _rt, cb) => cb({ status: true, token: 'at-1' }));
});

describe('testV2', () => {
    it('answers with the body it was sent', () => {
        const res = reply();
        ctrl.testV2({ body: { hello: 'world' } }, res);
        expect(res.body).toEqual({ hello: 'world' });
    });
});

describe('loginAuth', () => {
    const login = (body = { email: 'ada@example.test', password: 'pw' }) => new Promise((resolve) => {
        const req = { headers: {}, body, ip: '127.0.0.1' };
        const res = reply();
        const originalJson = res.json;
        res.json = (b) => { originalJson(b); resolve({ req, res, next: false }); return res; };
        ctrl.loginAuth(req, res, () => resolve({ req, res, next: true }));
    });

    it('hands the submitted credentials to the verifier', async () => {
        mockVerifyAuth.mockImplementation((_body, cb) => cb({ status: false, message: 'Invalid credentials' }));
        await login({ email: 'ada@example.test', password: 'pw' });
        expect(mockVerifyAuth.mock.calls[0][0]).toEqual({ email: 'ada@example.test', password: 'pw' });
    });

    it('passes a refused sign-in on with its message and opens no session', async () => {
        mockVerifyAuth.mockImplementation((_body, cb) => cb({ status: false, message: 'Invalid credentials' }));
        const { req, res, next } = await login();
        expect(next).toBe(true);
        expect(req.errorMessageObject).toEqual({ message: 'Invalid credentials' });
        expect(mockInsertSession).not.toHaveBeenCalled();
        expect(res.cookies).toEqual({});
    });

    it('answers a forced password reset with the uid and no session', async () => {
        mockVerifyAuth.mockImplementation((_body, cb) => cb({ status: true, isResetPassword: true, data: { _id: UID } }));
        const { res } = await login();
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ uid: UID, isResetPassword: true });
        expect(mockInsertSession).not.toHaveBeenCalled();
        expect(res.cookies).toEqual({});
    });

    it('asks an account with two-factor for a code instead of signing it in', async () => {
        mockVerifyAuth.mockImplementation((_body, cb) => cb({ status: true, data: { _id: UID, twoFactorEnabled: true } }));
        const { res } = await login();
        expect(res.body).toMatchObject({ status: true, twoFactorRequired: true, uid: UID });
        expect(verifyTempToken(res.body.tempToken)).toEqual({ uid: UID });
        expect(res.body.refreshToken).toBeUndefined();
        expect(res.body.accessToken).toBeUndefined();
        expect(mockInsertSession).not.toHaveBeenCalled();
        expect(res.cookies).toEqual({});
    });

    it('signs in an account without two-factor, setting both cookies', async () => {
        mockVerifyAuth.mockImplementation((_body, cb) => cb({ status: true, data: { _id: UID } }));
        const { res } = await login();
        expect(res.body).toEqual({ uid: UID, refreshToken: 'rt-1', accessToken: 'at-1' });
        expect(res.cookies.refreshToken.value).toBe('rt-1');
        expect(res.cookies.accessToken.value).toBe('at-1');
        expect(mockRefusalFor).toHaveBeenCalledWith(UID);
    });

    it('passes the error on when the verifier throws', async () => {
        mockVerifyAuth.mockImplementation(() => { throw new Error('verifier broke'); });
        const { req, next } = await login();
        expect(next).toBe(true);
        expect(req.errorMessageObject).toEqual({ message: 'verifier broke' });
    });

    it('passes a thrown non-error value on as it is', async () => {
        mockVerifyAuth.mockImplementation(() => { throw 'plain failure'; });
        const { req } = await login();
        expect(req.errorMessageObject).toEqual({ message: 'plain failure' });
    });

    it('passes a missing body to the verifier rather than crashing', async () => {
        mockVerifyAuth.mockImplementation((body, cb) => cb({ status: false, message: `got ${body}` }));
        const { req } = await login(null);
        expect(req.errorMessageObject).toEqual({ message: 'got null' });
    });
});

describe('logout', () => {
    const logout = (req) => new Promise((resolve) => {
        const res = reply();
        const originalJson = res.json;
        res.json = (b) => { originalJson(b); resolve(res); return res; };
        ctrl.logout({ hostname: 'hub.example.test', ...req }, res);
    });

    it('answers 400 with the reason when the session cannot be removed, and keeps the cookies', async () => {
        mockRemoveSession.mockImplementation((_req, cb) => cb({ status: false, message: 'session store down' }));
        const res = await logout({ uid: UID, sessionId: SESSION });
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'session store down' });
        expect(res.cookies).toEqual({});
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('removes the session, marks the account offline in the global users and expires both cookies', async () => {
        mockRemoveSession.mockImplementation((_req, cb) => cb({ status: true, data: { deletedCount: 1 } }));
        const res = await logout({ uid: UID, sessionId: SESSION });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, message: { status: true, data: { deletedCount: 1 } } });
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        const [scope, obj, method] = MongoDbCrudOpration.mock.calls[0];
        expect([scope, method, obj.type]).toEqual(['global', 'updateOne', dbCollections.USERS]);
        expect(String(obj.data[0]._id)).toBe(UID);
        expect(obj.data[1].$set.isOnline).toBe(false);
        expect(obj.data[1].$set.lastActive).toBeInstanceOf(Date);
        expect(Object.keys(obj.data[1].$set).sort()).toEqual(['isOnline', 'lastActive']);
        expect(res.cookies.accessToken.value).toBe('deleted');
        expect(res.cookies.refreshToken.value).toBe('deleted');
        expect(res.cookies.accessToken.options.expires.getTime()).toBe(0);
    });

    it('clears the caller\'s cached profile only', async () => {
        mockRemoveSession.mockImplementation((_req, cb) => cb({ status: true }));
        await logout({ uid: UID, sessionId: SESSION });
        expect(removeCache).toHaveBeenCalledWith(`UserData:${UID}`);
    });

    it('scopes the cookie domain to the host in production', async () => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            mockRemoveSession.mockImplementation((_req, cb) => cb({ status: true }));
            const res = await logout({ uid: UID, sessionId: SESSION });
            expect(res.cookies.accessToken.options.domain).toBe('hub.example.test');
        } finally {
            process.env.NODE_ENV = original;
        }
    });

    it.each([
        ['no uid', {}],
        ['a uid that is not an object id', { uid: 'me' }],
    ])('signs out %s without touching any account', async (_name, req) => {
        mockRemoveSession.mockImplementation((_req, cb) => cb({ status: true, data: { deletedCount: 0 } }));
        const res = await logout(req);
        expect(res.statusCode).toBe(200);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(res.cookies.accessToken.value).toBe('deleted');
    });
});

describe('generateTokenV2 refusals', () => {
    const refresh = (headers = { 'refresh-token': 'old-rt' }, body = { uid: UID }) => {
        const res = reply();
        return ctrl.generateTokenV2({ headers, body, hostname: 'hub.example.test' }, res).then(() => res);
    };

    it('asks for a refresh token when none comes', async () => {
        const res = await refresh({});
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: 'Please provide a refresh token.' });
        expect(resolveRefreshSession).not.toHaveBeenCalled();
    });

    it('asks for the user id when the session cannot name one', async () => {
        resolveRefreshSession.mockResolvedValue({ ok: false, reason: 'userRequired' });
        const res = await refresh({ 'refresh-token': 'old-rt' }, {});
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: 'The user id is required.' });
        expect(res.cleared).toEqual([]);
    });

    it('passes the uid from the body to the session lookup, and survives a missing body', async () => {
        resolveRefreshSession.mockResolvedValue({ ok: false, reason: 'userRequired' });
        await refresh({ 'refresh-token': 'old-rt' }, { uid: UID });
        expect(resolveRefreshSession).toHaveBeenLastCalledWith('old-rt', UID);
        await refresh({ 'refresh-token': 'old-rt' }, null);
        expect(resolveRefreshSession).toHaveBeenLastCalledWith('old-rt', null);
    });

    it('answers 409 with isRotated when the token was just exchanged, keeping the cookies', async () => {
        resolveRefreshSession.mockResolvedValue({ ok: true });
        rotateRefreshSession.mockResolvedValue({ ok: false, reason: 'rotated' });
        const res = await refresh();
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ status: false, isRotated: true });
        expect(res.cleared).toEqual([]);
    });

    it.each([
        ['an unknown session', { ok: false, reason: 'expired' }, null],
        ['a failed rotation', { ok: true }, { ok: false, reason: 'revoked' }],
    ])('logs out %s and clears both cookies', async (_name, resolved, rotated) => {
        resolveRefreshSession.mockResolvedValue(resolved);
        if (rotated) rotateRefreshSession.mockResolvedValue(rotated);
        const res = await refresh();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ message: 'Your session is expired', isLogout: true });
        expect(res.cleared.sort()).toEqual(['accessToken', 'refreshToken']);
        expect(mockTokenFun).not.toHaveBeenCalled();
    });

    it('logs out and removes the rotated token when no access token can be issued', async () => {
        resolveRefreshSession.mockResolvedValue({ ok: true });
        rotateRefreshSession.mockResolvedValue({ ok: true, userId: UID, refreshToken: 'rt-2', expiresAt: Math.floor(Date.now() / 1000) + 600 });
        mockTokenFun.mockImplementation((_uid, _rt, cb) => cb({ status: false, message: 'user not found.' }));
        const res = await refresh();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, message: 'user not found.' });
        expect(removeCacheAndCookie).toHaveBeenCalledWith('', '', res, 'rt-2');
        expect(res.cookies).toEqual({});
    });

    it('issues the new tokens for the rotated session, not the old one', async () => {
        resolveRefreshSession.mockResolvedValue({ ok: true });
        rotateRefreshSession.mockResolvedValue({ ok: true, userId: UID, refreshToken: 'rt-2', expiresAt: Math.floor(Date.now() / 1000) + 600 });
        const res = await refresh();
        expect(mockTokenFun.mock.calls[0].slice(0, 2)).toEqual([UID, 'rt-2']);
        expect(res.body).toEqual({ status: true, token: 'at-1', refreshToken: 'rt-2' });
        expect(res.cookies.refreshToken.value).toBe('rt-2');
        expect(res.cookies.accessToken.value).toBe('at-1');
        expect(res.cookies.refreshToken.options.maxAge).toBeGreaterThan(0);
        expect(res.cookies.refreshToken.options.maxAge).toBeLessThanOrEqual(600 * 1000);
    });

    it('never gives an already past refresh cookie a negative lifetime', async () => {
        resolveRefreshSession.mockResolvedValue({ ok: true });
        rotateRefreshSession.mockResolvedValue({ ok: true, userId: UID, refreshToken: 'rt-2', expiresAt: 1 });
        const res = await refresh();
        expect(res.cookies.refreshToken.options.maxAge).toBe(0);
    });

    it('answers a generic failure when the lookup throws, without the cause', async () => {
        resolveRefreshSession.mockRejectedValue(new Error('mongo down at db-host:27017'));
        const res = await refresh();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, isLogout: true, message: 'Authentication failed!' });
        expect(removeCacheAndCookie).toHaveBeenCalledWith('', '', res, 'old-rt');
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db-host'));
    });
});
