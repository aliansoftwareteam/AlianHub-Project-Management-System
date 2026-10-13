jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000d01';
const MEMBER = '6f0000000000000000000011';

const ROUTES = [
    ['get', '/api/v1/dashboard/6f0000000000000000000e01'],
    ['post', '/api/v1/dashboard'],
    ['post', '/api/v1/dashboard/my-time'],
    ['post', '/api/v1/dashboard/tasks-by-status'],
    ['get', '/api/v1/cardcomponent'],
    ['get', '/api/v1/dashboards'],
    ['post', '/api/v1/dashboards'],
    ['get', '/api/v1/dashboards/6f0000000000000000000e01'],
    ['put', '/api/v1/dashboards/6f0000000000000000000e01/cards'],
    ['delete', '/api/v1/dashboards/6f0000000000000000000e01'],
];

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        const reached = (req, res) => res.json({ status: true, uid: req.uid, companyId: req.headers.companyid });
        server.all(/^\/api\/v1\/(dashboards?|cardcomponent)(\/.*)?$/, reached);
    });
});
afterAll(() => app.close());

let seatActive;
beforeEach(() => {
    myCache.flushAll();
    seatActive = true;
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === SCHEMA_TYPE.USERS && method === 'findOne') return { _id: MEMBER, AssignCompany: [COMPANY] };
        if (obj.type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return seatActive ? { _id: 'seat' } : null;
        return null;
    });
});

const signedIn = () => {
    const token = signSession(MEMBER, [COMPANY]);
    myCache.del(`membership:${MEMBER}:${COMPANY}`);
    return token;
};

describe('dashboard routes check the live seat like other signed-in company routes', () => {
    it.each(ROUTES)('%s %s refuses a caller whose seat was removed', async (method, path) => {
        const token = signedIn();
        seatActive = false;
        const res = await app.call(method, path, { token, companyId: COMPANY, body: method === 'get' || method === 'delete' ? undefined : {} });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'You are no longer a member of this company' });
    });

    it.each(ROUTES)('%s %s lets an active member through', async (method, path) => {
        const token = signedIn();
        const res = await app.call(method, path, { token, companyId: COMPANY, body: method === 'get' || method === 'delete' ? undefined : {} });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, uid: MEMBER, companyId: COMPANY });
    });

    it.each([
        ['without a company header', undefined],
        ['with a company header that is not an id', 'not-a-company'],
    ])('refuses a request %s', async (label, companyId) => {
        const token = signedIn();
        const res = await app.call('get', '/api/v1/dashboards', { token, companyId });
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ status: false });
    });
});
