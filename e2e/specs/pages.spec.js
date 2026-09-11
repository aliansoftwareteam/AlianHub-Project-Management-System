const { test, expect, asRole } = require('../support/test');
const { createProject, listSprints, uniqueSuffix } = require('../support/fixtures');

/* Pages, forms, import and export (task 034, area `pages`).
 * Owner drives the Docs hub; the public /form and /share routes are server-rendered
 * pages reached directly (no login). Each test builds its own data through the API. */

const sprintOf = async (api, projectId) => String((await listSprints(api, projectId))[0]._id);

test.describe('docs hub as the owner', () => {
    test.use(asRole('owner'));

    test('renders the Docs hub and a page created for this test', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const title = `[QA pages] hub ${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `PAG UI ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        await owner.api.post('/api/v2/pages', { title, projectId: project._id });

        await page.goto(`/#/${state.companyId}/pages`);
        // The app shell boots behind a splash; wait for it before asserting hub content.
        await expect(page.getByPlaceholder('Search docs')).toBeVisible({ timeout: 45000 });
        await expect(page.getByText(title).first()).toBeVisible();
    });
});

test.describe('public form', () => {
    test('renders the published form and accepts a submission', async ({ page, loginAs }) => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `PAG Form ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const sprintId = await sprintOf(owner.api, project._id);
        const created = await owner.api.post('/api/v2/forms', { title: `[QA pages] form ${uniqueSuffix()}`, projectId: project._id, sprintId });
        const formId = created.body.data._id;
        await owner.api.put(`/api/v2/forms/${formId}`, { questions: [{ id: 'qname', label: 'Request title', mapTo: 'TaskName', required: true }] });
        const pub = await owner.api.post(`/api/v2/forms/${formId}/publish`, { publish: true });

        await page.goto(`/form/${pub.body.data.token}`);
        await expect(page.getByText('Request title')).toBeVisible();

        await page.locator('[name="qname"]').fill(`[QA pages] ui submission ${uniqueSuffix()}`);
        await page.locator('form button[type="submit"]').click();
        await expect(page).toHaveURL(/sent=1/);
    });

    test('shows nothing for an unknown token', async ({ page }) => {
        const res = await page.goto('/form/deadbeef');
        expect(res.status()).toBe(404);
    });
});

test.describe('public share', () => {
    test('serves a shared sprint board and stops after revoke', async ({ page, loginAs }) => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `PAG Share ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const sprintId = await sprintOf(owner.api, project._id);
        const share = await owner.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        const token = share.body.data.token;

        await page.goto(`/share/${token}`);
        await expect(page.locator('body')).toContainText('read-only public view');

        await owner.api.delete(`/api/v2/public-shares/${share.body.data._id}`);
        await page.goto(`/share/${token}`);
        await expect(page.locator('body')).toContainText('This link is not available.');
    });
});
