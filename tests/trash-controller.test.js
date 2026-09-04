const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn(async () => ({})) }));
jest.mock('../Modules/Sprints/controller', () => ({ updateSprintFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { bulkRestore: jest.fn(async () => ({ totals: { updated: 1 } })) } }));
jest.mock('../Modules/Pages/controller', () => ({ restorePage: jest.fn((req, res) => res.send({ status: true, statusText: 'page' })) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const { updateSprintFun } = require('../Modules/Sprints/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const pages = require('../Modules/Pages/controller');
const rules = require('../Modules/Trash/rules');
const ctrl = require('../Modules/Trash/controller');

const COMPANY = 'c1';
const ID = new mongoose.Types.ObjectId();
const PROJECT = new mongoose.Types.ObjectId();

const mockRes = () => ({ status: jest.fn().mockReturnThis(), send: jest.fn() });
const req = (over = {}) => ({ headers: { companyid: COMPANY }, query: {}, params: {}, body: {}, ...over });

beforeEach(() => jest.clearAllMocks());

describe('rules', () => {
    test('four kinds, every row carries the same shape', () => {
        expect(rules.KINDS).toEqual(['projects', 'lists', 'tasks', 'docs']);
        const row = rules.toRow('tasks', { _id: ID, TaskName: 'Fix', TaskKey: 'AH-1', ProjectID: PROJECT, updatedAt: 'now' });
        expect(row).toEqual({ _id: String(ID), kind: 'tasks', title: 'Fix', code: 'AH-1', projectId: String(PROJECT), updatedAt: 'now' });
        expect(Object.keys(rules.toRow('docs', { _id: ID, title: 'Doc' })).sort()).toEqual(Object.keys(row).sort());
    });

    test('list queries only ever read the trash', () => {
        rules.KINDS.forEach((kind) => expect(rules.listQuery(kind).filter).toEqual({ deletedStatusKey: 1 }));
        expect(rules.listQuery('tasks').options.limit).toBe(rules.MAX_ROWS);
    });

    test('containers restore the tasks they trashed; tasks and docs restore nothing else', () => {
        expect(rules.childRestoreFilter('projects', String(ID), mongoose.Types.ObjectId)).toEqual({ ProjectID: ID, deletedStatusKey: { $in: [1, 7] } });
        expect(rules.childRestoreFilter('lists', String(ID), mongoose.Types.ObjectId)).toEqual({ sprintId: ID, deletedStatusKey: 1 });
        expect(rules.childRestoreFilter('tasks', String(ID), mongoose.Types.ObjectId)).toBeNull();
        expect(rules.childRestoreFilter('docs', String(ID), mongoose.Types.ObjectId)).toBeNull();
    });
});

describe('GET /api/v2/trash', () => {
    test('rejects an unknown kind', async () => {
        const res = mockRes();
        await ctrl.list(req({ query: { kind: 'folders' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
    });

    test('reads the company trash and maps rows', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([{ _id: ID, TaskName: 'Fix', TaskKey: 'AH-1', ProjectID: PROJECT }]);
        const res = mockRes();
        await ctrl.list(req({ query: { kind: 'tasks' } }), res);
        const [companyId, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(companyId).toBe(COMPANY);
        expect(method).toBe('find');
        expect(query.type).toBe('tasks');
        expect(query.data[0]).toEqual({ deletedStatusKey: 1 });
        expect(res.send).toHaveBeenCalledWith({ status: true, statusText: 'Trash fetched.', data: [expect.objectContaining({ kind: 'tasks', title: 'Fix', code: 'AH-1' })] });
    });

    test('needs a company', async () => {
        const res = mockRes();
        await ctrl.list({ headers: {}, query: {} }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});

describe('PUT /api/v2/trash/:kind/:id/restore', () => {
    test('rejects a malformed id', async () => {
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'tasks', id: 'nope' } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('projects: existing project write, then the tasks it took along', async () => {
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'projects', id: String(ID) } }), res);
        expect(updateProjectInternal).toHaveBeenCalledWith(COMPANY, String(ID), { deletedStatusKey: 0 });
        const [companyId, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect([companyId, method, query.type]).toEqual([COMPANY, 'updateMany', 'tasks']);
        expect(query.data[0]).toEqual({ ProjectID: ID, deletedStatusKey: { $in: [1, 7] } });
        expect(query.data[1]).toEqual({ $set: { deletedStatusKey: 0 } });
        expect(res.send).toHaveBeenCalledWith({ status: true, statusText: 'Restored.', data: { kind: 'projects', id: String(ID) } });
    });

    test('lists: delegates to the sprint update with the restore key', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce({ _id: ID, name: 'Sprint 1', projectId: PROJECT })
            .mockResolvedValueOnce({ ProjectName: 'Proj' })
            .mockResolvedValueOnce({ modifiedCount: 2 });
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'lists', id: String(ID) }, body: { userData: { id: 'u', Employee_Name: 'Me' } } }), res);
        expect(updateSprintFun).toHaveBeenCalledWith(expect.objectContaining({
            params: { id: String(ID) },
            body: expect.objectContaining({ companyId: COMPANY, projectId: String(PROJECT), updateObject: { $set: { deletedStatusKey: 0 } }, updatedValueDeleteStatusKey: 0, sprintName: 'Sprint 1' })
        }));
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: true }));
    });

    test('lists: a missing sprint is a 500 with status false', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'lists', id: String(ID) } }), res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
    });

    test('tasks: goes through bulkRestore', async () => {
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'tasks', id: String(ID) }, body: { userData: { id: 'u' } } }), res);
        expect(taskMongo.bulkRestore).toHaveBeenCalledWith({ companyId: COMPANY, userData: { id: 'u' }, taskIds: [String(ID)] });
    });

    test('docs: hands the request to restorePage', async () => {
        const res = mockRes();
        const r = req({ params: { kind: 'docs', id: String(ID) } });
        await ctrl.restore(r, res);
        expect(pages.restorePage).toHaveBeenCalledWith(r, res);
    });
});

describe('DELETE /api/v2/sample-data', () => {
    test('trashes every welcome project and its live tasks', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce([{ _id: ID }])
            .mockResolvedValueOnce({ modifiedCount: 3 });
        const res = mockRes();
        await ctrl.removeSampleData(req(), res);
        expect(MongoDbCrudOpration.mock.calls[0][1].data[0]).toEqual({ ProjectCode: 'WELCOME', deletedStatusKey: { $ne: 1 } });
        expect(updateProjectInternal).toHaveBeenCalledWith(COMPANY, String(ID), { deletedStatusKey: 1 });
        expect(MongoDbCrudOpration.mock.calls[1][1].data).toEqual([{ ProjectID: ID, deletedStatusKey: 0 }, { $set: { deletedStatusKey: 1 } }]);
        expect(res.send).toHaveBeenCalledWith({ status: true, statusText: 'Sample data removed.', data: { projects: 1, tasks: 3 } });
    });
});
