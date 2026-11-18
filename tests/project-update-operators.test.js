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
const { permissionsForProjectUpdate } = require('../Config/projectAccess');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const TEAMMATE = 'a00000000000000000000004';
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

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: TEAMMATE, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

describe('PUT /api/v1/project/:id takes only the operators the app sends', () => {
    it('refuses $rename, even from a field every member may write, and writes nothing', async () => {
        seedRules({ 'project.private_projects': 1 });
        const project = seedProject();
        const res = await put(MEMBER, project, { updateObject: { favouriteTasks: 'isPrivateSpace' }, key: '$rename' });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(projectWrites()).toHaveLength(0);
    });

    it.each(['$rename', '$inc', '$mul', '$min', '$max', '$bit', '$currentDate', '$setOnInsert', 'set', '$SET', ['$set']])('refuses the operator %p for the owner too', async (key) => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, { updateObject: { ProjectName: 'Renamed' }, key });
        expect(res.statusCode).toBe(400);
        expect(projectWrites()).toHaveLength(0);
    });

    it('refuses an operator nested inside the update document', async () => {
        seedRules({ 'project.private_projects': 1 });
        const project = seedProject();
        for (const body of [
            { updateObject: { $rename: { favouriteTasks: 'isPrivateSpace' } } },
            { updateObject: { $rename: { favouriteTasks: 'isPrivateSpace' } }, key: '$set' },
            { updateObject: { $set: { ProjectName: 'Renamed' } }, key: '$set' },
        ]) {
            const res = await put(MEMBER, project, body);
            expect(res.statusCode).toBe(400);
        }
        expect(projectWrites()).toHaveLength(0);
    });

    it('refuses an update document that is not a plain object', async () => {
        seedRules({});
        const project = seedProject();
        for (const updateObject of [['ProjectName'], 'ProjectName']) {
            const res = await put(OWNER, project, { updateObject });
            expect(res.statusCode).toBe(400);
        }
        expect(projectWrites()).toHaveLength(0);
    });

    it('stores an $addToSet value as sent instead of reading it as an expression', async () => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, { updateObject: { apps: '$CompanyId' }, key: '$addToSet' });
        expect(res.statusCode).toBe(200);
        const [write] = projectWrites();
        expect(JSON.stringify(write.data[1])).not.toMatch(/\[\s*"\$CompanyId"\s*\]/);
        expect(JSON.stringify(write.data[1])).toContain('{"$literal":"$CompanyId"}');
    });
});

describe('PUT /api/v1/project/:id keeps ownership, tenant and counter fields on the server', () => {
    const SERVER_ONLY = [
        { CompanyId: 'c00000000000000000000002' },
        { projectCreatedBy: MEMBER },
        { personalOwner: MEMBER },
        { isPersonal: true },
        { isRestrict: false },
        { sprintsObj: {} },
        { 'sprintsObj.abc': { name: 'x' } },
        { 'sprintsfolders.abc.deletedStatusKey': 0 },
        { lastTaskId: '1' },
        { milestoneAmount: 0 },
        { proposalIdNumeric: 1 },
        { lastProjectActivity: {} },
        { [`userActivity.${MEMBER}`]: {} },
        { _id: oid() },
    ];

    it.each(SERVER_ONLY)('refuses %p even for the owner', async (updateObject) => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, { updateObject });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(projectWrites()).toHaveLength(0);
    });

    it('refuses a server-only field hidden behind another operator', async () => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, { updateObject: { projectCreatedBy: 1 }, key: '$unset' });
        expect(res.statusCode).toBe(400);
        expect(projectWrites()).toHaveLength(0);
    });
});

