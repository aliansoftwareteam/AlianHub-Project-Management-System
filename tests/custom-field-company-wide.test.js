const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/CustomField/helpers/customFieldHistory', () => ({
    recordFieldCreated: jest.fn(() => Promise.resolve()),
    recordFieldRenamed: jest.fn(() => Promise.resolve()),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const SETTINGS_KEY = 'settings.settings_custom_field';

const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require('../Modules/CustomField/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT') });
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

const insert = (uid, updateObject) => run(routes()['POST /api/v1/customField'], {
    uid, params: {}, query: {}, headers: { companyid: C }, body: { type: 'save', updateObject },
});
const update = (uid, id, updateObject, key = '$set') => run(routes()['PUT /api/v1/customField'], {
    uid, params: {}, query: {}, headers: { companyid: C }, body: { type: 'updateOne', key, id: String(id), updateObject },
});

const seedRules = (grants = {}) => {
    const parents = {};
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        parents[section] = parents[section] || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parents[section]._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const fields = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELDS] || [];
const stored = (id) => fields().find((field) => String(field._id) === String(id));
const seedField = (doc) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), fieldTitle: 'Budget', fieldType: 'number', type: 'task', isDelete: true, ...doc });
const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [MEMBER], isGlobalPermission: true, ...doc });

const builderPayload = {
    fieldTitle: 'Cost', fieldDescription: 'Cost', fieldType: 'number', fieldValidation: '',
    formulaExpression: '', rollupSourceFieldId: '', rollupFunction: '', rollupScope: '',
    fieldImage: 'number.svg', fieldImageGrey: 'number-grey.svg', fieldPrimaryColor: '#000', fieldBackgroundColor: '#fff',
    type: 'task', updatedAt: new Date().toISOString(),
};

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

describe('company-wide custom fields need the custom field settings permission', () => {
    it('refuses a member without it creating a company-wide field', async () => {
        seedRules({ [SETTINGS_KEY]: null });
        const res = await insert(MEMBER, { ...builderPayload, global: true, isDelete: true, projectId: [], userId: MEMBER });
        expect(res.statusCode).toBe(403);
        expect(fields()).toHaveLength(0);
    });

    it('refuses a member who may only view the settings screen', async () => {
        seedRules({ [SETTINGS_KEY]: false });
        const field = seedField({ global: true, projectId: [] });
        const res = await update(MEMBER, field._id, { isDelete: false });
        expect(res.statusCode).toBe(403);
        expect(stored(field._id).isDelete).toBe(true);
    });

    it('refuses a member without it editing a company-wide field', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true });
        const field = seedField({ global: true, projectId: [] });
        const res = await update(MEMBER, field._id, { fieldTitle: 'Renamed' });
        expect(res.statusCode).toBe(403);
        expect(stored(field._id).fieldTitle).toBe('Budget');
    });

    it('refuses a project member turning a project field into a company-wide one', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true, 'project.private_projects': 1 });
        const project = seedProject();
        const field = seedField({ global: false, projectId: [String(project._id)] });
        const res = await update(MEMBER, field._id, { global: true, projectId: [] });
        expect(res.statusCode).toBe(403);
        expect(stored(field._id).global).toBe(false);
    });

    it('lets a member holding it manage company-wide fields', async () => {
        seedRules({ [SETTINGS_KEY]: true });
        const created = await insert(MEMBER, { ...builderPayload, global: true, isDelete: true, projectId: [], userId: MEMBER, createdAt: new Date().toISOString() });
        expect(created.statusCode).toBe(200);
        const id = fields()[0]._id;
        const renamed = await update(MEMBER, id, { fieldTitle: 'Spend' });
        expect(renamed.statusCode).toBe(200);
        expect(stored(id).fieldTitle).toBe('Spend');
    });

    it('lets the owner edit a company-wide field with the builder payload', async () => {
        const field = seedField({ global: true, projectId: [] });
        const res = await update(OWNER, field._id, builderPayload);
        expect(res.statusCode).toBe(200);
        expect(stored(field._id).fieldTitle).toBe('Cost');
    });

    it('keeps project fields under project access for the web app shapes', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true, 'project.private_projects': 1 });
        const project = seedProject();
        const created = await insert(MEMBER, {
            fieldTitle: 'Region', fieldPlaceholder: 'Region', fieldDescription: 'Region', fieldType: 'dropdown',
            fieldOptions: [{ label: 'EU', value: 'eu', color: '#fff', id: 1 }], fieldValidation: '', fieldMinimum: '', fieldMaximum: '',
            fieldImage: 'dropdown.svg', fieldImageGrey: 'dropdown-grey.svg',
            global: false, projectId: [String(project._id)], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), userId: MEMBER, type: 'project',
        });
        expect(created.statusCode).toBe(200);
        const id = fields()[0]._id;
        const edited = await update(MEMBER, id, { fieldTitle: 'Area', fieldPlaceholder: 'Area', fieldDescription: 'Area', updatedAt: new Date().toISOString() });
        expect(edited.statusCode).toBe(200);
        expect(stored(id).fieldTitle).toBe('Area');
    });
});

describe('a custom field write takes only what the field screens send', () => {
    it.each(['$rename', '$unset', '$inc', '$push'])('refuses the %s operator and writes nothing', async (key) => {
        const field = seedField({ global: true, projectId: [] });
        const res = await update(OWNER, field._id, { fieldTitle: 'CompanyId' }, key);
        expect(res.statusCode).toBe(400);
        expect(stored(field._id)).toMatchObject({ fieldTitle: 'Budget', global: true });
    });

    it('refuses a client _id on insert', async () => {
        const res = await insert(OWNER, { ...builderPayload, _id: oid(), global: true, projectId: [] });
        expect(res.statusCode).toBe(400);
        expect(fields()).toHaveLength(0);
    });

    it.each([
        ['_id', oid()],
        ['CompanyId', C],
        ['createdAt', new Date(0).toISOString()],
        ['userId', MEMBER],
        ['deletedStatusKey', 1],
        ['fieldTitle.$', 'x'],
    ])('refuses setting %s and writes nothing', async (name, value) => {
        const field = seedField({ global: true, projectId: [] });
        const res = await update(OWNER, field._id, { fieldTitle: 'Renamed', [name]: value });
        expect(res.statusCode).toBe(400);
        expect(stored(field._id).fieldTitle).toBe('Budget');
    });

    it.each([
        ['global', 'yes'],
        ['isDelete', 'no'],
        ['projectId', [{ $ne: null }]],
    ])('refuses a %s of the wrong shape', async (name, value) => {
        const field = seedField({ global: true, projectId: [] });
        const res = await update(OWNER, field._id, { [name]: value });
        expect(res.statusCode).toBe(400);
    });

    it('refuses an update without a well-formed field id', async () => {
        const res = await update(OWNER, 'not-an-id', { fieldTitle: 'Renamed' });
        expect(res.statusCode).toBe(400);
    });
});
