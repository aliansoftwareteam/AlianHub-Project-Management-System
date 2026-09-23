const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 111: custom field values, task tags, tag definitions and project checklist items are described on the server. Every read is scoped to a project this suite created. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML = '<img src=x onerror=alert(1)>';

jest.setTimeout(60000);

let client;
let owner;
let member;
let project;

const db = () => client.db(state.companyId);
const historyOf = (query) => db().collection('history').find({ ProjectId: String(project._id), ...query }).toArray();
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

const freshTask = async () => {
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    return waitFor(async () => {
        const doc = await db().collection('tasks').findOne({ _id: new ObjectId(task._id) });
        return doc && doc.TaskKey !== '--' ? doc : null;
    }, 'the task key');
};

const crafted = (type, key, taskId = null) => member.api.post('/api/v1/handleHistory', {
    type, companyId: state.companyId, projectId: String(project._id), taskId,
    object: { key, message: `<b>${HTML}</b> crafted` },
    userData: { id: owner.uid, Employee_Name: HTML, companyOwnerId: owner.uid },
});

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    member = await loginAs('member');
    project = await createProject(owner.api, { name: `FU111 items ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a task custom field value', () => {
    it('is recorded by the server from the stored field, for the signed-in user', async () => {
        const task = await freshTask();
        const { insertedId } = await db().collection('customField').insertOne({
            fieldTitle: `Budget ${uniqueSuffix()}`, fieldType: 'text', type: 'task', global: false, projectId: [String(project._id)],
        });
        const fieldId = String(insertedId);
        const field = await db().collection('customField').findOne({ _id: insertedId });

        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateTaskCustomField', companyId: state.companyId, taskId: String(task._id), customFieldId: fieldId,
            updateDetail: { _id: fieldId, fieldValue: `AB ${HTML}` },
        });
        expect([res.status, res.body.status]).toEqual([200, true]);

        const memberName = await nameOf(member.uid);
        const [row] = await rowsOf(() => historyOf({ TaskId: String(task._id), Key: 'Project_Category' }), 'the custom field row');
        expect(row.UserId).toBe(member.uid);
        expect(row.Message).toBe(`<b>${memberName}</b> has added value in <b> ${field.fieldTitle}</b> Custom Field as <b>AB &lt;img src=x onerror=alert&#40;1&#41;&gt;</b>.`);

        const history = await crafted('task', 'Project_Category', String(task._id));
        expect(history.body.status).toBe(true);
        await quiet();
        expect((await historyOf({ TaskId: String(task._id), Key: 'Project_Category' })).map((found) => found.Message)).toEqual([row.Message]);
    });
});

describe('a tag added to a task', () => {
    it('writes the task row and the project row with the stored tag and task names', async () => {
        const task = await freshTask();
        const tag = { uid: `t${uniqueSuffix()}`, tagName: `Urgent ${uniqueSuffix()}`, tagColor: '#ff0000', tagBgColor: '#ff000035' };
        expect((await owner.api.post('/api/v1/project/tags', { id: String(project._id), items: tag, operation: 'push' })).status).toBe(200);

        const res = await member.api.patch('/api/v2/tasks', {
            action: 'updateTags', companyId: state.companyId, projectId: String(project._id), sprintId: task.sprintId,
            taskId: String(task._id), tagId: tag.uid, operation: 'add',
        });
        expect([res.status, res.body.status]).toEqual([200, true]);

        const memberName = await nameOf(member.uid);
        const [taskRow] = await rowsOf(() => historyOf({ TaskId: String(task._id), Key: 'task' }), 'the task tag row');
        expect(taskRow.Message).toBe(`<b>${memberName}</b> has added the <b> ${tag.tagName} Tag </b>`);
        const [projectRow] = await rowsOf(() => historyOf({ TaskId: '', Key: 'Project_Name', Message: { $regex: tag.tagName } }), 'the project tag row');
        expect(projectRow.Message).toBe(`<b>${memberName}</b> has added the <b> ${tag.tagName} Tag </b> in <b>${task.TaskName}</b> Task`);

        await crafted('task', 'task', String(task._id));
        await quiet();
        expect(await historyOf({ TaskId: String(task._id), Key: 'task' })).toHaveLength(1);
    });
});

describe('a project checklist item', () => {
    it('is recorded by the server from the stored item', async () => {
        const parent = { id: `c${uniqueSuffix()}`, name: 'Checklist', isChecked: false, isExpand: false, AssigneeUserId: [] };
        const item = { id: `i${uniqueSuffix()}`, parentId: parent.id, name: `Write spec ${uniqueSuffix()}`, isChecked: false, isExpand: false, AssigneeUserId: [] };
        expect((await owner.api.post('/api/v1/project/checklist', { id: String(project._id), checklistItem: parent, operation: 'push' })).status).toBe(200);
        expect((await owner.api.post('/api/v1/project/checklist', { id: String(project._id), checklistItem: item, operation: 'push' })).status).toBe(200);
        const res = await owner.api.post('/api/v1/project/checklist', {
            id: String(project._id), checklistItem: { id: item.id, name: `Renamed ${HTML}` }, operation: 'update', key: 'name',
        });
        expect(res.status).toBe(200);

        const ownerName = await nameOf(owner.uid);
        const rows = await waitFor(async () => {
            const found = await historyOf({ Key: 'Task_Checklist' });
            return found.some((row) => row.Message.includes('Renamed')) ? found : null;
        }, 'the checklist rename row');
        const messages = rows.map((row) => row.Message);
        expect(messages).toContain(`<b>${ownerName}</b> has created new checklist item <b class="text-ellipsis vertical-middle d-inline-block" style="max-width:150px" title="${item.name}">${item.name}</b>`);
        expect(messages).toContain(`<b>${ownerName}</b> has changed checklist item name from <b>${item.name}</b> to <b>Renamed &lt;img src=x onerror=alert&#40;1&#41;&gt;</b>`);

        const before = rows.length;
        await crafted('project', 'Task_Checklist');
        await quiet();
        expect(await historyOf({ Key: 'Task_Checklist' })).toHaveLength(before);
    });
});

describe('a project tag rename', () => {
    it('names the stored tag name', async () => {
        const tag = { uid: `t${uniqueSuffix()}`, tagName: `Stale ${uniqueSuffix()}`, tagColor: '#ff0000', tagBgColor: '#ff000035' };
        await owner.api.post('/api/v1/project/tags', { id: String(project._id), items: tag, operation: 'push' });
        const res = await member.api.post('/api/v1/project/tags', { id: String(project._id), items: { id: tag.uid, tagName: 'Fresh', tagColor: tag.tagColor }, operation: 'update', key: 'tagName' });
        expect(res.status).toBe(200);

        const memberName = await nameOf(member.uid);
        const [row] = await rowsOf(() => historyOf({ Key: 'Project_Name', Message: { $regex: tag.tagName } }), 'the tag rename row');
        expect(row.Message).toBe(`<b>${memberName}</b> has renamed the Tag from <b>  ${tag.tagName}  </b> to <b>Fresh </b>`);
    });
});
