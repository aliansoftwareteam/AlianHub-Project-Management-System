/* A field's project list is changed by naming the projects to add and to take off. A copy of the field read
   before someone else linked a project can then save without taking that project off again. */
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/CustomField/helpers/customFieldHistory', () => ({
    recordFieldCreated: jest.fn(() => Promise.resolve()),
    recordFieldRenamed: jest.fn(() => Promise.resolve()),
}));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { removeCache } = require('../utils/commonFunctions');
const socketEmitter = require('../event/socketEventEmitter');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;

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

const update = (uid, id, body) => run(routes()['PUT /api/v1/customField'], {
    uid, params: {}, query: {}, headers: { companyid: C }, body: { type: 'updateOne', key: '$set', id: String(id), ...body },
});
const insert = (uid, updateObject) => run(routes()['POST /api/v1/customField'], {
    uid, params: {}, query: {}, headers: { companyid: C }, body: { type: 'save', updateObject },
});

const seedRules = (grants = {}) => {
    const parents = {};
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        parents[section] = parents[section] || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parents[section]._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};
const FIELD_GRANTS = { 'project.project_custom_field': true, 'task.task_custom_field': true };

const stored = (id) => (mockDb.store[SCHEMA_TYPE.CUSTOM_FIELDS] || []).find((field) => String(field._id) === String(id));
const linked = (id) => [].concat(stored(id).projectId);
const seedField = (doc) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), fieldTitle: 'Budget', fieldType: 'number', type: 'task', isDelete: true, global: false, ...doc });
const seedProject = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [], isGlobalPermission: true, ...doc })._id);
const fieldChanges = () => socketEmitter.emit.mock.calls.filter(([, change]) => change && change.module === 'customFields');

let alpha;
let beta;
let gamma;

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    [alpha, beta, gamma] = ['Alpha', 'Beta', 'Gamma'].map((ProjectName) => seedProject({ ProjectName }));
});

describe('two copies of one field', () => {
    it('keep each other\'s links: an older copy adds its project beside the one linked meanwhile', async () => {
        const field = seedField({ projectId: [alpha] });

        expect((await update(OWNER, field._id, { addProjects: [beta] })).statusCode).toBe(200);
        const fromOlderCopy = await update(OWNER, field._id, { updateObject: { global: false }, addProjects: [gamma] });

        expect(fromOlderCopy.statusCode).toBe(200);
        expect(linked(field._id)).toEqual([alpha, beta, gamma]);
    });

    it('an older copy that renames the field leaves the links alone', async () => {
        const field = seedField({ projectId: [alpha] });
        await update(OWNER, field._id, { addProjects: [beta] });

        expect((await update(OWNER, field._id, { updateObject: { fieldTitle: 'Cost' } })).statusCode).toBe(200);

        expect(stored(field._id)).toMatchObject({ fieldTitle: 'Cost', projectId: [alpha, beta] });
    });

    it('an older copy that sends its whole list is refused when the list would take a project off', async () => {
        const field = seedField({ projectId: [alpha] });
        await update(OWNER, field._id, { addProjects: [beta] });

        const res = await update(OWNER, field._id, { updateObject: { fieldTitle: 'Cost', projectId: [alpha, gamma] } });

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ status: false, code: 'FIELD_PROJECTS_CHANGED' });
        expect(res.body.message).toMatch(/removeProjects/);
        expect(stored(field._id)).toMatchObject({ fieldTitle: 'Budget', projectId: [alpha, beta] });
    });

    it('a whole list that only adds is taken as the projects to add', async () => {
        const field = seedField({ projectId: [alpha] });
        await update(OWNER, field._id, { addProjects: [beta] });

        const res = await update(OWNER, field._id, { updateObject: { projectId: [beta, alpha, gamma] } });

        expect(res.statusCode).toBe(200);
        expect(linked(field._id)).toEqual([alpha, beta, gamma]);
    });

    it('a whole list may leave out a project the request takes off by name', async () => {
        const field = seedField({ projectId: [alpha, beta] });

        const res = await update(OWNER, field._id, { updateObject: { projectId: [beta, gamma] }, removeProjects: [alpha] });

        expect(res.statusCode).toBe(200);
        expect(linked(field._id)).toEqual([beta, gamma]);
    });
});

