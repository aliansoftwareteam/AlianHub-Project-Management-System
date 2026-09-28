const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

const reached = (name) => jest.fn((req, res) => res.status(200).json({ status: true, reached: name }));
jest.mock('../Modules/Project/controller/getProjectById', () => ({ getProjectById: reached('getProjectById') }));
jest.mock('../Modules/Project/controller/getProjectList', () => ({ getProjectList: reached('getProjectList') }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProject: reached('updateProject') }));
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

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const { cleanViewSettings, DEFAULT_VIEW_SETTINGS } = require('../Modules/Project/helpers/viewSettings');
const membersCtrl = require('../Modules/settings/Members/controller');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const TEAMMATE = 'a00000000000000000000004';
const MEMBER_ROLE = 3;
const LIST_ID = 'b00000000000000000000001';
const BOARD_ID = 'b00000000000000000000002';

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

const request = ({ uid = MEMBER, params = {}, body = {}, headers = {} } = {}) => ({
    uid, params, body, query: {}, headers: { companyid: C, ...headers },
});

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
    _id: oid(),
    ProjectName: 'Launch',
    isPrivateSpace: false,
    AssigneeUserId: [OWNER, MEMBER],
    isGlobalPermission: true,
    ProjectRequiredComponent: [
        { _id: LIST_ID, id: LIST_ID, name: 'List', keyName: 'ProjectListView', value: 'list', setAsDefault: true, viewStatus: true },
        { _id: BOARD_ID, id: BOARD_ID, name: 'Board', keyName: 'ProjectKanban', value: 'ProjectKanban', viewStatus: true },
    ],
    ...doc,
});

const storedProject = (id) => mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === String(id));
const storedView = (project, viewId) => storedProject(project._id).ProjectRequiredComponent.find((v) => String(v._id) === viewId);

const SETTINGS = {
    groupBy: 2,
    me: true,
    search: 'invoice',
    doneBy: 'agent',
    subtasks: 'expanded',
    sort: { field: 'DueDate', dir: -1 },
    columns: { order: ['due', 'assignee', 'cf:6a0000000000000000000001'], shown: ['start'], hidden: ['tags'] },
    filters: [{ name: { value: 'statusKey', name: 'status', type: 'array', filterOn: 'statusKey' }, comparison: { value: ':', name: 'Is' }, values: [3], condition: '&&', date: '' }],
};

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    socketEmitter.emit.mockClear();
    removeCache.mockClear();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false, ProjectRequiredComponent: [] });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false, ProjectRequiredComponent: [] });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: TEAMMATE, roleType: MEMBER_ROLE, status: 2, isDelete: false, ProjectRequiredComponent: [] });
});

describe('the stored settings shape', () => {
    it('keeps what a view saves and drops what it does not know', () => {
        const clean = cleanViewSettings({ ...SETTINGS, planted: { $where: '1' }, groupBy: 9, doneBy: 'robots', sort: { field: '$where', dir: 1 } });
        expect(clean).toEqual({
            ...DEFAULT_VIEW_SETTINGS,
            me: true,
            search: 'invoice',
            subtasks: 'expanded',
            columns: SETTINGS.columns,
            filters: SETTINGS.filters,
        });
        expect(clean).not.toHaveProperty('planted');
    });

    it('keeps column ids as values, sorted where order does not matter, and drops ids that could name a path', () => {
        const clean = cleanViewSettings({ columns: { order: ['due', 'due', 'a.b', '$x'], shown: ['start', 'points', 'tags'], hidden: ['tags', 'risk'] } });
        expect(clean.columns).toEqual({ order: ['due'], shown: ['points', 'start'], hidden: ['risk', 'tags'] });
    });

    it('refuses filter rows that would name an operator as a field', () => {
        const row = { ...SETTINGS.filters[0], name: { value: '$where', type: 'array', filterOn: '$where' } };
        expect(cleanViewSettings({ filters: [row] }).filters).toEqual([]);
    });

    it('survives the strict project and member schemas, which keep view entries whole', () => {
        const projects = new mongoose.Schema(schema.projects);
        const members = new mongoose.Schema(schema.companyUsers);
        const Project = mongoose.models.ViewSettingsProject || mongoose.model('ViewSettingsProject', projects);
        const Member = mongoose.models.ViewSettingsMember || mongoose.model('ViewSettingsMember', members);
        const view = { _id: LIST_ID, keyName: 'ProjectListView', title: 'Mine', settings: cleanViewSettings(SETTINGS) };
        expect(new Project({ ProjectRequiredComponent: [view] }).toObject().ProjectRequiredComponent[0]).toMatchObject(view);
        expect(new Member({ ProjectRequiredComponent: [{ ...view, id: 'abcdefghij' }] }).toObject().ProjectRequiredComponent[0]).toMatchObject(view);
    });
});

