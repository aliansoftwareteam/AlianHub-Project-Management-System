jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const STRANGER = '6f00000000000000000000a9';
const VIEW_ID = 'view-table-1';

let ids;
const ROUTES = [
    { method: 'GET', path: () => '/api/v2/view-templates', allowed: [OWNER, ADMIN, MEMBER], refused: [[STRANGER, 403, 'a person with no seat in the workspace']] },
    { method: 'POST', path: () => '/api/v2/view-templates', body: () => ({ projectId: ids.project, viewId: VIEW_ID, name: 'Weekly review' }), allowed: [OWNER, ADMIN], refused: [[MEMBER, 403, 'a member the workspace rules give no view edit']], writes: ['save'] },
    { method: 'PATCH', path: () => `/api/v2/view-templates/${ids.template}`, body: () => ({ name: 'Renamed' }), allowed: [OWNER, ADMIN], refused: [[MEMBER, 403, 'a member who is not owner or admin'], [STRANGER, 403, 'a person with no seat in the workspace']], writes: ['updateOne'] },
    { method: 'DELETE', path: () => `/api/v2/view-templates/${ids.template}`, allowed: [OWNER, ADMIN], refused: [[MEMBER, 403, 'a member who is not owner or admin'], [STRANGER, 403, 'a person with no seat in the workspace']], writes: ['updateOne'] },
];

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/ViewTemplates/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { isPrivateSpace: false, ProjectRequiredComponent: [{ _id: VIEW_ID, keyName: 'TableView', settings: {} }] });
    const template = mockDb.seed(SCHEMA_TYPE.VIEW_TEMPLATES, { name: 'Standup', viewType: 'TableView', settings: {}, deletedStatusKey: 0 });
    ids = { project: String(project._id), template: String(template._id) };
    mockDb.calls.length = 0;
});

const call = (route, uid, extra = {}) => app.call(route.method, route.path(), { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body: route.body && route.body(), ...extra });

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

    it.each(route.allowed.map((uid) => [uid]))('names the caller\'s workspace in every database call (%s)', async (uid) => {
        const res = await call(route, uid);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
        (route.writes || []).forEach((write) => expect(mockDb.calls.some((c) => c.method === write)).toBe(true));
    });

    it.each(route.refused)('refuses %s with %i (%s), and writes nothing', async (uid, status) => {
        const res = await call(route, uid);
        expect(res.status).toBe(status);
        expect(res.body.status).toBe(false);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(mockDb.calls.filter((c) => !['findOne', 'find'].includes(c.method))).toEqual([]);
        expect(mockDb.store[SCHEMA_TYPE.VIEW_TEMPLATES].map((row) => [row.name, row.deletedStatusKey])).toEqual([['Standup', 0]]);
    });
});
