jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, MEMBER, OWNER, ADMIN, serveModule, seedSeats, tokenFor } = require('./fixtures/workspaceScoping');

const GUEST = '6f00000000000000000000a4';

let tracker;
const ROUTES = [
    { method: 'POST', path: () => '/api/v1/tracker/create', body: () => ({ dataObj: { title: 'Windows', version: '1.0' } }), write: 'save' },
    { method: 'PUT', path: () => '/api/v1/tracker/update', body: () => ({ dataObj: [{ _id: String(tracker._id) }, { $set: { title: 'Renamed' } }] }), write: 'findOneAndUpdate' },
    { method: 'DELETE', path: () => `/api/v1/tracker/delete/${tracker._id}`, write: 'deleteOne' },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/trackerDownload/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    delete process.env.INSTANCE_ADMIN_KEY;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(dbCollections.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false, companyId: WORKSPACE });
    mockDb.seed(dbCollections.USERS, { _id: OWNER, isProductOwner: true });
    [ADMIN, MEMBER, GUEST].forEach((id) => mockDb.seed(dbCollections.USERS, { _id: id, isProductOwner: false }));
    tracker = mockDb.seed(dbCollections.TIMETRACKER_DOWNLOAD, { title: 'Windows', version: '1.0' });
    mockDb.calls.length = 0;
});

const call = (route, uid) => app.call(route.method, route.path(), { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: route.body && route.body() });
const trackerCalls = () => mockDb.calls.filter((c) => c.type === dbCollections.TIMETRACKER_DOWNLOAD);
const titles = () => mockDb.store[dbCollections.TIMETRACKER_DOWNLOAD].map((row) => row.title);

describe.each(ROUTES)('$method $path', (route) => {
    it('answers 401 to a caller without a session, before any write', async () => {
        const res = await call(route, null);
        expect(res.status).toBe(401);
        expect(trackerCalls()).toEqual([]);
        expect(titles()).toEqual(['Windows']);
    });

    it.each([[ADMIN, 'a workspace admin'], [MEMBER, 'a member'], [GUEST, 'a guest']])('refuses %s with 403, and writes nothing', async (uid) => {
        const res = await call(route, uid);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(trackerCalls()).toEqual([]);
        expect(titles()).toEqual(['Windows']);
    });

    it('lets the instance owner write, in the global database only', async () => {
        const res = await call(route, OWNER);
        expect(res.status).toBe(200);
        expect(trackerCalls().map((c) => [c.companyId, c.method])).toEqual([['global', route.write]]);
    });
});

describe('GET /api/v1/tracker', () => {
    it('is public by design: it answers a caller without a session from the global database only, with the download fields and nothing else', async () => {
        const res = await app.call('GET', '/api/v1/tracker', { companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(mockDb.calls.every((c) => c.companyId === 'global' && c.type === dbCollections.TIMETRACKER_DOWNLOAD && c.method === 'aggregate')).toBe(true);
        const project = JSON.stringify(mockDb.calls[0].data);
        expect(project).toContain('"$project":{"title":1,"type":1,"version":1,"downloadUrl":1,"description":1}');
    });
});
