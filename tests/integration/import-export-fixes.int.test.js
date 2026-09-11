const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymousWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const refused = (res) => res.status >= 400 || Boolean(res.body && typeof res.body === 'object' && res.body.status === false);

/* One login per role per file: the refresh token is derived from the second a session starts. */
const sessions = {};
const as = async (role) => {
    if (!sessions[role]) sessions[role] = await loginAs(role);
    return sessions[role];
};

async function waitFor(check, { timeoutMs = 20000, intervalMs = 300 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

async function exportAndWait(session, projectId) {
    const created = await session.api.post('/api/v2/exports', { format: 'csv', projectId, projectName: 'pag', userData: { id: session.userId } });
    expect(created.body.status).toBe(true);
    const jobId = String(created.body.data._id);
    const job = await waitFor(async () => {
        const list = await session.api.get('/api/v2/exports');
        const found = (list.body.data || []).find((item) => String(item._id) === jobId);
        return found && found.status !== 'queued' && found.status !== 'processing' ? found : null;
    });
    expect(job && job.status).toBe('done');
    return jobId;
}

describe('PAG-01 export jobs belong to the session user', () => {
    it('answers 404 to another user\'s download link and serves the owner', async () => {
        const owner = await as('owner');
        const guest = await as('guest');
        const jobId = await exportAndWait(owner, state.projects.shared._id);

        const steal = await guest.api.get(`/api/v2/exports/${jobId}/download?uid=${owner.userId}`);
        expect(steal.status).toBe(404);

        const own = await owner.api.get(`/api/v2/exports/${jobId}/download`);
        expect(own.status).toBe(200);
        expect(String(own.body)).toContain('TaskName');
    });

    it('refuses another user\'s job list and never leaks it', async () => {
        const owner = await as('owner');
        const guest = await as('guest');
        const jobId = await exportAndWait(owner, state.projects.shared._id);

        const byQuery = await guest.api.get(`/api/v2/exports?uid=${owner.userId}`);
        expect(byQuery.status).toBe(403);

        const mine = await guest.api.get('/api/v2/exports');
        expect(mine.body.status).toBe(true);
        expect((mine.body.data || []).some((job) => String(job._id) === jobId)).toBe(false);
    });
});

describe('PAG-02 export requires a visible project', () => {
    it.each(['member', 'guest'])('answers 404 when a %s exports a private project they are not in', async (role) => {
        const session = await as(role);
        const res = await session.api.post('/api/v2/exports', { format: 'csv', projectId: state.projects.restricted._id, projectName: 'secret', userData: { id: session.userId } });
        expect(res.status).toBe(404);
        expect(res.body.status).toBe(false);
    });

    it('lets the owner export the private project', async () => {
        const owner = await as('owner');
        await exportAndWait(owner, state.projects.restricted._id);
    });
});

describe('PAG-03 import history belongs to the session user', () => {
    it('refuses another user\'s import history and lists the caller\'s own', async () => {
        const owner = await as('owner');
        const guest = await as('guest');
        const [sprint] = await listSprints(owner.api, state.projects.shared._id);
        const imported = await owner.api.post('/api/v2/imports/csv', {
            projectId: state.projects.shared._id,
            sprintId: String(sprint._id),
            sprintName: sprint.name,
            rows: [{ 'Task name': `[QA pages] import ${uniqueSuffix()}` }],
            userData: { id: owner.userId },
        });
        expect(imported.body.status).toBe(true);

        const byQuery = await guest.api.get(`/api/v2/imports?uid=${owner.userId}`);
        expect(byQuery.status).toBe(403);

        const guestOwn = await guest.api.get('/api/v2/imports');
        expect(guestOwn.body.status).toBe(true);
        expect(guestOwn.body.data || []).toHaveLength(0);

        const ownerOwn = await owner.api.get('/api/v2/imports');
        expect((ownerOwn.body.data || []).some((job) => job.source === 'csv')).toBe(true);
    });
});

describe('PAG-04 settings and rules imports are gated', () => {
    const template = () => ({ TemplateName: `[QA pages] tmpl ${uniqueSuffix()}`, TemplateId: `pagtmpl${uniqueSuffix()}`, category: 'category' });

    it.each(['member', 'guest'])('refuses a template import from a %s', async (role) => {
        const session = await as(role);
        const res = await session.api.post('/api/v1/importTemplate', { companyId: state.companyId, templates: [template()] });
        expect(res.status).toBe(403);
    });

    it.each(['member', 'guest'])('refuses a company-wide rules import from a %s', async (role) => {
        const session = await as(role);
        const res = await session.api.post('/api/v1/importSettingsProjectFunction', { companyId: state.companyId });
        expect(res.status).toBe(403);
    });

    it.each(['admin', 'member', 'guest'])('refuses the full settings import to a %s', async (role) => {
        const session = await as(role);
        const res = await session.api.post('/api/v1/importSettings', { companyId: state.companyId, uid: session.userId, email: session.email, rules: ['importCompanyUserOwner'] });
        expect(res.status).toBe(403);
    });

    it('lets an admin import a template', async () => {
        const admin = await as('admin');
        const res = await admin.api.post('/api/v1/importTemplate', { companyId: state.companyId, templates: [template()] });
        expect(refused(res)).toBe(false);
    });
});

describe('PAG-05 exports neutralise spreadsheet formulas', () => {
    it('prefixes a formula cell in the report CSV export', async () => {
        const owner = await as('owner');
        const res = await owner.api.post('/api/v1/export/csv', { filename: 'x', tableHead: ['A'], tableRows: [['=HYPERLINK("http://x","y")']] });
        expect(res.status).toBe(200);
        const dataCell = String(res.body).split(/\r?\n/).pop();
        expect(/^["']?[=+\-@]/.test(dataCell)).toBe(false);
        expect(dataCell).toContain("'=HYPERLINK");
    });

    it('prefixes a formula task name in the async task export', async () => {
        const owner = await as('owner');
        const project = await createProject(owner.api, { name: `PAG Formula ${uniqueSuffix()}`, assigneeIds: [owner.userId], createdBy: owner.userId });
        const name = `=1+2 PAG ${uniqueSuffix()}`;
        await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.userId });
        const jobId = await exportAndWait(owner, String(project._id));
        const file = await owner.api.get(`/api/v2/exports/${jobId}/download`);
        expect(String(file.body)).toContain(`'${name}`);
    });
});

describe('PAG-06 projects-apps envelope', () => {
    it('answers with the standard envelope', async () => {
        const owner = await as('owner');
        const res = await owner.api.get('/api/v1/projects-apps');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});

describe('PAG-07 report exports need a session', () => {
    it.each(['csv', 'xlsx', 'pdf'])('refuses an anonymous %s export', async (format) => {
        const res = await anonymousWithCompany.post(`/api/v1/export/${format}`, { filename: 'x', tableHead: ['A'], tableRows: [['1']], type: 'x', params: {} });
        expect(res.status).toBe(401);
    });
});
