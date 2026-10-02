jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { WORKSPACE, OTHER_WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* The handler only mints an id: it opens no database, so there is no call that could miss the workspace. */
const ROUTES = [
    { method: 'GET', path: '/api/v1/generateMongoId' },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/generateMongoId/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => { mockDb.calls.length = 0; });

describe.each(ROUTES)('$method $path', ({ method, path }) => {
    it('answers 401 to a caller without a session', async () => {
        const res = await app.call(method, path, { companyId: WORKSPACE });
        expect(res.status).toBe(401);
    });

    it('answers 401 to a caller with no workspace in the header', async () => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER) });
        expect(res.status).toBe(401);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header', async () => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE });
        expect(res.status).toBe(401);
    });

    it('mints an ObjectId for a member and makes no database call', async () => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(res.body).toMatch(/^[a-f0-9]{24}$/);
        expect(mockDb.calls).toEqual([]);
    });
});
