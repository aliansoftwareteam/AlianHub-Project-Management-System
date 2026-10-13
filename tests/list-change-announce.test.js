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
const socketEmitter = require('../event/socketEventEmitter');
const controller = require('../Modules/Sprints/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
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
    const req = verified({ uid: OWNER, params: { id }, body: { companyId: C, userData: { id: OWNER, Employee_Name: 'Olivia' }, ...body }, query: {}, headers: { companyid: C } });
    for (const handler of routes()[route]) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await settle();
    return res;
};

const folderIn = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), projectId: project, name: 'Q3', deletedStatusKey: 0, ...doc })._id);
const sprintIn = (doc = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId: project, name: 'Sprint 1', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...doc })._id);

const PATCH = 'PATCH /api/v1/sprint/:id';
const update = (id, updateObject) => run(PATCH, {
    id,
    body: { type: 'updateSprint', projectId: project, sprintName: 'Sprint 1', projectData: { id: project, ProjectName: 'Launch' }, updateObject },
});

const announced = () => socketEmitter.emit.mock.calls
    .filter(([, payload]) => payload && payload.module === 'sprints')
    .map(([type, payload]) => ({ sent: type, ...payload }));
const saidOf = (id, type = 'update') => ({ sent: type, type, companyId: C, module: 'sprints', data: { _id: String(id) } });

let project;
beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [MEMBER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia' });
    project = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    jest.spyOn(controller, 'getPerProjectCount').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe('a list write says which list changed', () => {
    it('when a list is made, with its id and the company and nothing else of it', async () => {
        const res = await run('POST /api/v1/sprint', { body: { projectId: project, sprintName: 'Redundancy plan', type: 'addSprint' } });
        expect(res.body).toMatchObject({ status: true });
        expect(announced()).toEqual([saidOf(res.body.data._id, 'insert')]);
        expect(JSON.stringify(announced())).not.toContain('Redundancy');
    });

    it('when a list is renamed', async () => {
        const list = sprintIn();
        await run(PATCH, { id: list, body: { type: 'editSprintName', projectId: project, sprintName: 'Sprint one' } });
        expect(announced()).toEqual([saidOf(list)]);
    });

    it('when a list is moved into a folder, archived or sent to the trash', async () => {
        const list = sprintIn();
        const folder = folderIn();
        await update(list, { $set: { folderId: folder, folderName: 'Q3' } });
        await update(list, { $set: { deletedStatusKey: 2 } });
        await update(list, { $set: { deletedStatusKey: 1 } });
        expect(announced()).toEqual([saidOf(list), saidOf(list), saidOf(list)]);
    });

    it('with how it was shared before, when its sharing changes', async () => {
        const list = sprintIn({ private: true, AssigneeUserId: [OWNER, MEMBER] });
        await update(list, { $pull: { AssigneeUserId: MEMBER } });
        expect(announced()).toEqual([{ ...saidOf(list), sharedBefore: { private: true, AssigneeUserId: [OWNER, MEMBER] } }]);
    });

    it('takes how it was shared before from the stored list, never from the request', async () => {
        const list = sprintIn({ private: true, AssigneeUserId: [OWNER] });
        await run(PATCH, {
            id: list,
            body: { type: 'updateSprint', projectId: project, sprintName: 'Sprint 1', projectData: { id: project, ProjectName: 'Launch' }, updateObject: { $set: { deletedStatusKey: 2 } }, sharedBefore: { private: false, AssigneeUserId: [] } },
        });
        expect(announced()).toEqual([saidOf(list)]);
    });

    it('when a list is made a sprint with dates, started, and made a plain list again', async () => {
        const list = sprintIn();
        const planned = sprintIn({ name: 'Sprint 2' });
        await run('POST /api/v2/sprints/scrum', { body: { sprintId: list, isScrum: true, startDate: '2026-10-05', endDate: '2026-10-16' } });
        await run('POST /api/v2/sprints/start', { body: { sprintId: list } });
        await run('POST /api/v2/sprints/scrum', { body: { sprintId: planned, isScrum: true } });
        await run('POST /api/v2/sprints/scrum', { body: { sprintId: planned, isScrum: false } });
        expect(announced()).toEqual([saidOf(list), saidOf(list), saidOf(planned), saidOf(planned)]);
    });
});

describe('a list write says nothing', () => {
    it('when only the count of its tasks moves', async () => {
        const list = sprintIn();
        const answer = await controller.updateSprintFun({ params: { id: list }, body: { companyId: C, projectId: project, updateObject: { $inc: { tasks: 1 } }, userData: { id: OWNER, Employee_Name: 'Olivia' } } });
        await settle();
        expect(answer).toMatchObject({ status: true });
        expect(announced()).toEqual([]);
    });

    it('when it is refused or finds no list', async () => {
        await run(PATCH, { id: oid(), body: { type: 'editSprintName', projectId: project, sprintName: 'Nothing' } });
        await update(oid(), { $set: { deletedStatusKey: 2 } });
        await update(sprintIn(), { $set: { name: 'Not through here' } });
        await run('POST /api/v2/sprints/scrum', { body: { sprintId: oid(), isScrum: true } });
        expect(announced()).toEqual([]);
    });
});