describe('the projects of a field', () => {
    it('are taken off by name, and the others stay', async () => {
        const field = seedField({ projectId: [alpha, beta, gamma] });

        expect((await update(OWNER, field._id, { removeProjects: [beta] })).statusCode).toBe(200);

        expect(linked(field._id)).toEqual([alpha, gamma]);
    });

    it('are added and taken off in one request', async () => {
        const field = seedField({ projectId: [alpha, beta] });

        expect((await update(OWNER, field._id, { addProjects: [gamma], removeProjects: [alpha] })).statusCode).toBe(200);

        expect(linked(field._id)).toEqual([beta, gamma]);
    });

    it('are not listed twice', async () => {
        const field = seedField({ projectId: [alpha] });

        expect((await update(OWNER, field._id, { addProjects: [alpha, beta, beta] })).statusCode).toBe(200);

        expect(linked(field._id)).toEqual([alpha, beta]);
    });

    it('are a list afterwards when an older field held its one project as text', async () => {
        const field = seedField({ projectId: alpha });

        expect((await update(OWNER, field._id, { addProjects: [beta] })).statusCode).toBe(200);
        expect(stored(field._id).projectId).toEqual([alpha, beta]);

        expect((await update(OWNER, field._id, { removeProjects: [alpha] })).statusCode).toBe(200);
        expect(stored(field._id).projectId).toEqual([beta]);
    });

    it('are cleared when the field is made company-wide', async () => {
        const field = seedField({ projectId: [alpha, beta] });

        expect((await update(OWNER, field._id, { updateObject: { global: true, projectId: [] } })).statusCode).toBe(200);

        expect(stored(field._id)).toMatchObject({ global: true, projectId: [] });
    });

    it('come back as named when a company-wide field is narrowed', async () => {
        const field = seedField({ global: true, projectId: [] });

        expect((await update(OWNER, field._id, { updateObject: { global: false }, addProjects: [alpha, gamma] })).statusCode).toBe(200);

        expect(stored(field._id)).toMatchObject({ global: false, projectId: [alpha, gamma] });
    });

    it.each([
        ['a project named to add and to take off', { addProjects: ['PROJECT'], removeProjects: ['PROJECT'] }],
        ['a project in the whole list that is also taken off', { updateObject: { projectId: ['PROJECT'] }, removeProjects: ['PROJECT'] }],
        ['a list that is not a list of ids', { addProjects: 'PROJECT' }],
        ['an id that is not an id', { removeProjects: ['nope'] }],
        ['projects added to a field being made company-wide', { updateObject: { global: true }, addProjects: ['PROJECT'] }],
        ['nothing to change', {}],
    ])('refuse %s', async (_label, body) => {
        const field = seedField({ projectId: [alpha, beta] });
        const named = JSON.parse(JSON.stringify(body).replaceAll('PROJECT', beta));

        const res = await update(OWNER, field._id, named);

        expect(res.statusCode).toBe(400);
        expect(linked(field._id)).toEqual([alpha, beta]);
    });
});

describe('who may change the projects of a field', () => {
    let open;
    let closed;

    beforeEach(() => {
        seedRules({ ...FIELD_GRANTS, 'settings.settings_custom_field': null });
        open = seedProject({ ProjectName: 'Open to the member', isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER] });
        closed = seedProject({ ProjectName: 'Closed to the member', isPrivateSpace: true, AssigneeUserId: [OWNER] });
    });

    it('a member links and unlinks a project they can change fields on', async () => {
        const field = seedField({ projectId: [open] });
        const other = seedProject({ ProjectName: 'Also open', isPrivateSpace: true, AssigneeUserId: [MEMBER] });

        expect((await update(MEMBER, field._id, { addProjects: [other] })).statusCode).toBe(200);
        expect((await update(MEMBER, field._id, { removeProjects: [open] })).statusCode).toBe(200);

        expect(linked(field._id)).toEqual([other]);
    });

    it.each([
        ['take off', (ids) => ({ removeProjects: [ids.closed] })],
        ['take off through a whole list', (ids) => ({ updateObject: { projectId: [ids.open] } })],
        ['add to', (ids) => ({ addProjects: [ids.gamma] })],
    ])('a member cannot %s a field of a project they cannot open', async (_label, body) => {
        const field = seedField({ projectId: [open, closed] });
        const before = JSON.stringify(stored(field._id));

        const res = await update(MEMBER, field._id, body({ open, closed, gamma }));

        expect([403, 404, 409]).toContain(res.statusCode);
        expect(JSON.stringify(stored(field._id))).toBe(before);
    });

    it('a member cannot link a field to a project they cannot open', async () => {
        const field = seedField({ projectId: [open] });

        const res = await update(MEMBER, field._id, { addProjects: [closed] });

        expect([403, 404]).toContain(res.statusCode);
        expect(linked(field._id)).toEqual([open]);
    });

    it('taking the last project off needs the right to manage company-wide fields', async () => {
        const field = seedField({ projectId: [open] });

        expect((await update(MEMBER, field._id, { removeProjects: [open] })).statusCode).toBe(403);
        expect(linked(field._id)).toEqual([open]);

        expect((await update(OWNER, field._id, { removeProjects: [open] })).statusCode).toBe(200);
        expect(linked(field._id)).toEqual([]);
    });
});