describe('PUT /api/v1/project/:id/view-settings', () => {
    const save = (uid, project, body = {}) => run(
        routesOf('../Modules/Project/routes')['PUT /api/v1/project/:id/view-settings'],
        request({ uid, params: { id: String(project._id) }, body: { viewId: LIST_ID, settings: SETTINGS, ...body } }),
    );

    it('refuses a member without the view permission and leaves the view as it was', async () => {
        seedRules({ 'project.view_list': false, 'project.project_details': false });
        const project = seedProject();
        const res = await save(MEMBER, project);
        expect(res.statusCode).toBe(403);
        expect(storedView(project, LIST_ID).settings).toBeUndefined();
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('saves for everyone when the member may edit the project views', async () => {
        seedRules({ 'project.view_list': true, 'project.project_details': false });
        const project = seedProject();
        const res = await save(MEMBER, project);
        expect(res.statusCode).toBe(200);
        expect(storedView(project, LIST_ID).settings).toEqual(cleanViewSettings(SETTINGS));
        expect(storedView(project, BOARD_ID).settings).toBeUndefined();
    });

    it('lets the owner save without any rule', async () => {
        const project = seedProject();
        expect((await save(OWNER, project)).statusCode).toBe(200);
    });

    it('announces the change and clears the cached project lists', async () => {
        const project = seedProject();
        await save(OWNER, project);
        expect(removeCache).toHaveBeenCalledWith('UserProjectData:', true);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', updatedFields: expect.objectContaining({ ProjectRequiredComponent: expect.anything() }) }));
    });

    it('works inside the caller\'s company only', async () => {
        const project = seedProject();
        await save(OWNER, project);
        const writes = mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.PROJECTS);
        expect(writes.length).toBeGreaterThan(0);
        writes.forEach((call) => expect(call.companyId).toBe(C));
    });

    it('refuses a body that names another company than the session', async () => {
        const project = seedProject();
        const res = await save(OWNER, project, { companyId: OTHER_COMPANY });
        expect(res.statusCode).toBe(403);
        expect(storedView(project, LIST_ID).settings).toBeUndefined();
    });

    it('answers 404 for a view the project does not have', async () => {
        const project = seedProject();
        expect((await save(OWNER, project, { viewId: 'b000000000000000000000ff' })).statusCode).toBe(404);
    });

    it('refuses settings that are not an object', async () => {
        const project = seedProject();
        expect((await save(OWNER, project, { settings: 'group by status' })).statusCode).toBe(400);
    });
});

describe('POST /api/v1/project/:id/views', () => {
    const create = (uid, project, body = {}) => run(
        routesOf('../Modules/Project/routes')['POST /api/v1/project/:id/views'],
        request({ uid, params: { id: String(project._id) }, body: { sourceViewId: LIST_ID, title: 'Due this week', settings: SETTINGS, ...body } }),
    );

    it('adds a second view of the same kind, with its own id, name and settings', async () => {
        seedRules({ 'project.view_list': true });
        const project = seedProject();
        const res = await create(MEMBER, project);
        expect(res.statusCode).toBe(200);
        const views = storedProject(project._id).ProjectRequiredComponent;
        expect(views).toHaveLength(3);
        const added = views[2];
        expect(added).toMatchObject({ keyName: 'ProjectListView', name: 'List', title: 'Due this week', setAsDefault: false, sourceViewId: LIST_ID, settings: cleanViewSettings(SETTINGS) });
        expect(added._id).toMatch(/^[a-f0-9]{24}$/);
        expect(added._id).not.toBe(LIST_ID);
        expect(res.body.data._id).toBe(added._id);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project' }));
    });

    it('needs the same permission as saving a shared view', async () => {
        seedRules({ 'project.view_list': false, 'project.project_details': false });
        const project = seedProject();
        expect((await create(MEMBER, project)).statusCode).toBe(403);
        expect(storedProject(project._id).ProjectRequiredComponent).toHaveLength(2);
    });

    it('needs a name', async () => {
        const project = seedProject();
        expect((await create(OWNER, project, { title: '   ' })).statusCode).toBe(400);
    });
});

describe('private view settings', () => {
    const rowOf = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((r) => r.userId === userId);
    const call = async (uid, body) => {
        const res = response();
        await membersCtrl.handlePrivateView({ uid, headers: { companyid: C }, body, params: {}, query: {} }, res, () => {});
        return res;
    };
    const privateList = (extra = {}) => ({ id: 'mylist0001', _id: LIST_ID, name: 'List', keyName: 'ProjectListView', isPrivate: true, projectId: 'p1', ...extra });

    it('saves settings on the caller\'s own private view', async () => {
        rowOf(MEMBER).ProjectRequiredComponent = [privateList()];
        const res = await call(MEMBER, { id: String(rowOf(MEMBER)._id), operation: 'settings', data: { id: 'mylist0001', settings: SETTINGS } });
        expect(res.statusCode).toBe(200);
        expect(rowOf(MEMBER).ProjectRequiredComponent[0].settings).toEqual(cleanViewSettings(SETTINGS));
    });

    it('keeps one person\'s private settings away from another\'s', async () => {
        rowOf(MEMBER).ProjectRequiredComponent = [privateList()];
        rowOf(TEAMMATE).ProjectRequiredComponent = [privateList()];
        const res = await call(TEAMMATE, { id: String(rowOf(MEMBER)._id), operation: 'settings', data: { id: 'mylist0001', settings: SETTINGS } });
        expect(res.statusCode).toBe(403);
        await call(TEAMMATE, { id: String(rowOf(TEAMMATE)._id), operation: 'settings', data: { id: 'mylist0001', settings: { ...SETTINGS, search: 'theirs' } } });
        expect(rowOf(MEMBER).ProjectRequiredComponent[0].settings).toBeUndefined();
        expect(rowOf(TEAMMATE).ProjectRequiredComponent[0].settings.search).toBe('theirs');
    });

    it('answers 404 for a private view the caller does not have', async () => {
        const res = await call(MEMBER, { id: String(rowOf(MEMBER)._id), operation: 'settings', data: { id: 'nope', settings: SETTINGS } });
        expect(res.statusCode).toBe(404);
    });

    it('cleans the settings and name a new private view is created with', async () => {
        const res = await call(MEMBER, { id: String(rowOf(MEMBER)._id), operation: 'push', data: privateList({ title: 'Mine', settings: { ...SETTINGS, planted: 1 } }) });
        expect(res.statusCode).toBe(200);
        const stored = rowOf(MEMBER).ProjectRequiredComponent[0];
        expect(stored.settings).toEqual(cleanViewSettings(SETTINGS));
        expect(stored.title).toBe('Mine');
    });

    it('writes to the caller\'s company only', async () => {
        rowOf(MEMBER).ProjectRequiredComponent = [privateList()];
        await call(MEMBER, { id: String(rowOf(MEMBER)._id), operation: 'settings', data: { id: 'mylist0001', settings: SETTINGS } });
        const memberCalls = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.COMPANY_USERS);
        expect(memberCalls.length).toBeGreaterThan(0);
        memberCalls.forEach((c) => expect(c.companyId).toBe(C));
    });
});
