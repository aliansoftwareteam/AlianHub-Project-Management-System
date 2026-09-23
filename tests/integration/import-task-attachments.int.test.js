const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 97. The harness runs with STORAGE_DOWNLOAD_SCOPE=enforce, so an import naming a
 * file that is not stored for the new task is refused; report mode is covered by the unit suite. */

const state = readState();

let client;
let owner;
let project;
let sprintId;

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    project = await createProject(owner.api, { name: `ITA ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const sprint = await firstSprint(owner.api, project._id);
    sprintId = String(sprint._id || sprint.id);
});

afterAll(async () => {
    if (client) await client.close();
});

/* The suites share one workspace, so reads are limited to this suite's project. */
const importedRows = (name) => client.db(state.companyId).collection('tasks').find({
    ProjectID: { $in: [String(project._id), new ObjectId(String(project._id))] },
    TaskName: name,
}).toArray();

const importTask = (name, attachments) => owner.api.patch('/api/v1/importTasks', {
    action: 'createMultipleTasks',
    tasks: [{ _id: 'row-1', TaskName: name, status: 'To Do', ParentTaskId: '', Task_Leader: owner.uid, ...(attachments ? { attachments } : {}) }],
    userData: { id: owner.uid },
    projectData: { _id: project._id, CompanyId: state.companyId, lastTaskId: project.lastTaskId || 0, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode },
    indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: '1' },
    statusArray: project.taskStatusData.map((status) => ({ name: status.name, key: status.key, type: status.type })),
    sprint: { id: sprintId, name: 'List' },
    eventId: `ev_${uniqueSuffix()}`,
});

describe('PATCH /api/v1/importTasks attachments', () => {
    it('imports a task with no attachments', async () => {
        const name = `ITA none ${uniqueSuffix()}`;
        const res = await importTask(name);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        const rows = await importedRows(name);
        expect(rows).toHaveLength(1);
        expect(rows[0].attachments).toEqual([]);
    });

    it('imports a task whose attachment is filed in the destination sprint\'s folder', async () => {
        const name = `ITA own ${uniqueSuffix()}`;
        const url = `Project/${project._id}/Sprint/${sprintId}/Attachment/voice-note.webm`;
        const res = await importTask(name, [{ id: 'i1', filename: 'voice-note.webm', url }]);
        expect(res.status).toBe(200);
        const rows = await importedRows(name);
        expect(rows).toHaveLength(1);
        expect(rows[0].attachments.map((item) => item.url)).toEqual([url]);
    });

    it.each([
        ['another task\'s file', () => `Project/${project._id}/Sprint/${state.tasks[0]._id}/Attachment/spec.pdf`],
        ['an unknown key', () => 'backups/company.zip'],
    ])('refuses an attachment naming %s and imports nothing', async (_label, urlOf) => {
        const name = `ITA refused ${uniqueSuffix()}`;
        const res = await importTask(name, [{ id: 'i1', filename: 'x', url: urlOf() }]);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ status: false, code: 'ATTACHMENT_KEY_NOT_OWN' });
        expect(await importedRows(name)).toEqual([]);
    });
});
