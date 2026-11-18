const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn(async () => ({ status: true, id: 't1' })) } }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/EmailIn/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const GONE = 'a00000000000000000000005';
const MEMBER_ROLE = 3;
const oid = () => new mongoose.Types.ObjectId().toString();

const call = async (handler, { uid = MEMBER, params = {}, body = {}, query = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    await handler(verified({ uid, params, body, query, headers: { companyid: C } }), res);
    return res;
};

const inboxes = () => mockDb.store[SCHEMA_TYPE.EMAIL_INBOXES] || [];
const inboxFor = (projectId, createdBy, extra = {}) => mockDb.seed(SCHEMA_TYPE.EMAIL_INBOXES, {
    _id: oid(), token: `token${inboxes().length}`.padEnd(32, '0'), companyId: C, name: 'Inbox', ProjectID: projectId, createdBy, enabled: true, deletedStatusKey: 0, ...extra,
});
const listIn = (projectId, extra = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId, name: 'Sprint 1', private: false, deletedStatusKey: 0, ...extra })._id);

const grantTaskCreate = (permission) => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    mockDb.seed(SCHEMA_TYPE.RULES, { key: 'task_create', isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
};

let open;
let hidden;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, MEMBER_ROLE], [OTHER, MEMBER_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `Stored ${userId.slice(-1)}` });
    });
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', ProjectCode: 'LAU', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', ProjectCode: 'BRD', isPrivateSpace: true, AssigneeUserId: [OTHER] })._id);
});

describe('an email inbox is made in a project its maker can add tasks to', () => {
    it('makes one in a project the caller can open, in the caller\'s stored name', async () => {
        grantTaskCreate(true);
        const list = listIn(open);
        const res = await call(ctrl.createInbox, { body: { projectId: open, userData: { id: MEMBER, Employee_Name: 'Someone Else', companyOwnerId: OWNER } } });
        expect(res.body).toMatchObject({ status: true });
        expect(inboxes()).toHaveLength(1);
        expect(inboxes()[0]).toMatchObject({ createdBy: MEMBER, sprintId: list });
        expect(inboxes()[0].userSnapshot).toMatchObject({ id: MEMBER, Employee_Name: 'Stored 3' });
    });

    it('answers 404 for a project the caller cannot open, and makes nothing', async () => {
        grantTaskCreate(true);
        listIn(hidden);
        const res = await call(ctrl.createInbox, { body: { projectId: hidden } });
        expect(res.statusCode).toBe(404);
        expect(inboxes()).toHaveLength(0);
        expect(JSON.stringify(res.body)).not.toMatch(/Board|token|address/i);
    });

    it('answers 403 to a member who may not add tasks in the project', async () => {
        grantTaskCreate(false);
        listIn(open);
        const res = await call(ctrl.createInbox, { body: { projectId: open } });
        expect(res.statusCode).toBe(403);
        expect(inboxes()).toHaveLength(0);
    });

    it.each([
        ['a list of another project', () => listIn(hidden)],
        ['a private list the caller is not on', () => listIn(open, { private: true, AssigneeUserId: [OTHER] })],
    ])('does not deliver into %s', async (_label, makeList) => {
        grantTaskCreate(true);
        const fallback = listIn(open);
        const named = makeList();
        const res = await call(ctrl.createInbox, { body: { projectId: open, sprintId: named, sprintArray: { id: named, name: 'Named by the request' } } });
        expect(res.statusCode).toBe(404);
        expect(inboxes()).toHaveLength(0);
        expect(fallback).toEqual(expect.any(String));
    });

    it('takes the list\'s name from the stored list', async () => {
        grantTaskCreate(true);
        const list = listIn(open, { name: 'Support' });
        const res = await call(ctrl.createInbox, { body: { projectId: open, sprintArray: { id: list, name: 'Named by the request', folderId: oid() } } });
        expect(res.body).toMatchObject({ status: true });
        expect(inboxes()[0].sprintArray).toEqual({ id: list, name: 'Support' });
    });

    it('never picks a private list the caller is not on as the default', async () => {
        grantTaskCreate(true);
        listIn(open, { private: true, AssigneeUserId: [OTHER] });
        const visible = listIn(open, { name: 'Open list' });
        const res = await call(ctrl.createInbox, { body: { projectId: open } });
        expect(res.body).toMatchObject({ status: true });
        expect(inboxes()[0].sprintId).toBe(visible);
    });

    it('keeps the people it assigns to the workspace\'s members', async () => {
        grantTaskCreate(true);
        listIn(open);
        await call(ctrl.createInbox, { body: { projectId: open, assignees: [OTHER, GONE, { $ne: '' }] } });
        expect(inboxes()[0].templateSnapshot.AssigneeUserId).toEqual([OTHER]);
    });
});

describe('the inbox list shows the inboxes of projects the caller can open', () => {
    it('leaves out an inbox of a project the caller cannot open', async () => {
        inboxFor(open, OTHER);
        inboxFor(hidden, OTHER);
        const res = await call(ctrl.listInboxes);
        expect(res.body.data.map((row) => String(row.ProjectID))).toEqual([open]);
        const all = await call(ctrl.listInboxes, { uid: OWNER });
        expect(all.body.data).toHaveLength(2);
    });

    it('answers nothing for a project filter the caller cannot open', async () => {
        inboxFor(hidden, OTHER);
        const res = await call(ctrl.listInboxes, { query: { projectId: hidden } });
        expect(res.body.data).toEqual([]);
    });
});

describe('an inbox is changed by its maker, an owner or an admin', () => {
    it.each([['its maker', MEMBER], ['the owner', OWNER], ['an admin', ADMIN]])('lets %s switch it off and remove it', async (_label, uid) => {
        const inbox = inboxFor(open, MEMBER);
        const off = await call(ctrl.updateInbox, { uid, params: { id: String(inbox._id) }, body: { enabled: false } });
        expect(off.body).toMatchObject({ status: true });
        expect(inboxes()[0].enabled).toBe(false);
        const gone = await call(ctrl.deleteInbox, { uid, params: { id: String(inbox._id) } });
        expect(gone.body).toMatchObject({ status: true });
        expect(inboxes()[0].deletedStatusKey).toBe(1);
    });

    it('answers 404 to another member, and leaves the inbox as it was', async () => {
        const inbox = inboxFor(open, OTHER);
        const params = { id: String(inbox._id) };
        expect((await call(ctrl.updateInbox, { params, body: { enabled: false } })).statusCode).toBe(404);
        expect((await call(ctrl.updateInbox, { params, body: { name: 'Mine now' } })).statusCode).toBe(404);
        expect((await call(ctrl.deleteInbox, { params })).statusCode).toBe(404);
        expect(inboxes()[0]).toMatchObject({ enabled: true, name: 'Inbox', deletedStatusKey: 0 });
    });

    it('answers 404 to an id that is not an inbox', async () => {
        expect((await call(ctrl.updateInbox, { params: { id: 'nope' }, body: { enabled: false } })).statusCode).toBe(404);
        expect((await call(ctrl.deleteInbox, { params: { id: oid() } })).statusCode).toBe(404);
    });
});
