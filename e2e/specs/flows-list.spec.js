const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, findTasksByName, readTask, uniqueSuffix } = require('../support/fixtures');
const { chooseFromRowMenu, listRow, skipFirstRun } = require('../support/pages');

async function openListWithTask({ page, state, loginAs, label, apps }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid, apps });
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
    await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);
    const row = listRow(page, name);
    await expect(row).toBeVisible();
    return { owner, project, task, name, row, suffix };
}

test.describe('everyday flows in the List', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a task typed into a group\'s add row is created in that list', async ({ page, state, loginAs }) => {
        const { owner, project, suffix } = await openListWithTask({ page, state, loginAs, label: 'Add row' });
        const open = project.taskStatusData.find((status) => status.type === 'default_active');
        const name = `Typed in the list ${suffix}`;

        await page.getByRole('button', { name: `Add task to ${open.name}` }).click();
        const field = page.getByPlaceholder('Task name');
        await field.fill(name);
        await field.press('Enter');

        await expect(listRow(page, name)).toBeVisible();
        await expect.poll(async () => (await findTasksByName(owner.api, project._id, name)).length).toBe(1);
    });

    test('a task is renamed from its row', async ({ page, state, loginAs }) => {
        const { owner, task, name, row, suffix } = await openListWithTask({ page, state, loginAs, label: 'Rename' });
        const renamed = `Renamed in the row ${suffix}`;

        await row.getByRole('button', { name, exact: true }).focus();
        await row.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
        const field = page.getByRole('textbox', { name: 'Task name', exact: true });
        await field.fill(renamed);
        await field.press('Enter');

        await expect(listRow(page, renamed)).toBeVisible();
        await expect.poll(async () => (await readTask(owner.api, task._id)).TaskName).toBe(renamed);
    });

    test('a due date and a priority are set from the row', async ({ page, state, loginAs }) => {
        const { owner, task, row } = await openListWithTask({ page, state, loginAs, label: 'Plan', apps: ['Priority'] });

        await row.getByRole('button', { name: 'Due date: none, set' }).click();
        await page.getByRole('gridcell', { name: '15', exact: true }).click();
        await expect(row.getByRole('button', { name: /^Due date: .+, change$/ })).toBeVisible();
        await expect.poll(async () => new Date((await readTask(owner.api, task._id)).DueDate).getDate()).toBe(15);

        await row.getByRole('button', { name: 'Priority: Medium, change' }).click();
        await page.getByRole('dialog', { name: 'Select Priorities' }).getByRole('option', { name: 'High' }).click();
        await expect(row.getByRole('button', { name: 'Priority: High, change' })).toBeVisible();
        await expect.poll(async () => (await readTask(owner.api, task._id)).Task_Priority).toBe('HIGH');
    });

    test('Duplicate in the row menu makes a copy in the same list', async ({ page, state, loginAs }) => {
        const { owner, project, name, row } = await openListWithTask({ page, state, loginAs, label: 'Duplicate' });

        await chooseFromRowMenu(page, row, name, 'Duplicate');

        await expect(listRow(page, `Copy of ${name}`)).toBeVisible();
        await expect(row).toBeVisible();
        await expect.poll(async () => (await findTasksByName(owner.api, project._id, `Copy of ${name}`)).length).toBe(1);
    });

    test('a deleted task waits in the Trash and comes back when restored', async ({ page, state, loginAs }) => {
        const { owner, task, name, row } = await openListWithTask({ page, state, loginAs, label: 'Trash' });

        await chooseFromRowMenu(page, row, name, 'Delete');
        await expect(row).toHaveCount(0);
        await expect.poll(async () => (await readTask(owner.api, task._id)).deletedStatusKey).toBe(1);

        await page.goto(`/#/${state.companyId}/trash`);
        await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
        const restore = page.getByRole('button', { name: `Restore ${name}`, exact: true });
        await restore.click();
        await expect(restore).toHaveCount(0);
        await expect.poll(async () => (await readTask(owner.api, task._id)).deletedStatusKey).toBe(0);
    });
});
