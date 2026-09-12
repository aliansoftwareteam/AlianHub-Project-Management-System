const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const reached = (name) => jest.fn((req, res) => res.status(200).json({ status: true, reached: name }));
jest.mock('../Modules/Project/controller/getProjectById', () => ({ getProjectById: reached('getProjectById') }));
jest.mock('../Modules/Project/controller/getProjectList', () => ({ getProjectList: reached('getProjectList') }));
jest.mock('../Modules/Project/controller/projectAlltaskUpdate', () => ({ projectAlltaskUpdate: reached('projectAlltaskUpdate') }));
jest.mock('../Modules/Project/controller/getSprintFolder', () => ({ getSprintFolder: reached('getSprintFolder') }));
jest.mock('../Modules/Project/controller/updateSprint', () => ({ updateSprint: reached('updateSprint') }));
jest.mock('../Modules/Project/controller/getProjectFilterData', () => ({ projectFilter: reached('projectFilter'), getRemainingProject: reached('getRemainingProject') }));
jest.mock('../Modules/Project/controller/manageGlobalFilter', () => ({ saveFilter: reached('f'), getFilter: reached('f'), deleteFilter: reached('f'), updateFilter: reached('f') }));
jest.mock('../Modules/Project/controller/checklist', () => ({ handleChecklist: reached('handleChecklist') }));
jest.mock('../Modules/Project/controller/tags', () => ({ handleTags: reached('handleTags') }));
jest.mock('../Modules/Project/controller/getQueryFun', () => ({ getQueryFun: reached('getQueryFun') }));
jest.mock('../Modules/projectSetting/controller', () => ({ changeTaskType: reached('changeTaskType'), changeTaskStatus: reached('changeTaskStatus'), migrateSprintsFun: reached('migrateSprintsFun') }));
jest.mock('../Modules/projectSetting/autoArchive', () => ({ getAutoArchive: reached('getAutoArchive'), setAutoArchive: reached('setAutoArchive') }));
jest.mock('../Modules/projectSetting/estimationScale', () => ({ setEstimationScale: reached('setEstimationScale') }));
jest.mock('../Modules/projectSetting/wipLimit', () => ({ setWipLimit: reached('setWipLimit') }));
jest.mock('../Modules/projectRules/controller', () => ({ getProjectRules: reached('getProjectRules'), updateProjectRules: reached('updateProjectRules'), deleteProjectRules: reached('deleteProjectRules') }));
jest.mock('../Modules/ImportSettings/controller', () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || reached(String(name)); return target[name]; } }));
jest.mock('../Modules/Trash/controller', () => ({ list: reached('list'), restore: reached('restore'), removeSampleData: reached('removeSampleData') }));
jest.mock('../Modules/CustomField/controller', () => ({
    ...jest.requireActual('../Modules/CustomField/controller'),
    insertCustomField: reached('insertCustomField'),
    updateCustomField: reached('updateCustomField'),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { permissionsForProjectUpdate } = require('../Config/projectAccess');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
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

const run = async (handlers, request) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(request, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await flush();
    return res;
};

const request = ({ uid = MEMBER, params = {}, body = {}, headers = {}, apiToken } = {}) => ({
    uid, params, body, query: {}, headers: { companyid: C, ...headers }, ...(apiToken ? { apiToken } : {}),
});

const seedRules = (grants = {}, type = SCHEMA_TYPE.RULES, extra = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(type, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }], ...extra });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(type, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }], ...extra });
    });
};

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER], isGlobalPermission: true, ...doc,
});

const projectName = (id) => mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === String(id)).ProjectName;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: TEAMMATE, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

