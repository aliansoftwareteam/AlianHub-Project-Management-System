const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Writes that name people accept only active members of the verified company. The outsider has a live seat in a
 * second company; the invitee's seat here is still pending. Neither may be named, and nothing shows their names. */

const state = readState();
const SECOND_COMPANY = crypto.randomBytes(12).toString('hex');
const OUTSIDER = new ObjectId().toHexString();
const INVITEE = new ObjectId().toHexString();
const FORMER = new ObjectId().toHexString();
const OUTSIDER_NAME = `Otto Outsider ${uniqueSuffix()}`;
const INVITEE_NAME = `Ivy Invitee ${uniqueSuffix()}`;
const DEADLINE_MS = 10000;

let client;
let owner;
let member;
let project;
let task;

const db = () => client.db(state.companyId);
const storedTask = (id) => db().collection('tasks').findOne({ _id: new ObjectId(String(id)) });

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

const projectSlice = () => ({ _id: project._id, CompanyId: state.companyId, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode });
const userData = () => ({ id: owner.uid, Employee_Name: 'Olivia Owner' });

const assigneeBody = (AssigneeUserId, type) => ({
    action: 'updateAssignee', firebaseObj: { AssigneeUserId }, projectData: projectSlice(),
    taskData: { _id: task._id, TaskName: 'T', sprintId: task.sprintId, folderObjId: '', AssigneeUserId: [] },
    employeeName: 'Someone', type, isUpdateTask: true, userData: userData(),
});

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    await client.db('global').collection('users').insertMany([
        { _id: new ObjectId(OUTSIDER), Employee_Name: OUTSIDER_NAME, Employee_Email: `otto.${uniqueSuffix()}@outside.test` },
        { _id: new ObjectId(INVITEE), Employee_Name: INVITEE_NAME, Employee_Email: `ivy.${uniqueSuffix()}@invited.test` },
    ]);
    await client.db(SECOND_COMPANY).collection('company_users').insertOne({
        companyId: SECOND_COMPANY, userId: OUTSIDER, userEmail: 'otto@outside.test', roleType: 3, designation: 0, status: 2, isDelete: false,
    });
    await db().collection('company_users').insertOne({
        companyId: state.companyId, userId: INVITEE, userEmail: 'ivy@invited.test', roleType: 3, designation: 0, status: 1, isDelete: false,
    });
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `NPC ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    await waitFor(async () => {
        const doc = await storedTask(task._id);
        return doc && doc.TaskKey !== '--' && doc.groupByStatusIndex !== undefined;
    }, 'the task key');
});

afterAll(async () => {
    if (!client) return;
    await client.db('global').collection('users').deleteMany({ _id: { $in: [new ObjectId(OUTSIDER), new ObjectId(INVITEE)] } });
    await db().collection('company_users').deleteMany({ userId: INVITEE });
    await db().collection('pto_entries').deleteMany({ userId: { $in: [OUTSIDER, INVITEE, member.uid] } });
    await db().collection('timesheet_approval').deleteMany({ userId: { $in: [OUTSIDER, INVITEE, member.uid] } });
    await client.db(SECOND_COMPANY).dropDatabase();
    await client.close();
});

describe('time off', () => {
    const ptoFor = (userId) => ({ userId, type: 'casual', status: 'approved', startDate: '2019-02-04', endDate: '2019-02-05', reason: 'probe' });

    it.each([['another company\'s user', () => OUTSIDER], ['a pending invitee', () => INVITEE], ['an id nobody holds', () => FORMER]])(
        'refuses an entry for %s and never shows their name',
        async (_, who) => {
            const res = await owner.api.post('/api/v1/pto', ptoFor(who()));
            expect([res.status, res.body.status]).toEqual([400, false]);
            expect(await db().collection('pto_entries').countDocuments({ userId: who() })).toBe(0);
            const list = await owner.api.get('/api/v1/pto', { query: { pageSize: 50 } });
            expect(JSON.stringify(list.body)).not.toContain(OUTSIDER_NAME);
            expect(JSON.stringify(list.body)).not.toContain(INVITEE_NAME);
        },
    );

    it('still records an entry for a member of the company', async () => {
        const res = await owner.api.post('/api/v1/pto', ptoFor(member.uid));
        expect([res.status, res.body.status]).toEqual([201, true]);
        expect(res.body.data.userId).toBe(member.uid);
    });
});

describe('timesheet approval', () => {
    const period = { periodStart: '2019-03-04', periodEnd: '2019-03-10', periodType: 'week' };

    it.each([['another company\'s user', () => OUTSIDER], ['a pending invitee', () => INVITEE]])(
        'refuses a submission for %s and the queue never shows their name',
        async (_, who) => {
            const res = await owner.api.post('/api/v2/timesheet-approval/submit', { ...period, userId: who() });
            expect([res.status, res.body.status]).toEqual([400, false]);
            expect(await db().collection('timesheet_approval').countDocuments({ userId: who() })).toBe(0);
            const queue = await owner.api.get('/api/v2/timesheet-approval/queue');
            expect(JSON.stringify(queue.body)).not.toContain(OUTSIDER_NAME);
            expect(JSON.stringify(queue.body)).not.toContain(INVITEE_NAME);
        },
    );

    it('submits for a member and records the reviewer by the session, not the body', async () => {
        const submitted = await owner.api.post('/api/v2/timesheet-approval/submit', { ...period, userId: member.uid });
        expect([submitted.status, submitted.body.status]).toEqual([200, true]);
        const reviewed = await owner.api.post(`/api/v2/timesheet-approval/${submitted.body.data._id}/review`, {
            action: 'approve', userData: { id: owner.uid, name: OUTSIDER_NAME },
        });
        expect(reviewed.body.status).toBe(true);
        expect(reviewed.body.data.reviewedBy).toBe(owner.uid);
        expect(reviewed.body.data.reviewerName).not.toBe(OUTSIDER_NAME);
        expect(reviewed.body.data.reviewerName).toMatch(/Olivia/);
    });
});

describe('task people', () => {
    it('refuses adding another company\'s user as an assignee', async () => {
        const res = await owner.api.patch('/api/v2/tasks', assigneeBody(OUTSIDER, 'assigneeAdd'));
        expect([res.status, res.body.status]).toEqual([400, false]);
        expect((await storedTask(task._id)).AssigneeUserId.map(String)).not.toContain(OUTSIDER);
    });

    it('refuses a replacement list that brings in a pending invitee', async () => {
        const res = await owner.api.patch('/api/v2/tasks', assigneeBody([member.uid, INVITEE], 'replace'));
        expect([res.status, res.body.status]).toEqual([400, false]);
        expect((await storedTask(task._id)).AssigneeUserId.map(String)).not.toContain(INVITEE);
    });

    it('refuses another company\'s user as a watcher or as the task leader', async () => {
        const watcher = await owner.api.patch('/api/v2/tasks', {
            action: 'updateWatcher', companyId: state.companyId, projectId: project._id, sprintId: task.sprintId, taskId: task._id,
            userId: OUTSIDER, add: true, userData: userData(), employeeName: 'Someone',
        });
        const leader = await owner.api.patch('/api/v2/tasks', {
            action: 'updateTaskLeader', firebaseObj: { Task_Leader: OUTSIDER }, projectData: projectSlice(),
            taskData: { _id: task._id, sprintId: task.sprintId }, employeeName: 'Someone', isUpdateTask: true, userData: userData(),
        });
        expect([watcher.status, watcher.body.status]).toEqual([400, false]);
        expect([leader.status, leader.body.status]).toEqual([400, false]);
        const doc = await storedTask(task._id);
        expect((doc.watchers || []).map(String)).not.toContain(OUTSIDER);
        expect(String(doc.Task_Leader)).not.toBe(OUTSIDER);
    });

    it('refuses a bulk assignment of another company\'s user', async () => {
        const res = await owner.api.post('/api/v2/tasks/bulk', {
            action: 'bulkUpdateAssignee', companyId: state.companyId, taskIds: [task._id], employeeName: 'Someone', employeeId: [OUTSIDER], type: 'assigneeAdd', userData: userData(),
        });
        expect([res.status, res.body.status]).toEqual([400, false]);
        expect((await storedTask(task._id)).AssigneeUserId.map(String)).not.toContain(OUTSIDER);
    });

    it('refuses a new task assigned to another company\'s user', async () => {
        const name = `NPC outsider ${uniqueSuffix()}`;
        await expect(createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [OUTSIDER] })).rejects.toThrow(/\(400\)/);
        expect(await db().collection('tasks').countDocuments({ TaskName: name })).toBe(0);
    });

    it('still assigns a member, and keeps or removes someone already on the task', async () => {
        await db().collection('tasks').updateOne({ _id: new ObjectId(task._id) }, { $addToSet: { AssigneeUserId: FORMER } });

        const added = await owner.api.patch('/api/v2/tasks', assigneeBody(member.uid, 'assigneeAdd'));
        expect([added.status, added.body.status]).toEqual([200, true]);
        const kept = await owner.api.patch('/api/v2/tasks', assigneeBody([member.uid, FORMER], 'replace'));
        expect([kept.status, kept.body.status]).toEqual([200, true]);
        expect((await storedTask(task._id)).AssigneeUserId.map(String).sort()).toEqual([member.uid, FORMER].sort());
        const removed = await owner.api.patch('/api/v2/tasks', assigneeBody(FORMER, 'assigneRemove'));
        expect([removed.status, removed.body.status]).toEqual([200, true]);
        expect((await storedTask(task._id)).AssigneeUserId.map(String)).toEqual([member.uid]);
    });
});
