const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
let mockFutureSetting = false;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => undefined) }));

/* Stands in for a setting a later build adds to a view's setup: templates must carry it without naming it. */
jest.mock('../Modules/Project/helpers/viewSettings', () => {
    const real = jest.requireActual('../Modules/Project/helpers/viewSettings');
    return {
        ...real,
        cleanViewSettings: (raw) => ({
            ...real.cleanViewSettings(raw),
            ...(mockFutureSetting ? { density: raw && raw.density === 'compact' ? 'compact' : 'comfortable' } : {}),
        }),
    };
});

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

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const { cleanViewSettings, DEFAULT_VIEW_SETTINGS } = jest.requireActual('../Modules/Project/helpers/viewSettings');
const rules = require('../Modules/ViewTemplates/templateRules');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const TEAMMATE = 'a00000000000000000000004';
const OUTSIDER = 'a00000000000000000000009';
const MEMBER_ROLE = 3;
const ALPHA = 'b00000000000000000000001';
const BETA = 'b00000000000000000000002';
const LIST_ID = 'd00000000000000000000001';
const BOARD_ID = 'd00000000000000000000002';
const COMMENTS_ID = 'd00000000000000000000003';
const TABLE_ROW = 'e00000000000000000000009';
const SHARED_FIELD = 'f00000000000000000000001';
const ALPHA_FIELD = 'f00000000000000000000002';
const GONE_FIELD = 'f00000000000000000000003';

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

const call = async (modulePath, route, uid, { params = {}, query = {}, body = {}, headers = {} } = {}) => {
    const handlers = routesOf(modulePath)[route];
    if (!handlers) throw new Error(`no route ${route}`);
    const res = response();
    const req = { uid, params, query, body, headers: { companyid: C, ...headers } };
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const templates = (route, uid, options) => call('../Modules/ViewTemplates/routes', route, uid, options);
const addView = (uid, projectId, body) => call('../Modules/Project/routes', 'POST /api/v1/project/:id/views', uid, { params: { id: projectId }, body });

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

const customRow = (fieldId, label) => ({
    name: { value: `customField.${fieldId}`, name: label, type: 'custom', fieldType: 'number', filterOn: `customField.${fieldId}.fieldValue` },
    comparison: { value: ':>', name: 'Greater_Than' },
    values: [5],
    condition: '&&',
    date: '',
});
const statusRow = (values) => ({ name: { value: 'statusKey', name: 'status', type: 'array', filterOn: 'statusKey' }, comparison: { value: ':', name: 'Is' }, values, condition: '&&', date: '' });
const priorityRow = { name: { value: 'Task_Priority', name: 'priority', type: 'array', filterOn: 'Task_Priority' }, comparison: { value: ':', name: 'Is' }, values: ['HIGH'], condition: '&&', date: '' };

const SETUP = {
    groupBy: `cf:${ALPHA_FIELD}`,
    me: true,
    search: 'invoice',
    subtasks: 'expanded',
    sort: { field: `customField.${ALPHA_FIELD}.fieldValue`, dir: -1 },
    columns: { order: ['due', `cf:${ALPHA_FIELD}`, `cf:${SHARED_FIELD}`], shown: [`cf:${ALPHA_FIELD}`, 'start'], hidden: ['tags', `cf:${GONE_FIELD}`] },
    filters: [customRow(ALPHA_FIELD, 'Size'), customRow(SHARED_FIELD, 'Budget'), statusRow([1, 7]), priorityRow],
    workloadUnit: 'points',
};

const seedProject = (_id, doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id,
    ProjectName: `Project ${_id.slice(-1)}`,
    isPrivateSpace: false,
    AssigneeUserId: [OWNER, MEMBER],
    isGlobalPermission: true,
    taskStatusData: [{ key: 1, name: 'To Do' }, { key: 3, name: 'Done' }],
    ProjectRequiredComponent: [
        { _id: LIST_ID, id: LIST_ID, name: 'List', keyName: 'ProjectListView', value: 'list', setAsDefault: true, viewStatus: true, settings: { ...SETUP, planted: { $where: '1' } } },
        { _id: BOARD_ID, id: BOARD_ID, name: 'Board', keyName: 'ProjectKanban', value: 'ProjectKanban', viewStatus: true },
        { _id: COMMENTS_ID, id: COMMENTS_ID, name: 'Comments', keyName: 'Comments', value: 'comments', viewStatus: true },
    ],
    ...doc,
});