describe('PUT /api/v1/project/:id', () => {
    const rename = (uid, project, extra = {}) => run(
        routesOf('../Modules/Project/routes')['PUT /api/v1/project/:id'],
        request({ uid, params: { id: String(project._id) }, body: { updateObject: { ProjectName: 'Renamed' } }, ...extra }),
    );

    it('refuses a member renaming a private project they are not in, as if it did not exist', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_name_edit': true });
        const project = seedProject();
        const res = await rename(MEMBER, project);
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ status: false, error: 'Not Found' });
        expect(projectName(project._id)).toBe('Launch');
    });

    it('answers 403 when the member can list every private project but is not assigned to this one', async () => {
        seedRules({ 'project.private_projects': 2, 'project.project_name_edit': true });
        const project = seedProject();
        const res = await rename(MEMBER, project);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'Forbidden' });
        expect(projectName(project._id)).toBe('Launch');
    });

    it.each([['owner', OWNER], ['admin', ADMIN]])('still lets the %s rename a project they are not assigned to', async (role, uid) => {
        seedRules({ 'project.private_projects': 1 });
        const project = seedProject({ AssigneeUserId: [MEMBER] });
        const res = await rename(uid, project);
        expect(res.statusCode).toBe(200);
        expect(projectName(project._id)).toBe('Renamed');
    });

    it('lets an assigned member with project_name_edit rename', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_name_edit': true });
        const project = seedProject({ AssigneeUserId: [OWNER, MEMBER] });
        const res = await rename(MEMBER, project);
        expect(res.statusCode).toBe(200);
        expect(projectName(project._id)).toBe('Renamed');
    });

    it('refuses an assigned member whose role only reads project names', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_name_edit': false });
        const project = seedProject({ AssigneeUserId: [OWNER, MEMBER] });
        const res = await rename(MEMBER, project);
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'Forbidden', permission: 'project.project_name_edit' });
        expect(projectName(project._id)).toBe('Launch');
    });

    it('counts a member assigned through a team', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_name_edit': true });
        const team = mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), assigneeUsersArray: [TEAMMATE] });
        const project = seedProject({ AssigneeUserId: [OWNER, `tId_${team._id}`] });
        const res = await rename(TEAMMATE, project);
        expect(res.statusCode).toBe(200);
        expect(projectName(project._id)).toBe('Renamed');
    });

    it('treats every company member as a member of a public project, and leaves the edit to the catalogue', async () => {
        seedRules({ 'project.project_name_edit': true });
        const allowed = seedProject({ isPrivateSpace: false });
        expect((await rename(MEMBER, allowed)).statusCode).toBe(200);

        myCache.flushAll();
        mockDb = fakeMongo.create();
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
        seedRules({ 'project.project_name_edit': null });
        const denied = seedProject({ isPrivateSpace: false });
        expect((await rename(MEMBER, denied)).statusCode).toBe(403);
        expect(projectName(denied._id)).toBe('Launch');
    });

    it('reads the project\'s own rules when it is not on global permissions', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_name_edit': null });
        const granted = seedProject({ AssigneeUserId: [MEMBER], isGlobalPermission: false });
        seedRules({ 'project.project_name_edit': true }, SCHEMA_TYPE.PROJECT_RULES, { projectId: String(granted._id) });
        expect((await rename(MEMBER, granted)).statusCode).toBe(200);

        const revoked = seedProject({ AssigneeUserId: [MEMBER], isGlobalPermission: false });
        seedRules({ 'project.project_name_edit': false }, SCHEMA_TYPE.PROJECT_RULES, { projectId: String(revoked._id) });
        expect((await rename(MEMBER, revoked)).statusCode).toBe(403);
        expect(projectName(revoked._id)).toBe('Launch');
    });

    it('lets a member keep their own favourites without any project edit permission', async () => {
        seedRules({});
        const project = seedProject({ isPrivateSpace: false });
        const res = await run(
            routesOf('../Modules/Project/routes')['PUT /api/v1/project/:id'],
            request({ params: { id: String(project._id) }, body: { updateObject: { favouriteTasks: { userId: MEMBER } }, key: '$push' } }),
        );
        expect(res.statusCode).toBe(200);
    });

    it('keeps a personal list private to its owner, admins included', async () => {
        seedRules({});
        const project = seedProject({ isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
        expect((await rename(ADMIN, project)).statusCode).toBe(404);
        expect((await rename(MEMBER, project)).statusCode).toBe(200);
    });

    it('applies the same membership rule to an API token', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_name_edit': true });
        const project = seedProject();
        const res = await rename(MEMBER, project, { apiToken: { _id: 't1', userId: MEMBER } });
        expect(res.statusCode).toBe(404);
        expect(projectName(project._id)).toBe('Launch');
    });

    it('refuses a body companyId that disagrees with the header', async () => {
        seedRules({});
        const project = seedProject({ AssigneeUserId: [OWNER] });
        const res = await run(
            routesOf('../Modules/Project/routes')['PUT /api/v1/project/:id'],
            request({ uid: OWNER, params: { id: String(project._id) }, body: { companyId: OTHER_COMPANY, updateObject: { ProjectName: 'Renamed' } } }),
        );
        expect(res.statusCode).toBe(403);
        expect(projectName(project._id)).toBe('Launch');
    });
});

