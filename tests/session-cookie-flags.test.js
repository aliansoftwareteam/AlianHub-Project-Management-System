process.env.JWT_SECRET = 'session-cookie-flags-test-secret';
process.env.JWT_ALGORITHM = 'HS256';
process.env.JWT_EXP = '24h';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Auth/helpers/refreshSession', () => {
    const actual = jest.requireActual('../Modules/Auth/helpers/refreshSession');
    return { resolveRefreshSession: jest.fn(), rotateRefreshSession: jest.fn(), newSessionCredentials: actual.newSessionCredentials };
});
jest.mock('../Modules/Auth/controller/authHelpers', () => {
    const actual = jest.requireActual('../Modules/Auth/controller/authHelpers');
    return { ...actual, generateTokenV2Fun: jest.fn((uid, refreshToken, cb) => cb({ status: true, token: 'access-token' })) };
});

/* Sprint 8 slice 11: session cookies are httpOnly behind SESSION_COOKIE_HTTPONLY. */
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { resolveRefreshSession, rotateRefreshSession } = require('../Modules/Auth/helpers/refreshSession');
const { finalizeSession, generateTokenV2 } = require('../Modules/Auth/controller/loginSession');
const { finalizeSsoSession } = require('../Modules/SSO/ssoSession');

const UID = '6f0000000000000000000001';
const FLAG = 'SESSION_COOKIE_HTTPONLY';
const savedFlag = process.env[FLAG];

const res = () => {
    const r = { code: 200, cookies: [] };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.cookie = (name, value, options) => { r.cookies.push([name, options]); return r; };
    r.redirect = (url) => { r.redirected = url; return r; };
    return r;
};

const req = (over = {}) => ({ headers: { 'user-agent': 'jest', ...over.headers }, ip: '127.0.0.1', hostname: 'app.test', body: {}, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb.seed(dbCollections.USERS, { _id: UID, Employee_Email: 'u@example.test', isEmailVerified: true, AssignCompany: [] });
    resolveRefreshSession.mockResolvedValue({ ok: true });
});

afterEach(() => {
    if (savedFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = savedFlag;
});

const login = async () => {
    const out = res();
    await new Promise((resolve) => {
        const original = out.json.bind(out);
        out.json = (body) => { original(body); resolve(body); };
        finalizeSession(req(), out, UID, () => resolve(null));
    });
    return out;
};

describe('session cookie flags', () => {
    it('marks login cookies httpOnly only with the flag on', async () => {
        for (const [value, expected] of [['on', true], ['off', false], [undefined, false]]) {
            if (value === undefined) delete process.env[FLAG];
            else process.env[FLAG] = value;
            // eslint-disable-next-line no-await-in-loop
            const out = await login();
            expect(out.cookies.map(([name]) => name).sort()).toEqual(['accessToken', 'refreshToken']);
            expect(out.cookies.every(([, options]) => options.httpOnly === expected)).toBe(true);
        }
    });

    it('marks rotated refresh cookies httpOnly with the flag on', async () => {
        process.env[FLAG] = 'true';
        rotateRefreshSession.mockResolvedValue({ ok: true, userId: UID, refreshToken: 'new-refresh', expiresAt: Date.now() / 1000 + 3600 });
        const out = res();
        await generateTokenV2(req({ headers: { 'refresh-token': 'old-refresh' } }), out);
        expect(out.code).toBe(200);
        expect(out.cookies.map(([name]) => name).sort()).toEqual(['accessToken', 'refreshToken']);
        expect(out.cookies.every(([, options]) => options.httpOnly === true)).toBe(true);
    });

    it('marks SSO cookies httpOnly with the flag on', async () => {
        process.env[FLAG] = '1';
        const out = res();
        await new Promise((resolve) => {
            const original = out.redirect.bind(out);
            out.redirect = (url) => { original(url); resolve(url); };
            finalizeSsoSession(req(), out, UID, '/home');
        });
        expect(out.redirected).toBe('/home');
        expect(out.cookies.map(([name]) => name).sort()).toEqual(['accessToken', 'refreshToken']);
        expect(out.cookies.every(([, options]) => options.httpOnly === true)).toBe(true);
    });
});
