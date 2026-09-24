/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

async function serverTask(api, taskId) {
    const res = await api.get(`/api/v1/task/${taskId}`);
    return (res.body && (res.body.data || res.body)) || {};
}

async function listWithTask({ page, state, owner, name, assigneeIds = [], projectAssignees }) {
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `LIE ${suffix}`, assigneeIds: projectAssignees || [owner.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, name: `${name} ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds });
    const row = page.locator('.lv2__row:not(.is-sub)').filter({ has: page.locator('.lv2__name', { hasText: `${name} ${suffix}` }) });
    return { project, task, row, taskName: `${name} ${suffix}` };
}

test.describe('List rows: inline edit', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('status changes from the row in two clicks and the server has it', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { project, task, row } = await listWithTask({ page, state, owner, name: 'Status inline' });
        const next = project.taskStatusData.find((s) => s.type === 'active');
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);

        await row.getByRole('button', { name: /^Status: .+, change$/ }).click();
        await page.getByRole('dialog', { name: 'Select Task Status' }).getByRole('option', { name: next.name }).click();

        await expect.poll(async () => (await serverTask(owner.api, task._id)).statusKey).toBe(next.key);
        const group = page.locator('.lv2__group').filter({ has: page.locator('.lv2__group-name', { hasText: next.name }) });
        await expect(group.locator('.lv2__row:not(.is-sub)')).toHaveCount(1);
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toHaveCount(0);
    });

    test('the assignee is set inline', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { project, task, row } = await listWithTask({ page, state, owner, name: 'Assign inline' });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);

        await row.getByRole('button', { name: 'Assignee: none, set' }).click();
        const picker = page.getByRole('dialog', { name: 'List Of User' });
        await picker.getByRole('option', { name: /Olivia Owner/ }).click();

        await expect.poll(async () => (await serverTask(owner.api, task._id)).AssigneeUserId || []).toContain(owner.uid);
        await expect(row.getByRole('button', { name: /^Assignee: Olivia Owner, change$/ })).toBeVisible();
    });

    test('Undo in the toast puts the previous status back', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { project, task, row, taskName } = await listWithTask({ page, state, owner, name: 'Undo inline' });
        const open = project.taskStatusData.find((s) => s.type === 'default_active');
        const next = project.taskStatusData.find((s) => s.type === 'active');
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);

        await row.getByRole('button', { name: /^Status: .+, change$/ }).click();
        await page.getByRole('dialog', { name: 'Select Task Status' }).getByRole('option', { name: next.name }).click();
        await expect.poll(async () => (await serverTask(owner.api, task._id)).statusKey).toBe(next.key);

        const toast = page.getByRole('status').filter({ hasText: 'Status updated' });
        await toast.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => (await serverTask(owner.api, task._id)).statusKey).toBe(open.key);
        const back = page.locator('.lv2__row:not(.is-sub)').filter({ has: page.locator('.lv2__name', { hasText: taskName }) });
        await expect(back.getByRole('button', { name: `Status: ${open.name}, change` })).toBeVisible();
    });

    test('Escape closes the status picker and nothing else', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { project, task, row } = await listWithTask({ page, state, owner, name: 'Esc inline' });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);

        await row.locator('.lv2__select input[type="checkbox"]').click();
        await expect(page.getByRole('region', { name: 'Bulk task actions' })).toContainText('1 selected');

        const circle = row.getByRole('button', { name: /^Status: .+, change$/ });
        await circle.focus();
        await page.keyboard.press('Enter');
        const picker = page.getByRole('dialog', { name: 'Select Task Status' });
        await expect(picker).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(picker).toBeHidden();
        await expect(page.getByRole('region', { name: 'Bulk task actions' })).toContainText('1 selected');
    });

    test('at 390 px the status circle still works and the cells fold under the title', async ({ page, state, loginAs }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const owner = await loginAs('owner');
        const { project, task, row } = await listWithTask({ page, state, owner, name: 'Narrow inline' });
        const next = project.taskStatusData.find((s) => s.type === 'active');
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);

        await expect(row.getByRole('button', { name: 'Assignee: none, set' })).toBeVisible();
        const title = await row.locator('.lv2__c-title').boundingBox();
        const assignee = await row.locator('.lv2__c-assignee').boundingBox();
        expect(assignee.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        await row.getByRole('button', { name: /^Status: .+, change$/ }).click();
        await page.getByRole('dialog', { name: 'Select Task Status' }).getByRole('option', { name: next.name }).click();
        await expect.poll(async () => (await serverTask(owner.api, task._id)).statusKey).toBe(next.key);
    });
});

test.describe('List rows: no edit rights', () => {
    test.use(asRole('guest'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a member without edit rights sees the values and no picker', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const guest = state.users.guest;
        const { project, task, row } = await listWithTask({
            page, state, owner, name: 'Read only', assigneeIds: [guest.userId], projectAssignees: [owner.uid, guest.userId],
        });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);

        await expect(row).toBeVisible();
        await expect(row.locator('.lv2__status')).toHaveAttribute('aria-label', /^Status: [^,]+$/);
        await expect(row.getByRole('button', { name: /^(Status|Assignee|Due date|Priority): .+, (change|set)$/ })).toHaveCount(0);
        await expect(row.locator('[data-action="rename"]')).toHaveCount(0);
        await row.locator('.lv2__status').click();
        await expect(page.getByRole('dialog', { name: 'Select Task Status' })).toHaveCount(0);
    });
});
