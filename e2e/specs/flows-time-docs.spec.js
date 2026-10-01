const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

test.describe('logging time and writing docs', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('time logged in the task panel shows in the timesheet', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `Time ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid, apps: ['TimeTracking'] });
        const name = `Time task ${suffix}`;
        const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
        const panel = taskPanel(page);
        await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();

        await panel.getByRole('button', { name: 'Add time' }).click();
        const form = panel.getByRole('form', { name: 'Add time' });
        await form.getByRole('spinbutton', { name: 'Hours' }).fill('1');
        await form.getByRole('spinbutton', { name: 'Minutes' }).fill('30');
        await form.getByRole('button', { name: 'Save time' }).click();

        await expect(panel.getByRole('list', { name: 'Time entries' }).getByRole('listitem')).toHaveCount(1);
        await expect.poll(async () => (await owner.api.get(`/api/v1/timesheet/task/${task._id}`)).body.data.totalMinutes).toBe(90);

        await page.goto(`/#/${state.companyId}/timesheet/user`);
        await expect(page.getByRole('heading', { level: 1, name: 'My timesheet' })).toBeVisible();
        await expect(page.getByText(name, { exact: true })).toBeVisible();
    });

    test('a new doc keeps its title without a click on Save', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const title = `Doc ${uniqueSuffix()}`;

        await page.goto(`/#/${state.companyId}/pages`);
        await page.getByRole('button', { name: 'New doc', exact: true }).first().click();
        await page.waitForURL(/\/pages\/[0-9a-f]{24}/);
        const pageId = /\/pages\/([0-9a-f]{24})/.exec(page.url())[1];

        await page.getByPlaceholder('Untitled').fill(title);
        await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
        await expect.poll(async () => JSON.stringify((await owner.api.get(`/api/v2/pages/${pageId}`)).body)).toContain(title);

        await page.reload();
        await expect(page.getByPlaceholder('Untitled')).toHaveValue(title);
    });
});
