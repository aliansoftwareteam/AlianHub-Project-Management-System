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
    const req = { uid, aud: C, params: { fieldId: String(fieldId) }, query: {}, body: {}, headers: { companyid: C }, ...extra };
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
        const elsewhere = mockDb.calls.filter((call) => call.companyId !== C);
        expect(elsewhere.map((call) => [call.companyId, call.type, call.method])).toEqual([[SCHEMA_TYPE.GOLBAL, SCHEMA_TYPE.USERS, 'findOne']]);
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

describe('what the count and the names are taken from', () => {
    const MAY_MANAGE = { [SETTINGS_KEY]: true, 'task.task_list': true };
    const inProject = (project) => ({ ProjectID: new mongoose.Types.ObjectId(String(project._id)) });

    it('counts the tasks the person asking can open, and no others', async () => {
        seedRules(MAY_MANAGE);
        const mine = seedProject();
        const theirs = seedProject({ AssigneeUserId: [OWNER] });
        const field = seedField();
        seedTask({ [field._id]: { fieldValue: 1 } }, inProject(mine));
        seedTask({ [field._id]: { fieldValue: 2 } }, inProject(theirs));
        seedTask({ [field._id]: { fieldValue: 3 } }, inProject(theirs));
        expect((await usage(MEMBER, field._id)).body.data).toMatchObject({ tasks: 1, partial: true });
        expect((await usage(OWNER, field._id)).body.data).toMatchObject({ tasks: 3, partial: false });
    });

    it('leaves out the tasks of a list that is not shared with them', async () => {
        seedRules(MAY_MANAGE);
        const mine = seedProject();
        const closed = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: String(mine._id), private: true, AssigneeUserId: [OWNER] });
        const field = seedField();
        seedTask({ [field._id]: { fieldValue: 1 } }, inProject(mine));
        seedTask({ [field._id]: { fieldValue: 2 } }, { ...inProject(mine), sprintId: new mongoose.Types.ObjectId(String(closed._id)) });
        expect((await usage(MEMBER, field._id)).body.data.tasks).toBe(1);
    });

    it('never counts a conversation', async () => {
        const project = seedProject();
        const field = seedField();
        seedTask({ [field._id]: { fieldValue: 1 } }, inProject(project));
        seedTask({ [field._id]: { fieldValue: 2 } }, { ...inProject(project), mainChat: true, AssigneeUserId: [OWNER, MEMBER] });
        expect((await usage(OWNER, field._id)).body.data.tasks).toBe(1);
    });

    it('counts a field of some projects in those projects alone', async () => {
        const launch = seedProject();
        const site = seedProject();
        const field = seedField({ global: false, projectId: [String(launch._id)] });
        seedTask({ [field._id]: { fieldValue: 1 } }, inProject(launch));
        seedTask({ [field._id]: { fieldValue: 2 } }, inProject(site));
        expect((await usage(OWNER, field._id)).body.data.tasks).toBe(1);
    });

    it('names a formula or a rollup only where the person asking can open one of its projects', async () => {
        seedRules(MAY_MANAGE);
        const theirs = seedProject({ AssigneeUserId: [OWNER] });
        const field = seedField({ fieldTitle: 'Cost' });
        seedField({ fieldTitle: 'Everywhere', fieldType: 'formula', formulaExpression: '{Cost} * 2' });
        seedField({ fieldTitle: 'Elsewhere', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: String(field._id), global: false, projectId: [String(theirs._id)] });
        expect((await usage(MEMBER, field._id)).body.data).toMatchObject({ readBy: ['Everywhere'], readElsewhere: true });
        const forOwner = (await usage(OWNER, field._id)).body.data;
        expect(forOwner.readBy.sort()).toEqual(['Elsewhere', 'Everywhere']);
        expect(forOwner.readElsewhere).toBe(false);
    });

    it('does not take a formula of another project for a reader of a field of some projects', async () => {
        const launch = seedProject();
        const site = seedProject();
        const field = seedField({ fieldTitle: 'Cost', global: false, projectId: [String(launch._id)] });
        seedField({ fieldTitle: 'Site cost', fieldType: 'formula', formulaExpression: '{Cost} * 2', global: false, projectId: [String(site._id)] });
        seedField({ fieldTitle: 'Launch cost', fieldType: 'formula', formulaExpression: '{Cost} * 2', global: false, projectId: [String(launch._id)] });
        expect((await usage(OWNER, field._id)).body.data.readBy).toEqual(['Launch cost']);
    });

    it('refuses the delete while a field the person cannot see reads it, without naming that field', async () => {
        seedRules(MAY_MANAGE);
        const theirs = seedProject({ AssigneeUserId: [OWNER] });
        const field = seedField({ fieldTitle: 'Cost' });
        seedField({ fieldTitle: 'Margin total', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: String(field._id), global: false, projectId: [String(theirs._id)] });
        const res = await remove(MEMBER, field._id);
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ code: 'FIELD_IS_READ', data: { readBy: [], readElsewhere: true } });
        expect(JSON.stringify(res.body)).not.toContain('Margin total');
        expect(stored(field._id)).toBeDefined();
    });

    it('answers the delete with the count the person could see', async () => {
        seedRules(MAY_MANAGE);
        const mine = seedProject();
        const theirs = seedProject({ AssigneeUserId: [OWNER] });
        const field = seedField();
        seedTask({ [field._id]: { fieldValue: 1 } }, inProject(mine));
        const hidden = seedTask({ [field._id]: { fieldValue: 2 } }, inProject(theirs));
        const res = await remove(MEMBER, field._id);
        expect(res.body).toMatchObject({ status: true, data: { tasks: 1 } });
        expect(tasks().find((row) => row._id === hidden._id).customField).toEqual({});
    });
});

