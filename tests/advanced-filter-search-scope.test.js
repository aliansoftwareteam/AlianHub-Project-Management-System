const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../Modules/Comments/controller', () => ({ searchComments: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';

const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    require('../Modules/AdvancedGlobalFilter/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') });
    return table;
};

const search = async (what, uid, body) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    const req = { uid, aud: C, headers: { companyid: C }, params: {}, query: {}, body };
    for (const handler of routes()[`POST /api/v1/advance/filter/search/${what}`]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const seedProject = (ProjectName, doc = {}) => {
    const projectId = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active', ...doc })._id);
    return projectId;
};

const seedTaskIn = (projectId, TaskName) => {
    const sprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'List', projectId, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskName, ProjectID: projectId, sprintId: String(sprint._id), deletedStatusKey: 0, createdAt: new Date('2026-09-01T00:00:00Z') });
};

let open;
let empty;
let secret;
let mine;
let personal;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [MEMBER, 3], [OTHER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    open = seedProject('Open');
    empty = seedProject('Empty');
    secret = seedProject('Secret', { isPrivateSpace: true, AssigneeUserId: [OWNER] });
    mine = seedProject('Mine', { isPrivateSpace: true, AssigneeUserId: [MEMBER] });
    personal = seedProject('Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: OTHER, AssigneeUserId: [OTHER] });
    seedTaskIn(open, 'in the open project');
    seedTaskIn(secret, 'in the secret project');
    seedTaskIn(mine, 'in my private project');
    seedTaskIn(personal, 'in a personal list');
});

const everyProject = () => [open, empty, secret, mine, personal];

describe('the task search keeps to the projects the caller can open', () => {
    const found = async (uid, pids) => {
        const res = await search('tasks', uid, { searchText: '', pids, batchSize: 50 });
        expect(res.statusCode).toBe(200);
        return res.body.data.map((task) => task.TaskName).sort();
    };

    it('finds nothing for a member in a private project they are not on, or in someone else\'s personal list', async () => {
        expect(await found(MEMBER, [secret])).toEqual([]);
        expect(await found(MEMBER, [personal])).toEqual([]);
        expect(await found(MEMBER, everyProject())).toEqual(['in my private project', 'in the open project']);
    });

    it('finds every project\'s tasks for an owner, short of someone else\'s personal list', async () => {
        expect(await found(OWNER, everyProject())).toEqual(['in my private project', 'in the open project', 'in the secret project']);
    });

    it('still takes the project ids as a comma-separated string', async () => {
        expect(await found(MEMBER, `${open}, ${secret}`)).toEqual(['in the open project']);
    });
});

describe('the project search keeps to the projects the caller can open', () => {
    const found = async (uid, queries = { publicQuery: {}, privateQuery: {} }) => {
        const res = await search('projects', uid, { searchText: '', sortBy: 'createdAt', skipValue: 0, batchSizeValue: 50, ...queries });
        return res.statusCode === 404 ? [] : res.body.data.map((project) => project.ProjectName).sort();
    };

    it('lists only those to a member, whatever match the request sends', async () => {
        expect(await found(MEMBER)).toEqual(['Empty', 'Mine', 'Open']);
        expect(await found(MEMBER, { publicQuery: { isPrivateSpace: true }, privateQuery: { isPersonal: true } })).toEqual(['Mine']);
    });

    it('lists every project to an owner, short of someone else\'s personal list', async () => {
        expect(await found(OWNER)).toEqual(['Empty', 'Mine', 'Open', 'Secret']);
    });

    it('still applies the match the request sends', async () => {
        expect(await found(MEMBER, { publicQuery: { isPrivateSpace: false }, privateQuery: { isPrivateSpace: false } })).toEqual(['Empty', 'Open']);
    });
});

describe.each(['files', 'links'])('the %s search keeps to the projects the caller can open', (what) => {
    const found = async (uid, body) => {
        const res = await search(what, uid, { sortBy: 'last_update', skipValue: 0, batchSizeValue: 50, filterQuery: {}, ...body });
        return res.statusCode === 404 ? [] : res.body.data.map((project) => String(project._id));
    };
    const byFilter = (ids) => ({ $and: [{ _id: { objId: { $in: ids } } }] });

    it('finds nothing for a member in a project they cannot open, named either way', async () => {
        expect(await found(MEMBER, { pids: [secret, personal] })).toEqual([]);
        expect(await found(MEMBER, { pids: [empty], filterQuery: byFilter([secret, personal]) })).toEqual([]);
    });

    it('finds nothing for an owner in someone else\'s personal list', async () => {
        expect(await found(OWNER, { pids: [personal] })).toEqual([]);
        expect(await found(OWNER, { pids: [empty], filterQuery: byFilter([personal]) })).toEqual([]);
    });

    it('still reads a project the caller can open', async () => {
        expect(await found(MEMBER, { pids: [empty, secret] })).toEqual([empty]);
        expect(await found(MEMBER, { pids: [], filterQuery: byFilter([empty, secret]) })).toEqual([empty]);
    });
});
