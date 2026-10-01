const verified = require('./fixtures/verifiedRequest');
const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn(async () => ({})) }));
jest.mock('../Modules/Sprints/controller', () => ({
    updateSprintFun: jest.fn(async () => ({ status: true })),
    updateFolderFun: jest.fn(async () => ({ answer: { status: true }, cascade: Promise.resolve() })),
    announceFolders: jest.fn(),
}));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({
    taskMongo: { bulkRestore: jest.fn(async () => ({ totals: { updated: 1 } })) },
}));
jest.mock('../Modules/Tasks/helpers/taskListsLeft', () => ({ leaveLists: jest.fn(async () => 0) }));
jest.mock('../Modules/Pages/controller', () => ({ restorePage: jest.fn((req, res) => res.send({ status: true, statusText: 'page' })) }));
jest.mock('../Modules/Trash/listAccess', () => ({ visibleTrash: jest.fn(async (companyId, uid, kind, docs) => docs) }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ sessionActor: jest.fn(async (req) => ({ id: String(req.uid), Employee_Name: 'Me' })) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const { updateSprintFun, updateFolderFun } = require('../Modules/Sprints/controller');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const pages = require('../Modules/Pages/controller');
const rules = require('../Modules/Trash/rules');
const ctrl = require('../Modules/Trash/controller');

const COMPANY = '6f00000000000000000000c1';
const ID = new mongoose.Types.ObjectId();
const PROJECT = new mongoose.Types.ObjectId();
const USER = '6f00000000000000000000a1';

const mockRes = () => ({ status: jest.fn().mockReturnThis(), send: jest.fn() });
const req = (over = {}) => verified({ uid: USER, headers: { companyid: COMPANY }, query: {}, params: {}, body: {}, ...over });

beforeEach(() => jest.clearAllMocks());

describe('rules', () => {
    test('five kinds, every row carries the same shape', () => {
        expect(rules.KINDS).toEqual(['projects', 'folders', 'lists', 'tasks', 'docs']);
        expect(rules.toRow('folders', { _id: ID, name: 'Design', projectId: PROJECT, updatedAt: 'now' })).toEqual({ _id: String(ID), kind: 'folders', title: 'Design', code: '', projectId: String(PROJECT), updatedAt: 'now' });
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
        expect(rules.childRestoreFilter('folders', String(ID), mongoose.Types.ObjectId)).toBeNull();
        expect(rules.childRestoreFilter('docs', String(ID), mongoose.Types.ObjectId)).toBeNull();
    });
});

describe('GET /api/v2/trash', () => {
    test('rejects an unknown kind', async () => {
        const res = mockRes();
        await ctrl.list(req({ query: { kind: 'comments' } }), res);
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
        expect(res.status).toHaveBeenCalledWith(403);
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

    test('folders: the folder write restores it, with what went to the trash with it, and is waited for', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce({ _id: ID, name: 'Design', projectId: PROJECT, deletedStatusKey: 1 })
            .mockResolvedValueOnce({ ProjectName: 'Proj' });
        let settled = false;
        updateFolderFun.mockResolvedValueOnce({ answer: { status: true }, cascade: new Promise((resolve) => setTimeout(() => { settled = true; resolve(); }, 5)) });
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'folders', id: String(ID) }, body: { userData: { id: 'u', Employee_Name: 'Forged' } } }), res);
        expect(updateFolderFun).toHaveBeenCalledWith({
            companyId: COMPANY,
            id: String(ID),
            updateObject: { $set: { deletedStatusKey: 0 } },
            folderName: 'Design',
            projectData: { id: String(PROJECT), ProjectName: 'Proj' },
            userData: { id: USER, Employee_Name: 'Me' },
            fromTrash: true,
        });
        expect(settled).toBe(true);
        expect(res.send).toHaveBeenCalledWith({ status: true, statusText: 'Restored.', data: { kind: 'folders', id: String(ID) } });
    });

    test('folders: one that is not in the trash is refused and nothing is written', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ _id: ID, name: 'Design', projectId: PROJECT, deletedStatusKey: 2 });
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'folders', id: String(ID) } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
        expect(updateFolderFun).not.toHaveBeenCalled();
    });

    test('folders: a refusal of the folder write keeps its reason and status', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce({ _id: ID, name: 'Icons', projectId: PROJECT, deletedStatusKey: 1 })
            .mockResolvedValueOnce({ ProjectName: 'Proj' });
        updateFolderFun.mockRejectedValueOnce(Object.assign(new Error('The parent folder is archived or deleted. Restore the parent folder first.'), { statusCode: 400 }));
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'folders', id: String(ID) } }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith({ status: false, statusText: 'The parent folder is archived or deleted. Restore the parent folder first.' });
    });

    test('tasks: goes through bulkRestore as the signed-in user', async () => {
        const res = mockRes();
        await ctrl.restore(req({ params: { kind: 'tasks', id: String(ID) }, body: { userData: { id: 'u' } } }), res);
        expect(taskMongo.bulkRestore).toHaveBeenCalledWith({ companyId: COMPANY, userData: { id: USER, Employee_Name: 'Me' }, taskIds: [String(ID)] });
    });

    test('docs: hands the request to restorePage', async () => {
        const res = mockRes();
        const r = req({ params: { kind: 'docs', id: String(ID) } });
        await ctrl.restore(r, res);
        expect(pages.restorePage).toHaveBeenCalledWith(r, res);
    });
});

