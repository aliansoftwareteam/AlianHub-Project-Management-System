jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { WORKSPACE, OTHER_WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* The logo and the brand settings belong to the installation, not to a workspace, and the sign-in page needs them before anyone has a session. */
const ROUTES = [
    { method: 'GET', path: '/api/v1/getlogo', answers: [200, 404] },
    { method: 'GET', path: '/api/v1/getBrandSettingsData', answers: [200] },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Admin/admin').init(server)); });
afterAll(() => app.close());
beforeEach(() => { mockDb.calls.length = 0; });

describe.each(ROUTES)('$method $path', ({ method, path, answers }) => {
    it('answers a caller without a session, and makes no database call', async () => {
        const res = await app.call(method, path);
        expect(answers).toContain(res.status);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[WORKSPACE], [OTHER_WORKSPACE]])('answers the same whichever workspace the header names (%s), and makes no database call', async (companyId) => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER, [WORKSPACE]), companyId });
        expect(answers).toContain(res.status);
        expect(mockDb.calls).toEqual([]);
    });
});
