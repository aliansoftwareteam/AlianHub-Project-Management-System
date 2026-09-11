const { createApiClient } = require('../../e2e/support/api');
const { createProject, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Pages, forms, import and export (task 034, area `pages`).
 * Every test makes its own data. Public /form and /share routes are urlencoded
 * server-rendered pages, so they are driven with a small urlencoded POST helper
 * rather than the JSON api client. */

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || (res.body && res.body.status === false);

const urlencoded = async (path, fields) => {
    const res = await fetch(new URL(path, state.baseURL), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual',
    });
    return { status: res.status, text: await res.text() };
};

const sprintOf = async (api, projectId) => String((await listSprints(api, projectId))[0]._id);

async function makeSharedProject(owner) {
    return createProject(owner.api, {
        name: `PAG Shared ${uniqueSuffix()}`,
        assigneeIds: [owner.uid],
        createdBy: owner.uid,
    });
}

async function makeLiveForm(owner, project) {
    const sprintId = await sprintOf(owner.api, project._id);
    const created = await owner.api.post('/api/v2/forms', { title: `[QA pages] form ${uniqueSuffix()}`, projectId: project._id, sprintId });
    const formId = created.body.data._id;
    await owner.api.put(`/api/v2/forms/${formId}`, { questions: [{ id: 'qname', label: 'Request title', mapTo: 'TaskName', required: true }] });
    const pub = await owner.api.post(`/api/v2/forms/${formId}/publish`, { publish: true });
    return { formId, token: pub.body.data.token, sprintId };
}

describe('pages module', () => {
    it('lets the owner create a page and hides a private page from others', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await makeSharedProject(owner);

        const priv = await owner.api.post('/api/v2/pages', { title: `[QA pages] private ${uniqueSuffix()}`, projectId: project._id, visibility: 'private' });
        expect(priv.body.status).toBe(true);
        const pageId = priv.body.data._id;

        const asMember = await member.api.get(`/api/v2/pages/${pageId}`);
        expect(asMember.body.status).toBe(false);

        const list = await member.api.get(`/api/v2/pages?projectId=${project._id}`);
        expect((list.body.data || []).some((p) => p._id === pageId)).toBe(false);
    });

    it('records the author from the JWT, not the request body', async () => {
        const owner = await loginAs('owner');
        const admin = await loginAs('admin');
        const project = await makeSharedProject(owner);
        const res = await admin.api.post('/api/v2/pages', { title: `[QA pages] author ${uniqueSuffix()}`, projectId: project._id, createdBy: owner.uid });
        expect(res.body.data.createdBy).toBe(admin.uid);
    });

    it('refuses a page without a title', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/pages', { title: '' });
        expect(res.body.status).toBe(false);
    });

    it('refuses an anonymous request', async () => {
        const res = await anon.get('/api/v2/pages', { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });
});

describe('forms module', () => {
    it('publishes a form and records a public submission as a task', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const { formId, token } = await makeLiveForm(owner, project);

        const page = await anon.get(`/form/${token}`);
        expect(page.status).toBe(200);

        const taskName = `[QA pages] submission ${uniqueSuffix()}`;
        const submit = await urlencoded(`/form/${token}`, { qname: taskName });
        expect(submit.status).toBe(303);

        const subs = await owner.api.get(`/api/v2/forms/${formId}/submissions`);
        expect(subs.body.data.total).toBeGreaterThanOrEqual(1);
    });

    it('refuses to publish a form with no questions', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const created = await owner.api.post('/api/v2/forms', { title: `[QA pages] empty ${uniqueSuffix()}`, projectId: project._id });
        const res = await owner.api.post(`/api/v2/forms/${created.body.data._id}/publish`, { publish: true });
        expect(res.body.status).toBe(false);
    });

    it('refuses to delete a live form until it is unpublished', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const { formId } = await makeLiveForm(owner, project);
        expect((await owner.api.delete(`/api/v2/forms/${formId}`)).body.status).toBe(false);
        await owner.api.post(`/api/v2/forms/${formId}/publish`, { publish: false });
        expect((await owner.api.delete(`/api/v2/forms/${formId}`)).body.status).toBe(true);
    });

    it('does not serve a form through a rotated/unknown token', async () => {
        expect((await anon.get('/form/deadbeef')).status).toBe(404);
    });
});

