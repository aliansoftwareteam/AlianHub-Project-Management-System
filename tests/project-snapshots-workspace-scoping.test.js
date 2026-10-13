jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const GUEST = '6f00000000000000000000a4';
const PATH = '/api/v2/projects/templates';

let ids;
const ROUTES = [
    { method: 'GET', path: () => PATH },
    { method: 'POST', path: () => `${PATH}/${ids.shared}/use`, body: () => ({ name: 'Copy' }) },
    { method: 'PATCH', path: () => `${PATH}/${ids.mine}`, body: () => ({ name: 'Renamed' }) },
    { method: 'DELETE', path: () => `${PATH}/${ids.mine}` },
    { method: 'POST', path: () => `/api/v2/projects/${ids.project}/template`, body: () => ({ name: 'Saved', include: { tasks: false } }) },
];
const MUTATING = ROUTES.filter((route) => route.method !== 'GET');

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/ProjectSnapshots/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(dbCollections.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false, companyId: WORKSPACE });
    const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { isPrivateSpace: false, isPersonal: false, deletedStatusKey: 0 });
    const mine = mockDb.seed(SCHEMA_TYPE.PROJECT_SNAPSHOTS, { kind: 'template', name: 'Mine', everyone: false, createdBy: MEMBER, deletedStatusKey: 0 });
    const privateTemplate = mockDb.seed(SCHEMA_TYPE.PROJECT_SNAPSHOTS, { kind: 'template', name: 'Private', everyone: false, createdBy: ADMIN, deletedStatusKey: 0 });
    const shared = mockDb.seed(SCHEMA_TYPE.PROJECT_SNAPSHOTS, { kind: 'template', name: 'Shared', everyone: true, createdBy: ADMIN, deletedStatusKey: 0 });
    ids = { project: String(project._id), mine: String(mine._id), privateTemplate: String(privateTemplate._id), shared: String(shared._id) };
    mockDb.calls.length = 0;
});

const call = (route, uid, extra = {}) => app.call(route.method, route.path(), { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: route.body && route.body(), ...extra });
const writes = () => mockDb.calls.filter((c) => !['findOne', 'find', 'countDocuments'].includes(c.method));
const templateRows = () => mockDb.store[SCHEMA_TYPE.PROJECT_SNAPSHOTS].map((row) => [row.name, row.deletedStatusKey]);

describe.each(ROUTES)('$method $path', (route) => {
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

    it('names the caller\'s workspace in every database call', async () => {
        await call(route, ADMIN);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });

    it('keeps a second workspace named in the body out of every database call', async () => {
        const res = await call(route, OWNER, { token: tokenFor(OWNER, [WORKSPACE, OTHER_WORKSPACE]), body: route.method === 'GET' ? undefined : { ...route.body?.(), companyId: OTHER_WORKSPACE } });
        expect([200, 400, 403, 404]).toContain(res.status);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });
});

describe('a template saved by someone else', () => {
    it.each([
        ['PATCH', 'privateTemplate', 404, 'one not offered to the caller'],
        ['DELETE', 'privateTemplate', 404, 'one not offered to the caller'],
        ['PATCH', 'shared', 403, 'one offered to everyone'],
        ['DELETE', 'shared', 403, 'one offered to everyone'],
    ])('%s answers %i for %s, and changes nothing', async (method, key, status) => {
        const before = templateRows();
        const res = await app.call(method, `${PATH}/${ids[key]}`, { token: tokenFor(MEMBER), companyId: WORKSPACE, body: method === 'PATCH' ? { name: 'Renamed' } : undefined });
        expect(res.status).toBe(status);
        expect(res.body.status).toBe(false);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(writes()).toEqual([]);
        expect(templateRows()).toEqual(before);
    });

    it('does not list a template that is not offered to the caller', async () => {
        const res = await app.call('GET', PATH, { token: tokenFor(MEMBER), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(res.body.data.map((row) => row.name).sort()).toEqual(['Mine', 'Shared']);
    });
});

describe('refusals', () => {
    it.each(MUTATING.map((route) => [route.method, route]))('%s refuses a guest, and writes nothing', async (method, route) => {
        const res = await call(route, GUEST);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(writes()).toEqual([]);
    });
});
