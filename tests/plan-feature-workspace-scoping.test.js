jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* The plan tables are product content shared by every workspace, so each read goes to the global database and filters on nothing:
 * no row of any workspace can be named by it. The /admin routes carry no workspace either, so they need only a session. */
const ROUTES = [
    { method: 'GET', path: '/api/v1/plan-feature-display', workspaceHeader: true, read: SCHEMA_TYPE.PLANFEATUREDISPLAY },
    { method: 'GET', path: '/api/v1/admin/plan-feature', workspaceHeader: false, read: SCHEMA_TYPE.PLANFEATURE },
    { method: 'GET', path: '/api/v1/admin/plan-feature-display', workspaceHeader: false, read: SCHEMA_TYPE.PLANFEATUREDISPLAY },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/PlanFeature/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockDb.seed(SCHEMA_TYPE.PLANFEATURE, { key: 'projects' });
    mockDb.seed(SCHEMA_TYPE.PLANFEATUREDISPLAY, { key: 'projects' });
    mockDb.calls.length = 0;
});

describe.each(ROUTES)('$method $path', ({ method, path, workspaceHeader, read }) => {
    const headers = (extra = {}) => ({ ...(workspaceHeader ? { companyId: WORKSPACE } : {}), ...extra });

    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call(method, path, headers());
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a caller whose token is not a session token, before any database call', async () => {
        const res = await app.call(method, path, headers({ token: 'not-a-session-token' }));
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('reads only the global catalogue, filtered on nothing a workspace could own', async () => {
        const res = await app.call(method, path, headers({ token: tokenFor(MEMBER) }));
        expect(res.status).toBe(200);
        expect(mockDb.calls.map(({ companyId, type, method: m, data }) => ({ companyId, type, method: m, data }))).toEqual([
            { companyId: 'global', type: read, method: 'find', data: [] },
        ]);
    });
});

describe('GET /api/v1/plan-feature-display with a token for another workspace', () => {
    it('answers 401 before any database call', async () => {
        const res = await app.call('GET', '/api/v1/plan-feature-display', { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });
});
