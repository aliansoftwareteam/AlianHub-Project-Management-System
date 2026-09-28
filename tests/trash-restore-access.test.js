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
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { bulkRestore: jest.fn(async () => ({ totals: { updated: 1 } })) } }));
jest.mock('../Modules/Pages/controller', () => ({ restorePage: jest.fn((req, res) => res.send({ status: true })) }));

const mockReached = jest.fn((req, res) => res.status(200).json({ status: true, reached: 'restore' }));
jest.mock('../Modules/Trash/controller', () => ({ ...jest.requireActual('../Modules/Trash/controller'), restore: (...args) => mockReached(...args) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateSprintFun } = require('../Modules/Sprints/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const MEMBER_ROLE = 3;

const oid = () => new mongoose.Types.ObjectId().toString();

const restoreRoute = () => {
    let handlers;
    require('../Modules/Trash/routes').init({
        get: () => {},
        delete: () => {},
        put: (path, ...chain) => { if (path === '/api/v2/trash/:kind/:id/restore') handlers = chain; },
    });
    return handlers;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
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

const request = (uid, kind, id, body = {}) => ({
    uid, aud: C, params: { kind, id: String(id) }, query: {}, body, headers: { companyid: C },
});

const restore = (uid, kind, id) => run(restoreRoute(), request(uid, kind, id));

const seedRules = (grants = {}) => {
    const parents = {};
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        parents[section] = parents[section] || mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parents[section]._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [], isGlobalPermission: true, ...doc });
const seedSprint = (project, doc = {}) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Sprint', projectId: project._id, private: false, AssigneeUserId: [], deletedStatusKey: 1, ...doc });
const seedTask = (project, sprint, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), TaskName: 'Fix', ProjectID: project._id, sprintId: sprint._id, deletedStatusKey: 1, ...doc });

const CAN_DELETE = { 'task.task_delete': true, 'project.sprint_delete': true, 'project.private_projects': 1 };

beforeEach(() => {
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
});

describe('restoring a task from the trash', () => {
    it('refuses a member who may not delete tasks', async () => {
        seedRules({ ...CAN_DELETE, 'task.task_delete': false });
        const project = seedProject();
        const res = await restore(MEMBER, 'tasks', seedTask(project, seedSprint(project, { deletedStatusKey: 0 }))._id);
        expect(res.statusCode).toBe(403);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('answers 404 for a task in a private project the member is not in', async () => {
        seedRules(CAN_DELETE);
        const project = seedProject({ isPrivateSpace: true, AssigneeUserId: [OWNER] });
        const res = await restore(MEMBER, 'tasks', seedTask(project, seedSprint(project, { deletedStatusKey: 0 }))._id);
        expect(res.statusCode).toBe(404);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('answers 404 for a task in a private list the member is not on', async () => {
        seedRules(CAN_DELETE);
        const project = seedProject();
        const res = await restore(MEMBER, 'tasks', seedTask(project, seedSprint(project, { private: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 }))._id);
        expect(res.statusCode).toBe(404);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('lets a member who may delete tasks restore one they can see', async () => {
        seedRules(CAN_DELETE);
        const project = seedProject();
        const res = await restore(MEMBER, 'tasks', seedTask(project, seedSprint(project, { deletedStatusKey: 0 }))._id);
        expect(res.body).toMatchObject({ reached: 'restore' });
    });
});

describe('restoring a list from the trash', () => {
    it('refuses a member who may not delete lists', async () => {
        seedRules({ ...CAN_DELETE, 'project.sprint_delete': false });
        const res = await restore(MEMBER, 'lists', seedSprint(seedProject())._id);
        expect(res.statusCode).toBe(403);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('answers 404 for a private list the member is not on', async () => {
        seedRules(CAN_DELETE);
        const res = await restore(MEMBER, 'lists', seedSprint(seedProject(), { private: true, AssigneeUserId: [OWNER] })._id);
        expect(res.statusCode).toBe(404);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('answers 404 for a list in a private project the member is not in', async () => {
        seedRules(CAN_DELETE);
        const res = await restore(MEMBER, 'lists', seedSprint(seedProject({ isPrivateSpace: true, AssigneeUserId: [OWNER] }))._id);
        expect(res.statusCode).toBe(404);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('answers 404 to a member for a list whose container is not a project', async () => {
        seedRules(CAN_DELETE);
        const res = await restore(MEMBER, 'lists', seedSprint({ _id: oid() })._id);
        expect(res.statusCode).toBe(404);
        expect(mockReached).not.toHaveBeenCalled();
    });

    it('lets the owner restore a private list and one outside any project', async () => {
        seedRules({});
        expect((await restore(OWNER, 'lists', seedSprint(seedProject(), { private: true, AssigneeUserId: [MEMBER] })._id)).body).toMatchObject({ reached: 'restore' });
        expect((await restore(OWNER, 'lists', seedSprint({ _id: oid() })._id)).body).toMatchObject({ reached: 'restore' });
    });

    it('lets a member on a private list who may delete lists restore it', async () => {
        seedRules(CAN_DELETE);
        const res = await restore(MEMBER, 'lists', seedSprint(seedProject(), { private: true, AssigneeUserId: [MEMBER] })._id);
        expect(res.body).toMatchObject({ reached: 'restore' });
    });
});

describe('the restore records the signed-in user', () => {
    const { restore: restoreHandler } = jest.requireActual('../Modules/Trash/controller');
    const FORGED = { id: OWNER, Employee_Name: 'Somebody else' };

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: new mongoose.Types.ObjectId(MEMBER), Employee_Name: 'Mia' });
    });

    it('for a task, whatever the body says', async () => {
        const project = seedProject();
        const task = seedTask(project, seedSprint(project, { deletedStatusKey: 0 }));
        const res = response();
        await restoreHandler(request(MEMBER, 'tasks', task._id, { userData: FORGED }), res);
        expect(res.body).toMatchObject({ status: true });
        expect(taskMongo.bulkRestore).toHaveBeenCalledWith(expect.objectContaining({ userData: { id: MEMBER, Employee_Name: 'Mia' } }));
    });

    it('for a list, whatever the body says', async () => {
        const sprint = seedSprint(seedProject());
        const res = response();
        await restoreHandler(request(MEMBER, 'lists', sprint._id, { userData: FORGED }), res);
        expect(res.body).toMatchObject({ status: true });
        expect(updateSprintFun.mock.calls[0][0].body.userData).toEqual({ id: MEMBER, Employee_Name: 'Mia' });
    });
});
