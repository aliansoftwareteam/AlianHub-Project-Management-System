jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const rules = require('../Modules/Users/helpers/userAccessRules');
const ctrl = require('../Modules/Users/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const STRANGER = '6f0000000000000000000005';

const SECRETS = { webTokens: ['push-token'], verificationToken: 'verify-secret', forgotPasswordToken: 'reset-secret', forgotPasswordTokenTime: 1 };
const USERS = {
    [OWNER]: { _id: OWNER, Employee_Name: 'Owner', AssignCompany: [COMPANY, OTHER_COMPANY], isProductOwner: true, customerId: 'cus_1', ...SECRETS },
    [ADMIN]: { _id: ADMIN, Employee_Name: 'Admin', AssignCompany: [COMPANY], ...SECRETS },
    [MEMBER]: { _id: MEMBER, Employee_Name: 'Member', AssignCompany: [COMPANY], ...SECRETS },
    [GUEST]: { _id: GUEST, Employee_Name: 'Guest', AssignCompany: [COMPANY], ...SECRETS },
    [STRANGER]: { _id: STRANGER, Employee_Name: 'Stranger', AssignCompany: [OTHER_COMPANY], ...SECRETS },
};
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === method);
const leaksSecret = (body) => /push-token|verify-secret|reset-secret/.test(JSON.stringify(body));

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareV2(server);
        server.put('/api/v1/user', ctrl.updateUserStatus);
        server.get('/api/v1/user/:id', ctrl.getUserById);
        server.post('/api/v1/user/find', ctrl.getUserByQuey);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        const filter = (obj.data && obj.data[0]) || {};
        if (obj.type === SCHEMA_TYPE.COMPANY_USERS) return db === COMPANY && ROLES[filter.userId] !== undefined ? { roleType: ROLES[filter.userId] } : null;
        if (method === 'findOne') return USERS[String(filter._id)] || null;
        if (method === 'aggregate') return [USERS[OWNER], USERS[GUEST]];
        if (method === 'findOneAndUpdate') return { ...USERS[String(filter._id)], ...((obj.data[1] && obj.data[1].$set) || {}) };
        return null;
    });
});

describe('userAccessRules', () => {
    it('keeps secrets out of both views', () => {
        expect(leaksSecret(rules.toSelfView(USERS[OWNER]))).toBe(false);
        expect(leaksSecret(rules.toMemberView(USERS[OWNER], [COMPANY]))).toBe(false);
    });

    it('shows only the companies the caller shares', () => {
        expect(rules.toMemberView(USERS[OWNER], [COMPANY]).AssignCompany).toEqual([COMPANY]);
    });

    it.each([
        [{ forgotPasswordToken: { $regex: '^a' } }],
        [{ Employee_Name: { $regex: 'a' } }],
        [{ $expr: { $eq: ['$isActive', true] } }],
        [{ $or: [{ webTokens: 'x' }] }],
    ])('refuses the filter %j', (query) => {
        expect(rules.sanitizeUserQuery(query).ok).toBe(false);
    });

    it('accepts the filter the members store sends', () => {
        expect(rules.sanitizeUserQuery({ isActive: true, AssignCompany: { $in: [COMPANY] } }).ok).toBe(true);
    });

    it.each([
        [{ $set: { isProductOwner: true } }],
        [{ AssignCompany: [OTHER_COMPANY] }],
        [{ $push: { AssignCompany: OTHER_COMPANY } }],
        [{ $set: { 'webTokens.0': 'x' } }],
        [{ $set: { tour: {} }, $unset: { isActive: 1 } }],
    ])('refuses the self update %j', (update) => {
        expect(rules.sanitizeSelfUpdate(update).ok).toBe(false);
    });

    it('turns a plain profile update into $set', () => {
        expect(rules.sanitizeSelfUpdate({ isOnline: true }).update).toEqual({ $set: { isOnline: true } });
    });
});

describe('ACC-05 GET /api/v1/user/:id', () => {
    it('refuses an anonymous read', async () => {
        const res = await app.call('GET', `/api/v1/user/${OWNER}`);
        expect(res.status).toBe(401);
    });

    it('returns the caller their own profile without secrets', async () => {
        const res = await app.call('GET', `/api/v1/user/${OWNER}`, { token: signSession(OWNER, [COMPANY]) });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ _id: OWNER, isProductOwner: true, AssignCompany: [COMPANY, OTHER_COMPANY] });
        expect(leaksSecret(res.body)).toBe(false);
    });

    it('gives a guest only the public profile of a teammate', async () => {
        const res = await app.call('GET', `/api/v1/user/${OWNER}`, { token: signSession(GUEST, [COMPANY]) });
        expect(res.status).toBe(200);
        expect(leaksSecret(res.body)).toBe(false);
        expect(res.body.isProductOwner).toBeUndefined();
        expect(res.body.customerId).toBeUndefined();
        expect(res.body.AssignCompany).toEqual([COMPANY]);
    });

    it('does not reveal a user who shares no company with the caller', async () => {
        const res = await app.call('GET', `/api/v1/user/${STRANGER}`, { token: signSession(GUEST, [COMPANY]) });
        expect(res.status).toBe(404);
        expect(res.body.Employee_Name).toBeUndefined();
    });
});

