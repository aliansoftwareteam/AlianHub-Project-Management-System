const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

async function listWithTasks({ state, loginAs, names }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `Sort ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    let sprintId = '';
    for (const label of names) {
        const created = await createTask(owner.api, { project, name: `${label} ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid });
        sprintId = created.sprintId;
    }
    return { project, sprintId, suffix, titles: (order) => order.map((label) => `${label} ${suffix}`) };
}

const taskRows = (page, suffix) => page.getByRole('row').filter({ hasText: suffix });

async function sortBy(page, key, direction) {
    await page.getByRole('button', { name: 'Sort', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Sort tasks by' });
    await panel.getByRole('radio', { name: key, exact: true }).check();
    if (direction) await panel.getByRole('radio', { name: direction, exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
}

const viewBar = (page) => page.getByRole('region', { name: 'View settings' });

test.describe('sorting a List', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('Sort by Name puts the tasks in order and Descending reverses it', async ({ page, state, loginAs }) => {
        const { project, sprintId, suffix, titles } = await listWithTasks({ state, loginAs, names: ['Bravo', 'Charlie', 'Alpha'] });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
        await expect(taskRows(page, suffix)).toHaveCount(3);

        await sortBy(page, 'Name');
        await expect(taskRows(page, suffix)).toContainText(titles(['Alpha', 'Bravo', 'Charlie']));
        await expect(page.getByRole('button', { name: 'Name ↑' })).toBeVisible();

        await sortBy(page, 'Name', 'Descending');
        await expect(taskRows(page, suffix)).toContainText(titles(['Charlie', 'Bravo', 'Alpha']));
        await expect(page.getByRole('button', { name: 'Name ↓' })).toBeVisible();
    });

    test('a saved sort is still applied after a reload', async ({ page, state, loginAs }) => {
        const { project, sprintId, suffix, titles } = await listWithTasks({ state, loginAs, names: ['Mike', 'Zulu', 'Echo'] });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
        await expect(taskRows(page, suffix)).toHaveCount(3);
        await sortBy(page, 'Name', 'Descending');
        await expect(taskRows(page, suffix)).toContainText(titles(['Zulu', 'Mike', 'Echo']));

        const bar = viewBar(page);
        await expect(bar).toContainText('Unsaved changes');
        await bar.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(bar).toBeHidden();

        await page.reload();
        await expect(page.getByRole('button', { name: 'Name ↓' })).toBeVisible();
        await expect(taskRows(page, suffix)).toContainText(titles(['Zulu', 'Mike', 'Echo']));
    });

    test('Reset on an unsaved sort brings back the order the tasks were added in', async ({ page, state, loginAs }) => {
        const { project, sprintId, suffix } = await listWithTasks({ state, loginAs, names: ['Tango', 'Delta', 'Oscar'] });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
        const rows = taskRows(page, suffix);
        await expect(rows).toHaveCount(3);
        const addedOrder = (await rows.allTextContents()).map((text) => text.trim());

        await sortBy(page, 'Name');
        await expect(rows).toContainText([`Delta ${suffix}`, `Oscar ${suffix}`, `Tango ${suffix}`]);

        await viewBar(page).getByRole('button', { name: 'Reset', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Sort', exact: true })).toBeVisible();
        await expect.poll(async () => (await rows.allTextContents()).map((text) => text.trim())).toEqual(addedOrder);
    });
});
