const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ unsetAllCounts: jest.fn(async () => ({})), updateUnReadCommentsCount: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(() => Promise.resolve()) }));
jest.mock('../Modules/Sprints/helpers/sprintHistory', () => ({
    storedNames: jest.fn(async () => ({ projectName: 'Launch', folderName: 'Q3' })),
    notifySprintCreated: jest.fn(() => Promise.resolve()),
    notifyFolderCreated: jest.fn(() => Promise.resolve()),
}));
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const controller = require('../Modules/Sprints/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ARCHIVED = 2;
const DELETED = 1;
const ARCHIVED_WITH_FOLDER = 6;
const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.flat(); };
    require('../Modules/Sprints/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });
    return table;
};

const settle = async () => { for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const run = async (route, { id, body }) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    const req = verified({ uid: OWNER, params: { id }, body: { companyId: C, ...body }, query: {}, headers: { companyid: C } });
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await settle();
    return res;
};

const sprints = () => mockDb.store[SCHEMA_TYPE.SPRINTS] || [];
const projectIn = (name = 'Launch') => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: name, isPrivateSpace: false, AssigneeUserId: [] })._id);
const folderIn = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), projectId: project, name: 'Q3', deletedStatusKey: 0, ...doc })._id);
const sprintIn = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Sprint 1', private: false, deletedStatusKey: 0, ...doc })._id);

const addList = (folder, extra = {}) => run('POST /api/v1/sprint', { body: { projectId: project, sprintName: 'Backlog', folder, type: 'addSprint', ...extra } });
const moveList = (id, folderId) => run('PATCH /api/v1/sprint/:id', {
    id,
    body: { type: 'updateSprint', projectId: project, sprintName: 'Sprint 1', projectData: { id: project, ProjectName: 'Launch' }, updateObject: { $set: { folderId, folderName: 'whatever the client says' } }, historyData: { type: 'moved' } },
});

const refused = (res) => {
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ status: false, statusText: expect.any(String) });
    return res.body.statusText;
};

let project;
beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia' });
    project = projectIn();
    jest.spyOn(controller, 'getPerProjectCount').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('creating a list', () => {
    it('stores the folder it is created in', async () => {
        const folder = folderIn();
        const res = await addList({ folderId: folder, folderName: 'Q3' });
        expect(res.body).toMatchObject({ status: true });
        expect(sprints()).toHaveLength(1);
        expect(String(sprints()[0].folderId)).toBe(folder);
        expect(String(sprints()[0].projectId)).toBe(project);
    });

    it('stores the subfolder it is created in', async () => {
        const subfolder = folderIn({ name: 'Icons', parentFolderId: folderIn() });
        const res = await addList({ folderId: subfolder, folderName: 'Icons' });
        expect(res.body).toMatchObject({ status: true });
        expect(String(sprints()[0].folderId)).toBe(subfolder);
    });

    it.each([null, undefined, {}, { folderId: '' }])('stores no folder at the top level (%j)', async (folder) => {
        const res = await addList(folder);
        expect(res.body).toMatchObject({ status: true });
        expect(sprints()[0]).not.toHaveProperty('folderId');
    });

    it.each([
        ['an archived folder', { deletedStatusKey: ARCHIVED }],
        ['a deleted folder', { deletedStatusKey: DELETED }],
        ['a subfolder archived with its folder', { deletedStatusKey: ARCHIVED_WITH_FOLDER }],
    ])('is refused in %s', async (_label, doc) => {
        const res = await addList({ folderId: folderIn(doc), folderName: 'Q3' });
        expect(refused(res)).toMatch(/archived or deleted/);
        expect(sprints()).toEqual([]);
    });

    it.each([ARCHIVED, DELETED])('is refused in a live subfolder whose folder has status %s', async (deletedStatusKey) => {
        const subfolder = folderIn({ name: 'Icons', parentFolderId: folderIn({ deletedStatusKey }) });
        expect(refused(await addList({ folderId: subfolder, folderName: 'Icons' }))).toMatch(/archived or deleted/);
        expect(sprints()).toEqual([]);
    });

    it('is refused in a folder of another project', async () => {
        const elsewhere = projectIn('Elsewhere');
        const folder = folderIn({ projectId: elsewhere });
        expect(refused(await addList({ folderId: folder, folderName: 'Q3' }))).toMatch(/not in this project/);
        expect(sprints()).toEqual([]);
    });

    it('is refused in a folder that does not exist, or one that is not an id', async () => {
        expect(refused(await addList({ folderId: oid(), folderName: 'Q3' }))).toMatch(/not in this project/);
        expect(refused(await addList({ folderId: 'nope', folderName: 'Q3' }))).toMatch(/valid folder id/);
        expect(sprints()).toEqual([]);
    });
});

describe('moving a list', () => {
    it('lands in a live subfolder under the folder\'s stored name', async () => {
        const subfolder = folderIn({ name: 'Icons', parentFolderId: folderIn() });
        const sprint = sprintIn();
        const res = await moveList(sprint, subfolder);
        expect(res.body).toMatchObject({ status: true });
        expect(String(sprints()[0].folderId)).toBe(subfolder);
    });

    it.each([
        ['an archived folder', { deletedStatusKey: ARCHIVED }],
        ['a deleted folder', { deletedStatusKey: DELETED }],
    ])('is refused into %s and stays where it was', async (_label, doc) => {
        const from = folderIn();
        const sprint = sprintIn({ folderId: from });
        expect(refused(await moveList(sprint, folderIn(doc)))).toMatch(/archived or deleted/);
        expect(String(sprints()[0].folderId)).toBe(from);
    });

    it('is refused into a folder of another project', async () => {
        const sprint = sprintIn();
        const folder = folderIn({ projectId: projectIn('Elsewhere') });
        expect(refused(await moveList(sprint, folder))).toMatch(/not in this project/);
        expect(sprints()[0]).not.toHaveProperty('folderId');
    });

    it('goes back to the top level', async () => {
        const sprint = sprintIn({ folderId: folderIn() });
        const res = await moveList(sprint, null);
        expect(res.body).toMatchObject({ status: true });
        expect(sprints()[0].folderId).toBeNull();
    });
});
