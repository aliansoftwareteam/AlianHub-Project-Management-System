const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn(async () => ({})) }));
jest.mock('../Modules/Sprints/controller', () => ({ updateSprintFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { bulkRestore: jest.fn() } }));
jest.mock('../Modules/Pages/controller', () => ({ restorePage: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { list } = require('../Modules/Trash/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const OUTSIDER = 'a00000000000000000000009';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    return res;
};

const titles = async (uid, kind) => {
    const res = response();
    await list({ uid, aud: C, headers: { companyid: C }, query: { kind }, params: {}, body: {} }, res);
    expect(res.body).toMatchObject({ status: true });
    return res.body.data.map((row) => row.title).sort();
};

const seedRules = (grants = {}) => {
    const parents = {};
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        parents[section] = parents[section] || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parents[section]._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const project = (ProjectName, doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName, isPrivateSpace: false, AssigneeUserId: [], isGlobalPermission: true, deletedStatusKey: 0, ...doc,
});
const sprint = (name, inProject, doc = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, {
    _id: oid(), name, projectId: inProject._id, private: false, AssigneeUserId: [], deletedStatusKey: 0, ...doc,
});
const task = (TaskName, inSprint, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), TaskName, ProjectID: inSprint.projectId, sprintId: inSprint._id, deletedStatusKey: 1, ...doc,
});
const page = (title, doc = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, { _id: oid(), title, visibility: 'project', createdBy: OWNER, deletedStatusKey: 1, ...doc });

let open;
let closed;
let personal;

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    seedRules({ 'project.private_projects': 1 });
    open = project('Open');
    closed = project('Closed', { isPrivateSpace: true, AssigneeUserId: [OWNER] });
    personal = project('Mine', { isPersonal: true, personalOwner: MEMBER });
});

describe('the trash lists only what the caller can open', () => {
    it('trashed projects: the ones the caller may read', async () => {
        project('Trashed open', { deletedStatusKey: 1 });
        project('Trashed private, member on it', { deletedStatusKey: 1, isPrivateSpace: true, AssigneeUserId: [MEMBER] });
        project('Trashed private', { deletedStatusKey: 1, isPrivateSpace: true, AssigneeUserId: [OWNER] });
        expect(await titles(MEMBER, 'projects')).toEqual(['Trashed open', 'Trashed private, member on it']);
        expect(await titles(OWNER, 'projects')).toEqual(['Trashed open', 'Trashed private', 'Trashed private, member on it']);
    });

    it('lists: in readable projects, and private ones only for the people on them', async () => {
        sprint('Open list', open, { deletedStatusKey: 1 });
        sprint('Private list', open, { deletedStatusKey: 1, private: true, AssigneeUserId: [OWNER] });
        sprint('Shared private list', open, { deletedStatusKey: 1, private: true, AssigneeUserId: [MEMBER] });
        sprint('List in a private project', closed, { deletedStatusKey: 1 });
        sprint('Channel', { _id: oid() }, { deletedStatusKey: 1 });
        expect(await titles(MEMBER, 'lists')).toEqual(['Open list', 'Shared private list']);
        expect(await titles(OWNER, 'lists')).toEqual(['Channel', 'List in a private project', 'Open list', 'Private list', 'Shared private list']);
    });

    it('folders: in the projects the caller may read, and never a chat category', async () => {
        const folder = (name, inProject, doc = {}) => mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), name, projectId: inProject._id, deletedStatusKey: 1, ...doc });
        folder('Open folder', open);
        folder('Live folder', open, { deletedStatusKey: 0 });
        folder('Folder in a private project', closed);
        folder('Category', { _id: oid() });
        expect(await titles(MEMBER, 'folders')).toEqual(['Open folder']);
        expect(await titles(OWNER, 'folders')).toEqual(['Folder in a private project', 'Open folder']);
    });

    it('tasks: in readable projects and not in private lists the caller is not on', async () => {
        task('Open task', sprint('Open list', open));
        task('Task in a private list', sprint('Private list', open, { private: true, AssigneeUserId: [OWNER] }));
        task('Task in a private project', sprint('Hidden', closed));
        task('Task in my personal list', sprint('Personal', personal));
        expect(await titles(MEMBER, 'tasks')).toEqual(['Open task', 'Task in my personal list']);
        expect(await titles(OWNER, 'tasks')).toEqual(['Open task', 'Task in a private list', 'Task in a private project']);
    });

    it('docs: by the doc\'s own access', async () => {
        page('Company doc');
        page('Open project doc', { ProjectID: new mongoose.Types.ObjectId(String(open._id)) });
        page('Private project doc', { ProjectID: new mongoose.Types.ObjectId(String(closed._id)) });
        page('Someone else\'s private doc', { visibility: 'private', createdBy: OWNER });
        page('My private doc', { visibility: 'private', createdBy: MEMBER });
        expect(await titles(MEMBER, 'docs')).toEqual(['Company doc', 'My private doc', 'Open project doc']);
    });

    it('lists nothing to a caller without a seat', async () => {
        task('Open task', sprint('Open list', open));
        project('Trashed open', { deletedStatusKey: 1 });
        page('Company doc');
        expect(await titles(OUTSIDER, 'tasks')).toEqual([]);
        expect(await titles(OUTSIDER, 'projects')).toEqual([]);
        expect(await titles(OUTSIDER, 'docs')).toEqual([]);
    });
});
