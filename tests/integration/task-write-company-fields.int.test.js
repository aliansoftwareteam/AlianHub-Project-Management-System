const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { assertOk, createProject, createTask, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Sprint 8 slice 3b. Browser sessions with the workspace in the default `off` mode, where no permission refusal applies. */

const state = readState();
const SECOND_COMPANY = crypto.randomBytes(12).toString('hex');
const DEADLINE_MS = 10000;

let client;
let owner;
let member;

const tasksOf = (companyId) => client.db(companyId).collection('tasks');
const stored = (taskId, companyId = state.companyId) => tasksOf(companyId).findOne({ _id: new ObjectId(String(taskId)) });

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

const userData = (user) => ({ id: user.uid, Employee_Name: 'Max Member', companyOwnerId: owner.uid });
const projectSlice = (project, companyId = state.companyId) => ({ _id: project._id, CompanyId: companyId, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode });

/* The bodies TaskOperations sends for these actions. */
const priorityBody = ({ project, task }, firebaseObj, { companyId, taskId = task._id } = {}) => ({
    action: 'updatePriority',
    firebaseObj,
    projectData: projectSlice(project, companyId),
    taskData: { _id: taskId, sprintId: task.sprintId, ProjectID: project._id },
    priorityObj: { taskId, taskName: 'task', priorityName: 'MEDIUM', newPriorityName: firebaseObj.Task_Priority },
    isUpdateTask: true,
    userData: userData(member),
});

const startDateBody = ({ project, task }, firebaseObj) => ({
    action: 'updateStartDate',
    commonDateFormatString: 'DD/MM/YYYY',
    firebaseObj,
    project: projectSlice(project),
    task: { _id: task._id, sprintId: task.sprintId },
    obj: {},
    isUpdateTask: true,
    userData: userData(member),
});

const watcherBody = ({ project, task }, { companyId = state.companyId, taskId = task._id } = {}) => ({
    action: 'updateWatcher', companyId, projectId: project._id, sprintId: task.sprintId, taskId, userId: member.uid, add: true, userData: userData(member), employeeName: 'Max Member',
});

const setWorkspaceMode = (mode) => client.db('global').collection('companies').updateOne(
    { _id: new ObjectId(state.companyId) },
    mode ? { $set: { permissionEnforcement: { mode } } } : { $unset: { permissionEnforcement: '' } },
);

let target;

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    await setWorkspaceMode(null);
    owner = await loginAs('owner');
    member = await loginAs('member');
    const project = await createProject(owner.api, { name: `TWF ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const other = await createProject(owner.api, { name: `TWF Other ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    await waitFor(async () => {
        const doc = await stored(task._id);
        return doc && doc.TaskKey !== '--' && doc.groupByStatusIndex !== undefined;
    }, 'the task key');
    target = { project, other, task };
});

afterAll(async () => {
    if (!client) return;
    await client.db(SECOND_COMPANY).dropDatabase();
    await client.close();
});

describe('a browser session with enforcement off', () => {
    it('cannot move a task to another project through a non-move action', async () => {
        const before = await stored(target.task._id);

        const priority = await member.api.patch('/api/v2/tasks', priorityBody(target, { Task_Priority: 'HIGH', ProjectID: target.other._id }));
        const operator = await member.api.patch('/api/v2/tasks', startDateBody(target, { $set: { ProjectID: target.other._id } }));
        const dotted = await member.api.patch('/api/v2/tasks', priorityBody(target, { Task_Priority: 'HIGH', 'sprintArray.id': 'elsewhere' }));

        expect([priority.status, operator.status, dotted.status]).toEqual([400, 400, 400]);
        expect([priority.body.status, operator.body.status, dotted.body.status]).toEqual([false, false, false]);
        expect(await stored(target.task._id)).toEqual(before);
    });

    it('cannot write into a second company by naming it in the body', async () => {
        const foreignTask = new ObjectId();
        await tasksOf(SECOND_COMPANY).insertOne({ _id: foreignTask, TaskName: 'Foreign', Task_Priority: 'LOW', watchers: [], ProjectID: new ObjectId(target.project._id) });

        const priority = await member.api.patch('/api/v2/tasks', priorityBody(target, { Task_Priority: 'HIGH' }, { companyId: SECOND_COMPANY, taskId: String(foreignTask) }));
        const watcher = await member.api.patch('/api/v2/tasks', watcherBody(target, { companyId: SECOND_COMPANY, taskId: String(foreignTask) }));

        expect(priority.body.status).toBe(false);
        expect(watcher.status).toBe(404);
        expect(await tasksOf(SECOND_COMPANY).findOne({ _id: foreignTask })).toMatchObject({ Task_Priority: 'LOW', watchers: [] });
        expect(await stored(foreignTask)).toBeNull();
    });

    it('writes a body that names a second company into the company the request was sent for', async () => {
        const res = await member.api.patch('/api/v2/tasks', priorityBody(target, { Task_Priority: 'LOW' }, { companyId: SECOND_COMPANY }));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect((await stored(target.task._id)).Task_Priority).toBe('LOW');
        expect(await tasksOf(SECOND_COMPANY).countDocuments({ _id: new ObjectId(target.task._id) })).toBe(0);
    });

    it.each(['updateWatcher', 'updateTags', 'updateAttachments'])('cannot create a stub task through %s', async (action) => {
        const missing = String(new ObjectId());
        const bodies = {
            updateWatcher: watcherBody(target, { taskId: missing }),
            updateTags: { action, companyId: state.companyId, projectId: target.project._id, sprintId: target.task.sprintId, taskId: missing, tagId: 'tag-1', operation: 'add' },
            updateAttachments: {
                action, companyId: state.companyId, sprintId: target.task.sprintId, taskId: missing, taskData: { _id: missing, TaskName: 'gone', sprintId: target.task.sprintId, attachments: [] },
                id: '', operation: 'add', data: { id: 'a1', filename: 'a.txt' }, userData: { id: member.uid, name: 'Max' }, projectData: { id: target.project._id, ProjectName: target.project.ProjectName },
            },
        };
        const res = await member.api.patch('/api/v2/tasks', bodies[action]);
        expect(res.status).toBe(404);
        expect(res.body.status).toBe(false);
        expect(await stored(missing)).toBeNull();
    });
});

describe('the web app task flows still work', () => {
    let flow;

    beforeAll(async () => {
        const project = await createProject(owner.api, { name: `TWF Flow ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
        const sprint = await firstSprint(owner.api, project._id);
        const second = assertOk(await owner.api.post('/api/v1/sprint', {
            companyId: state.companyId, projectId: project._id, projectName: project.ProjectName, sprintName: `TWF Second ${uniqueSuffix()}`, userData: userData(owner), folder: {},
        }), 'create sprint').data;
        flow = { project, sprint, second };
    });

    it('creates a task in the company the request was sent for, with its key assigned', async () => {
        const task = await createTask(member.api, { project: flow.project, user: state.users.member, companyOwnerId: owner.uid });
        const row = await waitFor(async () => {
            const doc = await stored(task._id);
            return doc && doc.TaskKey !== '--' ? doc : null;
        }, 'the task key');
        expect(String(row.CompanyId)).toBe(state.companyId);
        expect(String(row.ProjectID)).toBe(flow.project._id);
        expect(row.TaskKey).toMatch(new RegExp(`^${flow.project.ProjectCode}-\\d+$`));
    });

    it('edits a task: name, status, due date, watcher, tag', async () => {
        const task = await createTask(owner.api, { project: flow.project, user: state.users.owner, companyOwnerId: owner.uid });
        const status = flow.project.taskStatusData.find((s) => s.type === 'close') || flow.project.taskStatusData[0];
        const due = new Date(Date.now() + 86400000).toISOString();
        const calls = [
            { action: 'updateTaskName', firebaseObj: { TaskName: 'TWF renamed' }, projectData: projectSlice(flow.project), taskData: { _id: task._id, sprintId: task.sprintId, TaskName: 'before' }, obj: { previousTaskName: 'before', userName: 'Max' }, userData: userData(member) },
            { action: 'updateStatus', newStatus: { status: { text: status.name, key: status.key, value: status.value, type: status.type }, statusKey: status.key, statusType: status.type }, prevStatus: { taskId: task._id, taskName: 'TWF renamed', statusName: 'To Do', updatedTaskName: status.name }, projectData: projectSlice(flow.project), task: { _id: task._id, sprintId: task.sprintId }, isUpdateTask: true, userData: userData(member) },
            { action: 'updateDueDate', commonDateFormatString: 'DD/MM/YYYY', firebaseObj: { DueDate: due, dueDateDeadLine: [{ date: due }] }, project: projectSlice(flow.project), task: { _id: task._id, sprintId: task.sprintId }, obj: {}, isUpdateTask: true, userData: userData(member) },
            watcherBody({ project: flow.project, task }),
            { action: 'updateTags', companyId: state.companyId, projectId: flow.project._id, sprintId: task.sprintId, taskId: task._id, tagId: 'twf-tag', operation: 'add' },
        ];
        for (const body of calls) {
            const res = await member.api.patch('/api/v2/tasks', body);
            expect([body.action, res.status, res.body.status]).toEqual([body.action, 200, true]);
        }
        const row = await stored(task._id);
        expect(row).toMatchObject({ TaskName: 'TWF renamed', statusKey: status.key, tagsArray: ['twf-tag'] });
        expect(row.watchers).toContain(member.uid);
        expect(new Date(row.DueDate).toISOString()).toBe(due);
        expect(String(row.ProjectID)).toBe(flow.project._id);
    });

    it('moves a task to another sprint', async () => {
        const task = await createTask(owner.api, { project: flow.project, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'moveTask',
            companyId: state.companyId,
            projectData: { id: flow.project._id, ProjectCode: flow.project.ProjectCode, ProjectName: flow.project.ProjectName },
            sprintObj: { id: String(flow.second._id), name: flow.second.name, folderId: null },
            moveTaskId: task._id,
            oldSprintObj: { id: task.sprintId, folderId: null, name: flow.sprint.name, folderName: '' },
            oldProject: { id: flow.project._id, taskTypeCounts: flow.project.taskTypeCounts, taskStatusData: flow.project.taskStatusData },
            isSubTask: false,
            assignee: [],
            watcher: [],
            userData: userData(member),
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        const row = await waitFor(async () => {
            const doc = await stored(task._id);
            return doc && String(doc.sprintId) === String(flow.second._id) && doc.deletedStatusKey === 0 ? doc : null;
        }, 'the move');
        expect(String(row.ProjectID)).toBe(flow.project._id);
    });

    it('archives and restores a task', async () => {
        const task = await createTask(owner.api, { project: flow.project, user: state.users.owner, companyOwnerId: owner.uid });
        const body = (deletedStatusKey, current) => ({
            action: 'updateArchiveDelete', companyId: state.companyId, projectData: projectSlice(flow.project), sprintId: task.sprintId,
            task: { _id: task._id, ProjectID: flow.project._id, sprintId: task.sprintId, deletedStatusKey: current, isParentTask: true, subTasks: 0, sprintArray: { id: task.sprintId, name: flow.sprint.name } },
            userData: userData(member), deletedStatusKey,
        });
        const archived = await member.api.patch('/api/v2/tasks', body(2, 0));
        expect([archived.status, archived.body.status, (await stored(task._id)).deletedStatusKey]).toEqual([200, true, 2]);
        const restored = await member.api.patch('/api/v2/tasks', body(0, 2));
        expect([restored.status, restored.body.status, (await stored(task._id)).deletedStatusKey]).toEqual([200, true, 0]);
    });

    it('runs the bulk bar actions', async () => {
        const one = await createTask(owner.api, { project: flow.project, user: state.users.owner, companyOwnerId: owner.uid });
        const two = await createTask(owner.api, { project: flow.project, user: state.users.owner, companyOwnerId: owner.uid });
        const taskIds = [one._id, two._id];

        const priority = await member.api.post('/api/v2/tasks/bulk', { action: 'bulkUpdatePriority', taskIds, userData: userData(member), firebaseObj: { Task_Priority: 'HIGH' }, priorityObj: { priorityName: 'Medium', newPriorityName: 'High' } });
        expect(priority.body).toMatchObject({ status: true, data: { totals: { updated: 2 } } });
        const archive = await member.api.post('/api/v2/tasks/bulk', { action: 'bulkArchive', taskIds, userData: userData(member) });
        expect(archive.body).toMatchObject({ status: true, data: { totals: { updated: 2 } } });

        for (const id of taskIds) expect(await stored(id)).toMatchObject({ Task_Priority: 'HIGH', deletedStatusKey: 2 });
    });
});
