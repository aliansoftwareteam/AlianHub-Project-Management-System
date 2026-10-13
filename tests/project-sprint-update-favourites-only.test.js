const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Sprints/helpers/sprintHistory', () => ({ recordSprintFavourite: jest.fn(() => Promise.resolve()) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateSprint } = require('../Modules/Project/controller/updateSprint');

const C = 'c00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const oid = () => new mongoose.Types.ObjectId().toString();

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    return res;
};

const put = async (id, body) => {
    const res = response();
    await updateSprint({ params: { id }, body, uid: MEMBER, headers: { companyid: C } }, res);
    return res;
};

const writes = () => mockDb.crud.mock.calls.filter(([, { type }, method]) => type === SCHEMA_TYPE.SPRINTS && method === 'findOneAndUpdate');

let sprintId;
beforeEach(() => {
    mockDb = fakeMongo.create();
    sprintId = String(mockDb.seed(SCHEMA_TYPE.SPRINTS, {
        _id: oid(), name: 'Sprint 1', projectId: oid(), private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0, favouriteTasks: [{ userId: OTHER }],
    })._id);
});

describe('PUT /api/v1/project/sprint/:id changes only the caller\'s own favourite', () => {
    it('adds the caller to the favourites with the shape the sprint list sends', async () => {
        const res = await put(sprintId, { key: '$addToSet', updateObject: { favouriteTasks: { userId: MEMBER } } });
        expect(res.statusCode).toBe(200);
        expect(writes()).toHaveLength(1);
        expect(JSON.stringify(writes()[0][1].data[1])).not.toMatch(/private|AssigneeUserId|deletedStatusKey|projectId/);
    });

    it('removes the caller from the favourites', async () => {
        const id = String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Sprint 2', favouriteTasks: [{ userId: MEMBER }, { userId: OTHER }] })._id);
        const res = await put(id, { key: '$pull', updateObject: { favouriteTasks: { userId: MEMBER } } });
        expect(res.statusCode).toBe(200);
        expect(writes()[0][1].data[1]).toEqual({ $pull: { favouriteTasks: { userId: MEMBER } } });
        expect(res.body.favouriteTasks).toEqual([{ userId: OTHER }]);
    });

    it.each([
        ['a rename of the favourites onto the privacy flag', { key: '$rename', updateObject: { favouriteTasks: 'private' } }],
        ['a rename onto the container', { key: '$rename', updateObject: { favouriteTasks: 'projectId' } }],
        ['a rename onto the trash key', { key: '$rename', updateObject: { watchers: 'deletedStatusKey' } }],
        ['a plain $set of the privacy flag', { updateObject: { private: false } }],
        ['a $set of the members', { key: '$set', updateObject: { AssigneeUserId: [MEMBER] } }],
        ['a $set of the container', { key: '$set', updateObject: { projectId: oid() } }],
        ['a $set of the trash key', { key: '$set', updateObject: { deletedStatusKey: 1 } }],
        ['a lifecycle field', { key: '$set', updateObject: { state: 'closed' } }],
        ['an $unset of the favourites', { key: '$unset', updateObject: { favouriteTasks: '' } }],
        ['someone else\'s favourite', { key: '$addToSet', updateObject: { favouriteTasks: { userId: OTHER } } }],
        ['removing someone else\'s favourite', { key: '$pull', updateObject: { favouriteTasks: { userId: OTHER } } }],
        ['a favourite with extra fields', { key: '$addToSet', updateObject: { favouriteTasks: { userId: MEMBER, pinned: true } } }],
        ['a favourite next to another field', { key: '$addToSet', updateObject: { favouriteTasks: { userId: MEMBER }, AssigneeUserId: MEMBER } }],
        ['a $push of the members', { key: '$push', updateObject: { AssigneeUserId: MEMBER } }],
    ])('refuses %s with 400 and writes nothing', async (_label, body) => {
        const res = await put(sprintId, body);
        expect(res.statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
        const stored = await mockDb.crud(C, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: sprintId }] }, 'findOne');
        expect(stored).toMatchObject({ private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0, favouriteTasks: [{ userId: OTHER }] });
    });
});
