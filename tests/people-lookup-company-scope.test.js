jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';
[
    '../Modules/ImportSettings/controller.js', '../Modules/notification/defaults', '../Modules/Knowledge/vectorStore',
    '../Modules/Auth/controller/helper.js', '../Modules/Auth/controller.js', '../Modules/Company/eventController.js',
    '../Modules/service.js', '../Modules/serviceFunction.js', '../Modules/Affiliate/controller.js',
    '../common-storage/common-server.js', '../Modules/createProject/sampleProject.js', '../Modules/createProject/sampleTasks.js',
].forEach((path) => jest.mock(path, () => ({})));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const companyCtrl = require('../Modules/Company/controller');

const COMPANY = '6f0000000000000000000c01';
const CALLER = '6f0000000000000000000001';
const OUTSIDER = '6f0000000000000000000009';
const UNKNOWN = '6f00000000000000000000ff';

const OWNED_COMPANIES = {
    [CALLER]: ['Caller Co'],
    [OUTSIDER]: ['Elsewhere Inc', 'Elsewhere Labs'],
};

let app;
const previousFreeCount = process.env.FREE_COMPANY_COUNT;

beforeAll(async () => {
    process.env.FREE_COMPANY_COUNT = '2';
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        server.get('/api/v1/freeCompanyCount/:userId', companyCtrl.checkFreeCompanyCountsApi);
    });
});
afterAll(() => {
    if (previousFreeCount === undefined) delete process.env.FREE_COMPANY_COUNT;
    else process.env.FREE_COMPANY_COUNT = previousFreeCount;
    return app.close();
});

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === dbCollections.COMPANIES && method === 'aggregate') {
            const owner = String(obj.data[0][0].$match.userId);
            const names = OWNED_COMPANIES[owner];
            return names ? [{ defaultSubscriptionCount: names.length, Cst_CompanyName: names }] : [];
        }
        return null;
    });
});

describe('GET /api/v1/freeCompanyCount/:userId', () => {
    const lookup = (userId) => app.call('GET', `/api/v1/freeCompanyCount/${userId}`, { token: signSession(CALLER, [COMPANY]) });

    it('answers for a user of another company exactly as for an unknown user', async () => {
        const outsider = await lookup(OUTSIDER);
        const unknown = await lookup(UNKNOWN);

        expect(outsider.status).toBe(unknown.status);
        expect(outsider.body).toEqual(unknown.body);
        expect(JSON.stringify(outsider.body)).not.toContain('Elsewhere');
    });

    it('still answers the caller about their own companies', async () => {
        const own = await lookup(CALLER);

        expect(own.status).toBe(200);
        expect(own.body).toMatchObject({ status: true, isFree: true, companies: ['Caller Co'] });
    });
});
