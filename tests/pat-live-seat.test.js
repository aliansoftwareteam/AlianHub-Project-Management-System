const mockDbs = {};
const mockDbFor = (db) => { mockDbs[db] = mockDbs[db] || require('./fixtures/fakeMongo').create(); return mockDbs[db]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (db, q, method) => mockDbFor(String(db)).crud(db, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({ addAndRemoveUserInMongodbNotificationCount: jest.fn(async () => {}) }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const members = require('../Modules/settings/Members/controller');
const scim = require('../Modules/Scim/provisioning');

const C = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const OTHER = '6f0000000000000000000003';

const company = () => mockDbFor(C);
const tokensOf = (userId) => (company().store[SCHEMA_TYPE.API_TOKENS] || []).filter((t) => t.userId === userId);
const seatOf = (userId) => company().store[SCHEMA_TYPE.COMPANY_USERS].find((r) => r.userId === userId);

const seat = (userId, roleType) => company().seed(SCHEMA_TYPE.COMPANY_USERS, {
    userId, roleType, status: 2, isDelete: false, designation: 0, userEmail: `${userId}@example.test`,
});

const mintToken = (userId) => {
    const raw = generateToken();
    company().seed(SCHEMA_TYPE.API_TOKENS, {
        name: 'script', tokenHash: hashToken(raw), prefix: raw.slice(0, 12), scopes: ['read'], userId, active: true,
        expiresAt: new Date(Date.now() + 30 * 86400000), lastUsedAt: new Date(),
    });
    return raw;
};

const removeSeat = (userId) => Object.assign(seatOf(userId), { isDelete: true, status: 3 });

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require(modulePath).init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    res.on = jest.fn(() => res);
    return res;
};

const callPublic = async (path, rawToken, { query = {} } = {}) => {
    const req = {
        method: 'GET', originalUrl: path, params: {}, query, body: {},
        headers: { companyid: C, authorization: `Bearer ${rawToken}` },
    };
    const res = response();
    for (const handler of routesOf('../Modules/ApiTokens/publicApi')[`GET ${path}`]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

let secret;
let open;
beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    mockDbFor(dbCollections.GLOBAL).seed(SCHEMA_TYPE.COMPANIES, { _id: C });
    [OWNER, ADMIN, OTHER].forEach((uid) => mockDbFor(dbCollections.GLOBAL).seed(dbCollections.USERS, { _id: uid, AssignCompany: [C] }));
    seat(OWNER, 1);
    seat(ADMIN, 2);
    seat(OTHER, 3);
    secret = company().seed(SCHEMA_TYPE.PROJECTS, { _id: new mongoose.Types.ObjectId().toString(), ProjectName: 'Secret', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
    open = company().seed(SCHEMA_TYPE.PROJECTS, { _id: new mongoose.Types.ObjectId().toString(), ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
    company().seed(SCHEMA_TYPE.TASKS, { TaskKey: 'AH-1', TaskName: 'Open task', ProjectID: String(open._id), deletedStatusKey: 0 });
});

describe('a personal access token on the public API', () => {
    it('still works while its owner holds a seat', async () => {
        const raw = mintToken(ADMIN);
        const projects = await callPublic('/api/public-v1/projects', raw);
        expect(projects.body).toMatchObject({ status: true });
        expect(projects.body.data.map((p) => p.ProjectName).sort()).toEqual(['Open', 'Secret']);

        const tasks = await callPublic('/api/public-v1/tasks', raw, { query: { projectId: String(open._id) } });
        expect(tasks.body).toMatchObject({ status: true });
        expect(tasks.body.data.map((t) => t.TaskKey)).toEqual(['AH-1']);
    });

    it.each([
        ['/api/public-v1/projects', {}],
        ['/api/public-v1/tasks', { projectId: 'x' }],
    ])('is refused on %s once its owner has left the workspace', async (path, query) => {
        const raw = mintToken(ADMIN);
        removeSeat(ADMIN);
        const res = await callPublic(path, raw, { query: query.projectId ? { projectId: String(open._id) } : {} });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false });
        expect(res.body.data).toBeUndefined();
    });
});

describe('visibleProjects', () => {
    it('shows a former admin nothing, even though their old role row is still there', async () => {
        removeSeat(ADMIN);
        expect(await visibleProjectIds(C, ADMIN)).toEqual([]);
    });

    it('shows someone with no seat at all nothing', async () => {
        expect(await visibleProjectIds(C, '6f0000000000000000000009')).toEqual([]);
    });

    it('still shows an active admin every project', async () => {
        expect((await visibleProjectIds(C, ADMIN)).sort()).toEqual([String(secret._id), String(open._id)].sort());
    });
});

const updateMember = async (userId, data) => {
    const res = response();
    await members.updateMember({ uid: OWNER, headers: { companyid: C }, body: { id: String(seatOf(userId)._id), data }, params: {}, query: {} }, res);
    return res;
};

describe('leaving the workspace revokes the member\'s personal access tokens', () => {
    it.each([
        ['removed', { isDelete: true }],
        ['whose seat is cancelled', { status: 3 }],
    ])('when %s from the members screen', async (_label, data) => {
        const raw = mintToken(OTHER);
        mintToken(ADMIN);
        const res = await updateMember(OTHER, data);
        expect(res.statusCode).toBe(200);

        expect(tokensOf(OTHER).map((t) => t.active)).toEqual([false]);
        expect(tokensOf(ADMIN).map((t) => t.active)).toEqual([true]);
        Object.assign(seatOf(OTHER), { isDelete: false, status: 2 });
        myCache.flushAll();
        expect((await callPublic('/api/public-v1/projects', raw)).statusCode).toBe(401);
    });

    it('but not on a role change', async () => {
        mintToken(OTHER);
        const res = await updateMember(OTHER, { roleType: 2 });
        expect(res.statusCode).toBe(200);
        expect(tokensOf(OTHER).map((t) => t.active)).toEqual([true]);
    });

    it('when SCIM deactivates the member', async () => {
        mintToken(OTHER);
        mintToken(ADMIN);
        await scim.setActive(C, OTHER, false);
        expect(tokensOf(OTHER).map((t) => t.active)).toEqual([false]);
        expect(tokensOf(ADMIN).map((t) => t.active)).toEqual([true]);
    });

    it('when SCIM provisions an existing member as inactive', async () => {
        mintToken(OTHER);
        mockDbFor(dbCollections.GLOBAL).seed(dbCollections.USER_AUTH, { _id: OTHER, email: `${OTHER}@example.test` });
        await scim.provision(C, { email: `${OTHER}@example.test`, active: false });
        const provisioned = seatOf(OTHER) || {};
        expect(provisioned.isDelete).toBe(true);
        expect(tokensOf(OTHER).map((t) => t.active)).toEqual([false]);
    });
});
