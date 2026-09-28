const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mockReached = (name) => jest.fn((req, res) => res.status(200).json({ status: true, reached: name }));
const mockModule = () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || mockReached(String(name)); return target[name]; } });
jest.mock('../Modules/Sprints/controller', () => mockModule());
jest.mock('../Modules/Sprints/burndown', () => mockModule());
jest.mock('../Modules/Sprints/hours', () => mockModule());
jest.mock('../Modules/Sprints/scrum', () => mockModule());

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const MEMBER_ROLE = 3;
const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    require('../Modules/Sprints/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const run = async (route, { uid = MEMBER, id, body }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid, params: { id }, body: { companyId: C, ...body }, query: {}, headers: { companyid: C } });
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const seedRules = (grants) => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'project', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    Object.entries(grants).forEach(([path, permission]) => {
        mockDb.seed(SCHEMA_TYPE.RULES, { key: path.split('.')[1], isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

let project;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OTHER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    project = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
});

const sprintIn = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Sprint 1', private: false, deletedStatusKey: 0, ...doc })._id);
const folderIn = (projectId = project) => String(mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), projectId, name: 'Q3', deletedStatusKey: 0 })._id);

const PATCH_SPRINT = 'PATCH /api/v1/sprint/:id';
const PATCH_FOLDER = 'PATCH /api/v1/folder/:id';
const updateSprint = (updateObject, extra = {}) => ({ type: 'updateSprint', projectId: project, updateObject, ...extra });

describe('a sprint update needs the permission for what it writes', () => {
    it('takes the delete permission for a delete, whatever the separate status field says', async () => {
        seedRules({ 'project.sprint_archive': true, 'project.sprint_delete': false });
        const res = await run(PATCH_SPRINT, { id: sprintIn(), body: updateSprint({ $set: { deletedStatusKey: 1 } }, { updatedValueDeleteStatusKey: 2 }) });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ permission: 'project.sprint_delete' });
    });

    it('takes the sharing permission to make a sprint private, a sprint name permission is not enough', async () => {
        seedRules({ 'project.project_sprint_name_edit': true, 'project.sprint_type_change': false });
        const res = await run(PATCH_SPRINT, { id: sprintIn(), body: updateSprint({ $addToSet: { AssigneeUserId: MEMBER }, $set: { private: true } }) });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ permission: 'project.sprint_type_change' });
    });

    it('takes the sharing permission to add someone else as a watcher', async () => {
        seedRules({ 'project.project_sprint_name_edit': true, 'project.sprint_type_change': false });
        const res = await run(PATCH_SPRINT, { id: sprintIn(), body: updateSprint({ $addToSet: { watchers: OTHER } }) });
        expect(res.statusCode).toBe(403);
    });

    it('lets a project member watch a sprint themselves', async () => {
        seedRules({});
        const res = await run(PATCH_SPRINT, { id: sprintIn(), body: updateSprint({ $addToSet: { watchers: MEMBER } }) });
        expect(res.body).toMatchObject({ status: true, reached: 'updateSprint' });
    });

    it('lets a holder of the archive permission archive', async () => {
        seedRules({ 'project.sprint_archive': true });
        const res = await run(PATCH_SPRINT, { id: sprintIn(), body: updateSprint({ $set: { deletedStatusKey: 2 } }, { updatedValueDeleteStatusKey: 2 }) });
        expect(res.body).toMatchObject({ status: true, reached: 'updateSprint' });
    });
});

describe('a folder update needs the permission for what it writes', () => {
    it('takes the delete permission for a delete, whatever the separate status field says', async () => {
        seedRules({ 'project.folder_archive': true, 'project.folder_delete': false });
        const res = await run(PATCH_FOLDER, { id: folderIn(), body: { type: 'updateFolder', projectId: project, updateObject: { $set: { deletedStatusKey: 1 } }, updatedValueDeleteStatusKey: 2 } });
        expect(res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ permission: 'project.folder_delete' });
    });
});

