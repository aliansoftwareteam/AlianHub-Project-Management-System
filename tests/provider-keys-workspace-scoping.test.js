jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const crypto = require('crypto');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const ENV_KEYS = ['TENANT_PROVIDER_KEYS', 'SECRETS_STORE', 'SECRETS_KEY'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const VALUE = `sk-ws-${crypto.randomBytes(20).toString('hex')}`;

const ROUTES = [
    { method: 'GET', path: '/api/v2/provider-keys' },
    { method: 'PUT', path: '/api/v2/provider-keys/openai', body: { value: VALUE }, writes: ['updateOne'] },
    { method: 'DELETE', path: '/api/v2/provider-keys/openai', keyIsSet: true, writes: ['updateOne'] },
];

let app;
beforeAll(async () => {
    process.env.TENANT_PROVIDER_KEYS = 'on';
    process.env.SECRETS_STORE = 'true';
    process.env.SECRETS_KEY = crypto.randomBytes(24).toString('hex');
    app = await serveModule((server) => require('../Modules/ProviderKeys/routes').init(server));
});
afterAll(async () => {
    ENV_KEYS.forEach((key) => {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    });
    await app.close();
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(dbCollections.COMPANIES, { _id: WORKSPACE, aiProviderKeys: {} });
    mockDb.seed(dbCollections.COMPANIES, { _id: OTHER_WORKSPACE, aiProviderKeys: {} });
});

const call = (route, uid, extra = {}) => app.call(route.method, route.path, { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: route.body, ...extra });

const prepare = async (route) => {
    if (route.keyIsSet) await app.call('PUT', '/api/v2/provider-keys/openai', { token: tokenFor(OWNER), companyId: WORKSPACE, body: { value: VALUE } });
    mockDb.calls.length = 0;
};

describe.each(ROUTES)('$method $path', (route) => {
    beforeEach(() => prepare(route));

    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await call(route, null);
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await call(route, null, { token: tokenFor(OWNER, [OTHER_WORKSPACE]) });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[OWNER], [ADMIN]])('names the caller\'s workspace in every database call (%s)', async (uid) => {
        const res = await call(route, uid);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
        (route.writes || []).forEach((write) => expect(mockDb.calls.some((c) => c.method === write)).toBe(true));
        expect(JSON.stringify(res.body)).not.toContain(VALUE);
    });

    it('refuses a workspace member who is not owner or admin, before any database call but the seat read', async () => {
        const res = await call(route, MEMBER);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(mockDb.calls.map((c) => [c.type, c.method])).toEqual([[dbCollections.COMPANY_USERS, 'findOne']]);
        expect(mockDb.store[dbCollections.COMPANIES].find((row) => row._id === WORKSPACE).aiProviderKeys).toEqual(route.keyIsSet ? expect.objectContaining({ openai: expect.any(String) }) : {});
    });
});
