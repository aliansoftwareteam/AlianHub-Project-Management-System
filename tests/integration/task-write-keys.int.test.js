const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Sprint 8 slice 3. The harness server reads the workspace mode on every request (cache TTL 0). */

const state = readState();
const MEMBER_ROLE = 3;
const ROW_DEADLINE_MS = 10000;

let client;
let owner;
let member;
let memberToken;
let companies;
let decisions;

const setWorkspaceMode = (mode) => companies.updateOne(
    { _id: new ObjectId(state.companyId) },
    mode ? { $set: { permissionEnforcement: { mode } } } : { $unset: { permissionEnforcement: '' } },
);

const waitFor = async (read, what) => {
    const deadline = Date.now() + ROW_DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not appear within ${ROW_DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

async function tokenClientFor(session) {
    const res = await session.api.post('/api/v2/api-tokens', { name: `Task write keys ${uniqueSuffix()}`, scopes: ['read', 'write'] });
    if (!res.body || res.body.status !== true) throw new Error(`token for ${session.email} failed: ${JSON.stringify(res.body)}`);
    return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
}

/* A project with its own rules where the member's task rename and priority are None, and a task in it. */
async function taskWhereRenameIsNone() {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const imported = await owner.api.post('/api/v1/importSettingsProjectFunction', { companyId: state.companyId, type: 'project', projectId: project._id });
    expect(imported.body.status).toBe(true);
    expect((await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { isGlobalPermission: false } })).status).toBe(200);
    const rules = (await owner.api.get(`/api/v1/projectRules/${project._id}`)).body;
    for (const key of ['task_name_edit', 'task_priority']) {
        const rule = rules.find((r) => r.key === key);
        const roles = [...rule.roles.filter((r) => r.key !== MEMBER_ROLE), { key: MEMBER_ROLE, permission: null }];
        expect((await owner.api.put('/api/v1/projectRules/update', { updateObject: { roles }, key: '$set', id: rule._id, projectId: project._id })).status).toBe(200);
    }
    const task = await createTask(owner.api, { project, user: owner, companyOwnerId: owner.uid });
    return { project, task };
}

/* The body TaskDetailPanel.vue sends through TaskOperations updateTaskName. */
const rename = (api, { project, task }, name, { taskId = task._id, companyId = state.companyId } = {}) => api.patch('/api/v2/tasks', {
    action: 'updateTaskName',
    firebaseObj: { TaskName: name },
    projectData: { _id: project._id, CompanyId: companyId, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode },
    taskData: { _id: taskId, ProjectID: project._id, sprintId: task.sprintId, TaskName: 'before' },
    obj: { previousTaskName: 'before', userName: 'Member' },
    userData: { id: member.uid, Employee_Name: 'Member', companyOwnerId: owner.uid },
});

const OTHER_COMPANY = '0123456789abcdef01234567';

const storedName = async (taskId) => (await client.db(state.companyId).collection('tasks').findOne({ _id: new ObjectId(taskId) }, { projection: { TaskName: 1 } })).TaskName;

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    companies = client.db('global').collection('companies');
    decisions = client.db(state.companyId).collection('permission_decisions');
    owner = await loginAs('owner');
    member = await loginAs('member');
    memberToken = await tokenClientFor(member);
});

afterAll(async () => {
    if (companies) await setWorkspaceMode(null);
    if (client) await client.close();
});

describe('an API token without the key on a newly mapped task action', () => {
    let target;

    beforeAll(async () => {
        target = await taskWhereRenameIsNone();
    });

    afterAll(() => setWorkspaceMode(null));

    it('is allowed with the workspace off, as before this change', async () => {
        await setWorkspaceMode(null);
        const name = `off ${uniqueSuffix()}`;
        const res = await rename(memberToken, target, name);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(await storedName(target.task._id)).toBe(name);
        expect(await decisions.countDocuments({ permission: 'task.task_name_edit', scope: target.project._id })).toBe(0);
    });

    it('is allowed and recorded in report', async () => {
        await setWorkspaceMode('report');
        const name = `report ${uniqueSuffix()}`;
        const res = await rename(memberToken, target, name);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(await storedName(target.task._id)).toBe(name);
        // The user id is pushed in a second update after the row is upserted.
        const row = await waitFor(() => decisions.findOne({ mode: 'report', permission: 'task.task_name_edit', scope: target.project._id, userIds: member.uid }), 'a report row');
        expect(row).toMatchObject({ method: 'PATCH', route: '/api/v2/tasks', role: MEMBER_ROLE, reason: 'denied', userIds: [member.uid] });
    });

    it('is refused in enforce and the task keeps its name', async () => {
        await setWorkspaceMode('enforce');
        const before = await storedName(target.task._id);
        const res = await rename(memberToken, target, `enforce ${uniqueSuffix()}`);
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'Forbidden', permission: 'task.task_name_edit' });
        expect(await storedName(target.task._id)).toBe(before);
        await waitFor(() => decisions.findOne({ mode: 'enforce', permission: 'task.task_name_edit', scope: target.project._id }), 'an enforce row');
    });

    it('in enforce, still lets the owner through', async () => {
        await setWorkspaceMode('enforce');
        const name = `owner ${uniqueSuffix()}`;
        const res = await rename(owner.api, target, name);
        expect(res.status).toBe(200);
        expect(await storedName(target.task._id)).toBe(name);
    });
});

