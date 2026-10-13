jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

jest.mock('fs', () => ({ ...jest.requireActual('fs'), readFile: jest.fn(), writeFile: jest.fn() }));
const fs = require('fs');
const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, MEMBER, OWNER, ADMIN, serveModule, seedSeats, tokenFor } = require('./fixtures/workspaceScoping');

const GUEST = '6f00000000000000000000a4';
const PATH = '/api/v1/updateEmailTemplate';
const body = { id: 1, subject: 'Hello', emailData: '<p>Hi</p>' };

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/emailTemplate/routes').init(server)); });
afterAll(() => app.close());

beforeEach(() => {
    delete process.env.INSTANCE_ADMIN_KEY;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    fs.readFile.mockReset();
    fs.writeFile.mockReset();
    seedSeats(mockDb, dbCollections);
    mockDb.seed(dbCollections.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false, companyId: WORKSPACE });
    mockDb.seed(dbCollections.USERS, { _id: OWNER, isProductOwner: true });
    [ADMIN, MEMBER, GUEST].forEach((id) => mockDb.seed(dbCollections.USERS, { _id: id, isProductOwner: false }));
    mockDb.calls.length = 0;
});

describe(`POST ${PATH}`, () => {
    const post = (uid) => app.call('POST', PATH, { token: uid ? tokenFor(uid) : undefined, companyId: WORKSPACE, body });

    it('answers 401 to a caller without a session, and reads and writes no template', async () => {
        const res = await post(null);
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
        expect(fs.readFile).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it.each([[ADMIN, 'a workspace admin'], [MEMBER, 'a member'], [GUEST, 'a guest']])('refuses %s with 403, and reads and writes no template', async (uid) => {
        const res = await post(uid);
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(fs.readFile).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('lets the instance owner through to the handler, which touches no workspace database', async () => {
        fs.readFile.mockImplementation((file, enc, done) => done(null, 'return {\n  subject: `a`,\n  mail: `b`\n}'));
        fs.writeFile.mockImplementation((file, data, enc, done) => done(null));
        const res = await post(OWNER);
        expect(res.status).toBe(200);
        expect(res.body.statusText).toBe('done');
        expect(mockDb.calls.filter((c) => c.companyId !== 'global')).toEqual([]);
    });
});
