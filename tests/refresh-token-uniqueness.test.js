process.env.JWT_SECRET = 'refresh-token-uniqueness-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const jwt = require('jsonwebtoken');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const sessionCtr = require('../Modules/Auth/session');
const loginSession = require('../Modules/Auth/controller/loginSession');
const { generateTokenV2Fun } = require('../Modules/Auth/controller/authHelpers');
const { verifyJWTTokenV2 } = require('../Config/jwt');

const USER_A = '6f00000000000000000000a1';
const USER_B = '6f00000000000000000000b1';
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0, 250);
const AFTER_GRACE = NOW + 5 * 60 * 1000;

const sessions = () => mockDb.store[dbCollections.SESSIONS] || [];
const sessionsOf = (userId) => sessions().filter((s) => String(s.userId) === userId);

const response = () => {
    const res = { statusCode: 200, body: undefined, cookies: {} };
    res.done = new Promise((resolve) => { res.finish = resolve; });
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.finish(body); return res; };
    res.cookie = (name, value) => { res.cookies[name] = value; return res; };
    res.clearCookie = (name) => { res.cookies[name] = null; return res; };
    return res;
};

const issueSession = (userId) => new Promise((resolve, reject) => {
    sessionCtr.insertSessionFun({ userId }, 'jest', '127.0.0.1', (out) => (out.status ? resolve(out.data.refreshToken) : reject(new Error(out.message))));
});

const refresh = async (token, uid) => {
    const res = response();
    await loginSession.generateTokenV2({ headers: { 'refresh-token': token }, body: uid ? { uid } : {}, hostname: 'localhost' }, res);
    await res.done;
    return res;
};

const trackerLogin = async (body) => {
    const res = response();
    await loginSession.loginAuthTracker({ headers: { 'user-agent': 'tracker' }, body, ip: '127.0.0.1' }, res);
    await res.done;
    return res;
};

const accessTokenFor = (userId, refreshToken) => new Promise((resolve, reject) => {
    generateTokenV2Fun(userId, refreshToken, (out) => (out.status ? resolve(out.token) : reject(new Error(out.message))));
});

const throughMiddleware = (accessToken) => new Promise((resolve) => {
    const res = response();
    res.done.then((body) => resolve({ passed: false, body, cookies: res.cookies }));
    verifyJWTTokenV2({ headers: { authorization: `Bearer ${accessToken}` }, body: {} }, res, () => resolve({ passed: true }));
});

const refused = (res) => res.statusCode >= 400 || Boolean(res.body && res.body.status === false);
const accessUid = (res) => jwt.decode(res.body.token || res.body.accessToken).uid;
const legacyToken = () => jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 172800 });
const clockAt = (ms) => jest.spyOn(Date, 'now').mockReturnValue(ms);
const seedLegacySession = (userId, refreshToken) => mockDb.seed(dbCollections.SESSIONS, { userId, ip: '127.0.0.1', refreshToken, createdAt: new Date(NOW) });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    jest.restoreAllMocks();
    clockAt(NOW);
    mockDb.seed(dbCollections.USERS, { _id: USER_A, isEmailVerified: true, AssignCompany: ['6f0000000000000000000c01'] });
    mockDb.seed(dbCollections.USERS, { _id: USER_B, isEmailVerified: true, AssignCompany: ['6f0000000000000000000c01'] });
});

