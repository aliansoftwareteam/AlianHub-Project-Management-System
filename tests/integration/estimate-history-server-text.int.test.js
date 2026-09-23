const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 80: estimate history and notification text is built on the server. Every read is scoped to a task this suite created. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML = '<img src=x onerror=alert(1)>';
const DAY = '2026-10-01T00:00:00.000Z';

jest.setTimeout(60000);

let client;
let owner;
let member;
let project;

const db = () => client.db(state.companyId);
const stored = (taskId) => db().collection('tasks').findOne({ _id: new ObjectId(String(taskId)) });
const historyOf = (taskId, key) => db().collection('history').find({ TaskId: String(taskId), Key: key }).toArray();
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
const rowsOf = (read, what) => waitFor(async () => { const rows = await read(); return rows.length ? rows : null; }, what);

const freshTask = async () => {
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    await waitFor(async () => {
        const doc = await stored(task._id);
        return doc && doc.TaskKey !== '--' ? doc : null;
    }, 'the task key');
    return stored(task._id);
};

const nameOf = async (uid) => (await client.db('global').collection('users').findOne({ _id: new ObjectId(String(uid)) })).Employee_Name;

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `FU80 estimates ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a planned estimate', () => {
    it('stores the history and notification text the server builds, naming the signed-in user', async () => {
        const task = await freshTask();
        const res = await member.api.put('/api/v1/estimatedTime', {
            userId: member.uid,
            taskId: String(task._id),
            projectId: String(project._id),
            date: DAY,
            minutes: 90,
            timeZone: 'UTC',
            message: `<p>${HTML}</p>`,
            historyObj: { key: 'Task_Due_Date', message: HTML },
            userData: { id: owner.uid, Employee_Name: HTML },
        });
        expect(res.status).toBe(200);
        expect(res.body.EstimatedTime).toBe(90);

        const memberName = await nameOf(member.uid);
        const [row] = await rowsOf(() => historyOf(task._id, 'Task_Due_Date'), 'the planned estimate history row');
        expect(row.UserId).toBe(member.uid);
        expect(row.Message).toBe(`<b>${memberName}</b> has added <b>hrs(01:30)</b> <b>estimated time</b> for<b> 01/10/2026</b>.`);

        const [notice] = await rowsOf(() => noticesOf(task._id, 'task_estimated_hours'), 'the planned estimate notification');
        expect(notice.message).toContain(`<strong>${memberName}</strong> Added <strong>01:30 hrs (01/10/2026)</strong> Estimated hours in <strong>${task.TaskName}</strong> task`);
        expect(notice.message).not.toMatch(/img|onerror/);
    });

    it('is not written a second time by the generic history route', async () => {
        const task = await freshTask();
        const res = await member.api.post('/api/v1/handleHistory', {
            type: 'task',
            companyId: state.companyId,
            projectId: String(project._id),
            taskId: String(task._id),
            object: { sprintId: task.sprintId, key: 'Task_Due_Date', message: `<b>${HTML}</b>` },
            userData: { id: member.uid, Employee_Name: 'Max Member', companyOwnerId: owner.uid },
        });
        expect([res.status, res.body.status]).toEqual([200, true]);
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(await historyOf(task._id, 'Task_Due_Date')).toEqual([]);
    });
});

describe('a total estimate change', () => {
    it('names the estimate the task held, not the one the request sends', async () => {
        const task = await freshTask();
        const change = (totalEstimatedTime, obj) => owner.api.patch('/api/v2/tasks', {
            action: 'updateTaskTotalEstimate',
            firebaseObj: { totalEstimatedTime },
            projectData: { _id: String(project._id), CompanyId: state.companyId },
            taskData: { _id: String(task._id), sprintId: task.sprintId },
            obj,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner', companyOwnerId: owner.uid },
        });

        const first = await change(120, { previousEstimatedTime: 999 });
        expect([first.status, first.body.status]).toEqual([200, true]);
        await rowsOf(() => historyOf(task._id, 'task_total_estimate'), 'the first estimate history row');

        const second = await change(180, { previousEstimatedTime: HTML, reason: 'Scope grew' });
        expect([second.status, second.body.status]).toEqual([200, true]);
        const rows = await waitFor(async () => { const found = await historyOf(task._id, 'task_total_estimate'); return found.length === 2 ? found : null; }, 'the second estimate history row');

        const ownerName = await nameOf(owner.uid);
        expect(rows.map((row) => row.Message).sort()).toEqual([
            `<b>${ownerName}</b> has updated total estimated time from <b>00h 00m</b> to <b>02h 00m</b>.`,
            `<b>${ownerName}</b> has updated total estimated time from <b>02h 00m</b> to <b>03h 00m</b>. <b>Reason:</b> Scope grew`,
        ].sort());
        expect((await stored(task._id)).estimateChangedFlag).toBe(true);
    });
});
