jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const PROJECT = '6f0000000000000000000d01';
const SPRINT = '6f0000000000000000000d02';
const SELECTED = JSON.stringify({ _id: PROJECT, ProjectID: PROJECT, sprintId: SPRINT });

const ROUTES = [
    { method: 'GET', path: `/api/v1/mediaFiles?handleType=project&selectedData=${encodeURIComponent(SELECTED)}&mediaTypes=${encodeURIComponent('["audio"]')}&batchSize=10` },
    { method: 'GET', path: `/api/v1/groupByUsers?fromWhich=project&selectedData=${encodeURIComponent(SELECTED)}` },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/MediaFiles/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.calls.length = 0;
});

describe.each(ROUTES)('$method $path', ({ method, path }) => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call(method, path, { companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[OWNER], [MEMBER]])('reads only the comments of the caller\'s workspace, and writes nothing (%s)', async (uid) => {
        const res = await app.call(method, path, { token: tokenFor(uid), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(mockDb.calls.every((call) => call.type === SCHEMA_TYPE.COMMENTS && call.method === 'aggregate')).toBe(true);
    });

    it('keeps a second workspace named in the query out of every database call', async () => {
        const res = await app.call(method, `${path}&companyId=${OTHER_WORKSPACE}`, { token: tokenFor(MEMBER), companyId: WORKSPACE });
        expect([200, 403]).toContain(res.status);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });
});
