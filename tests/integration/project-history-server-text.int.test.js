const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 111: project history and notification text is built on the server. Every read is scoped to a project this suite created. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML = '<img src=x onerror=alert(1)>';

jest.setTimeout(60000);

let client;
let owner;
let member;

const db = () => client.db(state.companyId);
const storedProject = (projectId) => db().collection('projects').findOne({ _id: new ObjectId(String(projectId)) });
const historyOf = (projectId, key) => db().collection('history').find({ ProjectId: String(projectId), Key: key }).toArray();
const noticesOf = (projectId, key) => db().collection('notifications').find({ projectId: String(projectId), key }).toArray();
const nameOf = async (uid) => (await client.db('global').collection('users').findOne({ _id: new ObjectId(String(uid)) })).Employee_Name;

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
const quiet = () => new Promise((resolve) => setTimeout(resolve, 500));

/* Project notices go to watchers and the owner, never to the person acting, so the member watches everything and the owner acts. */
const freshProject = async (label, assigneeIds = [owner.uid, member.uid]) => {
    const project = await createProject(owner.api, { name: `FU111 ${label} ${uniqueSuffix()}`, assigneeIds, createdBy: owner.uid });
    await db().collection('projects').updateOne({ _id: new ObjectId(String(project._id)) }, { $set: { [`watchers.${member.uid}`]: 'all_activity' } });
    return project;
};
const update = (session, projectId, body) => session.api.put(`/api/v1/project/${projectId}`, body);

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a new project', () => {
    it('is recorded once, by the server, naming the signed-in creator', async () => {
        const project = await freshProject('created');
        const ownerName = await nameOf(owner.uid);
        const rows = await rowsOf(() => historyOf(project._id, 'Project_Created'), 'the created row');
        expect(rows).toHaveLength(1);
        expect(rows[0].UserId).toBe(owner.uid);
        expect(rows[0].Message).toBe(`<b>${ownerName}</b> has created new as <b>${project.ProjectName}</b> project`);
    });
});

describe('a project rename', () => {
    it('stores the server text for the signed-in user, whatever the request carries', async () => {
        const project = await freshProject('rename');
        const res = await update(owner, project._id, {
            updateObject: { ProjectName: `Renamed ${HTML}` },
            historyObj: { key: 'Project_Name', message: HTML },
            userData: { id: member.uid, Employee_Name: HTML },
        });
        expect(res.status).toBe(200);

        const ownerName = await nameOf(owner.uid);
        const [row] = await rowsOf(() => historyOf(project._id, 'Project_Name'), 'the rename row');
        expect(row.UserId).toBe(owner.uid);
        expect(row.Message).toBe(`<b>${ownerName}</b> has changed the name of <b>${project.ProjectName}</b> to <b>Renamed &lt;img src=x onerror=alert&#40;1&#41;&gt;</b>`);
        const [notice] = await rowsOf(() => noticesOf(project._id, 'project_name'), 'the rename notice');
        expect([notice.receiverID, notice.userId]).toEqual([member.uid, owner.uid]);
        expect(notice.message).toBe(`<p>Project name is changed from <strong> ${project.ProjectName}</strong> to <strong> Renamed &lt;img src=x onerror=alert&#40;1&#41;&gt; </strong>.</p>`);
    });
});

