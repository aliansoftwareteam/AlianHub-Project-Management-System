process.env.JWT_SECRET = process.env.JWT_SECRET || 'session-refresh-token-test-secret';

const mockCrud = jest.fn(async () => ({ _id: 'session', deletedCount: 1 }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockCrud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => JSON.stringify({ _id: 'session' }), set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const jsonwebtoken = require('jsonwebtoken');
const { verifyJWTTokenV2 } = require('../Config/jwt');
const { validateSettings } = require('../Modules/Instance/settingsCatalog');
const session = require('../Modules/Auth/session');

const UID = '6f0000000000000000000001';
const SID = '6f00000000000000000005e1';

const signedRequest = (body) => {
    const sexp = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = jsonwebtoken.sign({ uid: UID, sid: SID, rti: 'refresh-jti', sexp }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { req: { headers: { authorization: `Bearer ${accessToken}` }, body } };
};

const res = () => {
    const r = { code: 200, clearCookie: () => r };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const passThrough = (req) => new Promise((resolve) => verifyJWTTokenV2(req, res(), resolve));

beforeEach(() => mockCrud.mockClear());

describe('INS-07 the session middleware and the request body', () => {
    it('keeps session details out of the body so strict validators accept it', async () => {
        const { req } = signedRequest({ APP_NAME: 'Renamed' });
        await passThrough(req);
        expect(req.body).toEqual({ APP_NAME: 'Renamed' });
        expect(req.sessionId).toBe(SID);
        expect(req.refreshToken).toBeUndefined();
        expect(validateSettings(req.body)).toMatchObject({ valid: true, values: { APP_NAME: 'Renamed' } });
    });

    it('updates the session named by the verified token, not the body', async () => {
        const { req } = signedRequest({ userId: '6f0000000000000000000002', refreshToken: 'someone-else', updateObject: { lastActive: new Date().toISOString() } });
        await passThrough(req);
        const out = res();
        session.updateSession(req, out);
        await new Promise(setImmediate);
        const [, query] = mockCrud.mock.calls.find(([, q, method]) => q.type === 'sessions' && method === 'findOneAndUpdate');
        expect(String(query.data[0]._id)).toBe(SID);
        expect(query.data[0].userId).toBe(UID);
        expect(out.code).toBe(200);
    });

    it('logs out the session named by the verified token', async () => {
        const { req } = signedRequest({ id: UID, refreshToken: 'someone-else' });
        await passThrough(req);
        const done = jest.fn();
        session.removeSession(req, done);
        await new Promise(setImmediate);
        const [, query] = mockCrud.mock.calls.find(([, q, method]) => q.type === 'sessions' && method === 'deleteMany');
        expect(String(query.data[0]._id)).toBe(SID);
        expect(query.data[0].userId).toBe(UID);
        expect(done).toHaveBeenCalledWith(expect.objectContaining({ status: true }));
    });
});