describe('DELETE /api/v2/sample-data', () => {
    const fakeMongo = require('./fixtures/fakeMongo');
    const { SCHEMA_TYPE } = require('../Config/schemaType');

    const oid = () => new mongoose.Types.ObjectId();
    const SAMPLE = oid();
    const OWN_PROJECT = oid();
    const OWN_LIST = oid();
    let db;

    const seedWorld = () => {
        db = fakeMongo.create();
        MongoDbCrudOpration.mockImplementation((...args) => db.crud(...args));
        updateProjectInternal.mockImplementation(async (company, id, patch) => {
            const row = db.store[SCHEMA_TYPE.PROJECTS].find((p) => String(p._id) === String(id));
            Object.assign(row, patch);
        });
        db.seed(SCHEMA_TYPE.PROJECTS, { _id: SAMPLE, ProjectCode: 'WELCOME', deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.PROJECTS, { _id: OWN_PROJECT, ProjectCode: 'MINE', deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: SAMPLE, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: OWN_PROJECT, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), name: 'Team playbook', projectId: SAMPLE, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), name: 'Weekly routines', projectId: SAMPLE, parentFolderId: oid(), deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), name: 'Mine', projectId: OWN_PROJECT, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Getting started', projectId: SAMPLE, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.SPRINTS, { _id: OWN_LIST, name: 'Backlog', projectId: OWN_PROJECT, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.PAGES, { _id: oid(), title: 'How we work', ProjectID: SAMPLE, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.PAGES, { _id: oid(), title: 'My doc', ProjectID: OWN_PROJECT, deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.PAGES, { _id: oid(), title: 'Company doc', deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), fieldTitle: 'Estimate (hours)', projectId: [String(SAMPLE)], global: false, isDelete: true });
        db.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), fieldTitle: 'Shared', projectId: [String(SAMPLE), String(OWN_PROJECT)], global: false, isDelete: true });
        db.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: oid(), fieldTitle: 'Company wide', projectId: '', global: true, isDelete: true });
        db.seed(SCHEMA_TYPE.GOALS, { _id: oid(), name: 'Finish the getting-started tasks', ownerUserId: USER, sample: true, sampleProjectId: String(SAMPLE), deletedStatusKey: 0 });
        db.seed(SCHEMA_TYPE.GOALS, { _id: oid(), name: 'My goal counting the sample list', ownerUserId: USER, deletedStatusKey: 0 });
    };
    const rowsOf = (type, where = () => true) => db.store[type].filter(where);
    const live = (type, where) => rowsOf(type, where).filter((row) => row.deletedStatusKey === 0 || row.isDelete === true);

    test('trashes every welcome project and its live tasks', async () => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration
            .mockResolvedValueOnce([{ _id: ID }])
            .mockResolvedValueOnce({ modifiedCount: 3 })
            .mockImplementation(async (company, query, method) => (method === 'find' ? [] : { modifiedCount: 0 }));
        const res = mockRes();
        await ctrl.removeSampleData(req(), res);
        expect(MongoDbCrudOpration.mock.calls[0][1].data[0]).toEqual({ ProjectCode: 'WELCOME', deletedStatusKey: { $ne: 1 } });
        expect(updateProjectInternal).toHaveBeenCalledWith(COMPANY, String(ID), { deletedStatusKey: 1 });
        expect(MongoDbCrudOpration.mock.calls[1][1].data).toEqual([{ ProjectID: ID, deletedStatusKey: 0 }, { $set: { deletedStatusKey: 1 } }]);
        expect(res.send).toHaveBeenCalledWith({ status: true, statusText: 'Sample data removed.', data: expect.objectContaining({ projects: 1, tasks: 3 }) });
    });

    test('removes every kind the sample holds, in this company only', async () => {
        seedWorld();
        const res = mockRes();
        await ctrl.removeSampleData(req(), res);
        expect(res.send).toHaveBeenCalledWith({
            status: true,
            statusText: 'Sample data removed.',
            data: { projects: 1, tasks: 1, folders: 2, lists: 1, docs: 1, fields: 1, goals: 1 },
        });
        expect(db.crud.mock.calls.every(([company]) => company === COMPANY)).toBe(true);
        const inSample = (key) => (row) => String(row[key]) === String(SAMPLE);
        expect(rowsOf(SCHEMA_TYPE.PROJECTS, inSample('_id'))[0].deletedStatusKey).toBe(1);
        [[SCHEMA_TYPE.TASKS, 'ProjectID'], [SCHEMA_TYPE.FOLDERS, 'projectId'], [SCHEMA_TYPE.SPRINTS, 'projectId'], [SCHEMA_TYPE.PAGES, 'ProjectID']].forEach(([type, key]) => {
            expect(rowsOf(type, inSample(key)).length).toBeGreaterThan(0);
            expect(rowsOf(type, inSample(key)).every((row) => row.deletedStatusKey === 1)).toBe(true);
        });
        expect(rowsOf(SCHEMA_TYPE.GOALS, (goal) => goal.sample)[0].deletedStatusKey).toBe(1);
        expect(rowsOf(SCHEMA_TYPE.CUSTOM_FIELDS, (field) => field.fieldTitle === 'Estimate (hours)')[0].isDelete).toBe(false);
    });

    test('leaves what a person made: their project, list, doc, goal, folder and fields', async () => {
        seedWorld();
        await ctrl.removeSampleData(req(), mockRes());
        expect(rowsOf(SCHEMA_TYPE.PROJECTS, (p) => p.ProjectCode === 'MINE')[0].deletedStatusKey).toBe(0);
        expect(live(SCHEMA_TYPE.TASKS, (t) => String(t.ProjectID) === String(OWN_PROJECT))).toHaveLength(1);
        expect(live(SCHEMA_TYPE.FOLDERS, (f) => f.name === 'Mine')).toHaveLength(1);
        expect(live(SCHEMA_TYPE.SPRINTS, (l) => String(l._id) === String(OWN_LIST))).toHaveLength(1);
        expect(live(SCHEMA_TYPE.PAGES, (p) => p.title === 'My doc' || p.title === 'Company doc')).toHaveLength(2);
        expect(live(SCHEMA_TYPE.GOALS, (g) => g.name === 'My goal counting the sample list')).toHaveLength(1);
        expect(live(SCHEMA_TYPE.CUSTOM_FIELDS, (f) => f.fieldTitle === 'Shared' || f.fieldTitle === 'Company wide')).toHaveLength(2);
    });

    test('a second removal finds nothing left and trashes nothing twice', async () => {
        seedWorld();
        await ctrl.removeSampleData(req(), mockRes());
        const res = mockRes();
        await ctrl.removeSampleData(req(), res);
        expect(res.send).toHaveBeenCalledWith({
            status: true,
            statusText: 'Sample data removed.',
            data: { projects: 0, tasks: 0, folders: 0, lists: 0, docs: 0, fields: 0, goals: 0 },
        });
    });

    test('tells other tabs the goals changed only when a goal went', async () => {
        const emit = require('../event/socketEventEmitter');
        const spy = jest.spyOn(emit, 'emit').mockImplementation(() => true);
        seedWorld();
        await ctrl.removeSampleData(req(), mockRes());
        expect(spy).toHaveBeenCalledWith('update', { type: 'update', companyId: COMPANY, module: 'goals' });
        spy.mockClear();
        await ctrl.removeSampleData(req(), mockRes());
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
