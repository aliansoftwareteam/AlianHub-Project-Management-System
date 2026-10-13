const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 80: history and notification text is built on the server from stored fields. Every read is scoped to a task this suite created. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML = '<img src=x onerror=alert(1)>';
const DUE = '2026-10-01T00:00:00.000Z';

let client;
let owner;
let member;
let project;

const db = () => client.db(state.companyId);
const stored = (taskId) => db().collection('tasks').findOne({ _id: new ObjectId(String(taskId)) });
const historyOf = (taskId) => db().collection('history').find({ TaskId: String(taskId) }).toArray();
const noticesOf = (taskId, key) => db().collection('notifications').find({ taskId: String(taskId), key }).toArray();

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

const memberUser = () => ({ id: member.uid, Employee_Name: 'Max Member', companyOwnerId: owner.uid });

const freshTask = async () => {
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    await waitFor(async () => {
        const doc = await stored(task._id);
        return doc && doc.TaskKey !== '--' ? doc : null;
    }, 'the task key');
    return stored(task._id);
};

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `FU80 ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a due date change', () => {
    it('stores the notification text the server builds, not the text the request sends', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateDueDate',
            commonDateFormatString: 'DD/MM/YYYY',
            timeZone: 'UTC',
            firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }] },
            project: { _id: project._id, CompanyId: state.companyId, ProjectName: HTML, ProjectCode: project.ProjectCode },
            task: { _id: String(task._id), sprintId: task.sprintId, TaskName: HTML },
            obj: { key: 'task_due_date', projectId: project._id, taskId: String(task._id), sprintId: task.sprintId, message: `<p>${HTML}</p>` },
            userData: memberUser(),
            isUpdateTask: true,
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        expect(new Date((await stored(task._id)).DueDate).toISOString()).toBe(DUE);

        const [notice] = await waitFor(async () => { const rows = await noticesOf(task._id, 'task_due_date'); return rows.length ? rows : null; }, 'the due date notification');
        expect(notice.message).toContain(`Due Date of <strong>${task.TaskName}</strong> is added as`);
        expect(notice.message).toContain(`In <strong>${project.ProjectName}</strong> Project`);
        expect(notice.message).toContain('>01/10/2026</span>');
        expect(notice.message).not.toMatch(/img|onerror/);
    });
});

describe('a task moved on the calendar', () => {
    it('stores the notification text the server builds and names both dates', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateStartDateAndDueDate',
            commonDateFormatString: 'DD/MM/YYYY',
            timeZone: 'UTC',
            userData: memberUser(),
            notificationObj: { key: 'task_due_date', projectId: project._id, taskId: String(task._id), sprintId: task.sprintId, message: `<p>${HTML}</p>` },
            firebaseObj: { DueDate: DUE, dueDateDeadLine: [{ date: DUE }], startDate: '2026-09-25T00:00:00.000Z' },
            task: { _id: String(task._id), sprintId: task.sprintId },
            project: { _id: project._id, CompanyId: state.companyId, ProjectName: HTML, ProjectCode: project.ProjectCode },
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        const saved = await stored(task._id);
        expect([new Date(saved.startDate).toISOString(), new Date(saved.DueDate).toISOString()]).toEqual(['2026-09-25T00:00:00.000Z', DUE]);

        const [notice] = await waitFor(async () => { const rows = await noticesOf(task._id, 'task_due_date'); return rows.length ? rows : null; }, 'the calendar move notification');
        expect(notice.message).toContain(`In <strong>${project.ProjectName}</strong> Project, Start Date of <strong>${task.TaskName}</strong> is added as`);
        expect(notice.message).toContain('>25/09/2026</span>');
        expect(notice.message).toContain('and Due Date is added as');
        expect(notice.message).toContain('>01/10/2026</span>');
        expect(notice.message).not.toMatch(/img|onerror/);
        const rows = await waitFor(async () => { const found = await historyOf(task._id); return found.some((row) => row.Key === 'Project_StartDate_DueDate') ? found : null; }, 'the calendar move history row');
        expect(rows.filter((row) => row.Key === 'Project_StartDate_DueDate')).toHaveLength(1);
    });
});

describe('a body without the task name', () => {
    it('still writes the history row with the stored name', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateTaskName',
            firebaseObj: { TaskName: 'FU80 renamed' },
            projectData: { _id: project._id, CompanyId: state.companyId },
            taskData: { _id: String(task._id), sprintId: task.sprintId },
            obj: {},
            userData: memberUser(),
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        const rows = await waitFor(async () => { const found = await historyOf(task._id); return found.some((row) => row.Key === 'task_name_edit') ? found : null; }, 'the rename history row');
        expect(rows.find((row) => row.Key === 'task_name_edit').Message).toContain(`from <b>${task.TaskName}</b> to <b>FU80 renamed</b>`);
    });
});

describe('a project name sent with markup', () => {
    it('is replaced by the stored name in the notification', async () => {
        const task = await freshTask();
        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updatePriority',
            firebaseObj: { Task_Priority: 'HIGH' },
            projectData: { _id: project._id, CompanyId: state.companyId, ProjectName: HTML },
            taskData: { _id: String(task._id), sprintId: task.sprintId },
            priorityObj: { priorityName: 'Medium', newPriorityName: 'High' },
            isUpdateTask: true,
            userData: memberUser(),
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        const [notice] = await waitFor(async () => { const rows = await noticesOf(task._id, 'task_priority'); return rows.length ? rows : null; }, 'the priority notification');
        expect(notice.message).toContain(`In <strong>${project.ProjectName}</strong> project`);
        expect(notice.message).not.toMatch(/img src=x|onerror/);
    });
});
