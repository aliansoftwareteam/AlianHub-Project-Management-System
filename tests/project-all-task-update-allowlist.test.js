const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));

const { projectAlltaskUpdate } = require('../Modules/Project/controller/projectAlltaskUpdate');

const C = 'c00000000000000000000001';
const PROJECT = '6f0000000000000000000a01';

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

const send = async (body) => {
    const res = response();
    await projectAlltaskUpdate({ params: { id: PROJECT }, headers: { companyid: C }, body }, res);
    return { res, updates: mockDb.calls.filter((call) => call.method === 'updateMany') };
};

/* JSON drops undefined inside arrays to null, which is how the delete cascade's filter reaches the server. */
const overTheWire = (body) => JSON.parse(JSON.stringify(body));

const WEB_APP_BODIES = [
    ['ProjectsListingSetting.vue deleteChildTasks', { findObject: { deletedStatusKey: { $in: [0, undefined] } }, updateObject: { $set: { deletedStatusKey: 1 } } }],
    ['ProjectsListingSetting.vue restoreChildTasks (unarchive)', { findObject: { deletedStatusKey: 7 }, updateObject: { deletedStatusKey: 0 } }],
    ['ProjectsListingSetting.vue restoreChildTasks (reopen)', { findObject: { deletedStatusKey: 8 }, updateObject: { deletedStatusKey: 0 } }],
    ['Item.vue updateChildTasks (close)', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 8 } }],
    ['Item.vue updateChildTasks (delete)', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 7 } }],
    ['Item.vue updateChildTasks (from archive)', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 1 } }],
    ['Item.vue updateChildTasks (restore)', { findObject: { deletedStatusKey: 8 }, updateObject: { deletedStatusKey: 0 } }],
    ['a findObject naming the URL project', { findObject: { ProjectID: PROJECT, deletedStatusKey: 7 }, updateObject: { deletedStatusKey: 0 } }],
];

beforeEach(() => {
    mockDb = fakeMongo.create();
});

describe('the bulk task update accepts every body the web app sends', () => {
    test.each(WEB_APP_BODIES)('%s', async (_, body) => {
        const wire = overTheWire(body);
        const { res, updates } = await send(wire);
        expect(res.statusCode).toBe(200);
        expect(updates).toHaveLength(1);
        const [filter, update] = updates[0].data;
        expect(String(filter.ProjectID)).toBe(PROJECT);
        expect(filter.deletedStatusKey).toEqual(wire.findObject.deletedStatusKey);
        expect(update).toEqual({ $set: wire.updateObject });
    });
});

describe('the bulk task update refuses anything else with 400', () => {
    test.each([
        ['an unknown update field', { findObject: { deletedStatusKey: 0 }, updateObject: { TaskName: 'x' } }, 'TaskName'],
        ['an unknown field beside an allowed one', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 1, AssigneeUserId: [] } }, 'AssigneeUserId'],
        ['an $unset operator', { findObject: { deletedStatusKey: 0 }, updateObject: { $unset: { deletedStatusKey: '' } } }, '$unset'],
        ['a $set nested in $set', { findObject: { deletedStatusKey: 0 }, updateObject: { $set: { $set: { deletedStatusKey: 1 } } } }, '$set'],
        ['a $set naming another field', { findObject: { deletedStatusKey: 0 }, updateObject: { $set: { Task_Priority: 'LOW' } } }, 'Task_Priority'],
        ['an $inc operator', { findObject: { deletedStatusKey: 0 }, updateObject: { $inc: { deletedStatusKey: 1 } } }, '$inc'],
        ['a dotted update path', { findObject: { deletedStatusKey: 0 }, updateObject: { 'customField.x': 1 } }, 'customField.x'],
        ['a dotted path inside $set', { findObject: { deletedStatusKey: 0 }, updateObject: { $set: { 'deletedStatusKey.x': 1 } } }, 'deletedStatusKey.x'],
        ['a non-numeric deletedStatusKey', { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: { $gt: 1 } } }, 'deletedStatusKey'],
        ['an empty update', { findObject: { deletedStatusKey: 0 }, updateObject: {} }, 'updateObject'],
        ['an unknown filter field', { findObject: { _id: '6f0000000000000000000b01' }, updateObject: { deletedStatusKey: 1 } }, '_id'],
        ['a filter operator', { findObject: { $where: 'true' }, updateObject: { deletedStatusKey: 1 } }, '$where'],
        ['a dotted filter path', { findObject: { 'sprintArray.id': 'x' }, updateObject: { deletedStatusKey: 1 } }, 'sprintArray.id'],
        ['a filter operator other than $in', { findObject: { deletedStatusKey: { $ne: 1 } }, updateObject: { deletedStatusKey: 1 } }, '$ne'],
        ['an update sent as an array', { findObject: { deletedStatusKey: 0 }, updateObject: [{ $set: { deletedStatusKey: 1 } }] }, 'updateObject'],
    ])('%s', async (_, body, named) => {
        const { res, updates } = await send(body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false });
        expect(res.body.statusText).toContain(named);
        expect(updates).toEqual([]);
    });
});
