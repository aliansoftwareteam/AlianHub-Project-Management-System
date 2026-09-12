process.env.JWT_SECRET = 'access-token-session-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const sessionCtr = require('../Modules/Auth/session');
const loginSession = require('../Modules/Auth/controller/loginSession');
const { generateTokenV2Fun } = require('../Modules/Auth/controller/authHelpers');
const { generateToken, verifyJWTTokenV2, verifyJWTTokenWithCV2 } = require('../Config/jwt');

const USER_A = '6f00000000000000000000a1';
const USER_B = '6f00000000000000000000b1';
const COMPANY = '6f0000000000000000000c01';
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

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
    sessionCtr.insertSessionFun({ userId }, 'jest', '127.0.0.1', (out) => (out.status ? resolve(out.data) : reject(new Error(out.message))));
});

const accessTokenFor = (userId, refreshToken) => new Promise((resolve, reject) => {
    generateTokenV2Fun(userId, refreshToken, (out) => (out.status ? resolve(out.token) : reject(new Error(out.message))));
});

const signIn = async (userId) => {
    const { refreshToken, _id } = await issueSession(userId);
    return { refreshToken, sessionId: String(_id), accessToken: await accessTokenFor(userId, refreshToken) };
};

const throughMiddleware = (accessToken, { verifier = verifyJWTTokenV2, headers = {}, body = {} } = {}) => new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${accessToken}`, ...headers }, body };
    const res = response();
    res.done.then((out) => resolve({ passed: false, status: res.statusCode, body: out, cookies: res.cookies, req }));
    verifier(req, res, () => resolve({ passed: true, req }));
});

const call = async (handler, req) => {
    const res = response();
    handler({ headers: { 'user-agent': 'tracker' }, ip: '127.0.0.1', body: {}, ...req }, res);
    await res.done;
    return res;
};

const refused = (res) => res.statusCode >= 400 || Boolean(res.body && res.body.status === false);
const clockAt = (ms) => jest.spyOn(Date, 'now').mockReturnValue(ms);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    jest.restoreAllMocks();
    clockAt(NOW);
    mockDb.seed(dbCollections.USERS, { _id: USER_A, isEmailVerified: true, AssignCompany: [COMPANY] });
    mockDb.seed(dbCollections.USERS, { _id: USER_B, isEmailVerified: true, AssignCompany: [COMPANY] });
});

describe('the access token', () => {
    it('names its session and never carries the refresh token', async () => {
        const { refreshToken, sessionId, accessToken } = await signIn(USER_A);
        const claims = jwt.decode(accessToken);
        const refreshClaims = jwt.decode(refreshToken);
        expect(claims.refreshToken).toBeUndefined();
        expect(Object.values(claims)).not.toContain(refreshToken);
        expect(accessToken).not.toContain(refreshToken);
        expect(claims).toMatchObject({ uid: USER_A, sid: sessionId, rti: refreshClaims.jti, sexp: refreshClaims.exp, aud: COMPANY });
    });

    it('is not minted from a token that is not a current refresh token', async () => {
        await expect(accessTokenFor(USER_A, jwt.sign({}, process.env.JWT_SECRET, { expiresIn: 60 }))).rejects.toThrow();
    });
});

describe.each([
    ['verifyJWTTokenV2', verifyJWTTokenV2, {}],
    ['verifyJWTTokenWithCV2', verifyJWTTokenWithCV2, { companyid: COMPANY }],
])('%s', (name, verifier, headers) => {
    beforeEach(() => { myCache.set(`membership:${USER_A}:${COMPANY}`, true, 600); });

    it('lets a live session through and names it on the request', async () => {
        const { sessionId, accessToken } = await signIn(USER_A);
        const out = await throughMiddleware(accessToken, { verifier, headers });
        expect(out.passed).toBe(true);
        expect(out.req.uid).toBe(USER_A);
        expect(out.req.sessionId).toBe(sessionId);
        expect(out.req.refreshToken).toBeUndefined();
    });

    it('checks the session store when the cache is cold', async () => {
        const { accessToken } = await signIn(USER_A);
        myCache.keys().filter((key) => key.startsWith('session:')).forEach((key) => myCache.del(key));
        expect((await throughMiddleware(accessToken, { verifier, headers })).passed).toBe(true);
    });

    it('sends an access token issued before this change to refresh, without logging out', async () => {
        const { refreshToken } = await signIn(USER_A);
        const legacy = jwt.sign({ uid: USER_A, refreshToken }, process.env.JWT_SECRET, { audience: COMPANY, expiresIn: '1h' });
        const out = await throughMiddleware(legacy, { verifier, headers });
        expect(out.passed).toBe(false);
        expect(out.status).toBe(401);
        expect(out.body.isJwtError).toBe(true);
        expect(out.body.isLogout).toBeUndefined();
        expect(out.cookies.refreshToken).toBeUndefined();
        expect(sessionsOf(USER_A)).toHaveLength(1);
    });

    it('logs out an access token whose session was signed out', async () => {
        const { accessToken } = await signIn(USER_A);
        await new Promise((resolve) => sessionCtr.deleteSessionFun(USER_A, resolve));
        myCache.flushAll();
        myCache.set(`membership:${USER_A}:${COMPANY}`, true, 600);
        const out = await throughMiddleware(accessToken, { verifier, headers });
        expect(out.passed).toBe(false);
        expect(out.status).toBe(401);
        expect(out.body.isLogout).toBe(true);
    });

    it('logs out and removes the session once the refresh token lifetime is over', async () => {
        process.env.SESSIONEXPIREDTIME = '60';
        try {
            const { accessToken } = await signIn(USER_A);
            clockAt(NOW + 120 * 1000);
            const out = await throughMiddleware(accessToken, { verifier, headers });
            expect(out.passed).toBe(false);
            expect(out.body.isLogout).toBe(true);
            await new Promise(setImmediate);
            expect(sessionsOf(USER_A)).toHaveLength(0);
        } finally {
            delete process.env.SESSIONEXPIREDTIME;
        }
    });

    it('refuses a refresh token presented as the access token', async () => {
        const { refreshToken } = await signIn(USER_A);
        const out = await throughMiddleware(refreshToken, { verifier, headers });
        expect(out.passed).toBe(false);
        expect(out.status).toBe(401);
    });

    it("refuses a token that names another user's session", async () => {
        myCache.set(`membership:${USER_B}:${COMPANY}`, true, 600);
        const a = await signIn(USER_A);
        const claims = jwt.decode(a.accessToken);
        const stolen = jwt.sign(
            { uid: USER_B, sid: claims.sid, rti: claims.rti, sexp: claims.sexp },
            process.env.JWT_SECRET,
            { audience: COMPANY, algorithm: process.env.JWT_ALGORITHM, expiresIn: '1h' }
        );
        const out = await throughMiddleware(stolen, { verifier, headers });
        expect(out.passed).toBe(false);
        expect(out.status).toBe(401);
        expect(out.body.isLogout).toBe(true);
    });
});

describe('verifyJWTTokenV2 and tokens that name no session', () => {
    it('refuses a signed token with an empty payload, as before', async () => {
        const out = await throughMiddleware(generateToken(600));
        expect(out.passed).toBe(false);
        expect(out.status).toBe(401);
        expect(out.body.isLogout).toBe(true);
    });
});

describe('session routes use the verified session id', () => {
    it('logs out only the session the access token names, whatever the body says', async () => {
        const a1 = await signIn(USER_A);
        const a2 = await signIn(USER_A);
        const b = await signIn(USER_B);
        const { req } = await throughMiddleware(a1.accessToken, { body: { id: USER_A, refreshToken: b.refreshToken } });
        const done = await new Promise((resolve) => sessionCtr.removeSession(req, resolve));
        expect(done.status).toBe(true);
        expect(sessions().map((s) => String(s._id)).sort()).toEqual([a2.sessionId, b.sessionId].sort());
    });

    it('updates the web push token and last activity of the calling session only', async () => {
        const a1 = await signIn(USER_A);
        const a2 = await signIn(USER_A);
        const { req } = await throughMiddleware(a1.accessToken, { body: { userId: USER_B, updateObject: { webToken: 'fcm-1', lastActive: new Date(NOW).toISOString() } } });
        const res = await call(sessionCtr.updateSession, req);
        expect(res.statusCode).toBe(200);
        const [row1] = sessions().filter((s) => String(s._id) === a1.sessionId);
        const [row2] = sessions().filter((s) => String(s._id) === a2.sessionId);
        expect(row1.webToken).toBe('fcm-1');
        expect(row2.webToken).toBeUndefined();
    });

    it.each([
        [{ userId: USER_B }],
        [{ $set: { refreshToken: 'x' } }],
        [{ trackerCodeHash: 'x' }],
        [{ webToken: { $gt: '' } }],
    ])('refuses a session update that touches anything else: %j', async (updateObject) => {
        const a1 = await signIn(USER_A);
        const { req } = await throughMiddleware(a1.accessToken, { body: { updateObject } });
        const res = await call(sessionCtr.updateSession, req);
        expect(res.statusCode).toBe(400);
        const [row] = sessionsOf(USER_A);
        expect(row.userId).toBe(USER_A);
        expect(row.refreshToken).toBeUndefined();
        expect(row.trackerCodeHash).toBeUndefined();
    });
});

describe('tracker sign-in with a one-time code', () => {
    const issueCode = async (accessToken) => {
        const { passed, req } = await throughMiddleware(accessToken);
        expect(passed).toBe(true);
        return call(loginSession.issueTrackerCode, req);
    };

    it('issues a short random code, stores only its hash, and exchanges it once for a new session', async () => {
        const browser = await signIn(USER_A);
        const issued = await issueCode(browser.accessToken);
        expect(issued.statusCode).toBe(200);
        const { code } = issued.body.data;
        expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.stringify(sessions())).not.toContain(code);

        const tracker = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A } });
        expect(refused(tracker)).toBe(false);
        expect(tracker.body.uid).toBe(USER_A);
        expect(jwt.decode(tracker.body.accessToken)).toMatchObject({ uid: USER_A });
        expect(jwt.decode(tracker.body.accessToken).refreshToken).toBeUndefined();
        expect(jwt.decode(tracker.body.refreshToken)).toMatchObject({ sub: USER_A, typ: 'refresh' });
        expect(sessionsOf(USER_A)).toHaveLength(2);
        expect((await throughMiddleware(tracker.body.accessToken)).passed).toBe(true);

        const again = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A } });
        expect(refused(again)).toBe(true);
        expect(again.body.accessToken).toBeUndefined();
        expect(sessionsOf(USER_A)).toHaveLength(2);
    });

    it('accepts the code in the field older tracker builds send the deep-link value in', async () => {
        const browser = await signIn(USER_A);
        const { code } = (await issueCode(browser.accessToken)).body.data;
        const tracker = await call(loginSession.loginAuthTracker, { body: { refreshToken: code, userId: USER_A } });
        expect(refused(tracker)).toBe(false);
        expect(tracker.body.uid).toBe(USER_A);
    });

    it('refuses an expired code', async () => {
        const browser = await signIn(USER_A);
        const { code } = (await issueCode(browser.accessToken)).body.data;
        clockAt(NOW + 10 * 60 * 1000);
        expect(refused(await call(loginSession.loginAuthTracker, { body: { code } }))).toBe(true);
    });

    it("refuses a code presented with another user's id", async () => {
        const browser = await signIn(USER_A);
        const { code } = (await issueCode(browser.accessToken)).body.data;
        const res = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_B } });
        expect(refused(res)).toBe(true);
        expect(res.body.accessToken).toBeUndefined();
    });

    it('refuses a refresh token in place of a code', async () => {
        const browser = await signIn(USER_A);
        const res = await call(loginSession.loginAuthTracker, { body: { refreshToken: browser.refreshToken, userId: USER_A } });
        expect(refused(res)).toBe(true);
        expect(sessionsOf(USER_A)).toHaveLength(1);
    });

    it('drops an unused code when the browser session that issued it signs out', async () => {
        const browser = await signIn(USER_A);
        const { code } = (await issueCode(browser.accessToken)).body.data;
        const { req } = await throughMiddleware(browser.accessToken, { body: { id: USER_A } });
        await new Promise((resolve) => sessionCtr.removeSession(req, resolve));
        expect(refused(await call(loginSession.loginAuthTracker, { body: { code } }))).toBe(true);
    });

    it('refuses to issue a code without a verified session', async () => {
        const res = await call(loginSession.issueTrackerCode, { uid: USER_A });
        expect(res.statusCode).toBe(401);
    });

    it('declares the code fields, so the strict sessions schema keeps them', () => {
        const { sessionsSchema } = require('../utils/mongo-handler/createSchema');
        ['trackerCodeHash', 'trackerCodeExpiresAt', 'trackerCodeChallenge'].forEach((field) => expect(sessionsSchema.path(field)).toBeDefined());
    });
});

describe('tracker sign-in bound to the tracker that asked for it (PKCE)', () => {
    const VERIFIER = crypto.randomBytes(32).toString('base64url');
    const OTHER_VERIFIER = crypto.randomBytes(32).toString('base64url');
    const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');
    const issueCode = async (accessToken, body = {}) => {
        const { passed, req } = await throughMiddleware(accessToken, { body });
        expect(passed).toBe(true);
        return call(loginSession.issueTrackerCode, req);
    };
    const boundCode = async () => {
        const res = await issueCode((await signIn(USER_A)).accessToken, { codeChallenge: challengeOf(VERIFIER) });
        expect(res.statusCode).toBe(200);
        return res.body.data.code;
    };

    it('stores the challenge and never the verifier', async () => {
        await boundCode();
        expect(JSON.stringify(sessions())).toContain(challengeOf(VERIFIER));
        expect(JSON.stringify(sessions())).not.toContain(VERIFIER);
    });

    it('exchanges a bound code for the matching verifier', async () => {
        const code = await boundCode();
        const tracker = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A, codeVerifier: VERIFIER } });
        expect(refused(tracker)).toBe(false);
        expect(tracker.body.uid).toBe(USER_A);
    });

    it('refuses a bound code presented with another verifier, and spends it', async () => {
        const code = await boundCode();
        const wrong = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A, codeVerifier: OTHER_VERIFIER } });
        expect(refused(wrong)).toBe(true);
        expect(wrong.body.accessToken).toBeUndefined();
        const retry = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A, codeVerifier: VERIFIER } });
        expect(refused(retry)).toBe(true);
        expect(sessionsOf(USER_A)).toHaveLength(1);
    });

    it('refuses a bound code presented with no verifier, whatever the legacy window says', async () => {
        const code = await boundCode();
        expect(refused(await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A } }))).toBe(true);
    });

    it('refuses a code challenge that is not a base64url sha-256 digest', async () => {
        const res = await issueCode((await signIn(USER_A)).accessToken, { codeChallenge: 'not-a-challenge' });
        expect(res.statusCode).toBe(400);
        expect(res.body.data).toBeUndefined();
    });

    it('still signs in a tracker build that sends no verifier while the legacy window is open', async () => {
        const code = (await issueCode((await signIn(USER_A)).accessToken)).body.data.code;
        const tracker = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A } });
        expect(refused(tracker)).toBe(false);
        expect(tracker.body.uid).toBe(USER_A);
    });

    it('refuses a tracker build that sends no verifier once TRACKER_PKCE_LEGACY_UNTIL has passed', async () => {
        process.env.TRACKER_PKCE_LEGACY_UNTIL = new Date(NOW - 1000).toISOString();
        try {
            const code = (await issueCode((await signIn(USER_A)).accessToken)).body.data.code;
            const res = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A } });
            expect(refused(res)).toBe(true);
            expect(res.body.accessToken).toBeUndefined();
        } finally {
            delete process.env.TRACKER_PKCE_LEGACY_UNTIL;
        }
    });

    it('keeps a bound code working after the legacy window closes', async () => {
        process.env.TRACKER_PKCE_LEGACY_UNTIL = new Date(NOW - 1000).toISOString();
        try {
            const code = await boundCode();
            const tracker = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A, codeVerifier: VERIFIER } });
            expect(refused(tracker)).toBe(false);
            expect(tracker.body.uid).toBe(USER_A);
        } finally {
            delete process.env.TRACKER_PKCE_LEGACY_UNTIL;
        }
    });

    it('drops the challenge left by an earlier code when the next one carries none', async () => {
        const browser = await signIn(USER_A);
        await issueCode(browser.accessToken, { codeChallenge: challengeOf(VERIFIER) });
        const code = (await issueCode(browser.accessToken)).body.data.code;
        const tracker = await call(loginSession.loginAuthTracker, { body: { code, userId: USER_A } });
        expect(refused(tracker)).toBe(false);
    });
});
