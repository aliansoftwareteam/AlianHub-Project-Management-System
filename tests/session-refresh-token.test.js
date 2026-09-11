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

const signedRequest = (body) => {
    const refreshToken = jsonwebtoken.sign({ kind: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const accessToken = jsonwebtoken.sign({ uid: UID, refreshToken }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { refreshToken, req: { headers: { authorization: `Bearer ${accessToken}` }, body } };
};

const res = () => {
    const r = { code: 200, clearCookie: () => r };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

beforeEach(() => mockCrud.mockClear());

describe('INS-07 the session middleware and the request body', () => {
    it('keeps the refresh token out of the body so strict validators accept it', async () => {
        const { refreshToken, req } = signedRequest({ APP_NAME: 'Renamed' });
        const next = jest.fn();
        verifyJWTTokenV2(req, res(), next);
        expect(next).toHaveBeenCalled();
        expect(req.body).toEqual({ APP_NAME: 'Renamed' });
        expect(req.refreshToken).toBe(refreshToken);
        expect(validateSettings(req.body)).toMatchObject({ valid: true, values: { APP_NAME: 'Renamed' } });
    });

    it('updates the session named by the verified token, not the body', async () => {
        const { refreshToken, req } = signedRequest({ userId: UID, refreshToken: 'someone-else', updateObject: { $set: { lastActive: 1 } } });
        verifyJWTTokenV2(req, res(), () => {});
        const out = res();
        session.updateSession(req, out);
        await new Promise(setImmediate);
        const [, query] = mockCrud.mock.calls.find(([, q, method]) => q.type === 'sessions' && method === 'findOneAndUpdate');
        expect(query.data[0]).toEqual({ refreshToken, userId: UID });
        expect(out.code).toBe(200);
    });

    it('logs out the session named by the verified token', async () => {
        const { refreshToken, req } = signedRequest({ id: UID });
        verifyJWTTokenV2(req, res(), () => {});
        const done = jest.fn();
        session.removeSession(req, done);
        await new Promise(setImmediate);
        const [, query] = mockCrud.mock.calls.find(([, q, method]) => q.type === 'sessions' && method === 'deleteMany');
        expect(query.data[0]).toEqual({ userId: UID, refreshToken });
        expect(done).toHaveBeenCalledWith(expect.objectContaining({ status: true }));
    });
});
