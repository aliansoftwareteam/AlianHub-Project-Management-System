/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

test.describe('task panel: Esc and undo', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    async function openFreshTask({ page, state, loginAs }) {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `ESC ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Esc task ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
        const dialog = page.getByRole('dialog', { name: 'Task detail' });
        await expect(dialog).toBeVisible();
        return { owner, project, task, dialog };
    }

    test('Esc with the assignee picker open closes the picker and keeps the panel', async ({ page, state, loginAs }) => {
        const { dialog } = await openFreshTask({ page, state, loginAs });
        await dialog.locator('.ah-detail__props').getByRole('button', { name: /^(Assignee|Add User)$/ }).first().click();
        const picker = page.getByRole('dialog', { name: 'List Of User' });
        await expect(picker).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect(dialog).toBeVisible();

        await dialog.focus();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });

    test('Undo in the toast puts the previous status back', async ({ page, state, loginAs }) => {
        const { owner, project, task, dialog } = await openFreshTask({ page, state, loginAs });
        const open = project.taskStatusData.find((s) => s.type === 'default_active');
        const next = project.taskStatusData.find((s) => s.key !== open.key && s.type !== 'close');
        const statusButton = dialog.locator('.ah-detail__props button.task-status-name');
        await expect(statusButton).toHaveText(open.name);

        await statusButton.click();
        await page.getByRole('dialog', { name: 'Select Task Status' }).getByRole('option', { name: next.name }).click();
        await expect(statusButton).toHaveText(next.name);

        const toast = page.getByRole('status').filter({ hasText: 'Status updated' });
        await expect(toast).toBeVisible();
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect(statusButton).toHaveText(open.name);
        await expect.poll(async () => {
            const res = await owner.api.get(`/api/v1/task/${task._id}`);
            return res.body && (res.body.data || res.body).statusKey;
        }).toBe(open.key);
    });
});
