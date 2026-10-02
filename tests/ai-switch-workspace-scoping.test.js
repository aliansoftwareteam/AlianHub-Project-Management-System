jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const ownUserRow = (call) => call.companyId === 'global' && call.type === dbCollections.USERS && Array.isArray(call.data) && String(call.data[0]._id) === String(call.caller);

const ROUTES = [
    { method: 'GET', path: '/api/v2/ai-switch', who: [OWNER, ADMIN, MEMBER], refusedRoles: [] },
    { method: 'PUT', path: '/api/v2/ai-switch', body: { enabled: false }, who: [OWNER, ADMIN], refusedRoles: [MEMBER] },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/AiSwitch/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    aiSwitch.forget();
    mockDb.seed(dbCollections.COMPANIES, { _id: WORKSPACE });
    seedSeats(mockDb, dbCollections);
    mockDb.calls.length = 0;
});

describe.each(ROUTES)('$method $path', ({ method, path, body, who, refusedRoles }) => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call(method, path, { companyId: WORKSPACE, body });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call(method, path, { token: tokenFor(OWNER, [OTHER_WORKSPACE]), companyId: WORKSPACE, body });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it.each(who.map((uid) => [uid]))('names the caller\'s workspace in every database call (%s)', async (uid) => {
        const res = await app.call(method, path, { token: tokenFor(uid), companyId: WORKSPACE, body });
        expect(res.status).toBe(200);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        const calls = mockDb.calls.map((call) => ({ ...call, caller: uid }));
        expect(unnamed(calls).filter((call) => !ownUserRow(call))).toEqual([]);
    });

});

describe.each(ROUTES.filter((route) => route.refusedRoles.length))('$method $path refuses a role', ({ method, path, body, refusedRoles }) => {
    it.each(refusedRoles.map((uid) => [uid]))('a workspace member who is not owner or admin (%s)', async (uid) => {
        const res = await app.call(method, path, { token: tokenFor(uid), companyId: WORKSPACE, body });
        expect(res.status).toBe(403);
        expect(mockDb.calls.filter((call) => call.method !== 'findOne')).toEqual([]);
        expect(aiSwitch.instanceEnabled()).toBe(true);
    });
});

describe('PUT /api/v2/ai-switch writes only the caller\'s workspace row', () => {
    it('updates the company named by the header and no other', async () => {
        mockDb.seed(dbCollections.COMPANIES, { _id: OTHER_WORKSPACE });
        mockDb.calls.length = 0;
        await app.call('PUT', '/api/v2/ai-switch', { token: tokenFor(ADMIN), companyId: WORKSPACE, body: { enabled: false } });
        const writes = mockDb.calls.filter((call) => call.method === 'updateOne');
        expect(writes).toHaveLength(1);
        expect(String(writes[0].data[0]._id)).toBe(WORKSPACE);
        expect(mockDb.store[dbCollections.COMPANIES].find((row) => row._id === OTHER_WORKSPACE).aiSwitch).toBeUndefined();
    });
});
