const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const OTHER_COMPANY = new ObjectId().toHexString();

let client;
let owner;
let project;
let from;
let to;

const statusKeyOf = async (taskId) => {
    const task = await client.db(state.companyId).collection('tasks').findOne({ _id: new ObjectId(taskId) });
    return task && task.statusKey;
};

const convertBody = (overrides = {}) => ({
    companyId: owner.companyId,
    projectId: String(project._id),
    taskStatusKey: [from.key],
    oldTaskStatus: [{ key: from.key, convertStatus: { key: to.key, name: to.name, type: to.type } }],
    ...overrides,
});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    from = project.taskStatusData.find((x) => x.type === 'default_active');
    to = project.taskStatusData.find((x) => x.key !== from.key);
});

afterAll(async () => {
    if (client) await client.close();
});

describe('POST /api/v1/projectSetting/taskStatus takes the company from the verified request', () => {
    it('converts the tasks when the body names no company', async () => {
        const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
        const body = convertBody();
        delete body.companyId;
        const res = await owner.api.post('/api/v1/projectSetting/taskStatus', body);

        expect(res.body).toMatchObject({ status: true });
        expect(await statusKeyOf(task._id)).toBe(to.key);
    });

    it('still converts the tasks when the body names the header company', async () => {
        const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await owner.api.post('/api/v1/projectSetting/taskStatus', convertBody());

        expect(res.body).toMatchObject({ status: true });
        expect(await statusKeyOf(task._id)).toBe(to.key);
    });

    it('refuses a body naming another company and leaves the tasks alone', async () => {
        const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await owner.api.post('/api/v1/projectSetting/taskStatus', convertBody({ companyId: OTHER_COMPANY }));

        expect(res.status).toBe(403);
        expect(await statusKeyOf(task._id)).toBe(from.key);
    });
});
