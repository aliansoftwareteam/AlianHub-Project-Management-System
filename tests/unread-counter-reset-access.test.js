const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/notification-count/controller');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const GUEST = 'a00000000000000000000004';
const MEMBER_ROLE = 3;
const oid = () => new mongoose.Types.ObjectId().toString();

const route = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    require('../Modules/notification-count/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
    return table['POST /api/v1/unsetCommentCounts'];
};

const reset = async (body, uid = MEMBER) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid, params: {}, body, query: {}, headers: { companyid: C } });
    for (const handler of route()) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const grant = (permission) => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    ['project_delete', 'project_close', 'sprint_delete', 'sprint_archive'].forEach((key) => {
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

let open;
let hidden;
let unsetAllCounts;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [OWNER] })._id);
    unsetAllCounts = jest.spyOn(ctrl, 'unsetAllCounts').mockResolvedValue({ statusText: 'success', data: [] });
});
afterEach(() => jest.restoreAllMocks());

describe('unread counters are reset for one project, by someone who may close or delete it', () => {
    it.each([
        ['its project counters', (id) => ({ searchKey: `project_${id}_` })],
        ['its task counters', (id) => ({ searchKey: `task_${id}_` })],
        ['a project id', (id) => ({ projectId: id })],
    ])('resets a project the caller may close, named by %s', async (_label, bodyFor) => {
        grant(true);
        const res = await reset({ companyId: C, ...bodyFor(open) });
        expect(res.body).toMatchObject({ status: true });
        expect(unsetAllCounts).toHaveBeenCalledTimes(1);
        expect(unsetAllCounts.mock.calls[0][0]).toBe(C);
    });

    it('resets any project for the owner', async () => {
        const res = await reset({ searchKey: `task_${hidden}_` }, OWNER);
        expect(res.body).toMatchObject({ status: true });
        expect(unsetAllCounts).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['every task counter', { searchKey: 'task_' }],
        ['every project counter', { searchKey: 'project_' }],
        ['every counter', { searchKey: '_' }],
        ['a pattern', { searchKey: '.*' }],
        ['a key that is not text', { searchKey: { $ne: '' } }],
        ['a project id that is not an id', { projectId: 'launch' }],
        ['another field of the row', { searchKey: 'userId' }],
    ])('answers 400 to a key that names %s', async (_label, body) => {
        grant(true);
        const res = await reset(body, OWNER);
        expect(res.statusCode).toBe(400);
        expect(unsetAllCounts).not.toHaveBeenCalled();
    });

    it('answers 404 for a project the caller cannot open', async () => {
        grant(true);
        for (const body of [{ searchKey: `task_${hidden}_` }, { searchKey: `project_${hidden}_` }, { projectId: hidden }, { searchKey: `task_${oid()}_` }]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await reset(body);
            expect(res.statusCode).toBe(404);
        }
        expect(unsetAllCounts).not.toHaveBeenCalled();
    });

    it('answers 403 to a member who may open the project but not close or delete it', async () => {
        grant(false);
        const res = await reset({ searchKey: `task_${open}_` });
        expect(res.statusCode).toBe(403);
        expect(unsetAllCounts).not.toHaveBeenCalled();
    });

    it('resets one list of a project, and answers 404 when the list is in another project', async () => {
        grant(true);
        const list = String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: open, name: 'Sprint 1', deletedStatusKey: 0 })._id);
        const elsewhere = String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: hidden, name: 'Private', deletedStatusKey: 0 })._id);

        expect((await reset({ projectId: open, sprintId: list })).body).toMatchObject({ status: true });
        expect((await reset({ projectId: open, sprintId: elsewhere })).statusCode).toBe(404);
        expect((await reset({ searchKey: `task_${open}_${elsewhere}_` })).statusCode).toBe(404);
        expect(unsetAllCounts).toHaveBeenCalledTimes(1);
    });

    it('answers 403 to a body that names another workspace', async () => {
        const res = await reset({ companyId: OTHER_COMPANY, searchKey: `task_${open}_` }, OWNER);
        expect(res.statusCode).toBe(403);
        expect(unsetAllCounts).not.toHaveBeenCalled();
    });
});
