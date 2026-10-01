const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, readTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

async function openProjectWithTask({ page, state, loginAs, label }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
    const next = project.taskStatusData.find((status) => status.type === 'active');
    await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    return { owner, task, name, next };
}

test.describe('the Board and the Table', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a card dragged to another column changes the task\'s status', async ({ page, state, loginAs }) => {
        const { owner, task, name, next } = await openProjectWithTask({ page, state, loginAs, label: 'Drag' });

        await page.getByRole('button', { name: 'Board', exact: true }).click();
        const card = page.getByRole('button', { name: new RegExp(name) });
        await expect(card).toBeVisible();
        const column = await page.getByRole('group', { name: next.name, exact: true }).boundingBox();
        const from = await card.boundingBox();
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10);
        await page.mouse.move(column.x + column.width / 2, column.y + 90, { steps: 12 });
        await page.mouse.up();

        await expect.poll(async () => (await readTask(owner.api, task._id)).statusKey).toBe(next.key);
    });

    test('a status changed in a Table cell is saved', async ({ page, state, loginAs }) => {
        const { owner, task, name, next } = await openProjectWithTask({ page, state, loginAs, label: 'Cell' });

        await page.getByRole('button', { name: '+ View', exact: true }).click();
        await page.getByRole('button', { name: /^Table/ }).click();
        await page.getByRole('button', { name: 'Table', exact: true }).click();
        const row = page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
        await row.getByRole('button', { name: /^Status: .+, change$/ }).click();
        await page.getByRole('dialog', { name: 'Select Task Status' }).getByRole('option', { name: next.name }).click();

        await expect.poll(async () => (await readTask(owner.api, task._id)).statusKey).toBe(next.key);
        await expect(row.getByRole('button', { name: `Status: ${next.name}, change` })).toBeVisible();
    });
});