const seedTemplate = (doc = {}) => mockDb.seed(SCHEMA_TYPE.VIEW_TEMPLATES, {
    name: 'Sprint list', viewType: 'ProjectListView', settings: cleanViewSettings(SETUP), createdBy: OWNER, deletedStatusKey: 0, ...doc,
});

const storedTemplates = () => mockDb.store[SCHEMA_TYPE.VIEW_TEMPLATES] || [];
const storedProject = (id) => mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === String(id));
const memberRow = (userId) => mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((row) => row.userId === userId);
const emitted = (type) => socketEmitter.emit.mock.calls.filter(([event, payload]) => event === type && payload.module === 'viewTemplates').map(([, payload]) => payload);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockFutureSetting = false;
    socketEmitter.emit.mockClear();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, MEMBER_ROLE], [TEAMMATE, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ProjectRequiredComponent: [] });
    });
    seedProject(ALPHA);
    seedProject(BETA, { taskStatusData: [{ key: 1, name: 'To Do' }, { key: 5, name: 'Review' }], ProjectRequiredComponent: [{ _id: LIST_ID, id: LIST_ID, name: 'List', keyName: 'ProjectListView', value: 'list', viewStatus: true }] });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: SHARED_FIELD, fieldTitle: 'Budget', fieldType: 'number', type: 'task', global: true, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: ALPHA_FIELD, fieldTitle: 'Size', fieldType: 'number', type: 'task', global: false, projectId: [ALPHA], isDelete: true });
    mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: GONE_FIELD, fieldTitle: 'Old', fieldType: 'number', type: 'task', global: true, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, { _id: TABLE_ROW, name: 'Table', keyName: 'TableView', value: 'TableView', sortIndex: 9, setAsDefault: false, viewStatus: false });
});

describe('fitting a saved setup to a project', () => {
    const fit = (settings, has) => rules.fitSettings(settings, { fieldIds: new Set(has.fields || []), statusKeys: new Set((has.statuses || []).map(String)) });

    it('keeps everything the project has', () => {
        const fitted = fit(SETUP, { fields: [ALPHA_FIELD, SHARED_FIELD, GONE_FIELD], statuses: [1, 7] });
        expect(fitted.settings).toEqual(cleanViewSettings(SETUP));
        expect(fitted.leftOut).toEqual([]);
    });

    it('drops a group, sort, filter and column on a custom field the project lacks, and says which parts', () => {
        const fitted = fit(SETUP, { fields: [SHARED_FIELD], statuses: [1, 7] });
        expect(fitted.settings.groupBy).toBe(DEFAULT_VIEW_SETTINGS.groupBy);
        expect(fitted.settings.sort).toBeNull();
        expect(fitted.settings.filters.map((row) => row.name.value)).toEqual([`customField.${SHARED_FIELD}`, 'statusKey', 'Task_Priority']);
        expect(fitted.settings.columns).toEqual({ order: ['due', `cf:${SHARED_FIELD}`], shown: ['start'], hidden: ['tags'] });
        expect(fitted.leftOut).toEqual(['group', 'sort', 'filters', 'columns']);
    });

    it('drops the statuses the project lacks from a status filter, and the filter once none is left', () => {
        const some = fit(SETUP, { fields: [ALPHA_FIELD, SHARED_FIELD, GONE_FIELD], statuses: [1, 3] });
        expect(some.settings.filters.find((row) => row.name.value === 'statusKey').values).toEqual([1]);
        expect(some.leftOut).toEqual(['filters']);
        const none = fit(SETUP, { fields: [ALPHA_FIELD, SHARED_FIELD, GONE_FIELD], statuses: [3] });
        expect(none.settings.filters.some((row) => row.name.value === 'statusKey')).toBe(false);
        expect(none.leftOut).toEqual(['filters']);
    });

    it('leaves every other setting as it was saved', () => {
        const fitted = fit(SETUP, { fields: [], statuses: [] });
        expect(fitted.settings).toMatchObject({ me: true, search: 'invoice', subtasks: 'expanded', workloadUnit: 'points' });
        expect(Object.keys(fitted.settings).sort()).toEqual(Object.keys(cleanViewSettings({})).sort());
    });

    it('carries a setting it has never heard of', () => {
        mockFutureSetting = true;
        const fitted = fit({ ...SETUP, density: 'compact' }, { fields: [], statuses: [] });
        expect(fitted.settings.density).toBe('compact');
    });
});

