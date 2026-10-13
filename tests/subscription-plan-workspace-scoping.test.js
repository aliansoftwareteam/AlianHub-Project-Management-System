jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, MEMBER, OWNER, serveModule, seedSeats, tokenFor } = require('./fixtures/workspaceScoping');

/* The plan catalogue is product content shared by every workspace: it lives in the global database and no row of it belongs to a workspace. */
let plan;
const READS = [
    { method: 'GET', path: () => '/api/v1/subscription' },
    { method: 'POST', path: () => '/api/v1/subscription/find', body: () => ({}) },
    { method: 'GET', path: () => `/api/v1/subscription/${plan._id}` },
];
const ROUTES = [...READS, { method: 'PUT', path: () => '/api/v1/subscription', body: () => ({ query: [{ _id: String(plan._id) }, { $set: { name: 'Renamed' } }] }) }];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/SubscriptionPlan/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    plan = mockDb.seed(SCHEMA_TYPE.SUBSCRIPTIONPLAN, { name: 'Pro' });
    mockDb.calls.length = 0;
});

const call = (route, uid) => app.call(route.method, route.path(), { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: route.body && route.body() });

describe.each(ROUTES)('$method $path', (route) => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await call(route, null);
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
        expect(mockDb.store[SCHEMA_TYPE.SUBSCRIPTIONPLAN].map((row) => row.name)).toEqual(['Pro']);
    });
});

describe.each(READS)('$method $path', (route) => {
    it.each([[OWNER], [MEMBER]])('reads only the global plan catalogue, and writes nothing (%s)', async (uid) => {
        const res = await call(route, uid);
        expect(res.status).toBe(200);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((c) => c.companyId === 'global' && c.type === SCHEMA_TYPE.SUBSCRIPTIONPLAN && ['find', 'findOne', 'aggregate'].includes(c.method))).toBe(true);
    });
});
