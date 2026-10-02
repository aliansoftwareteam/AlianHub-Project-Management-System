const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/CustomField/aiFields/controller', () => ({ preview: jest.fn(), apply: jest.fn(), startJob: jest.fn(), readJob: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { removeCache } = require('../utils/commonFunctions');
const socketEmitter = require('../event/socketEventEmitter');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;
const SETTINGS_KEY = 'settings.settings_custom_field';
const USAGE = 'GET /api/v2/custom-fields/:fieldId/usage';
const DELETE = 'POST /api/v2/custom-fields/:fieldId/delete';

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
    res.on = jest.fn();
    return res;
};

const run = async (route, uid, fieldId, extra = {}) => {
    const res = response();
    const req = { uid, params: { fieldId: String(fieldId) }, query: {}, body: {}, headers: { companyid: C }, ...extra };
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};
const usage = (uid, fieldId) => run(USAGE, uid, fieldId);
const remove = (uid, fieldId, extra) => run(DELETE, uid, fieldId, extra);

const seedRules = (grants = {}) => {
    const parents = {};
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        parents[section] = parents[section] || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parents[section]._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const fields = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELDS] || [];
const tasks = () => mockDb.store[SCHEMA_TYPE.TASKS] || [];
const links = () => mockDb.store[SCHEMA_TYPE.CUSTOM_FIELD_LINKS] || [];
const stored = (id) => fields().find((field) => String(field._id) === String(id));
const seedField = (doc = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), fieldTitle: 'Budget', fieldType: 'number', type: 'task', isDelete: true, global: true, projectId: [], ...doc });
const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [MEMBER], isGlobalPermission: true, ...doc });
const seedTask = (customField, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskName: 'A task', deletedStatusKey: 0, customField, ...extra });

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

describe('how many tasks hold a value of a field', () => {
    it('is counted over the tasks that hold one, an empty value left out', async () => {
        const field = seedField();
        const other = seedField({ fieldTitle: 'Cost' });
        seedTask({ [field._id]: { fieldValue: 5 } });
        seedTask({ [field._id]: { fieldValue: 0 } });
        seedTask({ [field._id]: { fieldValue: '' } });
        seedTask({ [other._id]: { fieldValue: 9 } });
        seedTask({});
        const res = await usage(OWNER, field._id);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { tasks: 2, readBy: [] } });
    });

    it('names the rollup and the formula that read the field', async () => {
        const field = seedField({ fieldTitle: 'Billable rate' });
        seedField({ fieldTitle: 'Total rate', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: String(field._id) });
        seedField({ fieldTitle: 'Value', fieldType: 'formula', formulaExpression: '{billable_rate} * 2' });
        seedField({ fieldTitle: 'By title', fieldType: 'formula', formulaExpression: '{Billable rate} + 1' });
        seedField({ fieldTitle: 'Unrelated', fieldType: 'formula', formulaExpression: '{estimate} * 2' });
        const res = await usage(OWNER, field._id);
        expect(res.body.data.readBy.sort()).toEqual(['By title', 'Total rate', 'Value']);
    });

    it('is not told to a member who may not manage the field', async () => {
        seedRules({ [SETTINGS_KEY]: false });
        const field = seedField();
        const res = await usage(MEMBER, field._id);
        expect(res.statusCode).toBe(403);
    });

    it('answers not found for an id that is no field of the company', async () => {
        expect((await usage(OWNER, oid())).statusCode).toBe(404);
        expect((await usage(OWNER, 'nonsense')).statusCode).toBe(400);
    });
});

