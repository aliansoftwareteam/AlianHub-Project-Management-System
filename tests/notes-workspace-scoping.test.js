jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

let note;
const ROUTES = [
    { method: 'GET', path: () => '/api/v1/notes' },
    { method: 'POST', path: () => '/api/v1/notes', body: () => ({ title: 'Plan', content: 'Ship' }) },
    { method: 'PATCH', path: () => `/api/v1/notes/${note._id}`, body: () => ({ title: 'Renamed' }) },
    { method: 'DELETE', path: () => `/api/v1/notes/${note._id}` },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Notes/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    note = mockDb.seed(SCHEMA_TYPE.NOTES, { userId: MEMBER, companyId: WORKSPACE, title: 'Mine', content: '', deletedStatusKey: 0 });
    mockDb.calls.length = 0;
});

const call = (route, uid, extra = {}) => app.call(route.method, route.path(), { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: route.body && route.body(), ...extra });

describe.each(ROUTES)('$method $path', (route) => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await call(route, null);
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await call(route, null, { token: tokenFor(MEMBER, [OTHER_WORKSPACE]) });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('names the caller\'s workspace in every database call', async () => {
        const res = await call(route, MEMBER);
        expect(res.status).toBe(200);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });

    it('keeps a second workspace named in the body out of every database call', async () => {
        const res = await call(route, OWNER, { body: route.method === 'GET' ? undefined : { ...(route.body && route.body()), companyId: OTHER_WORKSPACE } });
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect([200, 403]).toContain(res.status);
    });
});