describe('POST /api/v2/view-templates', () => {
    const save = (uid, body = {}, headers = {}) => templates('POST /api/v2/view-templates', uid, { body: { projectId: ALPHA, viewId: LIST_ID, name: 'Sprint list', ...body }, headers });

    it('stores the view type and its cleaned setup under the name', async () => {
        seedRules({ 'project.view_list': true });
        const res = await save(MEMBER);
        expect(res.statusCode).toBe(200);
        const [doc] = storedTemplates();
        expect(doc).toMatchObject({ name: 'Sprint list', viewType: 'ProjectListView', createdBy: MEMBER, deletedStatusKey: 0 });
        expect(doc.settings).toEqual(cleanViewSettings(SETUP));
        expect(doc.settings).not.toHaveProperty('planted');
        expect(res.body.data).toMatchObject({ _id: String(doc._id), name: 'Sprint list', viewType: 'ProjectListView' });
        expect(res.body.data).not.toHaveProperty('settings');
    });

    it('declares every field it stores, so the strict schema keeps them', async () => {
        await save(OWNER);
        const declared = Object.keys(schema.view_templates);
        const [doc] = storedTemplates();
        expect(Object.keys(doc).filter((key) => !['_id', 'createdAt', 'updatedAt'].includes(key) && !declared.includes(key))).toEqual([]);
        const Model = mongoose.models.ViewTemplateShape || mongoose.model('ViewTemplateShape', new mongoose.Schema(schema.view_templates));
        expect(new Model(doc).toObject().settings).toEqual(doc.settings);
    });

    it('carries a setting a later build adds, without naming it', async () => {
        mockFutureSetting = true;
        storedProject(ALPHA).ProjectRequiredComponent[0].settings.density = 'compact';
        await save(OWNER);
        expect(storedTemplates()[0].settings.density).toBe('compact');
    });

    it('is refused to a member who may not change the view for everyone', async () => {
        seedRules({ 'project.view_list': false, 'project.project_details': false });
        const res = await save(MEMBER);
        expect(res.statusCode).toBe(403);
        expect(storedTemplates()).toEqual([]);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('answers 404 for a private project the caller is not in', async () => {
        seedRules({ 'project.view_list': true });
        storedProject(ALPHA).isPrivateSpace = true;
        storedProject(ALPHA).AssigneeUserId = [OWNER];
        expect((await save(MEMBER)).statusCode).toBe(404);
        expect(storedTemplates()).toEqual([]);
    });

    it('saves the caller\'s own private view, and nobody else\'s', async () => {
        seedRules({ 'project.view_list': true });
        memberRow(MEMBER).ProjectRequiredComponent = [{ _id: LIST_ID, id: 'mine000001', name: 'List', keyName: 'ProjectListView', isPrivate: true, projectId: ALPHA, settings: { search: 'mine' } }];
        expect((await save(TEAMMATE, { viewId: 'mine000001' })).statusCode).toBe(404);
        const res = await save(MEMBER, { viewId: 'mine000001' });
        expect(res.statusCode).toBe(200);
        expect(storedTemplates()[0].settings.search).toBe('mine');
    });

    it('needs a name, and keeps it to the length a view name may have', async () => {
        expect((await save(OWNER, { name: '   ' })).statusCode).toBe(400);
        await save(OWNER, { name: 'x'.repeat(200) });
        expect(storedTemplates()).toHaveLength(1);
        expect(storedTemplates()[0].name).toHaveLength(60);
    });

    it('answers 404 for a view the project does not have', async () => {
        expect((await save(OWNER, { viewId: 'd000000000000000000000ff' })).statusCode).toBe(404);
    });

    it('refuses a kind of view that keeps no setup', async () => {
        expect((await save(OWNER, { viewId: COMMENTS_ID })).statusCode).toBe(400);
        expect(storedTemplates()).toEqual([]);
    });

    it('stops at the cap, counting only templates that still exist', async () => {
        for (let i = 0; i < rules.MAX_TEMPLATES - 1; i += 1) seedTemplate({ name: `T${i}` });
        seedTemplate({ name: 'Deleted', deletedStatusKey: 1 });
        expect((await save(OWNER)).statusCode).toBe(200);
        const res = await save(OWNER, { name: 'One too many' });
        expect(res.statusCode).toBe(400);
        expect(storedTemplates().filter((row) => row.name === 'One too many')).toEqual([]);
    });

    it('tells the company a template was added, without its setup', async () => {
        await save(OWNER);
        const [event] = emitted('insert');
        expect(event).toMatchObject({ type: 'insert', companyId: C, data: { name: 'Sprint list', viewType: 'ProjectListView' } });
        expect(event.data).not.toHaveProperty('settings');
    });

    it('works inside the caller\'s company only', async () => {
        await save(OWNER);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        mockDb.calls.forEach((entry) => expect(entry.companyId).toBe(C));
        const res = await save(OWNER, { companyId: OTHER_COMPANY, name: 'Elsewhere' });
        expect(res.statusCode).toBe(403);
        expect(storedTemplates()).toHaveLength(1);
    });
});

describe('GET /api/v2/view-templates', () => {
    it('lists names and view types, never the setup, and says who may manage', async () => {
        seedTemplate({ name: 'Zebra' });
        seedTemplate({ name: 'Alpha board', viewType: 'ProjectKanban' });
        seedTemplate({ name: 'Deleted', deletedStatusKey: 1 });
        const forMember = await templates('GET /api/v2/view-templates', MEMBER);
        expect(forMember.statusCode).toBe(200);
        expect(forMember.body.data.map((row) => [row.name, row.viewType, row.canManage])).toEqual([['Alpha board', 'ProjectKanban', false], ['Zebra', 'ProjectListView', false]]);
        forMember.body.data.forEach((row) => expect(row).not.toHaveProperty('settings'));
        const forAdmin = await templates('GET /api/v2/view-templates', ADMIN);
        expect(forAdmin.body.data.every((row) => row.canManage === true)).toBe(true);
    });

    it('answers nobody outside the company', async () => {
        seedTemplate();
        const res = await templates('GET /api/v2/view-templates', OUTSIDER);
        expect(res.statusCode).toBe(403);
        expect(res.body.data).toBeUndefined();
    });
});

describe('renaming and deleting', () => {
    it('lets an owner or admin rename, and tells the company', async () => {
        const template = seedTemplate();
        const res = await templates('PATCH /api/v2/view-templates/:id', ADMIN, { params: { id: String(template._id) }, body: { name: '  Release list  ' } });
        expect(res.statusCode).toBe(200);
        expect(storedTemplates()[0].name).toBe('Release list');
        expect(emitted('update')[0]).toMatchObject({ companyId: C, data: { _id: String(template._id), name: 'Release list' } });
    });

    it('refuses a rename or delete from a member, even one who may save templates', async () => {
        seedRules({ 'project.view_list': true });
        const template = seedTemplate();
        const renamed = await templates('PATCH /api/v2/view-templates/:id', MEMBER, { params: { id: String(template._id) }, body: { name: 'Mine now' } });
        const deleted = await templates('DELETE /api/v2/view-templates/:id', MEMBER, { params: { id: String(template._id) } });
        expect([renamed.statusCode, deleted.statusCode]).toEqual([403, 403]);
        expect(storedTemplates()[0]).toMatchObject({ name: 'Sprint list', deletedStatusKey: 0 });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('needs a name to rename', async () => {
        const template = seedTemplate();
        const res = await templates('PATCH /api/v2/view-templates/:id', OWNER, { params: { id: String(template._id) }, body: { name: ' ' } });
        expect(res.statusCode).toBe(400);
    });

    it('deletes the template and leaves the views made from it alone', async () => {
        const template = seedTemplate();
        const added = await addView(OWNER, BETA, { templateId: String(template._id) });
        const before = JSON.stringify(storedProject(BETA).ProjectRequiredComponent);
        const res = await templates('DELETE /api/v2/view-templates/:id', OWNER, { params: { id: String(template._id) } });
        expect(res.statusCode).toBe(200);
        expect(storedTemplates()[0].deletedStatusKey).toBe(1);
        expect(JSON.stringify(storedProject(BETA).ProjectRequiredComponent)).toBe(before);
        expect(storedProject(BETA).ProjectRequiredComponent.some((view) => view._id === added.body.data._id)).toBe(true);
        expect(emitted('delete')[0]).toMatchObject({ companyId: C, data: { _id: String(template._id) } });
        expect((await templates('GET /api/v2/view-templates', OWNER)).body.data).toEqual([]);
    });

    it('answers 404 for a template that is gone or was never there', async () => {
        const gone = seedTemplate({ deletedStatusKey: 1 });
        expect((await templates('PATCH /api/v2/view-templates/:id', OWNER, { params: { id: String(gone._id) }, body: { name: 'Back' } })).statusCode).toBe(404);
        expect((await templates('DELETE /api/v2/view-templates/:id', OWNER, { params: { id: 'not-an-id' } })).statusCode).toBe(404);
    });
});

describe('POST /api/v1/project/:id/views with a template', () => {
    it('adds a view of the template\'s kind with its setup, named after the template', async () => {
        seedRules({ 'project.view_list': true });
        const fitsAlpha = cleanViewSettings({ ...SETUP, columns: { ...SETUP.columns, hidden: ['tags'] }, filters: [customRow(ALPHA_FIELD, 'Size'), statusRow([1, 3]), priorityRow] });
        const template = seedTemplate({ settings: fitsAlpha });
        const res = await addView(MEMBER, ALPHA, { templateId: String(template._id) });
        expect(res.statusCode).toBe(200);
        const views = storedProject(ALPHA).ProjectRequiredComponent;
        expect(views).toHaveLength(4);
        expect(views[3]).toMatchObject({ keyName: 'ProjectListView', name: 'List', title: 'Sprint list', sourceViewId: LIST_ID, setAsDefault: false, isPin: false });
        expect(views[3].settings).toEqual(fitsAlpha);
        expect(views[3]._id).toMatch(/^[a-f0-9]{24}$/);
        expect(views[3]._id).not.toBe(LIST_ID);
        expect(res.body.data._id).toBe(views[3]._id);
        expect(res.body.leftOut).toEqual([]);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project' }));
    });

    it('leaves out what the target project lacks and says which parts', async () => {
        const template = seedTemplate();
        const res = await addView(OWNER, BETA, { templateId: String(template._id), title: 'Borrowed', isPin: true });
        expect(res.statusCode).toBe(200);
        const added = storedProject(BETA).ProjectRequiredComponent[1];
        expect(added).toMatchObject({ title: 'Borrowed', isPin: true });
        expect(added.settings.groupBy).toBe(DEFAULT_VIEW_SETTINGS.groupBy);
        expect(added.settings.sort).toBeNull();
        expect(added.settings.filters.map((row) => [row.name.value, row.values])).toEqual([[`customField.${SHARED_FIELD}`, [5]], ['statusKey', [1]], ['Task_Priority', ['HIGH']]]);
        expect(added.settings.columns).toEqual({ order: ['due', `cf:${SHARED_FIELD}`], shown: ['start'], hidden: ['tags'] });
        expect(res.body.leftOut).toEqual(['group', 'sort', 'filters', 'columns']);
        expect(storedTemplates()[0].settings).toEqual(cleanViewSettings(SETUP));
    });

    it('adds the first view of a kind from the company\'s catalogue', async () => {
        const template = seedTemplate({ name: 'Wide table', viewType: 'TableView', settings: cleanViewSettings({ search: 'wide' }) });
        const res = await addView(OWNER, ALPHA, { templateId: String(template._id) });
        expect(res.statusCode).toBe(200);
        const added = storedProject(ALPHA).ProjectRequiredComponent[3];
        expect(added).toMatchObject({ _id: TABLE_ROW, id: TABLE_ROW, keyName: 'TableView', name: 'Table', value: 'TableView', title: 'Wide table' });
        expect(added.settings.search).toBe('wide');
        expect(added).not.toHaveProperty('sourceViewId');
    });

    it('answers 404 for a kind of view the catalogue no longer offers', async () => {
        const template = seedTemplate({ viewType: 'Calendar' });
        expect((await addView(OWNER, ALPHA, { templateId: String(template._id) })).statusCode).toBe(404);
        expect(storedProject(ALPHA).ProjectRequiredComponent).toHaveLength(3);
    });

    it('needs the same permission as adding any shared view', async () => {
        seedRules({ 'project.view_list': false, 'project.project_details': false });
        const template = seedTemplate();
        expect((await addView(MEMBER, ALPHA, { templateId: String(template._id) })).statusCode).toBe(403);
        expect(storedProject(ALPHA).ProjectRequiredComponent).toHaveLength(3);
    });

    it('answers 404 for a deleted or unknown template', async () => {
        const gone = seedTemplate({ deletedStatusKey: 1 });
        expect((await addView(OWNER, ALPHA, { templateId: String(gone._id) })).statusCode).toBe(404);
        expect((await addView(OWNER, ALPHA, { templateId: 'nope' })).statusCode).toBe(404);
        expect(storedProject(ALPHA).ProjectRequiredComponent).toHaveLength(3);
    });

    it('hands back the fitted view without storing it when it is to be private', async () => {
        const template = seedTemplate();
        const res = await addView(OWNER, BETA, { templateId: String(template._id), isPrivate: true });
        expect(res.statusCode).toBe(200);
        expect(storedProject(BETA).ProjectRequiredComponent).toHaveLength(1);
        expect(res.body.data).toMatchObject({ _id: LIST_ID, keyName: 'ProjectListView', title: 'Sprint list' });
        expect(res.body.data.settings.groupBy).toBe(DEFAULT_VIEW_SETTINGS.groupBy);
        expect(res.body.leftOut).toEqual(['group', 'sort', 'filters', 'columns']);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('reads the template, the project and its fields in the caller\'s company only', async () => {
        const template = seedTemplate();
        await addView(OWNER, BETA, { templateId: String(template._id) });
        const reads = mockDb.calls.filter((entry) => [SCHEMA_TYPE.VIEW_TEMPLATES, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.PROJECTS].includes(entry.type));
        expect(new Set(reads.map((entry) => entry.type)).size).toBe(3);
        reads.forEach((entry) => expect(entry.companyId).toBe(C));
    });

    it('still copies a view the old way when no template is named', async () => {
        const res = await addView(OWNER, ALPHA, { sourceViewId: BOARD_ID, title: 'Second board', settings: { search: 'x' } });
        expect(res.statusCode).toBe(200);
        expect(storedProject(ALPHA).ProjectRequiredComponent[3]).toMatchObject({ keyName: 'ProjectKanban', title: 'Second board', sourceViewId: BOARD_ID });
    });
});

describe('the live update', () => {
    const helper = require('../socket/helper');
    const { relay, EVENT } = require('../socket/controller/viewTemplateSocket');

    const join = (companyId, socketId) => {
        const emit = jest.fn();
        const roomName = `selected_companies_${companyId}**${socketId}`;
        const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid: OWNER } };
        helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
        return emit;
    };

    it('reaches the sockets of that company and no other, and carries no setup', async () => {
        const mine = join(C, 's1');
        const theirs = join(OTHER_COMPANY, 's2');
        await relay({ type: 'insert', companyId: C, module: 'viewTemplates', data: { _id: 'x', name: 'Sprint list', viewType: 'ProjectListView', settings: { search: 'secret' } } });
        expect(mine).toHaveBeenCalledWith(EVENT, { type: 'insert' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('listens for every kind of template write', () => {
        const listened = socketEmitter.on.mock.calls.map(([event]) => event);
        expect(listened).toEqual(expect.arrayContaining(['viewTemplates:insert', 'viewTemplates:update', 'viewTemplates:delete']));
    });
});