describe('what a delete leaves behind', () => {
    const auditRows = () => mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || [];
    const settled = async () => { for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
    const taskEvents = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload.module === 'task').map(([, payload]) => payload);

    it('is written in the audit log, with who did it and how many values went', async () => {
        const field = seedField({ fieldTitle: 'Budget' });
        seedTask({ [field._id]: { fieldValue: 5 } });
        seedTask({ [field._id]: { fieldValue: '' } });
        await remove(OWNER, field._id);
        await settled();
        expect(auditRows()).toHaveLength(1);
        expect(auditRows()[0]).toMatchObject({ action: 'custom_field.deleted', actorId: OWNER, entityType: 'custom_field', entityId: String(field._id), entityName: 'Budget', meta: { fieldType: 'number', tasks: 2 } });
    });

    it('writes nothing in the audit log when the delete is refused', async () => {
        const field = seedField({ fieldTitle: 'Cost' });
        seedField({ fieldTitle: 'Total cost', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: String(field._id) });
        await remove(OWNER, field._id);
        await settled();
        expect(auditRows()).toEqual([]);
    });

    it('tells the open screens of each task that lost a value, as a change nobody made to the task', async () => {
        const field = seedField();
        const held = seedTask({ [field._id]: { fieldValue: 5 } }, { CompanyId: C });
        seedTask({}, { CompanyId: C });
        await remove(OWNER, field._id);
        expect(taskEvents()).toEqual([expect.objectContaining({ type: 'update', companyId: C, source: 'field_removed', updatedFields: { [`customField.${field._id}`]: null } })]);
        expect(String(taskEvents()[0].data._id)).toBe(String(held._id));
        expect(taskEvents()[0].data.customField).toEqual({});
    });

    it('takes the value off a conversation without telling anyone of it', async () => {
        const field = seedField();
        const chat = seedTask({ [field._id]: { fieldValue: 5 } }, { mainChat: true, AssigneeUserId: [OWNER, MEMBER] });
        await remove(OWNER, field._id);
        expect(tasks().find((row) => row._id === chat._id).customField).toEqual({});
        expect(taskEvents()).toEqual([]);
    });

    it('leaves the time each task was last changed alone', async () => {
        const field = seedField();
        seedTask({ [field._id]: { fieldValue: 5 } });
        await remove(OWNER, field._id);
        const write = mockDb.calls.find((call) => call.type === SCHEMA_TYPE.TASKS && call.method === 'updateMany');
        expect(write.data[2]).toMatchObject({ timestamps: false });
    });
});

describe('a field that names a project which is no longer there', () => {
    const orphan = () => seedField({ global: false, projectId: [oid()] });

    it('is counted and deleted by an owner', async () => {
        const field = orphan();
        expect((await usage(OWNER, field._id)).statusCode).toBe(200);
        expect((await remove(OWNER, field._id)).statusCode).toBe(200);
        expect(stored(field._id)).toBeUndefined();
    });

    it('is deleted by a member who holds the custom field setting', async () => {
        seedRules({ [SETTINGS_KEY]: true });
        const field = orphan();
        expect((await remove(MEMBER, field._id)).statusCode).toBe(200);
    });

    it('is not deleted by a member who only edits fields in projects', async () => {
        seedRules({ 'project.project_custom_field': true, 'task.task_custom_field': true, 'project.private_projects': 1 });
        const project = seedProject();
        const field = seedField({ global: false, projectId: [String(project._id), oid()] });
        expect((await remove(MEMBER, field._id)).statusCode).toBe(403);
        expect(stored(field._id)).toBeDefined();
    });
});
