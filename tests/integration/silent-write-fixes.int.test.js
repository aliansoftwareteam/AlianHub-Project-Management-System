const { createProject, createTask, firstSprint, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(60000);

const MISSING_ID = '0123456789abcdef01234567';

async function projectWithTask(owner) {
    const project = await createProject(owner.api, { name: `SNW ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const task = await createTask(owner.api, { project, name: `SNW Task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
            return { project, task };
        } catch (err) {
            lastErr = err;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
    throw lastErr;
}

const readTask = async (owner, taskId) => {
    const body = (await owner.api.get(`/api/v1/task/${taskId}`)).body;
    return (body && body.data) || body;
};

const sprintNamed = async (owner, projectId, sprintId) => {
    const sprints = await listSprints(owner.api, projectId);
    return (sprints.find((sprint) => String(sprint._id) === String(sprintId)) || {}).name;
};

const closedStatus = (project) => project.taskStatusData.find((row) => row.type === 'close');

const statusPayload = (status) => ({
    status: { text: status.name, key: status.key, type: status.type },
    statusKey: status.key,
    statusType: status.type,
});

describe('sprint rename keys off the route, not the body', () => {
    it('SNW-01 renames the sprint in the URL when the body carries the read shape (_id, no id)', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `SNW Rename ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const sprint = await firstSprint(owner.api, project._id);
        const renamed = `SNW Renamed ${uniqueSuffix()}`;

        const res = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, {
            type: 'editSprintName',
            companyId: state.companyId,
            projectId: project._id,
            projectName: project.ProjectName,
            sprintName: renamed,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
            prevData: { _id: String(sprint._id), name: sprint.name },
        });

        expect(res.body.status).toBe(true);
        expect(await sprintNamed(owner, project._id, sprint._id)).toBe(renamed);
    });

    it('SNW-02 leaves another sprint alone when the body names it', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `SNW Decoy ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const target = await firstSprint(owner.api, project._id);
        const decoy = (await owner.api.post('/api/v1/sprint', {
            companyId: state.companyId,
            projectId: project._id,
            projectName: project.ProjectName,
            sprintName: `SNW Decoy sprint ${uniqueSuffix()}`,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        })).body.data;
        const renamed = `SNW Route wins ${uniqueSuffix()}`;

        await owner.api.patch(`/api/v1/sprint/${target._id}`, {
            type: 'editSprintName',
            companyId: state.companyId,
            projectId: project._id,
            projectName: project.ProjectName,
            sprintName: renamed,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
            prevData: { id: String(decoy._id), name: target.name },
        });

        expect(await sprintNamed(owner, project._id, target._id)).toBe(renamed);
        expect(await sprintNamed(owner, project._id, decoy._id)).not.toBe(renamed);
    });

    it('SNW-03 reports failure when the sprint does not exist', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `SNW Gone ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });

        const res = await owner.api.patch(`/api/v1/sprint/${MISSING_ID}`, {
            type: 'editSprintName',
            companyId: state.companyId,
            projectId: project._id,
            projectName: project.ProjectName,
            sprintName: `SNW Nowhere ${uniqueSuffix()}`,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
            prevData: { _id: MISSING_ID, name: 'gone' },
        });

        expect(res.body.status).toBe(false);
    });

    it('SNW-10 reports failure when updateSprint and updateFolder match nothing', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `SNW Ghost ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });

        const sprint = await owner.api.patch(`/api/v1/sprint/${MISSING_ID}`, {
            type: 'updateSprint',
            companyId: state.companyId,
            projectId: project._id,
            updateObject: { $set: { name: `SNW Ghost sprint ${uniqueSuffix()}` } },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        });
        expect(sprint.body.status).toBe(false);

        const folder = await owner.api.patch(`/api/v1/folder/${MISSING_ID}`, {
            type: 'editFolderName',
            companyId: state.companyId,
            projectId: project._id,
            projectName: project.ProjectName,
            folderName: `SNW Ghost folder ${uniqueSuffix()}`,
            prevFolderName: 'gone',
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        });
        expect(folder.body.status).toBe(false);
    });
});

