jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const PATH = '/api/v1/projects-apps';

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Apps/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(SCHEMA_TYPE.APPS, { key: 'Board' });
    mockDb.calls.length = 0;
});

describe(`GET ${PATH}`, () => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call('GET', PATH, { companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call('GET', PATH, { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[OWNER], [MEMBER]])('names the caller\'s workspace in every database call (%s)', async (uid) => {
        const res = await app.call('GET', PATH, { token: tokenFor(uid), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(res.body.data.map((row) => row.key)).toEqual(['Board']);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });

    it('never answers from the cached apps of another workspace', async () => {
        myCache.set(`apps:${OTHER_WORKSPACE}`, [{ key: 'OtherOnly' }], 600);
        const res = await app.call('GET', PATH, { token: tokenFor(MEMBER, [WORKSPACE, OTHER_WORKSPACE]), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(res.body.data.map((row) => row.key)).toEqual(['Board']);
        expect(myCache.get(`apps:${WORKSPACE}`).map((row) => row.key)).toEqual(['Board']);
    });

    it('serves each workspace its own cached apps when one token holds both', async () => {
        myCache.set(`apps:${OTHER_WORKSPACE}`, [{ key: 'OtherOnly' }], 600);
        const res = await app.call('GET', PATH, { token: tokenFor(MEMBER, [WORKSPACE, OTHER_WORKSPACE]), companyId: OTHER_WORKSPACE });
        expect(res.body.data.map((row) => row.key)).toEqual(['OtherOnly']);
        expect(mockDb.calls).toEqual([]);
    });
});
