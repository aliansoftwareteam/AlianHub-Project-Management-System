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
const { removeCache } = require('../utils/commonFunctions');
const socketEmitter = require('../event/socketEventEmitter');
const { workingDaysFor } = require('../Modules/Company/helpers/workingDays');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const SUN_TO_THU = [0, 1, 2, 3, 4];
const COMPANY = { _id: C, workingDays: [1, 2, 3, 4, 5, 6] };

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

const flush = () => new Promise((resolve) => setImmediate(resolve));

const put = async (uid, project, body) => {
    const res = response();
    const req = { uid, aud: C, params: { id: String(project._id) }, body, query: {}, headers: { companyid: C } };
    for (const handler of routesOf('../Modules/Project/routes')['PUT /api/v1/project/:id']) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await flush();
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

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', CompanyId: C, isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER], isGlobalPermission: true,
    projectCreatedBy: OWNER, favouriteTasks: [], watchers: {}, ...doc,
});

const projectWrites = () => mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.PROJECTS && call.method === 'findOneAndUpdate');
const storedProject = async (project) => mockDb.crud(C, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: String(project._id) }] }, 'findOne');

let emitted;
const onProjectUpdate = (payload) => emitted.push(payload);

beforeAll(() => socketEmitter.on('project:update', onProjectUpdate));
afterAll(() => socketEmitter.off('project:update', onProjectUpdate));

beforeEach(() => {
    myCache.flushAll();
    removeCache.mockClear();
    emitted = [];
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

describe('PUT /api/v1/project/:id saves a working-days override', () => {
    it('stores the project\'s own week, sorted, and the resolver prefers it', async () => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, { updateObject: { workingDays: [4, 0, 1, 2, 3, 3] } });
        expect(res.statusCode).toBe(200);
        const stored = await storedProject(project);
        expect(stored.workingDays).toEqual(SUN_TO_THU);
        expect(workingDaysFor(COMPANY, stored)).toEqual(SUN_TO_THU);
    });

    it('clears the override with null, so the project uses the company\'s week again', async () => {
        seedRules({});
        const project = seedProject({ workingDays: SUN_TO_THU });
        const res = await put(OWNER, project, { updateObject: { workingDays: null } });
        expect(res.statusCode).toBe(200);
        const stored = await storedProject(project);
        expect(stored.workingDays).toBeNull();
        expect(workingDaysFor(COMPANY, stored)).toEqual(COMPANY.workingDays);
    });

    it.each([
        ['no days', { updateObject: { workingDays: [] } }],
        ['a day past Saturday', { updateObject: { workingDays: [1, 7] } }],
        ['a day sent as text', { updateObject: { workingDays: ['1'] } }],
        ['a name', { updateObject: { workingDays: 'weekdays' } }],
        ['one day pushed onto the list', { updateObject: { workingDays: 6 }, key: '$push' }],
        ['one day pulled off the list', { updateObject: { workingDays: 1 }, key: '$pull' }],
        ['a single position', { updateObject: { 'workingDays.0': 6 } }],
    ])('refuses %s and writes nothing', async (label, body) => {
        seedRules({});
        const project = seedProject({ workingDays: SUN_TO_THU });
        const res = await put(OWNER, project, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, message: expect.any(String) });
        expect(projectWrites()).toHaveLength(0);
        expect(emitted).toHaveLength(0);
    });

    it('needs the project details permission', async () => {
        seedRules({ 'project.project_details': false });
        const project = seedProject();
        const res = await put(MEMBER, project, { updateObject: { workingDays: SUN_TO_THU } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, permission: 'project.project_details' });
        expect(projectWrites()).toHaveLength(0);
    });

    it('lets a member who may edit the project details set it', async () => {
        seedRules({ 'project.project_details': true });
        const project = seedProject();
        const res = await put(MEMBER, project, { updateObject: { workingDays: SUN_TO_THU } });
        expect(res.statusCode).toBe(200);
        expect((await storedProject(project)).workingDays).toEqual(SUN_TO_THU);
    });

    it('announces the change and drops the cached project lists', async () => {
        seedRules({});
        const project = seedProject();
        await put(OWNER, project, { updateObject: { workingDays: SUN_TO_THU } });
        expect(removeCache).toHaveBeenCalledWith('UserProjectData:', true);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({ type: 'update', module: 'project', updatedFields: { workingDays: SUN_TO_THU } });
        expect(emitted[0].data).toMatchObject({ _id: String(project._id), workingDays: SUN_TO_THU });
    });

    it('stays quiet for an update that leaves the working days alone', async () => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, { updateObject: { ProjectName: 'Relaunch' } });
        expect(res.statusCode).toBe(200);
        expect(emitted).toHaveLength(0);
    });
});
