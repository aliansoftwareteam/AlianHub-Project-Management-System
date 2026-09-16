const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const MEMBER_ROLE = 3;

let client;
let owner;
let member;
let memberApi;

async function tokenClientFor(session) {
    const res = await session.api.post('/api/v2/api-tokens', { name: `Permission parity ${uniqueSuffix()}`, scopes: ['read', 'write'] });
    if (!res.body || res.body.status !== true) throw new Error(`token for ${session.email} failed: ${JSON.stringify(res.body)}`);
    return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
}

/* A project with its own rules, where the member's entry on each named key is None. */
async function projectWithOwnRules(noneKeys) {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const imported = await owner.api.post('/api/v1/importSettingsProjectFunction', { companyId: state.companyId, type: 'project', projectId: project._id });
    expect(imported.body.status).toBe(true);
    expect((await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { isGlobalPermission: false } })).status).toBe(200);
    const rules = (await owner.api.get(`/api/v1/projectRules/${project._id}`)).body;
    for (const key of noneKeys) {
        const rule = rules.find((r) => r.key === key);
        const roles = [...rule.roles.filter((r) => r.key !== MEMBER_ROLE), { key: MEMBER_ROLE, permission: null }];
        expect((await owner.api.put('/api/v1/projectRules/update', { updateObject: { roles }, key: '$set', id: rule._id, projectId: project._id })).status).toBe(200);
    }
    return project;
}

const storedFlag = (projectId, update) => client.db(state.companyId).collection('projects').updateOne({ _id: new ObjectId(projectId) }, update);

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    member = await loginAs('member');
    memberApi = await tokenClientFor(member);
});

afterAll(async () => {
    if (client) await client.close();
});

describe('the API-token guards after the evaluator parity change', () => {
    it('still judges a project with no stored flag on the company rules', async () => {
        const project = await projectWithOwnRules(['task_create']);
        await storedFlag(project._id, { $unset: { isGlobalPermission: '' } });
        await expect(createTask(memberApi, { project, user: member, companyOwnerId: owner.uid })).resolves.toMatchObject({ projectId: project._id });
    });

    it('still judges a project whose stored flag is null on the company rules (known difference)', async () => {
        const project = await projectWithOwnRules(['task_create']);
        await storedFlag(project._id, { $set: { isGlobalPermission: null } });
        await expect(createTask(memberApi, { project, user: member, companyOwnerId: owner.uid })).resolves.toMatchObject({ projectId: project._id });
    });

    it('still lets through a web-app shaped body the old lookup judged on the company rules (known difference)', async () => {
        const project = await projectWithOwnRules([]);
        const task = await createTask(owner.api, { project, user: owner, companyOwnerId: owner.uid });
        const rules = (await owner.api.get(`/api/v1/projectRules/${project._id}`)).body;
        const rule = rules.find((r) => r.key === 'task_description');
        const roles = [...rule.roles.filter((r) => r.key !== MEMBER_ROLE), { key: MEMBER_ROLE, permission: null }];
        expect((await owner.api.put('/api/v1/projectRules/update', { updateObject: { roles }, key: '$set', id: rule._id, projectId: project._id })).status).toBe(200);

        const res = await memberApi.patch('/api/v2/tasks', {
            action: 'updateDescription',
            companyId: state.companyId,
            projectData: { _id: project._id, CompanyId: state.companyId },
            sprintId: task.sprintId,
            task: { _id: task._id },
            text: { blocks: [], text: 'Parity' },
        });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('still refuses the taskData shape in a project whose own rules say None', async () => {
        const project = await projectWithOwnRules(['task_priority']);
        const task = await createTask(owner.api, { project, user: owner, companyOwnerId: owner.uid });
        const res = await memberApi.patch('/api/v2/tasks', {
            action: 'updatePriority',
            firebaseObj: { Task_Priority: 'HIGH' },
            projectData: { _id: project._id, CompanyId: state.companyId },
            taskData: { _id: task._id, sprintId: task.sprintId },
            priorityObj: {},
            isUpdateTask: true,
        });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, permission: 'task.task_priority' });
    });
});