describe('public shares', () => {
    it('serves a shared sprint board and stops serving it after a hard revoke', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const sprintId = await sprintOf(owner.api, project._id);

        const share = await owner.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        expect(share.body.status).toBe(true);
        expect(share.body.data.passwordHash).toBeUndefined();
        const token = share.body.data.token;

        expect((await anon.get(`/share/${token}`)).status).toBe(200);

        await owner.api.delete(`/api/v2/public-shares/${share.body.data._id}`);
        expect((await anon.get(`/share/${token}`)).status).toBe(404);
    });

    it('excludes a private child page from a shared doc tree', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const root = await owner.api.post('/api/v2/pages', { title: `[QA pages] root ${uniqueSuffix()}`, projectId: project._id, contentBlocks: [{ type: 'paragraph', data: { text: 'root body' } }] });
        const hidden = await owner.api.post('/api/v2/pages', { title: 'PAGSECRETCHILD', projectId: project._id, parentPageId: root.body.data._id, visibility: 'private' });
        const share = await owner.api.post('/api/v2/public-shares', { entityType: 'page', entityId: root.body.data._id });
        const html = (await anon.get(`/share/${share.body.data.token}`)).body;
        expect(String(html)).not.toContain('PAGSECRETCHILD');
        const frag = await anon.get(`/share/${share.body.data.token}/page/${hidden.body.data._id}`);
        expect(frag.body.title).not.toContain('PAGSECRETCHILD');
        await owner.api.delete(`/api/v2/public-shares/${share.body.data._id}`);
    });

    it('refuses to publish a private doc', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const priv = await owner.api.post('/api/v2/pages', { title: `[QA pages] priv ${uniqueSuffix()}`, projectId: project._id, visibility: 'private' });
        const res = await owner.api.post('/api/v2/public-shares', { entityType: 'page', entityId: priv.body.data._id });
        expect(res.body.status).toBe(false);
    });
});

describe('export and import', () => {
    it('runs an async task export the owner can list and download', async () => {
        const owner = await loginAs('owner');
        // The shared fixture project already holds tasks, so the export has rows.
        const project = { _id: state.projects.shared._id, ProjectName: state.projects.shared.name };
        const create = await owner.api.post('/api/v2/exports', { format: 'csv', projectId: project._id, projectName: project.ProjectName, userData: { id: owner.uid } });
        const jobId = create.body.data._id;

        let job = null;
        for (let i = 0; i < 20 && (!job || job.status !== 'done'); i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 250));
            // eslint-disable-next-line no-await-in-loop
            const list = await owner.api.get(`/api/v2/exports?uid=${owner.uid}`);
            job = (list.body.data || []).find((j) => j._id === jobId);
        }
        expect(job && job.status).toBe('done');
        const dl = await owner.api.get(`/api/v2/exports/${jobId}/download?uid=${owner.uid}`);
        expect(dl.status).toBe(200);
        expect(String(dl.body)).toContain('TaskKey');
    });

    it('imports a small CSV into the owner\'s project', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const sprintId = await sprintOf(owner.api, project._id);
        const res = await owner.api.post('/api/v2/imports/csv', {
            projectId: project._id, sprintId, sprintName: 'List',
            rows: [{ 'Task name': `[QA pages] csv ${uniqueSuffix()}`, Priority: 'High' }],
            userData: { id: owner.uid },
        });
        expect(res.body.status).toBe(true);
    });

    it('reports unknown statuses in a CSV preview without writing', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const res = await owner.api.post('/api/v2/imports/csv/preview', {
            projectId: project._id,
            rows: [{ 'Task name': 'x', Status: 'NoSuchStatus' }],
        });
        expect(res.body.status).toBe(true);
        expect(res.body.data.unknownStatuses).toContain('NoSuchStatus');
    });

    it('v1 CSV export streams text/csv from the client-supplied table', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/export/csv', { filename: 'x', tableHead: ['A'], tableRows: [['1']] });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/csv');
    });

    it('refuses an anonymous async export (the DB-backed endpoint is protected)', async () => {
        const res = await anon.post('/api/v2/exports', { format: 'csv', projectId: state.projects.shared._id }, { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });

    it('returns the app list for the owner', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/projects-apps');
        expect(res.status).toBe(200);
    });
});

/* Regression tests for confirmed findings. `it.failing` passes while the bug is
 * present and turns red once the fix lands — the reminder to flip it to it(). */