describe('a change to the field definitions is announced', () => {
    it('after an update, as the company and the kind of change', async () => {
        const field = seedField({ projectId: [alpha] });

        await update(OWNER, field._id, { addProjects: [beta] });

        expect(fieldChanges()).toEqual([['update', { type: 'update', companyId: C, module: 'customFields' }]]);
        expect(removeCache).toHaveBeenCalledWith(`customField:${C}`);
    });

    it('after a new field', async () => {
        const res = await insert(OWNER, { fieldTitle: 'Cost', fieldType: 'number', type: 'task', global: false, isDelete: true, projectId: [alpha], userId: OWNER });

        expect(res.statusCode).toBe(200);
        expect(fieldChanges()).toEqual([['insert', { type: 'insert', companyId: C, module: 'customFields' }]]);
    });

    it('and not after a refused one', async () => {
        const field = seedField({ projectId: [alpha, beta] });

        await update(OWNER, field._id, { updateObject: { projectId: [alpha] } });
        await update(OWNER, field._id, { addProjects: ['nope'] });

        expect(fieldChanges()).toEqual([]);
    });
});

describe('the change reaches the open tabs of the company', () => {
    const helper = require('../socket/helper');
    const { relay, EVENT } = require('../socket/controller/customFieldSocket');

    const join = (companyId, socketId, { inRoom = true } = {}) => {
        const emit = jest.fn();
        const roomName = `selected_companies_${companyId}**${socketId}`;
        const socket = { id: socketId, rooms: new Set(inRoom ? [roomName] : []), identity: { companyId, uid: OWNER } };
        helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
        return emit;
    };

    it('as the fact of a change, with no field, project or id, and reaches no other company', () => {
        const mine = join(C, 's1');
        const theirs = join(OTHER_COMPANY, 's2');

        relay({ type: 'update', companyId: C, module: 'customFields', data: { _id: 'f1', fieldTitle: 'Budget', projectId: [alpha, beta] }, projectId: alpha, fieldId: 'f1' });

        expect(mine).toHaveBeenCalledWith(EVENT, { type: 'update' });
        expect(JSON.stringify(mine.mock.calls)).not.toMatch(/[a-f0-9]{24}|Budget|f1/);
        expect(theirs).not.toHaveBeenCalled();
    });

    it('skips a socket that has left the company room, and does nothing without a company', () => {
        const left = join(C, 's3', { inRoom: false });
        const mine = join(C, 's4');

        relay({ type: 'insert', companyId: C, module: 'customFields' });
        expect(left).not.toHaveBeenCalled();
        expect(mine).toHaveBeenCalledTimes(1);

        relay({ type: 'update', module: 'customFields' });
        relay(undefined);
        expect(mine).toHaveBeenCalledTimes(1);
    });

    it('is named customFieldsChanged, listens for new and changed definitions and is loaded with the socket server', () => {
        expect(EVENT).toBe('customFieldsChanged');
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'controller', 'customFieldSocket.js'), 'utf8');
        expect(source).toMatch(/customFields:\$\{type\}/);
        expect(source).toMatch(/\['insert', 'update'\]/);
        const init = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'socketinit.js'), 'utf8');
        expect(init).toMatch(/require\('\.\/controller\/customFieldSocket'\)/);
    });
});
