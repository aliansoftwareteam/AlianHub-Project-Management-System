const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

let client;
let owner;

const db = () => client.db(state.companyId);
const taskOf = (id) => db().collection('tasks').findOne({ _id: new ObjectId(id) }, { projection: { deletedStatusKey: 1, trashedWithProject: 1 } });
const projectOf = (id) => db().collection('projects').findOne({ _id: new ObjectId(id) }, { projection: { status: 1, statusType: 1, deletedStatusKey: 1, statusBeforeClose: 1, trashedFromKey: 1 } });
const putAway = (id, deletedStatusKey) => db().collection('tasks').updateOne({ _id: new ObjectId(id) }, { $set: { deletedStatusKey } });
const update = async (project, updateObject) => {
    const res = await owner.api.put(`/api/v1/project/${project._id}`, { updateObject });
    expect(res.status).toBe(200);
};
const keys = async (...tasks) => Promise.all(tasks.map(async (task) => (await taskOf(task._id)).deletedStatusKey));

async function projectWithTasks(count) {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    const tasks = [];
    for (let i = 0; i < count; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        tasks.push(await createTask(owner.api, { project, name: `Lifecycle ${uniqueSuffix()}`, user: owner, companyOwnerId: owner.uid }));
    }
    return { project, tasks };
}

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a project and its tasks come back exactly as they were', () => {
    it('archive and restore leave a task archived on its own where it was', async () => {
        const { project, tasks: [live, alone] } = await projectWithTasks(2);
        await putAway(alone._id, 2);

        await update(project, { deletedStatusKey: 2 });
        expect(await keys(live, alone)).toEqual([7, 2]);

        await update(project, { deletedStatusKey: 0 });
        expect(await keys(live, alone)).toEqual([0, 2]);
    });

    it('a closed project archived and restored is closed again, and reopens to the status it had', async () => {
        const { project, tasks: [live] } = await projectWithTasks(1);
        const before = await projectOf(project._id);

        await update(project, { status: 'close', statusType: 'close' });
        expect(await keys(live)).toEqual([8]);
        expect((await projectOf(project._id)).statusBeforeClose).toBe(before.status);

        await update(project, { deletedStatusKey: 2 });
        expect(await keys(live)).toEqual([7]);
        await update(project, { deletedStatusKey: 0 });
        expect(await keys(live)).toEqual([8]);
        expect((await projectOf(project._id)).statusType).toBe('close');

        await update(project, { status: before.status, statusType: before.statusType });
        expect(await keys(live)).toEqual([0]);
        expect((await projectOf(project._id)).statusBeforeClose).toBeNull();
    });

    it('an archived project deleted and restored from the trash is archived again; a task deleted before it stays in the trash', async () => {
        const { project, tasks: [live, alone] } = await projectWithTasks(2);
        await putAway(alone._id, 1);

        await update(project, { deletedStatusKey: 2 });
        await update(project, { deletedStatusKey: 1 });
        expect(await taskOf(live._id)).toMatchObject({ deletedStatusKey: 1, trashedWithProject: true });
        expect((await taskOf(alone._id)).trashedWithProject).toBeUndefined();
        expect((await projectOf(project._id)).trashedFromKey).toBe(2);

        const res = await owner.api.put(`/api/v2/trash/projects/${project._id}/restore`, {});
        expect(res.status).toBe(200);
        expect(await projectOf(project._id)).toMatchObject({ deletedStatusKey: 2, trashedFromKey: null });
        expect(await taskOf(live._id)).toEqual({ _id: new ObjectId(live._id), deletedStatusKey: 7 });
        expect(await keys(alone)).toEqual([1]);
    });
});
