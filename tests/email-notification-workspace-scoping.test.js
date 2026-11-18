jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
const mockSendEmail = jest.fn((subject, text, to, attachments, done) => done({ status: true }));
jest.mock('../Modules/service', () => ({ SendEmail: (...a) => mockSendEmail(...a) }));

const { dbCollections } = require('../Config/collections');
const { myCache } = require('../Config/config');
const { WORKSPACE, OTHER_WORKSPACE, OWNER, MEMBER, serveModule, seedSeats, tokenFor } = require('./fixtures/workspaceScoping');

const PATH = '/api/v2/support-mail';
const MAILBOX = 'support@example.test';

let app;
beforeAll(async () => {
    process.env.SUPPORT_MAIL = MAILBOX;
    app = await serveModule((server) => require('../Modules/EmailNotification/routes').init(server));
});
afterAll(() => app.close());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockSendEmail.mockClear();
    seedSeats(mockDb, dbCollections);
    [OWNER, MEMBER].forEach((id) => mockDb.seed(dbCollections.USERS, { _id: id, Employee_Name: `Name ${id.slice(-2)}`, Employee_Email: `${id.slice(-2)}@example.test` }));
    mockDb.calls.length = 0;
});

describe(`POST ${PATH}`, () => {
    it('answers 401 to a caller without a session, before any database call or mail', async () => {
        const res = await app.call('POST', PATH, { companyId: WORKSPACE, body: { message: 'Help' } });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('answers 401 to a session whose token does not hold the workspace in the header, before any database call or mail', async () => {
        const res = await app.call('POST', PATH, { token: tokenFor(MEMBER, [OTHER_WORKSPACE]), companyId: WORKSPACE, body: { message: 'Help' } });
        expect(res.status).toBe(401);
        expect(mockDb.calls).toEqual([]);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it.each([[OWNER], [MEMBER]])('reads only the signed-in sender\'s own user row, and mails the configured mailbox (%s)', async (uid) => {
        const res = await app.call('POST', PATH, { token: tokenFor(uid), companyId: WORKSPACE, body: { message: 'Help', to: 'someone@else.test' } });
        expect(res.status).toBe(200);
        expect(mockDb.calls).toHaveLength(1);
        expect(mockDb.calls[0]).toMatchObject({ companyId: 'global', type: dbCollections.USERS, method: 'findOne' });
        expect(String(mockDb.calls[0].data[0]._id)).toBe(uid);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(mockSendEmail.mock.calls[0][2]).toBe(MAILBOX);
    });

    it('sends nothing for a sender who has no user row', async () => {
        mockDb.store[dbCollections.USERS].length = 0;
        const res = await app.call('POST', PATH, { token: tokenFor(MEMBER), companyId: WORKSPACE, body: { message: 'Help' } });
        expect(res.status).toBe(401);
        expect(mockSendEmail).not.toHaveBeenCalled();
    });
});
