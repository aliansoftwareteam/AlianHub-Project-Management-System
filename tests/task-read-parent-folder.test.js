const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
let mockTaskRead;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, query, method) => (method === 'aggregate' ? Promise.resolve(mockTaskRead) : mockDb.crud(companyId, query, method)),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getQueryFun } = require('../Modules/Project/controller/getQueryFun');

const C = 'c00000000000000000000001';
const oid = () => new mongoose.Types.ObjectId();
const PROJECT = oid();
const OTHER_PROJECT = oid();

const read = async () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    await getQueryFun({ query: { taskId: String(oid()), projectId: String(PROJECT), subTaskLimit: '5' }, headers: { companyid: C } }, res);
    return res;
};

const folder = (doc) => mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: oid(), projectId: PROJECT, deletedStatusKey: 0, ...doc });
const answering = (folderDetails) => { mockTaskRead = [{ _id: PROJECT, tasks: [{ TaskName: 'Arrows' }], sprintsfolders: folderDetails, subtasks: [] }]; };

beforeEach(() => { mockDb = fakeMongo.create(); });

describe('the parent folder on the task read', () => {
    it('names the folder above the task\'s subfolder', async () => {
        const design = folder({ name: 'Design', legacyId: 'kept-out' });
        const icons = folder({ name: 'Icons', parentFolderId: design._id });
        answering([icons]);
        const res = await read();
        expect(res.statusCode).toBe(200);
        expect(res.body[0].parentFolder).toEqual({ _id: design._id, name: 'Design' });
        expect(res.body[0].sprintsfolders).toEqual([icons]);
    });

    it('is null for a task in a top-level folder, and for a task in no folder', async () => {
        answering([folder({ name: 'Design' })]);
        expect((await read()).body[0].parentFolder).toBeNull();
        answering([]);
        expect((await read()).body[0].parentFolder).toBeNull();
        answering(undefined);
        expect((await read()).body[0].parentFolder).toBeNull();
    });

    it('is null when the parent is gone, or belongs to another project', async () => {
        answering([folder({ name: 'Icons', parentFolderId: oid() })]);
        expect((await read()).body[0].parentFolder).toBeNull();
        const foreign = folder({ name: 'Theirs', projectId: OTHER_PROJECT });
        answering([folder({ name: 'Icons', parentFolderId: foreign._id })]);
        expect((await read()).body[0].parentFolder).toBeNull();
    });

    it('asks only the company in the header', async () => {
        const design = folder({ name: 'Design' });
        answering([folder({ name: 'Icons', parentFolderId: design._id })]);
        await read();
        expect(mockDb.calls.filter((call) => call.type === SCHEMA_TYPE.FOLDERS).map((call) => call.companyId)).toEqual([C]);
    });

    it('leaves an empty answer as it is', async () => {
        mockTaskRead = [];
        expect((await read()).body).toEqual([]);
    });
});
