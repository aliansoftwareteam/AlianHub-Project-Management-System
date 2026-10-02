jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, MEMBER, serveModule, seedSeats, tokenFor, unnamed } = require('./fixtures/workspaceScoping');

const PROJECT = '6f0000000000000000000d01';
const PRIVATE_PROJECT = '6f0000000000000000000d03';
const NO_PROJECT = '6f0000000000000000000dff';
const SPRINT = '6f0000000000000000000d02';
const selected = (projectId) => encodeURIComponent(JSON.stringify({ _id: projectId, ProjectID: projectId, sprintId: SPRINT }));

const ROUTES = [
    { method: 'GET', pathOf: (projectId, kind = 'project') => `/api/v1/mediaFiles?handleType=${kind}&selectedData=${selected(projectId)}&mediaTypes=${encodeURIComponent('["audio"]')}&batchSize=10` },
    { method: 'GET', pathOf: (projectId, kind = 'project') => `/api/v1/groupByUsers?fromWhich=${kind}&selectedData=${selected(projectId)}` },
].map((route) => ({ ...route, path: route.pathOf(PROJECT) }));

const WRITES = /save|insert|update|delete|replace|bulkWrite/i;
const commentReads = () => mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.COMMENTS);

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/MediaFiles/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE_PROJECT, ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [OWNER] });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: PROJECT, project: true, type: 'audio', isDeleted: false, userId: OWNER, mediaName: 'standup.mp3' });
    mockDb.seed(SCHEMA_TYPE.COMMENTS, { projectId: PRIVATE_PROJECT, project: true, type: 'audio', isDeleted: false, userId: OWNER, mediaName: 'board.mp3' });
    mockDb.calls.length = 0;
});

describe.each(ROUTES)('$method $path', ({ method, path, pathOf }) => {
    it('answers 401 to a caller without a session, before any database call', async () => {
        const res = await app.call(method, path, { companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call', async () => {
        const res = await app.call(method, path, { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
    });

    it.each([[OWNER], [MEMBER]])('reads only the comments of the caller\'s workspace, in a project the caller can open, and writes nothing (%s)', async (uid) => {
        const res = await app.call(method, path, { token: tokenFor(uid), companyId: WORKSPACE });
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toMatch(/standup\.mp3/);
        expect(JSON.stringify(res.body)).not.toMatch(/board\.mp3/);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(commentReads().map((call) => call.method)).toEqual(['aggregate']);
        expect(mockDb.calls.filter((call) => WRITES.test(call.method))).toEqual([]);
    });

    it.each([
        ['a private project the caller is not on', PRIVATE_PROJECT],
        ['a project that is not there', NO_PROJECT],
    ])('answers 404 for %s, alike, and reads no comment', async (label, projectId) => {
        const res = await app.call(method, pathOf(projectId), { token: tokenFor(MEMBER), companyId: WORKSPACE });
        expect([res.status, res.body]).toEqual([404, { status: false, statusText: 'Comments not found.', message: 'Comments not found.' }]);
        expect(unnamed(mockDb.calls)).toEqual([]);
        expect(commentReads()).toEqual([]);
    });

    it('answers 400 for a thread it cannot name, and reads no comment', async () => {
        for (const url of [pathOf('not-an-id'), pathOf(PROJECT, 'company')]) {
            const res = await app.call(method, url, { token: tokenFor(OWNER), companyId: WORKSPACE });
            expect(res.status).toBe(400);
        }
        expect(commentReads()).toEqual([]);
    });

    it('keeps a second workspace named in the query out of every database call', async () => {
        const res = await app.call(method, `${path}&companyId=${OTHER_WORKSPACE}`, { token: tokenFor(MEMBER), companyId: WORKSPACE });
        expect([200, 403]).toContain(res.status);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(unnamed(mockDb.calls)).toEqual([]);
    });
});
