const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

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
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const run = async (handlers, request) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(request, res, () => { advanced = true; });
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

const routes = () => routesOf('../Modules/AgileReports/routes');
const call = (path, uid, query) => run(routes()[path], { uid, params: {}, body: {}, query, headers: { companyid: C } });

let hidden;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    seedRules({ 'project.private_projects': 1 });
    hidden = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Secret', isPrivateSpace: true, AssigneeUserId: [OWNER] });
});

describe.each([
    ['GET /api/v1/agile/velocity'],
    ['GET /api/v1/agile/cfd'],
    ['GET /api/v1/agile/milestones'],
])('%s is bound to the projects the caller may open', (path) => {
    it('answers 404 for a private project the caller is not on', async () => {
        const res = await call(path, MEMBER, { projectId: String(hidden._id) });
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false, error: 'Not Found' });
    });

    it('lets an owner through to the handler', async () => {
        const res = await call(path, OWNER, { projectId: String(hidden._id) });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true });
    });

    it('lets an assigned member through to the handler', async () => {
        const mine = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Mine', isPrivateSpace: true, AssigneeUserId: [MEMBER] });
        const res = await call(path, MEMBER, { projectId: String(mine._id) });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true });
    });
});

describe('GET /api/v1/agile/milestones without a projectId', () => {
    it('reports on the caller\'s visible projects only', async () => {
        const mine = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Mine', isPrivateSpace: false, AssigneeUserId: [MEMBER] });
        mockDb.seed(SCHEMA_TYPE.MILESTONE, { projectId: String(hidden._id), milestoneName: 'Secret launch', dueDate: new Date('2030-01-01') });
        mockDb.seed(SCHEMA_TYPE.MILESTONE, { projectId: String(mine._id), milestoneName: 'My launch', dueDate: new Date('2030-01-01') });

        const res = await call('GET /api/v1/agile/milestones', MEMBER, {});
        expect(res.statusCode).toBe(200);
        const names = (res.body.data.milestones || []).map((m) => m.name);
        expect(names).toContain('My launch');
        expect(names).not.toContain('Secret launch');
    });
});
