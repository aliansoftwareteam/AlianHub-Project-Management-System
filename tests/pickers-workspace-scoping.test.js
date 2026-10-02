jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { WORKSPACE, OTHER_WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');
const { DRIVE_PAGE_PATH, DRIVE_SCRIPT_PATH } = require('../Modules/Pickers/routes');

/* Public by design and outside /api: the pages hold no session or data of their own, so no request names a workspace and none reaches the database. */
const ROUTES = [
    { method: 'GET', path: DRIVE_PAGE_PATH },
    { method: 'GET', path: DRIVE_SCRIPT_PATH },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Pickers/routes').init(server, {})); });
afterAll(() => app.close());
beforeEach(() => { mockDb.calls.length = 0; });

describe.each(ROUTES)('$method $path', ({ method, path }) => {
    it('serves a caller without a session, and makes no database call', async () => {
        const res = await app.call(method, path);
        expect(res.status).toBe(200);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[WORKSPACE], [OTHER_WORKSPACE]])('serves the same page whichever workspace the header names (%s), and makes no database call', async (companyId) => {
        const anonymous = await app.call(method, path);
        const signedIn = await app.call(method, path, { token: tokenFor(MEMBER, [WORKSPACE]), companyId });
        expect(signedIn.status).toBe(200);
        expect(signedIn.body).toEqual(anonymous.body);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers a write to it with 404, since only the read is routed', async () => {
        const res = await app.call('POST', path, { body: {} });
        expect(res.status).toBe(404);
    });
});
