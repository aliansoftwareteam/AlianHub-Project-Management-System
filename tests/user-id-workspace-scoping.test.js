jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, MEMBER, serveModule, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

/* `others` is a row of the same module the caller may not touch: another user's counts. */
const ROUTES = [
    { method: 'GET', path: (uid) => `/api/v1/collection/userid/${uid}`, othersPath: () => `/api/v1/collection/userid/${OWNER}` },
    { method: 'PUT', path: () => '/api/v1/collection/userid', body: { key: 'notifications' }, othersBody: { key: 'notifications', userId: OWNER } },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/UserId/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.seed(SCHEMA_TYPE.USERID, { userId: MEMBER, notification_counts: 3, mention_counts: 1 });
    mockDb.seed(SCHEMA_TYPE.USERID, { userId: OWNER, notification_counts: 9, mention_counts: 9 });
    mockDb.calls.length = 0;
});

describe.each(ROUTES)('$method', ({ method, path, body, othersPath, othersBody }) => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call(method, path(MEMBER), { companyId: WORKSPACE, body });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call(method, path(MEMBER), { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE, body });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('names the caller\'s workspace in every database call', async () => {
        const res = await app.call(method, path(MEMBER), { token: tokenFor(MEMBER), companyId: WORKSPACE, body });
        expect(res.status).toBe(200);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(mockDb.calls.every((call) => call.type === SCHEMA_TYPE.USERID)).toBe(true);
    });

    it('refuses another user\'s counts, before any database call', async () => {
        const res = await app.call(method, othersPath ? othersPath() : path(MEMBER), { token: tokenFor(MEMBER), companyId: WORKSPACE, body: othersBody || body });
        expect(res.status).toBe(403);
        expect(mockDb.calls).toEqual([]);
        expect(mockDb.store[SCHEMA_TYPE.USERID].find((row) => row.userId === OWNER).notification_counts).toBe(9);
    });
});
