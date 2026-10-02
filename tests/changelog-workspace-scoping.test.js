jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const axios = require('axios');
const { WORKSPACE, MEMBER, serveModule, tokenFor } = require('./fixtures/workspaceScoping');

/* The release notes are the product's own CHANGELOG.md, shown before sign-in too (public by design in tests/conventions/route-guard-coverage.test.js).
 * The handler reads a file and the public GitHub releases list: it opens no database and sends GitHub nothing about the caller or a workspace. */
const ROUTES = [
    { method: 'GET', path: '/api/v2/changelog' },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Changelog/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    mockDb.calls.length = 0;
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: [] });
});

describe.each(ROUTES)('$method $path', ({ method, path }) => {
    it.each([
        ['without a session', {}],
        ['with a session for a workspace', { token: tokenFor(MEMBER), companyId: WORKSPACE }],
    ])('answers the same releases %s and makes no database call', async (label, extra) => {
        const res = await app.call(method, path, extra);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data.releases)).toBe(true);
        expect(mockDb.calls).toEqual([]);
    });

    it('sends GitHub no session token and no workspace', async () => {
        await app.call(method, path, { token: tokenFor(MEMBER), companyId: WORKSPACE });
        axios.get.mock.calls.forEach(([url, options]) => {
            expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\//);
            expect(JSON.stringify(options)).not.toContain(WORKSPACE);
            expect(JSON.stringify(options.headers)).not.toMatch(/companyid/i);
        });
    });
});