describe('pages findings (regressions)', () => {
    it.failing('PAG-01: a user cannot download another user\'s export job', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const project = await makeSharedProject(owner);
        const create = await owner.api.post('/api/v2/exports', { format: 'csv', projectId: project._id, projectName: project.ProjectName, userData: { id: owner.uid } });
        const jobId = create.body.data._id;
        await new Promise((r) => setTimeout(r, 1500));
        const steal = await guest.api.get(`/api/v2/exports/${jobId}/download?uid=${owner.uid}`);
        expect(refused(steal)).toBe(true);
    });

    it.failing('PAG-01: a user cannot list another user\'s export jobs', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        await owner.api.post('/api/v2/exports', { format: 'csv', projectId: state.projects.shared._id, projectName: 'x', userData: { id: owner.uid } });
        const list = await guest.api.get(`/api/v2/exports?uid=${owner.uid}`);
        expect((list.body.data || []).length).toBe(0);
    });

    it.failing('PAG-02: a non-member cannot export a private project', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await createProject(owner.api, { name: `PAG Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const res = await guest.api.post('/api/v2/exports', { format: 'csv', projectId: priv._id, projectName: 'secret', userData: { id: guest.uid } });
        expect(refused(res)).toBe(true);
    });

    it.failing('PAG-03: a user cannot read another user\'s import history', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const sprintId = await sprintOf(owner.api, state.projects.shared._id);
        await owner.api.post('/api/v2/imports/csv', { projectId: state.projects.shared._id, sprintId, sprintName: 'List', rows: [{ 'Task name': `imp ${uniqueSuffix()}` }], userData: { id: owner.uid } });
        const list = await guest.api.get(`/api/v2/imports?uid=${owner.uid}`);
        expect((list.body.data || []).length).toBe(0);
    });

    it.failing('PAG-04: a guest cannot import company templates', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/importTemplate', {
            companyId: state.companyId,
            templates: [{ TemplateName: `[QA pages] tmpl ${uniqueSuffix()}`, TemplateId: `pagtmpl${uniqueSuffix()}`, category: 'category' }],
        });
        expect(refused(res)).toBe(true);
    });

    it.failing('PAG-05: CSV export neutralises a leading formula character', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/export/csv', { filename: 'x', tableHead: ['A'], tableRows: [['=HYPERLINK("http://x","y")']] });
        const cells = String(res.body).split(/\r?\n/);
        const dataCell = cells[cells.length - 1];
        expect(/^["']?[=+\-@]/.test(dataCell)).toBe(false);
    });

    it.failing('PAG-06: projects-apps uses the standard response envelope', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/projects-apps');
        expect(res.body && res.body.status).toBe(true);
    });

    it('PAG-08: a guest cannot mint a public link to a sprint of a project they are not in', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await createProject(owner.api, { name: `PAG Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const sprintId = await sprintOf(owner.api, priv._id);
        const res = await guest.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        expect(refused(res)).toBe(true);
    });

    it('PAG-09: a guest cannot read docs of a project they are not in', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await createProject(owner.api, { name: `PAG Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        await owner.api.post('/api/v2/pages', { title: `[QA pages] hidden ${uniqueSuffix()}`, projectId: priv._id });
        const list = await guest.api.get(`/api/v2/pages?projectId=${priv._id}`);
        expect((list.body.data || []).length).toBe(0);
    });

    it('PAG-09: a guest cannot read a form of a project they are not in', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await createProject(owner.api, { name: `PAG Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        const form = await owner.api.post('/api/v2/forms', { title: `[QA pages] hidden form ${uniqueSuffix()}`, projectId: priv._id });
        const res = await guest.api.get(`/api/v2/forms/${form.body.data._id}/submissions`);
        expect(refused(res)).toBe(true);
    });

    it('PAG-10: a member cannot delete another user\'s private doc', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await makeSharedProject(owner);
        const priv = await owner.api.post('/api/v2/pages', { title: `[QA pages] mine ${uniqueSuffix()}`, projectId: project._id, visibility: 'private' });
        const res = await member.api.delete(`/api/v2/pages/${priv.body.data._id}`);
        expect(refused(res)).toBe(true);
    });

    it('PAG-11: a form submission records the key of the task it filed', async () => {
        const owner = await loginAs('owner');
        const project = await makeSharedProject(owner);
        const { formId, token } = await makeLiveForm(owner, project);
        await urlencoded(`/form/${token}`, { qname: `[QA pages] keyed ${uniqueSuffix()}` });
        const subs = await owner.api.get(`/api/v2/forms/${formId}/submissions`);
        expect(subs.body.data.submissions[0].taskKey).toBeTruthy();
    });

    it('PAG-12: importSettingsNotification refuses a request without a token', async () => {
        const res = await anon.post('/api/v1/importSettingsNotification', { companyId: state.companyId, userId: '0123456789abcdef01234599' });
        expect(res.status).toBe(401);
    });
});
