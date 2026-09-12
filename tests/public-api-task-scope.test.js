const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
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

/* The token middleware is exercised by its own suite; these cases start from a verified
 * token so they can say what a verified token may read. */
const call = async (path, uid, { params = {}, query = {} } = {}) => {
    const handlers = routesOf('../Modules/ApiTokens/publicApi')[path].slice(1);
    const req = {
        params, query, body: {}, headers: { companyid: C },
        apiCompanyId: C,
        apiToken: { _id: 'tok', userId: uid, scopes: ['read'], active: true },
    };
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

let hidden;
let mine;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    seedRules({ 'project.private_projects': 1 });
    hidden = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Secret', isPrivateSpace: true, AssigneeUserId: [OWNER] });
    mine = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Mine', isPrivateSpace: false, AssigneeUserId: [MEMBER] });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskKey: 'AH-1', TaskName: 'Secret task', ProjectID: String(hidden._id), deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskKey: 'AH-2', TaskName: 'My task', ProjectID: String(mine._id), deletedStatusKey: 0 });
});

describe('GET /api/public-v1/tasks/:key answers for the token owner', () => {
    it('does not hand over a task in a project the token owner cannot open', async () => {
        const res = await call('GET /api/public-v1/tasks/:key', MEMBER, { params: { key: 'AH-1' } });
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false });
    });

    it('still returns a task in a project they can open', async () => {
        const res = await call('GET /api/public-v1/tasks/:key', MEMBER, { params: { key: 'AH-2' } });
        expect(res.body).toMatchObject({ status: true, data: { TaskName: 'My task' } });
    });

    it('lets an owner read across the company', async () => {
        const res = await call('GET /api/public-v1/tasks/:key', OWNER, { params: { key: 'AH-1' } });
        expect(res.body).toMatchObject({ status: true, data: { TaskName: 'Secret task' } });
    });
});

describe('the rest of the namespace answers for the token owner too', () => {
    it('lists only the projects the token owner can open', async () => {
        const res = await call('GET /api/public-v1/projects', MEMBER);
        expect((res.body.data || []).map((p) => p.ProjectName)).toEqual(['Mine']);
    });

    it('refuses a task listing for a project the token owner cannot open', async () => {
        const res = await call('GET /api/public-v1/tasks', MEMBER, { query: { projectId: String(hidden._id) } });
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false });
    });
});