describe('ACC-05 POST /api/v1/user/find', () => {
    it('refuses a company the caller is not a member of', async () => {
        const token = signSession(GUEST, [COMPANY, OTHER_COMPANY]);
        myCache.set(`membership:${GUEST}:${OTHER_COMPANY}`, false);
        const res = await app.call('POST', '/api/v1/user/find', { token, body: { query: {}, companyId: OTHER_COMPANY } });
        expect(res.status).toBe(403);
        expect(callsOf('aggregate')).toHaveLength(0);
    });

    it('refuses a company outside the caller\'s token', async () => {
        const res = await app.call('POST', '/api/v1/user/find', { token: signSession(GUEST, [COMPANY]), body: { query: {}, companyId: OTHER_COMPANY } });
        expect(res.status).toBe(403);
    });

    it('pins the query to the caller\'s company and strips secrets', async () => {
        const query = { isActive: true, AssignCompany: { $in: [COMPANY] } };
        const res = await app.call('POST', '/api/v1/user/find', { token: signSession(GUEST, [COMPANY]), body: { query, companyId: COMPANY } });
        expect(res.status).toBe(200);
        expect(callsOf('aggregate')[0][1].data[0]).toEqual([{ $match: { $and: [query, { AssignCompany: COMPANY }] } }]);
        expect(leaksSecret(res.body)).toBe(false);
        expect(res.body.find((u) => u._id === OWNER).isProductOwner).toBeUndefined();
    });

    it('refuses a probing filter on a secret field', async () => {
        const res = await app.call('POST', '/api/v1/user/find', {
            token: signSession(GUEST, [COMPANY]),
            body: { query: { forgotPasswordToken: { $regex: '^a' } }, companyId: COMPANY },
        });
        expect(res.status).toBe(400);
        expect(callsOf('aggregate')).toHaveLength(0);
    });
});

describe('ACC-05 PUT /api/v1/user', () => {
    const put = (uid, body) => app.call('PUT', '/api/v1/user', { token: signSession(uid, [COMPANY]), body });

    it('refuses an anonymous write', async () => {
        const res = await app.call('PUT', '/api/v1/user', { body: { userId: OWNER, updateObject: { isActive: false } } });
        expect(res.status).toBe(401);
    });

    it('refuses a guest writing to another user', async () => {
        const res = await put(GUEST, { userId: OWNER, updateObject: { $set: { isActive: false } } });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('refuses a user promoting themself', async () => {
        const res = await put(GUEST, { userId: GUEST, updateObject: { $set: { isProductOwner: true } } });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('refuses a user adding a company to themself', async () => {
        const res = await put(GUEST, { userId: GUEST, updateObject: { $push: { AssignCompany: OTHER_COMPANY } } });
        expect(res.status).toBe(403);
    });

    it('lets a user update their own presence and returns no secrets', async () => {
        const res = await put(GUEST, { userId: GUEST, updateObject: { isOnline: true }, newObj: { returnDocument: 'after', upsert: true } });
        expect(res.status).toBe(200);
        expect(callsOf('findOneAndUpdate')[0][1].data).toEqual([expect.anything(), { $set: { isOnline: true } }, { returnDocument: 'after' }]);
        expect(leaksSecret(res.body)).toBe(false);
    });

    it('refuses selecting a company the user is not in', async () => {
        const res = await put(GUEST, { userId: GUEST, updateObject: { $set: { lastSelectedCompany: OTHER_COMPANY } } });
        expect(res.status).toBe(403);
    });

    it('refuses a member removing a teammate from the company', async () => {
        const res = await put(MEMBER, { userId: GUEST, updateObject: { $pull: { AssignCompany: COMPANY } } });
        expect(res.status).toBe(403);
    });

    it('lets an admin remove a member from their company', async () => {
        const res = await put(ADMIN, { userId: GUEST, updateObject: { $pull: { AssignCompany: COMPANY } }, newObj: { returnDocument: 'after' } });
        expect(res.status).toBe(200);
        expect(callsOf('findOneAndUpdate')[0][1].data[1]).toEqual({ $pull: { AssignCompany: COMPANY } });
        expect(leaksSecret(res.body)).toBe(false);
    });

    it('refuses an admin removing the owner', async () => {
        const res = await put(ADMIN, { userId: OWNER, updateObject: { $pull: { AssignCompany: COMPANY } } });
        expect(res.status).toBe(403);
    });

    it('refuses an admin removing a member from a company they do not administer', async () => {
        const res = await put(ADMIN, { userId: STRANGER, updateObject: { $pull: { AssignCompany: OTHER_COMPANY } } });
        expect(res.status).toBe(403);
    });
});