describe('building a sprint update', () => {
    const listWrites = () => require('../Modules/Sprints/helpers/listWrites');
    const sprintUpdateFrom = (update) => listWrites().sprintUpdateFrom(update);
    const folderUpdateFrom = (update) => listWrites().folderUpdateFrom(update);
    const prepareSprintUpdate = (...args) => listWrites().prepareSprintUpdate(...args);
    const prepareFolderUpdate = (...args) => listWrites().prepareFolderUpdate(...args);

    it.each([
        ['archiving', { $set: { deletedStatusKey: 2 } }],
        ['restoring', { $set: { deletedStatusKey: 0 } }],
        ['adding a member', { $addToSet: { AssigneeUserId: MEMBER, watchers: MEMBER } }],
        ['removing the last member', { $pull: { AssigneeUserId: MEMBER, watchers: MEMBER }, $set: { private: false } }],
        ['making it private', { $addToSet: { AssigneeUserId: MEMBER }, $set: { private: true } }],
        ['making it public', { $set: { AssigneeUserId: [], private: false } }],
        ['moving it to the root', { $set: { folderId: null, folderName: '' } }],
        ['watching it', { $pull: { watchers: MEMBER } }],
    ])('keeps what the sprint list sends for %s', (_label, updateObject) => {
        expect(sprintUpdateFrom(updateObject)).toEqual(updateObject);
    });

    it.each([
        ['a rename', { $rename: { watchers: 'deletedStatusKey' } }],
        ['a container change', { $set: { projectId: oid() } }],
        ['a lifecycle field', { $set: { state: 'closed' } }],
        ['a name', { $set: { name: 'x' } }],
        ['an unknown trash key', { $set: { deletedStatusKey: 4 } }],
        ['a privacy flag that is not a boolean', { $set: { private: 'yes' } }],
        ['an $unset', { $unset: { AssigneeUserId: '' } }],
        ['a $push', { $push: { AssigneeUserId: { $each: [MEMBER] } } }],
        ['several people at once', { $addToSet: { AssigneeUserId: { $each: [MEMBER, OTHER] } } }],
        ['a counter', { $inc: { tasks: 1 } }],
        ['a replacement document', { name: 'x', private: false }],
        ['nothing', {}],
    ])('refuses %s with 400', (_label, updateObject) => {
        expect(() => sprintUpdateFrom(updateObject)).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('answers 404 for a private sprint the caller is not on, and lets a member on it through', async () => {
        const id = sprintIn({ private: true, AssigneeUserId: [OTHER] });
        await expect(prepareSprintUpdate(C, MEMBER, id, { $set: { private: false } })).rejects.toMatchObject({ statusCode: 404 });
        await expect(prepareSprintUpdate(C, OTHER, id, { $set: { private: false } })).resolves.toMatchObject({ projectId: project });
        await expect(prepareSprintUpdate(C, OWNER, id, { $set: { private: false } })).resolves.toMatchObject({ projectId: project });
    });

    it('moves a sprint only into a folder of its own project and names the stored folder', async () => {
        const id = sprintIn();
        const elsewhere = folderIn(String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Other' })._id));
        await expect(prepareSprintUpdate(C, MEMBER, id, { $set: { folderId: elsewhere, folderName: 'Q3' } })).rejects.toMatchObject({ statusCode: 400 });
        const here = folderIn();
        const { update } = await prepareSprintUpdate(C, MEMBER, id, { $set: { folderId: here, folderName: 'forged' } });
        expect(String(update.$set.folderId)).toBe(here);
        expect(update.$set.folderName).toBe('Q3');
    });

    it('answers null for a sprint that does not exist, so nothing is created', async () => {
        await expect(prepareSprintUpdate(C, OWNER, oid(), { $set: { deletedStatusKey: 2 } })).resolves.toBeNull();
    });

    it('builds a folder update from the trash key alone and cascades onto the folder\'s own sprints', async () => {
        expect(() => folderUpdateFrom({ $set: { deletedStatusKey: 2, projectId: oid() } })).toThrow(expect.objectContaining({ statusCode: 400 }));
        expect(() => folderUpdateFrom({ $rename: { name: 'deletedStatusKey' } })).toThrow(expect.objectContaining({ statusCode: 400 }));
        const folder = folderIn();
        const inside = sprintIn({ folderId: folder });
        sprintIn({ folderId: folder, deletedStatusKey: 1 });
        sprintIn();
        const prepared = await prepareFolderUpdate(C, folder, { $set: { deletedStatusKey: 2 } });
        expect(prepared).toMatchObject({ status: 2, projectId: project, sprints: [inside], update: { $set: { deletedStatusKey: 2 } } });
    });
});
