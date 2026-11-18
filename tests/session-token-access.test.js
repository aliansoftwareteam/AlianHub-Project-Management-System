jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn() }));
jest.mock('../Modules/Auth/controller', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn() }));
jest.mock('../Modules/Auth/controller/sendVerificationMail', () => ({}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const session = require('../Modules/Auth/session');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 };

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === method);

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareV2(server);
        server.delete('/api/v2/session/delete', session.deleteAllSession);
        server.delete('/api/v2/session/delete/:id', session.deleteUserSpecificSession);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        const filter = (obj.data && obj.data[0]) || {};
        if (obj.type === SCHEMA_TYPE.COMPANY_USERS) return ROLES[filter.userId] !== undefined ? { roleType: ROLES[filter.userId] } : null;
        if (method === 'deleteMany') return { deletedCount: 1 };
        return null;
    });
});

describe('ACC-02 and ACC-03 token and session minting', () => {
    it('no longer exposes a handler that mints a token or session from a bare user id', () => {
        expect(require('../Modules/Auth/controller/createUser').generateToken).toBeUndefined();
        expect(session.registerSesstion).toBeUndefined();
    });
});

describe('ACC-03 /api/v2/session/delete', () => {
    it('refuses deleting every session anonymously', async () => {
        const res = await app.call('DELETE', '/api/v2/session/delete');
        expect(res.status).toBe(401);
        expect(callsOf('deleteMany')).toHaveLength(0);
    });

    it('deletes only the caller\'s sessions when asked to delete all', async () => {
        const token = signSession(MEMBER, [COMPANY]);
        const res = await app.call('DELETE', '/api/v2/session/delete', { token });
        expect(res.status).toBe(200);
        expect(callsOf('deleteMany').map((call) => call[1].data[0])).toEqual([{ userId: MEMBER }]);
    });

    it('never issues an unfiltered deleteMany', async () => {
        const result = await new Promise((resolve) => session.deleteSessionFun('', resolve));
        expect(result.status).toBe(false);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses deleting a user\'s sessions anonymously', async () => {
        const res = await app.call('DELETE', `/api/v2/session/delete/${OWNER}`);
        expect(res.status).toBe(401);
    });

    it('lets a user delete their own sessions by id', async () => {
        const token = signSession(MEMBER, [COMPANY]);
        const res = await app.call('DELETE', `/api/v2/session/delete/${MEMBER}`, { token, companyId: COMPANY });
        expect(res.status).toBe(200);
    });

    it('refuses a member signing out another member', async () => {
        const token = signSession(MEMBER, [COMPANY]);
        const res = await app.call('DELETE', `/api/v2/session/delete/${ADMIN}`, { token, companyId: COMPANY });
        expect(res.status).toBe(403);
        expect(callsOf('deleteMany')).toHaveLength(0);
    });

    it('lets an admin sign out a member of their company', async () => {
        const token = signSession(ADMIN, [COMPANY]);
        const res = await app.call('DELETE', `/api/v2/session/delete/${MEMBER}`, { token, companyId: COMPANY });
        expect(res.status).toBe(200);
        expect(callsOf('deleteMany')[0][1].data[0]).toEqual({ userId: MEMBER });
    });

    it('refuses an admin signing out the owner', async () => {
        const token = signSession(ADMIN, [COMPANY]);
        const res = await app.call('DELETE', `/api/v2/session/delete/${OWNER}`, { token, companyId: COMPANY });
        expect(res.status).toBe(403);
    });

    it('refuses an admin acting without a company', async () => {
        const token = signSession(ADMIN, [COMPANY]);
        const res = await app.call('DELETE', `/api/v2/session/delete/${MEMBER}`, { token });
        expect(res.status).toBe(403);
    });
});
