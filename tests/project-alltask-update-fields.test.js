const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockCrud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { projectAlltaskUpdate } = require('../Modules/Project/controller/projectAlltaskUpdate');

const C = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const oid = () => new mongoose.Types.ObjectId().toString();

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};

const send = async (body, { projectId = oid(), headers = {} } = {}) => {
    const res = response();
    await projectAlltaskUpdate({ uid: 'a00000000000000000000001', params: { id: projectId }, body, query: {}, headers: { companyid: C, ...headers } }, res);
    return res;
};

const writes = () => mockCrud.mock.calls.filter(([, , method]) => method === 'updateMany');

beforeEach(() => {
    mockCrud.mockReset();
    mockCrud.mockResolvedValue({ acknowledged: true, matchedCount: 2, modifiedCount: 2 });
});

describe('PUT /api/v1/project/allTask/:id writes only the fields this operation changes', () => {
    /* JSON.parse(JSON.stringify(...)) mirrors the wire: the web app's `undefined` in $in arrives as null. */
    const CALLERS = [
        ['Item.vue close', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 8 } }, 0, 8],
        ['Item.vue archive', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 7 } }, 0, 7],
        ['Item.vue delete', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 1 } }, 0, 1],
        ['Item.vue restore from close', { findObject: { deletedStatusKey: 8 }, updateObject: { deletedStatusKey: 0 } }, 8, 0],
        ['Item.vue restore from archive', { findObject: { deletedStatusKey: 7 }, updateObject: { deletedStatusKey: 0 } }, 7, 0],
        ['ProjectsListingSetting.vue reopen', { findObject: { deletedStatusKey: 8 }, updateObject: { deletedStatusKey: 0 } }, 8, 0],
        ['ProjectsListingSetting.vue unarchive', { findObject: { deletedStatusKey: 7 }, updateObject: { deletedStatusKey: 0 } }, 7, 0],
        ['ProjectsListingSetting.vue delete', JSON.parse(JSON.stringify({ findObject: { deletedStatusKey: { $in: [0, undefined] } }, updateObject: { $set: { deletedStatusKey: 1 } } })), { $in: [0, null] }, 1],
    ];

    it.each(CALLERS)('%s writes deletedStatusKey and nothing else', async (caller, body, filterKey, newKey) => {
        const projectId = oid();
        const res = await send(body, { projectId });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        expect(writes()).toHaveLength(1);
        const [companyId, mongoObj] = writes()[0];
        expect(companyId).toBe(C);
        expect(mongoObj.type).toBe(SCHEMA_TYPE.TASKS);
        const [filter, update] = mongoObj.data;
        expect(filter).toEqual({ deletedStatusKey: filterKey, ProjectID: new mongoose.Types.ObjectId(projectId) });
        expect(update).toEqual({ $set: { deletedStatusKey: newKey } });
    });

    it.each([
        ['an extra field beside the status', { deletedStatusKey: 0, TaskName: 'x' }],
        ['a different field alone', { TaskName: 'x' }],
        ['an extra field inside $set', { $set: { deletedStatusKey: 0, AssigneeUserId: [] } }],
        ['an extra field beside $set', { $set: { deletedStatusKey: 0 }, TaskName: 'x' }],
    ])('refuses %s with 400 and writes nothing', async (label, updateObject) => {
        const res = await send({ findObject: { deletedStatusKey: 0 }, updateObject });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(typeof res.body.statusText).toBe('string');
        expect(writes()).toEqual([]);
    });

    it.each([
        ['$unset', { $unset: { deletedStatusKey: '' } }],
        ['$inc', { $inc: { deletedStatusKey: 1 } }],
        ['$rename', { $rename: { deletedStatusKey: 'x' } }],
        ['$set nested in $set', { $set: { $set: { deletedStatusKey: 1 } } }],
        ['an operator as the value', { deletedStatusKey: { $gt: 0 } }],
        ['an operator as the value inside $set', { $set: { deletedStatusKey: { $gt: 0 } } }],
        ['a dotted path', { 'deletedStatusKey.x': 1 }],
        ['a dotted path inside $set', { $set: { 'history.0.deletedStatusKey': 1 } }],
        ['a positional path', { $set: { 'deletedStatusKey.$': 1 } }],
        ['a string status', { deletedStatusKey: '1' }],
        ['an empty update', {}],
        ['an array', [{ deletedStatusKey: 1 }]],
    ])('refuses the update operator or path %s', async (label, updateObject) => {
        const res = await send({ findObject: { deletedStatusKey: 0 }, updateObject });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(writes()).toEqual([]);
    });

    it.each([
        ['$or', { $or: [{ deletedStatusKey: 0 }, { deletedStatusKey: 1 }] }],
        ['$where', { $where: 'true' }],
        ['_id', { _id: oid(), deletedStatusKey: 0 }],
        ['a dotted path', { 'deletedStatusKey.x': 0 }],
        ['$ne on the status', { deletedStatusKey: { $ne: 1 } }],
        ['$in beside another operator', { deletedStatusKey: { $in: [0], $nin: [1] } }],
        ['an operator inside $in', { deletedStatusKey: { $in: [{ $gt: 0 }] } }],
        ['a different field', { statusKey: 0 }],
    ])('refuses the filter %s', async (label, findObject) => {
        const res = await send({ findObject, updateObject: { deletedStatusKey: 1 } });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(writes()).toEqual([]);
    });

    it('refuses a filter that names a project other than the one in the URL', async () => {
        const res = await send({ findObject: { ProjectID: oid(), deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 1 } });
        expect(res.statusCode).toBe(400);
        expect(writes()).toEqual([]);
    });

    it('takes the company from the request header, not the body', async () => {
        const res = await send({ companyId: OTHER_COMPANY, CompanyId: OTHER_COMPANY, findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 8 } });
        expect(res.statusCode).toBe(200);
        expect(writes()[0][0]).toBe(C);
    });
});
