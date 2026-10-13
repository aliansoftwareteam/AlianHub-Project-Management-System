process.env.JWT_SECRET = process.env.JWT_SECRET || 'session-cookie-refresh-test-secret';
process.env.JWT_EXP = process.env.JWT_EXP || '24h';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Auth/helpers/refreshSession', () => ({ resolveRefreshSession: jest.fn(), rotateRefreshSession: jest.fn() }));

/* Sprint 8 slice 11: the refresh endpoint reads the refresh cookie when the
 * client sent no refresh-token header. */
const { resolveRefreshSession, rotateRefreshSession } = require('../Modules/Auth/helpers/refreshSession');
const { generateTokenV2 } = require('../Modules/Auth/controller/loginSession');

const UID = '6f0000000000000000000001';
const COOKIE_TOKEN = 'cookie-refresh-token';
const HEADER_TOKEN = 'header-refresh-token';

const res = () => {
    const r = { code: 200, cleared: [] };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.cookie = () => r;
    r.clearCookie = (name, options) => { r.cleared.push([name, options]); return r; };
    return r;
};

const call = (headers) => {
    const out = res();
    return generateTokenV2({ headers, body: { uid: UID }, ip: '127.0.0.1' }, out).then(() => out);
};

beforeEach(() => {
    jest.clearAllMocks();
    resolveRefreshSession.mockResolvedValue({ ok: true });
    rotateRefreshSession.mockResolvedValue({ ok: false, reason: 'nope' });
});

describe('generateTokenV2', () => {
    it('resolves the refresh session from the cookie with no header sent', async () => {
        await call({ cookie: `refreshToken=${COOKIE_TOKEN}` });
        expect(resolveRefreshSession).toHaveBeenCalledWith(COOKIE_TOKEN, UID);
    });

    it('prefers an explicit refresh-token header over the cookie', async () => {
        await call({ 'refresh-token': HEADER_TOKEN, cookie: `refreshToken=${COOKIE_TOKEN}` });
        expect(resolveRefreshSession).toHaveBeenCalledWith(HEADER_TOKEN, UID);
    });

    it('still asks for a refresh token with neither', async () => {
        const out = await call({});
        expect(out.code).toBe(400);
        expect(out.body).toMatchObject({ status: false });
        expect(resolveRefreshSession).not.toHaveBeenCalled();
    });
});