describe('deleting a field', () => {
    it('removes the field and its value from every task', async () => {
        const field = seedField();
        const kept = seedField({ fieldTitle: 'Cost' });
        const task = seedTask({ [field._id]: { fieldValue: 5 }, [kept._id]: { fieldValue: 9 } });
        const res = await remove(OWNER, field._id);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { tasks: 1 } });
        expect(stored(field._id)).toBeUndefined();
        expect(stored(kept._id)).toBeDefined();
        expect(tasks().find((row) => row._id === task._id).customField).toEqual({ [kept._id]: { fieldValue: 9 } });
    });

    it('removes what a relationship or a voting field keeps beside the tasks', async () => {
        const field = seedField({ fieldType: 'relationship' });
        const other = seedField({ fieldTitle: 'Votes', fieldType: 'voting' });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { _id: `t1:${field._id}`, taskId: 't1', fieldId: String(field._id), kind: 'relationship', ids: ['t2'] });
        mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELD_LINKS, { _id: `t1:${other._id}`, taskId: 't1', fieldId: String(other._id), kind: 'voting', ids: [OWNER] });
        await remove(OWNER, field._id);
        expect(links().map((link) => link.fieldId)).toEqual([String(other._id)]);
    });

    it('tells the open clients and clears what was cached of the fields', async () => {
        const field = seedField();
        await remove(OWNER, field._id);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', { type: 'update', companyId: C, module: 'customFields' });
        expect(removeCache.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([`customField:${C}`, `computedFields:${C}`, `aiFieldAutoRefill:${C}`]));
    });

    it('is refused while a rollup or a formula reads the field, and nothing is removed', async () => {
        const field = seedField({ fieldTitle: 'Cost' });
        seedField({ fieldTitle: 'Total cost', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: String(field._id) });
        const task = seedTask({ [field._id]: { fieldValue: 5 } });
        const res = await remove(OWNER, field._id);
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ status: false, code: 'FIELD_IS_READ', data: { readBy: ['Total cost'] } });
        expect(stored(field._id)).toBeDefined();
        expect(tasks().find((row) => row._id === task._id).customField[field._id]).toEqual({ fieldValue: 5 });
    });

    it('answers not found for a field of no such id, and removes nothing', async () => {
        const field = seedField();
        const res = await remove(OWNER, oid());
        expect(res.statusCode).toBe(404);
        expect(stored(field._id)).toBeDefined();
    });

    it('reads and writes in the caller\'s company alone', async () => {
        const field = seedField();
        seedTask({ [field._id]: { fieldValue: 5 } });
        await remove(OWNER, field._id);
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((call) => call.companyId === C)).toBe(true);
    });
});

describe('who may delete a field', () => {
    it('a member without the custom field setting may not delete a company-wide field', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true });
        const field = seedField();
        const res = await remove(MEMBER, field._id);
        expect(res.statusCode).toBe(403);
        expect(stored(field._id)).toBeDefined();
    });

    it('a member holding it may', async () => {
        seedRules({ [SETTINGS_KEY]: true });
        const field = seedField();
        const res = await remove(MEMBER, field._id);
        expect(res.statusCode).toBe(200);
        expect(stored(field._id)).toBeUndefined();
    });

    it('a member who may edit fields in the project may delete a field of that project alone', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true, 'project.private_projects': 1 });
        const project = seedProject();
        const field = seedField({ global: false, projectId: [String(project._id)] });
        const res = await remove(MEMBER, field._id);
        expect(res.statusCode).toBe(200);
        expect(stored(field._id)).toBeUndefined();
    });

    it('a member outside one of the field\'s projects may not', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true, 'project.private_projects': 1 });
        const mine = seedProject();
        const theirs = seedProject({ AssigneeUserId: [OWNER] });
        const field = seedField({ global: false, projectId: [String(mine._id), String(theirs._id)] });
        const res = await remove(MEMBER, field._id);
        expect(res.statusCode).not.toBe(200);
        expect(stored(field._id)).toBeDefined();
    });

    it('a member who may not edit fields in the project may not', async () => {
        seedRules({ 'project.project_custom_field': false, 'task.task_custom_field': false, 'project.private_projects': 1 });
        const project = seedProject();
        const field = seedField({ global: false, projectId: [String(project._id)] });
        const res = await remove(MEMBER, field._id);
        expect(res.statusCode).not.toBe(200);
        expect(stored(field._id)).toBeDefined();
    });
});
