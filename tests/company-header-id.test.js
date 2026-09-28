jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));

const { myCache } = require('../Config/config');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000f01';
const USER = '6f0000000000000000000021';

let app;
let reached;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        server.all('/api/v1/getEnv', (req, res) => {
            reached = true;
            res.json({ status: true });
        });
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    reached = false;
});

describe('routes guarded by requireCompanyAud take only a company id in the companyid header', () => {
    it.each([
        ['a database name', 'admin'],
        ['a bucket name', 'USER_PROFILES'],
        ['a pattern', '.*'],
        ['an id with extra characters', `${COMPANY}x`],
    ])('refuses %s', async (_label, header) => {
        const token = signSession(USER, [COMPANY]);
        const res = await app.call('get', '/api/v1/getEnv', { token, companyId: header });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'Invalid company id' });
        expect(reached).toBe(false);
    });

    it('still lets a request through with no companyid header', async () => {
        const token = signSession(USER, [COMPANY]);
        const res = await app.call('get', '/api/v1/getEnv', { token });
        expect(res.status).toBe(200);
    });

    it('still lets a request through with a company id from the token', async () => {
        const token = signSession(USER, [COMPANY]);
        const res = await app.call('get', '/api/v1/getEnv', { token, companyId: COMPANY });
        expect(res.status).toBe(200);
    });

    it('still lets a body name the profile-picture bucket, which has its own checks', async () => {
        const token = signSession(USER, [COMPANY]);
        const res = await app.call('post', '/api/v1/getEnv', { token, companyId: COMPANY, body: { companyId: 'USER_PROFILES' } });
        expect(res.status).toBe(200);
    });
});