describe('task status and priority key off the task, not a nested body field', () => {
    it('SNW-04 updateStatus writes when only the task is given', async () => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTask(owner);
        const done = closedStatus(project);

        const res = await owner.api.patch('/api/v2/tasks', {
            action: 'updateStatus',
            isUpdateTask: true,
            newStatus: statusPayload(done),
            prevStatus: { taskName: task.name, statusName: 'To Do', updatedTaskName: done.name },
            projectData: { _id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName },
            task: { _id: task._id, sprintId: task.sprintId },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        });

        expect(res.body.status).toBe(true);
        expect((await readTask(owner, task._id)).statusType).toBe(done.type);
    });

    it('SNW-05 updateStatus does not report success when no task matches', async () => {
        const owner = await loginAs('owner');
        const { project } = await projectWithTask(owner);
        const done = closedStatus(project);

        const res = await owner.api.patch('/api/v2/tasks', {
            action: 'updateStatus',
            isUpdateTask: true,
            newStatus: statusPayload(done),
            prevStatus: { taskName: 'gone', statusName: 'To Do', updatedTaskName: done.name },
            projectData: { _id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName },
            task: { _id: MISSING_ID },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        });

        expect(res.body.status).toBe(false);
    });

    it('SNW-06 updatePriority writes when only the task is given', async () => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTask(owner);

        const res = await owner.api.patch('/api/v2/tasks', {
            action: 'updatePriority',
            isUpdateTask: true,
            firebaseObj: { Task_Priority: 'HIGH' },
            priorityObj: { taskName: task.name, priorityName: 'MEDIUM', newPriorityName: 'HIGH' },
            projectData: { _id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName },
            taskData: { _id: task._id, sprintId: task.sprintId },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        });

        expect(res.body.status).toBe(true);
        expect((await readTask(owner, task._id)).Task_Priority).toBe('HIGH');
    });

    it('SNW-07 updatePriority does not report success when no task matches', async () => {
        const owner = await loginAs('owner');
        const { project } = await projectWithTask(owner);

        const res = await owner.api.patch('/api/v2/tasks', {
            action: 'updatePriority',
            isUpdateTask: true,
            firebaseObj: { Task_Priority: 'HIGH' },
            priorityObj: { taskName: 'gone', priorityName: 'MEDIUM', newPriorityName: 'HIGH' },
            projectData: { _id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName },
            taskData: { _id: MISSING_ID },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        });

        expect(res.body.status).toBe(false);
    });

    it('SNW-11 the other single-task helpers report a zero match too', async () => {
        const owner = await loginAs('owner');
        const { project } = await projectWithTask(owner);
        const projectData = { _id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName };
        const userData = { id: owner.uid, Employee_Name: 'Olivia Owner' };
        const gone = { _id: MISSING_ID, sprintId: MISSING_ID };

        const calls = [
            { action: 'updateDueDate', firebaseObj: { DueDate: new Date().toISOString(), dueDateDeadLine: [] }, project: projectData, task: gone, obj: {}, userData },
            { action: 'updatePoints', firebaseObj: { points: 5 }, projectData, taskData: gone, userData },
            { action: 'updateTaskName', firebaseObj: { TaskName: 'SNW ghost' }, projectData, taskData: gone, obj: { previousTaskName: 'gone' }, userData },
            { action: 'updateDates', firebaseObj: { startDate: new Date().toISOString() }, projectData, taskData: gone, userData },
        ];

        for (const body of calls) {
            const res = await owner.api.patch('/api/v2/tasks', body);
            expect([body.action, res.body.status]).toEqual([body.action, false]);
        }
    });
});

describe('bulk project task update answers with the response envelope', () => {
    it('SNW-08 reports how many tasks the update matched', async () => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTask(owner);

        const res = await owner.api.put(`/api/v1/project/allTask/${project._id}`, {
            findObject: { deletedStatusKey: 0 },
            updateObject: { Task_Priority: 'LOW' },
        });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        expect(res.body.statusText).toEqual(expect.any(String));
        expect(res.body.data.matched).toBeGreaterThan(0);
        expect((await readTask(owner, task._id)).Task_Priority).toBe('LOW');
    });

    it('SNW-09 reports a zero match instead of an empty body', async () => {
        const owner = await loginAs('owner');
        const { project } = await projectWithTask(owner);

        const res = await owner.api.put(`/api/v1/project/allTask/${project._id}`, {
            findObject: { TaskKey: `SNW-none-${uniqueSuffix()}` },
            updateObject: { Task_Priority: 'LOW' },
        });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data.matched).toBe(0);
    });
});
