process.env.JWT_SECRET = process.env.JWT_SECRET || 'session-cookie-auth-test-secret';

const mockCrud = jest.fn(async () => ({ _id: 'session', deletedCount: 1 }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => JSON.stringify({ _id: 'session' }), set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

/* Sprint 8 slice 11: the JWT middleware reads the session cookie when the
 * client sent no Authorization header. An explicit header always wins. */
const jsonwebtoken = require('jsonwebtoken');
const { verifyJWTTokenV2, verifyJWTTokenWithCV2 } = require('../Config/jwt');

const COMPANY = '6f0000000000000000000c01';
const U1 = '6f0000000000000000000001';
const U2 = '6f0000000000000000000002';

const sign = (uid) => jsonwebtoken.sign(
    { uid, sid: '6f00000000000000000005e1', rti: 'refresh-jti', sexp: Math.floor(Date.now() / 1000) + 3600 },
    process.env.JWT_SECRET,
    { expiresIn: '1h', audience: COMPANY },
);

const res = () => {
    const r = { code: 200, cleared: [] };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.clearCookie = (name, options) => { r.cleared.push([name, options]); return r; };
    return r;
};

const through = (middleware, headers) => new Promise((resolve) => {
    const req = { headers, ip: '127.0.0.1' };
    const out = res();
    middleware(req, out, () => resolve({ req, res: out, passed: true }));
    setImmediate(() => resolve({ req, res: out, passed: out.code === 200 && out.body === undefined }));
});

describe.each([
    ['verifyJWTTokenV2', verifyJWTTokenV2],
    ['verifyJWTTokenWithCV2', verifyJWTTokenWithCV2],
])('%s', (_, middleware) => {
    it('authenticates from the session cookie with no Authorization header', async () => {
        const token = sign(U1);
        const { req, passed } = await through(middleware, { cookie: `accessToken=${token}`, companyid: COMPANY });
        expect(passed).toBe(true);
        expect(req.uid).toBe(U1);
    });

    it('prefers an explicit header over the cookie', async () => {
        const { req, passed } = await through(middleware, {
            authorization: `Bearer ${sign(U2)}`,
            cookie: `accessToken=${sign(U1)}`,
            companyid: COMPANY,
        });
        expect(passed).toBe(true);
        expect(req.uid).toBe(U2);
    });

    it('still refuses with neither a header nor a cookie', async () => {
        const { passed, res: out } = await through(middleware, { companyid: COMPANY });
        expect(passed).toBe(false);
        expect(out.code).toBe(401);
    });
});