describe('permissionsForProjectUpdate', () => {
    it('maps each field to the catalogue entry that gates it in the web app', () => {
        expect(permissionsForProjectUpdate({ ProjectName: 'x' })).toEqual([['project.project_name_edit']]);
        expect(permissionsForProjectUpdate({ 'customField.abc': 1 })).toEqual([['project.project_custom_field']]);
        expect(permissionsForProjectUpdate({ deletedStatusKey: 2 })).toEqual([['project.project_delete', 'project.project_close']]);
        expect(permissionsForProjectUpdate({ status: 'x', statusType: 'close' })).toEqual([['project.project_status_change', 'project.project_close']]);
        expect(permissionsForProjectUpdate({ 'watchers.u1': 'all_activity' })).toEqual([]);
    });

    it('fails closed to project_details for a field it does not know, including one nested under an operator', () => {
        expect(permissionsForProjectUpdate({ somethingNew: 1 })).toEqual([['project.project_details']]);
        expect(permissionsForProjectUpdate({ $set: { ProjectName: 'x', other: 1 } })).toEqual([['project.project_name_edit'], ['project.project_details']]);
    });
});

describe('every other project-mutating route runs the same guard', () => {
    const GRANTS = {
        'project.private_projects': 1,
        'project.project_details': true,
        'project.project_delete': true,
        'project.project_close': true,
        'project.project_checklist': true,
        'project.project_custom_field': true,
        'task.task_tag': true,
        'settings.settings_security_permissions': true,
    };

    const ROUTES = [
        ['../Modules/Project/routes', 'PUT /api/v1/project/allTask/:id', 'projectAlltaskUpdate', (pid) => ({ params: { id: pid }, body: { findObject: {}, updateObject: { deletedStatusKey: 1 } } })],
        ['../Modules/Project/routes', 'POST /api/v1/project/checklist', 'handleChecklist', (pid) => ({ body: { id: pid, operation: 'push', checklistItem: { id: 'x' } } })],
        ['../Modules/Project/routes', 'POST /api/v1/project/tags', 'handleTags', (pid) => ({ body: { id: pid, operation: 'push', items: {} } })],
        ['../Modules/projectSetting/routes', 'POST /api/v1/projectSetting/taskType', 'changeTaskType', (pid) => ({ body: { companyId: C, projectId: pid, taskTypeKey: [1], oldTaskType: [] } })],
        ['../Modules/projectSetting/routes', 'POST /api/v1/projectSetting/taskStatus', 'changeTaskStatus', (pid) => ({ body: { companyId: C, projectId: pid, taskStatusKey: [1], oldTaskStatus: [] } })],
        ['../Modules/projectSetting/routes', 'POST /api/v1/projectSetting/taskStatus/wipLimit', 'setWipLimit', (pid) => ({ body: { projectId: pid, statusKey: 1, wipLimit: 3 } })],
        ['../Modules/projectSetting/routes', 'POST /api/v1/projectSetting/autoArchive', 'setAutoArchive', (pid) => ({ body: { projectId: pid, enabled: true, afterDays: 30 } })],
        ['../Modules/projectSetting/routes', 'POST /api/v1/projectSetting/estimationScale', 'setEstimationScale', (pid) => ({ body: { projectId: pid, scale: 'linear' } })],
        ['../Modules/projectRules/routes', 'PUT /api/v1/projectRules/update', 'updateProjectRules', (pid) => ({ body: { id: oid(), key: '$set', projectId: pid, updateObject: { roles: [] } } })],
        ['../Modules/projectRules/routes', 'DELETE /api/v1/projectRules/delete/:pid', 'deleteProjectRules', (pid) => ({ params: { pid } })],
        ['../Modules/ImportSettings/routes', 'POST /api/v1/importSettingsProjectFunction', 'importSettingsProjectFunction', (pid) => ({ body: { companyId: C, type: 'project', projectId: pid } })],
        ['../Modules/Trash/routes', 'PUT /api/v2/trash/:kind/:id/restore', 'restore', (pid) => ({ params: { kind: 'projects', id: pid } })],
        ['../Modules/CustomField/routes', 'POST /api/v1/customField', 'insertCustomField', (pid) => ({ body: { type: 'save', updateObject: { global: false, projectId: [pid], fieldTitle: 'Budget' } } })],
        ['../Modules/CustomField/routes', 'PUT /api/v1/customField', 'updateCustomField', (pid) => {
            const field = mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), global: false, projectId: [pid], fieldTitle: 'Budget' });
            return { body: { type: 'updateOne', key: '$set', id: String(field._id), updateObject: { fieldTitle: 'Cost' } } };
        }],
    ];

    describe.each(ROUTES)('%s %s', (modulePath, route, controller, build) => {
        const call = (uid, project) => run(routesOf(modulePath)[route], request({ uid, ...build(String(project._id)) }));

        it('refuses a member who is not in the private project', async () => {
            seedRules(GRANTS);
            const res = await call(MEMBER, seedProject());
            expect(res.statusCode).toBe(404);
            expect(res.body).toMatchObject({ status: false });
        });

        it('lets an assigned member holding the permission through', async () => {
            seedRules(GRANTS);
            const res = await call(MEMBER, seedProject({ AssigneeUserId: [MEMBER] }));
            expect(res.body).toMatchObject({ status: true, reached: controller });
        });

        it('lets the owner through', async () => {
            seedRules({});
            const res = await call(OWNER, seedProject({ AssigneeUserId: [MEMBER] }));
            expect(res.body).toMatchObject({ status: true, reached: controller });
        });
    });

    it('refuses an assigned member without the permission on a settings route', async () => {
        seedRules({ 'project.private_projects': 1, 'project.project_details': false });
        const project = seedProject({ AssigneeUserId: [MEMBER] });
        const res = await run(
            routesOf('../Modules/projectSetting/routes')['POST /api/v1/projectSetting/autoArchive'],
            request({ body: { projectId: String(project._id), enabled: true } }),
        );
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ permission: 'project.project_details' });
    });

    it('leaves company-level custom fields and non-project trash kinds to their existing checks', async () => {
        seedRules({});
        const global = await run(routesOf('../Modules/CustomField/routes')['POST /api/v1/customField'], request({ body: { type: 'save', updateObject: { global: true } } }));
        expect(global.body).toMatchObject({ reached: 'insertCustomField' });
        const task = await run(routesOf('../Modules/Trash/routes')['PUT /api/v2/trash/:kind/:id/restore'], request({ params: { kind: 'tasks', id: oid() } }));
        expect(task.body).toMatchObject({ reached: 'restore' });
    });
});

describe('the project rules update is bound to the project it names', () => {
    it('does not change a rule that belongs to a different project', async () => {
        const { updateProjectRules } = jest.requireActual('../Modules/projectRules/controller');
        const mine = oid();
        const rule = mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { _id: oid(), projectId: oid(), key: 'project_name_edit', roles: [{ key: MEMBER_ROLE, permission: null }] });
        const res = response();
        await updateProjectRules(request({ body: { id: String(rule._id), key: '$set', projectId: mine, updateObject: { roles: [{ key: MEMBER_ROLE, permission: true }] } } }), res);
        expect(res.statusCode).toBe(400);
        expect(mockDb.store[SCHEMA_TYPE.PROJECT_RULES][0].roles[0].permission).toBeNull();
    });
});

describe('project settings routes require a session', () => {
    it('lists the auto-archive and estimation-scale prefixes behind the JWT guard', () => {
        const guarded = [];
        require('../Config/setMiddleware').setMiddlewareWithCV2({ use: (paths) => guarded.push(...paths) });
        expect(guarded).toEqual(expect.arrayContaining(['/api/v1/projectSetting/autoArchive', '/api/v1/projectSetting/estimationScale']));
    });
});
