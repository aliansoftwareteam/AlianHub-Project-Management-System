const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

async function projectWithTask({ owner, state, label, suffix }) {
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const name = `${label} task ${suffix}`;
    await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
    return { projectName: project.ProjectName, name };
}

test.describe('Everything: filter, group and Board', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a project filter, a grouping by project and the Board narrow the same tasks', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const first = await projectWithTask({ owner, state, label: 'Filter one', suffix });
        const second = await projectWithTask({ owner, state, label: 'Filter two', suffix });

        await page.goto(`/#/${state.companyId}/everything`);
        await page.getByRole('searchbox', { name: 'Search tasks' }).fill(suffix);
        const rows = page.getByRole('listitem').filter({ hasText: suffix });
        await expect(rows).toHaveCount(2);

        await page.getByRole('button', { name: 'Project', exact: true }).click();
        await page.getByRole('listbox', { name: 'Project', exact: true }).getByRole('option', { name: first.projectName, exact: true }).click();
        await expect(rows).toHaveCount(1);
        await expect(rows.filter({ hasText: first.name })).toHaveCount(1);
        await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
        await expect(rows).toHaveCount(2);

        await page.getByLabel('Group by').selectOption({ label: 'Project' });
        await expect(page.getByRole('button', { name: new RegExp(`^${first.projectName}`) })).toBeVisible();
        await expect(page.getByRole('button', { name: new RegExp(`^${second.projectName}`) })).toBeVisible();

        await page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Board', exact: true }).click();
        const board = page.getByRole('list', { name: 'Tasks by status' });
        await expect(board.getByRole('button', { name: first.name, exact: true })).toBeVisible();
        await expect(board.getByRole('button', { name: second.name, exact: true })).toBeVisible();
    });
});