describe('PUT /api/v1/project/:id gates privacy and caller-owned fields', () => {
    it('asks for the project list setting as well as project details to change who sees a project', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_details': true, 'settings.settings_project_list': false });
        const project = seedProject();
        const res = await put(MEMBER, project, { updateObject: { isPrivateSpace: false } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ permission: 'settings.settings_project_list' });
        expect(projectWrites()).toHaveLength(0);
    });

    it('lets a member holding both change who sees a project', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_details': true, 'settings.settings_project_list': true });
        const project = seedProject();
        const res = await put(MEMBER, project, { updateObject: { isPrivateSpace: false } });
        expect(res.statusCode).toBe(200);
    });

    it('lets a member add and remove their own favourite and watch setting with no edit permission', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_details': false });
        const project = seedProject();
        for (const body of [
            { updateObject: { favouriteTasks: { userId: MEMBER } }, key: '$addToSet' },
            { updateObject: { favouriteTasks: { userId: MEMBER } }, key: '$pull' },
            { updateObject: { [`watchers.${MEMBER}`]: 'all_activity' } },
            { updateObject: { [`watchers.${MEMBER}`]: 1 }, key: '$unset' },
        ]) {
            const res = await put(MEMBER, project, body);
            expect(res.statusCode).toBe(200);
        }
    });

    it.each([
        ['someone else\'s favourite', { updateObject: { favouriteTasks: { userId: TEAMMATE } }, key: '$pull' }],
        ['the whole favourites list', { updateObject: { favouriteTasks: [] } }],
        ['a favourite carrying more than the caller', { updateObject: { favouriteTasks: { userId: MEMBER, extra: 1 } }, key: '$addToSet' }],
        ['someone else\'s watch setting', { updateObject: { [`watchers.${TEAMMATE}`]: 1 }, key: '$unset' }],
        ['the whole watcher map', { updateObject: { watchers: {} } }],
    ])('treats %s as a project detail', async (label, body) => {
        seedRules({ 'project.private_projects': 1, 'project.project_details': false });
        const project = seedProject();
        const res = await put(MEMBER, project, body);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ permission: 'project.project_details' });
        expect(projectWrites()).toHaveLength(0);
    });
});

describe('PUT /api/v1/project/:id keeps every request shape the app sends', () => {
    const SHAPES = [
        ['a rename with no operator', { updateObject: { ProjectName: 'Renamed' } }],
        ['an empty operator', { updateObject: { ProjectName: 'Renamed' }, key: '' }],
        ['$set', { updateObject: { ProjectName: 'Renamed' }, key: '$set' }],
        ['a column toggle with array filters', { updateObject: { 'viewColumn.$[elementIndex].show': false }, key: '$set', arrayFilters: [{ 'elementIndex.key': 'k' }] }],
        ['a new column', { updateObject: { viewColumn: { label: 'Budget', key: 'k', show: true } }, key: '$push' }],
        ['an assignee added', { updateObject: { AssigneeUserId: TEAMMATE, LeadUserId: TEAMMATE }, key: '$addToSet' }],
        ['an assignee removed', { updateObject: { AssigneeUserId: MEMBER }, key: '$pull' }],
        ['an attachment added', { updateObject: { attachments: { id: 'a1', url: 'u' } }, key: '$push' }],
        ['an attachment removed', { updateObject: { attachments: { id: 'a1' } }, key: '$pull' }],
        ['an app enabled', { updateObject: { apps: 'Board' }, key: '$addToSet' }],
        ['a tab added', { updateObject: { ProjectRequiredComponent: { keyName: 'Board' } }, key: '$addToSet' }],
        ['a tab renamed', { updateObject: { 'ProjectRequiredComponent.$[elementIndex].name': 'B' }, arrayFilters: [{ 'elementIndex._id': 'x' }] }],
        ['task types saved', { updateObject: { taskTypeCounts: [], TaskTypeTemplateId: '' } }],
        ['task statuses saved', { updateObject: { taskStatusData: [], TemplateTaskStatusId: '' } }],
        ['project statuses saved', { updateObject: { projectStatusData: [], projectStatusTemplateId: '' } }],
        ['a custom field value', { updateObject: { 'customField.f1': { fieldValue: 'x' } } }],
        ['the project made private', { updateObject: { isPrivateSpace: true } }],
        ['global permissions switched off', { updateObject: { isGlobalPermission: false } }],
        ['the project trashed', { updateObject: { deletedStatusKey: 1 } }],
        ['the owner\'s watch setting removed', { updateObject: { [`watchers.${OWNER}`]: 1 }, key: '$unset' }],
    ];

    it.each(SHAPES)('accepts %s', async (label, body) => {
        seedRules({});
        const project = seedProject();
        const res = await put(OWNER, project, body);
        expect(res.statusCode).toBe(200);
        expect(projectWrites().length).toBeGreaterThan(0);
    });
});

describe('permissionsForProjectUpdate', () => {
    it('asks for both keys the web app checks before changing who sees a project', () => {
        expect(permissionsForProjectUpdate({ isPrivateSpace: true })).toEqual([['settings.settings_project_list'], ['project.project_details']]);
    });

    it('lets the caller write only their own entry of a caller-owned field', () => {
        expect(permissionsForProjectUpdate({ 'watchers.u1': 'all_activity' }, 'u1')).toEqual([]);
        expect(permissionsForProjectUpdate({ favouriteTasks: { userId: 'u1' } }, 'u1')).toEqual([]);
        expect(permissionsForProjectUpdate({ 'watchers.u2': 'all_activity' }, 'u1')).toEqual([['project.project_details']]);
        expect(permissionsForProjectUpdate({ favouriteTasks: { userId: 'u2' } }, 'u1')).toEqual([['project.project_details']]);
    });
});
