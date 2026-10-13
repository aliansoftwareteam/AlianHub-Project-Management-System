jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, MEMBER, OWNER, ADMIN, serveModule, seedSeats, tokenFor } = require('./fixtures/workspaceScoping');

const GUEST = '6f00000000000000000000a4';
const PATH = '/api/v1/subscriptions';

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/subscription/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    delete process.env.INSTANCE_ADMIN_KEY;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(dbCollections.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false, companyId: WORKSPACE });
    mockDb.seed(dbCollections.USERS, { _id: OWNER, isProductOwner: true });
    [ADMIN, MEMBER, GUEST].forEach((id) => mockDb.seed(dbCollections.USERS, { _id: id, isProductOwner: false }));
    mockDb.seed(SCHEMA_TYPE.SUBSCRIPTIONS, { subscriptionId: 'sub_1', companyId: WORKSPACE });
    mockDb.calls.length = 0;
});

describe(`GET ${PATH}/:id`, () => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call('GET', `${PATH}/sub_1`, { companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });
});

describe(`POST ${PATH}`, () => {
    const post = (uid) => app.call('POST', PATH, { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: { findQuery: [{ $match: {} }] } });
    const aggregates = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.SUBSCRIPTIONS);

    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await post(null);
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[ADMIN, 'a workspace admin'], [MEMBER, 'a member'], [GUEST, 'a guest']])('refuses %s with 403, and never reads the subscriptions', async (uid) => {
        const res = await post(uid);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(aggregates()).toEqual([]);
    });

    it('refuses an unknown admin key from a caller without a session', async () => {
        process.env.INSTANCE_ADMIN_KEY = 'right-key';
        const res = await app.call('POST', PATH, { companyId: WORKSPACE, body: { findQuery: [] } });
        expect(res.status).toBe(401);
        expect(aggregates()).toEqual([]);
    });

    it('lets the instance owner read the subscriptions, from the global database', async () => {
        const res = await post(OWNER);
        expect(res.status).toBe(200);
        expect(aggregates().every((c) => c.companyId === 'global' && c.method === 'aggregate')).toBe(true);
    });
});
