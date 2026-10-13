const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

let client;
let owner;

const tasks = () => client.db(state.companyId).collection('tasks');
const storedOf = (id) => tasks().findOne({ _id: new ObjectId(id) }, { projection: { deletedStatusKey: 1, TaskName: 1, statusKey: 1 } });
const bulk = (project, body) => owner.api.put(`/api/v1/project/allTask/${project._id}`, body);

async function projectWithTask() {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, name: `Bulk fields ${uniqueSuffix()}`, user: owner, companyOwnerId: owner.uid });
    return { project, task };
}

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('the bulk task update writes only the fields this operation changes', () => {
    it('archives and unarchives a project\'s tasks the way Item.vue and ProjectsListingSetting.vue do', async () => {
        const { project, task } = await projectWithTask();
        const archived = await bulk(project, { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 7 } });
        expect(archived.status).toBe(200);
        expect((await storedOf(task._id)).deletedStatusKey).toBe(7);
        const restored = await bulk(project, { findObject: { deletedStatusKey: 7 }, updateObject: { deletedStatusKey: 0 } });
        expect(restored.status).toBe(200);
        expect((await storedOf(task._id)).deletedStatusKey).toBe(0);
    });

    it('marks a deleted project\'s tasks with the body ProjectsListingSetting.vue sends', async () => {
        const { project, task } = await projectWithTask();
        const res = await bulk(project, { findObject: { deletedStatusKey: { $in: [0, null] } }, updateObject: { $set: { deletedStatusKey: 1 } } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { matched: 1, modified: 1 } });
        expect((await storedOf(task._id)).deletedStatusKey).toBe(1);
    });

    it.each([
        ['an extra field inside $set', { $set: { deletedStatusKey: 8, TaskName: 'Renamed in bulk' } }],
        ['a dotted path', { 'deletedStatusKey.x': 8 }],
        ['another update operator', { $inc: { deletedStatusKey: 8 } }],
        ['an operator as the value', { $set: { deletedStatusKey: { $max: 8 } } }],
    ])('refuses %s with 400 and changes no task', async (label, updateObject) => {
        const { project, task } = await projectWithTask();
        const before = await storedOf(task._id);
        const res = await bulk(project, { findObject: { deletedStatusKey: 0 }, updateObject });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
        expect(await storedOf(task._id)).toEqual(before);
    });

    it('refuses a filter operator outside the status key and changes no task', async () => {
        const { project, task } = await projectWithTask();
        const before = await storedOf(task._id);
        const res = await bulk(project, { findObject: { $or: [{ deletedStatusKey: 0 }] }, updateObject: { deletedStatusKey: 8 } });
        expect(res.status).toBe(400);
        expect(await storedOf(task._id)).toEqual(before);
    });
});
