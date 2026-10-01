const { test, expect, asRole } = require('../support/test');
const { createList, createProject, createTask, findTasksByName, readTask, uniqueSuffix } = require('../support/fixtures');
const { chooseFromRowMenu, listRow, skipFirstRun } = require('../support/pages');

async function openListWithTask({ page, state, loginAs, label }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
    await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);
    const row = listRow(page, name);
    await expect(row).toBeVisible();
    return { owner, project, task, name, row, suffix };
}

test.describe('archiving and moving tasks in the List', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('an archived task leaves the list, shows under Show Archive and is restored from its row menu', async ({ page, state, loginAs }) => {
        const { owner, task, name, row } = await openListWithTask({ page, state, loginAs, label: 'Archive' });

        await chooseFromRowMenu(page, row, name, 'Archive');
        await expect(row).toHaveCount(0);
        await expect.poll(async () => (await readTask(owner.api, task._id)).deletedStatusKey).toBe(2);

        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Show Archive', exact: true }).click();
        await expect(row).toBeVisible();

        await chooseFromRowMenu(page, row, name, 'Restore');
        await expect(row).toHaveCount(0);
        await expect.poll(async () => (await readTask(owner.api, task._id)).deletedStatusKey).toBe(0);

        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Hide Archive', exact: true }).click();
        await expect(row).toBeVisible();
    });

    test('Move in the row menu sends the task to another list', async ({ page, state, loginAs }) => {
        const { owner, project, task, name, row, suffix } = await openListWithTask({ page, state, loginAs, label: 'Move' });
        const target = await createList(owner.api, { project, name: `Target list ${suffix}`, user: owner });
        await page.reload();
        await expect(row).toBeVisible();

        await chooseFromRowMenu(page, row, name, 'Move to project…');
        const picker = page.getByRole('dialog', { name: 'Move Task' });
        await picker.getByText(target.name, { exact: true }).click();
        await picker.getByRole('button', { name: 'Move', exact: true }).click();

        await expect(row).toHaveCount(0);
        await expect.poll(async () => String((await readTask(owner.api, task._id)).sprintId)).toBe(target._id);
        await expect.poll(async () => (await findTasksByName(owner.api, project._id, name)).length).toBe(1);
    });
});