describe('closing a project', () => {
    it('names the stored project and is not written a second time through the retired generic routes', async () => {
        const project = await freshProject('close');
        const stored = await storedProject(project._id);
        const close = (stored.projectStatusData || []).find((status) => status.type === 'close');
        expect(close).toBeTruthy();

        const res = await update(owner, project._id, { updateObject: { status: close.value, statusType: close.type } });
        expect(res.status).toBe(200);
        const ownerName = await nameOf(owner.uid);
        const [row] = await rowsOf(() => historyOf(project._id, 'Project_Name'), 'the close row');
        expect(row.Message).toBe(`<b>${ownerName}</b> has closed the <b>${project.ProjectName}</b> Project`);
        const [notice] = await rowsOf(() => noticesOf(project._id, 'project_close'), 'the close notice');
        expect(notice.message).toBe(`<p><strong>${ownerName}</strong> has closed the <strong>${project.ProjectName}</strong> Project</p>`);

        const history = await owner.api.post('/api/v1/handleHistory', {
            type: 'project', companyId: state.companyId, projectId: String(project._id), taskId: null,
            object: { key: 'Project_EndDate', message: `<b>${HTML}</b> has reopened` },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner', companyOwnerId: owner.uid },
        });
        const notification = await owner.api.post('/api/v1/handleNotification', {
            type: 'project', companyId: state.companyId, projectId: String(project._id),
            object: { key: 'project_close', message: `<p>${HTML}</p>` },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner', companyOwnerId: owner.uid },
        });
        expect([history.status, notification.status]).toEqual([404, 404]);
        await quiet();
        expect(await historyOf(project._id, 'Project_EndDate')).toEqual([]);
        expect([...new Set((await noticesOf(project._id, 'project_close')).map((sent) => sent.message))]).toEqual([notice.message]);
    });
});

describe('a project assignee and date', () => {
    it('names the added user from the stored users', async () => {
        const project = await freshProject('assignee', [owner.uid]);
        const res = await update(owner, project._id, { updateObject: { AssigneeUserId: member.uid }, key: '$addToSet' });
        expect(res.status).toBe(200);

        const [ownerName, memberName] = await Promise.all([nameOf(owner.uid), nameOf(member.uid)]);
        const [row] = await rowsOf(() => historyOf(project._id, 'Project_Assignee_Add'), 'the assignee row');
        expect(row.Message).toBe(`<b>${ownerName}</b> has added the <b>${memberName}</b> to <b>Assignee</b>.`);
        expect((await storedProject(project._id)).AssigneeUserId).toContain(member.uid);
        const [notice] = await rowsOf(() => noticesOf(project._id, 'project_assignee'), 'the assignee notice');
        expect(notice.message).toBe(`<p><strong>${project.ProjectName}</strong> project is Assigned to <strong>${memberName}</strong>.</p>`);
    });

    it('shows a due date in the caller\'s time zone', async () => {
        const project = await freshProject('due');
        const due = '2026-09-30T18:30:00.000Z';
        const res = await update(owner, project._id, { updateObject: { DueDate: due, dueDateDeadLine: [{ date: due }] }, timeZone: 'Asia/Kolkata' });
        expect(res.status).toBe(200);
        const [notice] = await rowsOf(() => noticesOf(project._id, 'project_due_date'), 'the due date notice');
        expect(notice.message).toContain('01 Oct, 2026');
        const [row] = await rowsOf(() => historyOf(project._id, 'Project_DueDate'), 'the due date row');
        expect(row.Message).toContain(`DATE_${new Date(due).getTime()}`);
    });
});

describe('a new sprint', () => {
    it('notifies from the server, naming the stored project', async () => {
        const project = await freshProject('sprint');
        const sprintName = `Sprint ${uniqueSuffix()}`;
        const res = await owner.api.post('/api/v1/sprint', {
            companyId: state.companyId, projectId: String(project._id), sprintName, folder: null,
            projectName: HTML, userData: { id: member.uid, Employee_Name: HTML },
        });
        expect(res.body.status).toBe(true);

        const [notice] = await rowsOf(() => noticesOf(project._id, 'project_sprint_create'), 'the sprint notice');
        expect(notice.message).toBe(`<p>Created new <strong>Sprint</strong> named <strong>${sprintName}</strong> in <strong>${project.ProjectName}</strong> project.</p>`);
        const rows = await rowsOf(async () => (await historyOf(project._id, 'Create_Sprint')).filter((row) => row.Message.includes(sprintName)), 'the sprint row');
        expect(rows[0].Message).toContain(`in <b>${project.ProjectName}</b> project`);
        expect(rows[0].Message).not.toContain('&lt;img');
    });
});