describe('what a task write body names is read the way the handlers read it', () => {
    let target;

    beforeAll(async () => {
        await setWorkspaceMode(null);
        target = await taskWhereRenameIsNone();
    });

    afterAll(() => setWorkspaceMode(null));

    it('refuses an API token whose body names another company, with the workspace off', async () => {
        const before = await storedName(target.task._id);
        const res = await rename(memberToken, target, `other company ${uniqueSuffix()}`, { companyId: OTHER_COMPANY });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'Forbidden' });
        expect(await storedName(target.task._id)).toBe(before);
    });

    it('refuses an API token whose task id is an operator, with the workspace off', async () => {
        const before = await storedName(target.task._id);
        const res = await rename(memberToken, target, `operator ${uniqueSuffix()}`, { taskId: { $in: [target.task._id] } });
        expect(res.status).toBe(403);
        expect(await storedName(target.task._id)).toBe(before);
    });

    it('judges an API token on a mapping from before this change by the task a { id } names', async () => {
        const res = await memberToken.patch('/api/v2/tasks', {
            action: 'updatePriority',
            firebaseObj: { Task_Priority: 'HIGH' },
            projectData: { _id: target.project._id, CompanyId: state.companyId },
            taskData: { _id: { id: target.task._id }, sprintId: target.task.sprintId },
            priorityObj: {},
            isUpdateTask: true,
        });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ permission: 'task.task_priority' });
    });

    it('records a browser session naming another company in report, and lets it through', async () => {
        await setWorkspaceMode('report');
        const res = await rename(owner.api, target, `session ${uniqueSuffix()}`, { companyId: OTHER_COMPANY });
        expect(res.status).toBe(200);
        await waitFor(() => decisions.findOne({ mode: 'report', reason: 'company_mismatch', route: '/api/v2/tasks', userIds: owner.uid }), 'a company_mismatch row');
    });
});

describe('the bulk task update keeps to the fields the web app sends', () => {
    let project;
    let task;

    const tasks = () => client.db(state.companyId).collection('tasks');
    const statusKeyOf = async (id) => (await tasks().findOne({ _id: new ObjectId(id) }, { projection: { deletedStatusKey: 1, TaskName: 1 } }));

    beforeAll(async () => {
        await setWorkspaceMode(null);
        project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        task = await createTask(owner.api, { project, name: `Bulk ${uniqueSuffix()}`, user: owner, companyOwnerId: owner.uid });
    });

    it('refuses an extra field with 400 and writes nothing', async () => {
        const res = await owner.api.put(`/api/v1/project/allTask/${project._id}`, { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 0, TaskName: 'Renamed in bulk' } });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
        expect(res.body.statusText).toContain('TaskName');
        expect((await statusKeyOf(task._id)).TaskName).not.toBe('Renamed in bulk');
    });

    it('still closes and reopens a project\'s tasks the way Item.vue does', async () => {
        const closed = await owner.api.put(`/api/v1/project/allTask/${project._id}`, { findObject: { deletedStatusKey: 0 }, updateObject: { deletedStatusKey: 8 } });
        expect(closed.status).toBe(200);
        expect((await statusKeyOf(task._id)).deletedStatusKey).toBe(8);
        const reopened = await owner.api.put(`/api/v1/project/allTask/${project._id}`, { findObject: { deletedStatusKey: 8 }, updateObject: { deletedStatusKey: 0 } });
        expect(reopened.status).toBe(200);
        expect((await statusKeyOf(task._id)).deletedStatusKey).toBe(0);
    });

    it('answers the delete cascade ProjectsListingSetting.vue sends as beta does', async () => {
        const res = await owner.api.put(`/api/v1/project/allTask/${project._id}`, { findObject: { deletedStatusKey: { $in: [0, null] } }, updateObject: { $set: { deletedStatusKey: 1 } } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, data: { matched: 1 } });
    });
});
