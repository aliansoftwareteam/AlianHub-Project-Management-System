jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* The tours are product content shared by every workspace, so the one read goes to the global database and filters on nothing: no row of any workspace can be named by it. */
const ROUTES = [
    { method: 'GET', path: '/api/v1/tours', reads: [{ type: SCHEMA_TYPE.TOURS, method: 'find' }] },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/tours/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockDb.seed(SCHEMA_TYPE.TOURS, { key: 'welcome' });
    mockDb.calls.length = 0;
});

describe.each(ROUTES)('$method $path', ({ method, path, reads }) => {
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

    it('reads only the global catalogue, filtered on nothing a workspace could own', async () => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(mockDb.calls.map(({ companyId, type, method: m, data }) => ({ companyId, type, method: m, data }))).toEqual(
            reads.map((read) => ({ companyId: 'global', ...read, data: [] })),
        );
    });
});
