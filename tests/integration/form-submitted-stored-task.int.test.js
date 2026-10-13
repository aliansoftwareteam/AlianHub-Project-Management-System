const { MongoClient, ObjectId } = require('mongodb');
const { createProject, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Follow-up 81. A rule on form.submitted is handed the event's data as its task. When the
 * submission files a task, that task must be the stored row, carrying its _id; with task
 * creation off the form stays the entity. Every read here is scoped to this suite's own form,
 * rule and task, because the integration suites share one workspace. */

const state = readState();
const FINISHED_RUN = ['success', 'failed', 'stopped'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeout = 20000, interval = 250 } = {}) {
    const deadline = Date.now() + timeout;
    let value = await check();
    while (!value && Date.now() < deadline) {
        await sleep(interval);
        value = await check();
    }
    return value;
}

const submitPublicForm = (token, fields) => fetch(new URL(`/form/${token}`, state.baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
});

let owner;
let client;
let project;
let sprintId;
const ruleIds = [];

async function liveForm({ createTask }) {
    const form = (await owner.api.post('/api/v2/forms', { title: `[QA fu81] form ${uniqueSuffix()}`, projectId: project._id, sprintId })).body.data;
    await owner.api.put(`/api/v2/forms/${form._id}`, {
        questions: [{ id: 'qname', label: 'Request title', mapTo: 'TaskName', required: true }],
        settings: { createTask },
    });
    const published = await owner.api.post(`/api/v2/forms/${form._id}/publish`, { publish: true });
    expect(published.body.status).toBe(true);
    return { form, token: published.body.data.token };
}

async function commenterOn(form, body) {
    const res = await owner.api.post('/api/v2/automations', {
        name: `[QA fu81] on submit ${uniqueSuffix()}`,
        trigger: { event: 'form.submitted' },
        scope: { allProjects: false, projectIds: [String(project._id)] },
        conditions: { op: 'eq', field: 'formId', value: String(form._id) },
        steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body } }],
    });
    expect(res.body.status).toBe(true);
    const ruleId = res.body.data._id;
    ruleIds.push(ruleId);
    await owner.api.patch(`/api/v2/automations/${ruleId}/enabled`, { enabled: true });
    return ruleId;
}

const finishedRun = (ruleId) => waitFor(async () => {
    const rows = (await owner.api.get(`/api/v2/automations/${ruleId}/runs`)).body.data || [];
    return rows.length && rows.every((run) => FINISHED_RUN.includes(run.status)) ? rows : null;
});

// The runs endpoint answers only what the run history shows, so the envelope the engine stored is read from the row.
const storedRun = (run) => client.db(state.companyId).collection('automation_runs').findOne({ _id: new ObjectId(String(run._id)) });

const submissionsOf = async (form) => (await owner.api.get(`/api/v2/forms/${form._id}/submissions`)).body.data.submissions;

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    project = await createProject(owner.api, { name: `[QA fu81] ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    sprintId = String((await listSprints(owner.api, project._id))[0]._id);
});

afterAll(async () => {
    for (const id of ruleIds) await owner.api.delete(`/api/v2/automations/${id}`).catch(() => null);
    await client.close();
});

describe('form.submitted on a form that files a task', () => {
    let submission;
    let run;
    const body = `[QA fu81] filed ${uniqueSuffix()}`;

    beforeAll(async () => {
        const { form, token } = await liveForm({ createTask: true });
        const ruleId = await commenterOn(form, body);
        const submitted = await submitPublicForm(token, { qname: `[QA fu81] request ${uniqueSuffix()}` });
        expect([302, 303]).toContain(submitted.status);
        [submission] = await submissionsOf(form);
        expect(String(submission.taskId)).toMatch(/^[0-9a-fA-F]{24}$/);
        const runs = await finishedRun(ruleId);
        expect(runs).toHaveLength(1);
        [run] = runs;
    });

    it('hands the rule the stored task, whose _id is the task the submission filed', async () => {
        const taskId = String(submission.taskId);
        expect(run.entity).toMatchObject({ kind: 'task', id: taskId });
        const { envelope } = await storedRun(run);
        expect(envelope.data._id).toBe(taskId);
        expect(envelope.data.taskId).toBe(taskId);
        const stored = await owner.api.get(`/api/v1/task/${taskId}`);
        expect(stored.status).toBe(200);
        expect(JSON.stringify(stored.body)).toContain(taskId);
    });

    it('runs the step on that task', async () => {
        expect(run.status).toBe('success');
        const comments = await owner.api.get('/api/v1/comments/get-paginated-messages', {
            query: { projectId: String(project._id), taskId: String(submission.taskId), isDefault: 'true', batchLimit: 100 },
        });
        expect((comments.body.data || []).filter((c) => c.message === body)).toHaveLength(1);
    });
});

describe('form.submitted on a form that files no task', () => {
    it('still names the form as the entity and carries no task id', async () => {
        const { form, token } = await liveForm({ createTask: false });
        const ruleId = await commenterOn(form, `[QA fu81] no task ${uniqueSuffix()}`);
        const submitted = await submitPublicForm(token, { qname: `[QA fu81] note ${uniqueSuffix()}` });
        expect([302, 303]).toContain(submitted.status);
        const [submission] = await submissionsOf(form);
        expect(submission.taskId).toBeFalsy();

        const [run] = await finishedRun(ruleId);
        expect(run.entity).toMatchObject({ kind: 'form', id: String(form._id) });
        const { envelope } = await storedRun(run);
        expect(envelope.data).toMatchObject({ formId: String(form._id), submissionId: String(submission._id), taskId: null });
        expect(envelope.data).not.toHaveProperty('_id');
    });
});