describe('refresh tokens issued in the same second', () => {
    it('are different strings for two users', async () => {
        const tokenA = await issueSession(USER_A);
        const tokenB = await issueSession(USER_B);
        expect(tokenA).not.toBe(tokenB);
    });

    it('carry the subject, the session, a random jti and the refresh type', async () => {
        const token = await issueSession(USER_A);
        const claims = jwt.decode(token);
        expect(claims).toMatchObject({ sub: USER_A, typ: 'refresh', sid: String(sessionsOf(USER_A)[0]._id) });
        expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('are stored as a hash, never as the token itself', async () => {
        const token = await issueSession(USER_A);
        const [row] = sessionsOf(USER_A);
        expect(row.refreshToken).toBeUndefined();
        expect(Object.values(row)).not.toContain(token);
        expect(row.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('POST /api/v2/generateToken', () => {
    it("returns A's session for A's token even when the body names B", async () => {
        const tokenA = await issueSession(USER_A);
        await issueSession(USER_B);
        const res = await refresh(tokenA, USER_B);
        expect(refused(res)).toBe(false);
        expect(accessUid(res)).toBe(USER_A);
    });

    it("refuses a legacy token presented with another user's id", async () => {
        const token = legacyToken();
        seedLegacySession(USER_A, token);
        const res = await refresh(token, USER_B);
        expect(refused(res)).toBe(true);
        expect(res.body.token).toBeUndefined();
    });

    it('refuses a legacy token that two users share instead of picking one', async () => {
        const token = legacyToken();
        seedLegacySession(USER_B, token);
        seedLegacySession(USER_A, token);
        const res = await refresh(token, USER_B);
        expect(refused(res)).toBe(true);
        expect(res.body.token).toBeUndefined();
    });

    it('rotates the token, keeps its expiry, and revokes the session when the old one comes back', async () => {
        const first = await issueSession(USER_A);
        const rotated = await refresh(first, USER_A);
        expect(refused(rotated)).toBe(false);
        const second = rotated.body.refreshToken;
        expect(second).toBeTruthy();
        expect(second).not.toBe(first);
        expect(rotated.cookies.refreshToken).toBe(second);
        expect(jwt.decode(second).exp).toBe(jwt.decode(first).exp);

        clockAt(AFTER_GRACE);
        const reused = await refresh(first, USER_A);
        expect(refused(reused)).toBe(true);
        expect(reused.body.isLogout).toBe(true);
        expect(sessionsOf(USER_A)).toHaveLength(0);
        expect(refused(await refresh(second, USER_A))).toBe(true);
    });

    it('refuses without revoking a token re-sent while its rotation is seconds old', async () => {
        const first = await issueSession(USER_A);
        const rotated = await refresh(first, USER_A);
        const racing = await refresh(first, USER_A);
        expect(refused(racing)).toBe(true);
        expect(racing.body.isLogout).toBeUndefined();
        expect(sessionsOf(USER_A)).toHaveLength(1);
        expect(refused(await refresh(rotated.body.refreshToken, USER_A))).toBe(false);
    });

    it('accepts a legacy token once for its own user and rotates it to the new format', async () => {
        const token = legacyToken();
        seedLegacySession(USER_A, token);
        const accepted = await refresh(token, USER_A);
        expect(refused(accepted)).toBe(false);
        expect(accessUid(accepted)).toBe(USER_A);
        expect(jwt.decode(accepted.body.refreshToken)).toMatchObject({ sub: USER_A, typ: 'refresh' });
        expect(sessionsOf(USER_A)[0].refreshToken).toBeUndefined();

        clockAt(AFTER_GRACE);
        expect(refused(await refresh(token, USER_A))).toBe(true);
    });

    it('refuses the access token bound to a rotated refresh token without logging the user out', async () => {
        const first = await issueSession(USER_A);
        const oldAccess = await accessTokenFor(USER_A, first);
        const rotated = await refresh(first, USER_A);
        expect((await throughMiddleware(rotated.body.token)).passed).toBe(true);

        const stale = await throughMiddleware(oldAccess);
        expect(stale.passed).toBe(false);
        expect(stale.body.isJwtError).toBe(true);
        expect(stale.body.isLogout).toBeUndefined();
        expect(stale.cookies.refreshToken).toBeUndefined();
        expect(sessionsOf(USER_A)).toHaveLength(1);
    });
});

describe('POST /api/v1/auth/loginAuthTracker', () => {
    it("no longer turns a user's refresh token into a second session", async () => {
        const tokenA = await issueSession(USER_A);
        const res = await trackerLogin({ refreshToken: tokenA, userId: USER_A });
        expect(refused(res)).toBe(true);
        expect(res.body.accessToken).toBeUndefined();
        expect(sessionsOf(USER_A)).toHaveLength(1);
    });

    it("refuses a token presented with another user's id", async () => {
        const tokenA = await issueSession(USER_A);
        const res = await trackerLogin({ refreshToken: tokenA, userId: USER_B });
        expect(refused(res)).toBe(true);
    });

    it('refuses a legacy token that two users share', async () => {
        const token = legacyToken();
        seedLegacySession(USER_B, token);
        seedLegacySession(USER_A, token);
        const res = await trackerLogin({ refreshToken: token, userId: USER_A });
        expect(refused(res)).toBe(true);
    });
});

describe('sessions schema', () => {
    it('declares the refresh-token fields, so the strict schema keeps them', () => {
        const { sessionsSchema } = require('../utils/mongo-handler/createSchema');
        ['refreshTokenHash', 'refreshTokenJti', 'tokenTail', 'previousRefreshTokenHash', 'rotatedAt']
            .forEach((field) => expect(sessionsSchema.path(field)).toBeDefined());
    });
});
