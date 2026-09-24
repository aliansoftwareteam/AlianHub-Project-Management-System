/* eslint-env browser */
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Colour contrast is tracked by its own audit, so this suite guards names, roles and structure.
async function blockingViolations(page) {
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(['color-contrast']).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

// The first-run tour and checklist cover the screen and are audited on their own.
const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

const inDialog = (page) => page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('[role="dialog"]')));

test.describe('accessibility: signed out', () => {
    test('the sign-in page has no serious or critical axe violations', async ({ page }) => {
        await page.goto('/#/login');
        await expect(page.locator('#email')).toBeVisible();
        await expect(page.getByRole('main')).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });
});

test.describe('accessibility: everyday flows as the owner', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('Home', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });

    test('project List and Board', async ({ page, state }) => {
        const { shared } = state.projects;
        await page.goto(`/#/${state.companyId}/project/${shared._id}/s/${state.tasks[0].sprintId}`);
        await expect(page.getByRole('button', { name: 'E2E Task One', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1, name: shared.name })).toBeAttached();
        expect(await blockingViolations(page)).toEqual([]);

        const board = page.getByRole('button', { name: 'Board', exact: true });
        await board.focus();
        await page.keyboard.press('Enter');
        const card = page.locator('.kanban-card .card-title', { hasText: 'E2E Task One' });
        await expect(card).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);

        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();
    });

    test('List bulk bar and its undo notice', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `A11Y BULK ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        let sprintId = '';
        for (const label of ['One', 'Two']) {
            sprintId = (await createTask(owner.api, { project, name: `Bulk ${label} ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid })).sprintId;
        }
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
        const boxes = page.locator('.lv2__row .lv2__select input[type="checkbox"]');
        await expect(boxes).toHaveCount(2);
        await boxes.nth(0).click();
        await boxes.nth(1).click({ modifiers: ['Shift'] });
        const bar = page.getByRole('region', { name: 'Bulk task actions' });
        await expect(bar).toContainText('2 selected');
        expect(await blockingViolations(page)).toEqual([]);

        await bar.getByRole('button', { name: /Status/ }).click();
        await bar.locator('.lv2-bulk__item').last().click();
        const notice = page.getByRole('status').filter({ hasText: 'Updated 2 tasks.' });
        await expect(notice).toBeVisible();
        await expect(notice.getByRole('button', { name: 'Undo' })).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });

    test('task detail overlay', async ({ page, state }) => {
        const task = state.tasks[0];
        await page.goto(`/#/${state.companyId}/project/${task.projectId}/s/${task.sprintId}?task=${task._id}`);
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();
        await expect(page.locator('.ah-detail__panel .task-status-name')).toBeVisible();
        const dialog = page.getByRole('dialog', { name: 'Task detail' });
        await expect(dialog.getByRole('button', { name: 'Next task' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /^Copy task ID / })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Copy task link' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Complete' })).toBeVisible();
        await expect(dialog.getByRole('group', { name: 'Quick actions' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /^Empty/ }).first()).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });

    test('Inbox', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/inbox`);
        await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
        await expect(page.getByRole('main')).toHaveCount(1);
        expect(await blockingViolations(page)).toEqual([]);
    });

    test('Settings, Members', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/members`);
        await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });

    test('Ask', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/ai/ask`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });
});

test.describe('accessibility: keyboard in the task overlay', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('focus stays in the overlay and returns to the row that opened it', async ({ page, state }) => {
        const task = state.tasks[1];
        await page.goto(`/#/${state.companyId}/project/${task.projectId}/s/${task.sprintId}`);
        const row = page.getByRole('button', { name: 'E2E Task Two', exact: true });
        await row.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();
        await expect.poll(() => inDialog(page)).toBe(true);

        for (let i = 0; i < 40; i++) {
            await page.keyboard.press('Tab');
            expect(await inDialog(page), `Tab ${i + 1} left the overlay`).toBe(true);
        }
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Shift+Tab');
            expect(await inDialog(page), `Shift+Tab ${i + 1} left the overlay`).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeHidden();
        await expect(row).toBeFocused();
    });

    test('status and due date open from the keyboard', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `A11Y ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Keyboard ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();

        const status = page.locator('.ah-detail__panel button.task-status-name');
        await status.focus();
        await page.keyboard.press('Enter');
        const picker = page.getByRole('dialog', { name: 'Select Task Status' });
        await expect(picker).toBeVisible();
        const inProgress = picker.getByRole('option', { name: 'In Progress' });
        await inProgress.focus();
        await page.keyboard.press('Enter');
        await expect(picker).toBeHidden();
        await expect(status).toHaveText('In Progress');
        await expect(status).toBeFocused();

        const due = page.locator('.ah-detail__panel').getByRole('textbox', { name: 'Due Date' });
        await due.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.dp__menu')).toBeVisible();
    });

    test('the undo toast after a status change is named, axe clean and works from the keyboard', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `A11Y ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Undo ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();

        const status = page.locator('.ah-detail__panel button.task-status-name');
        const before = (await status.textContent()).trim();
        await status.focus();
        await page.keyboard.press('Enter');
        const picker = page.getByRole('dialog', { name: 'Select Task Status' });
        await picker.getByRole('option', { name: 'In Progress' }).focus();
        await page.keyboard.press('Enter');
        await expect(status).toHaveText('In Progress');

        const toast = page.getByRole('status').filter({ hasText: 'Status updated' });
        await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
        await expect(status).toBeFocused();
        await page.keyboard.press('Control+z');
        await expect(status).toHaveText(before);
    });

    test('copy ID, complete and the quick actions work from the keyboard', async ({ page, context, state, loginAs }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `A11Y ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Quick ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
        const dialog = page.getByRole('dialog', { name: 'Task detail' });
        await expect(dialog).toBeVisible();

        const copyId = dialog.getByRole('button', { name: /^Copy task ID / });
        await copyId.focus();
        await page.keyboard.press('Enter');
        const key = (await copyId.textContent()).trim();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(key);

        const complete = dialog.getByRole('button', { name: 'Complete' });
        await complete.focus();
        await page.keyboard.press('Enter');
        await expect(complete).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.ah-detail__panel button.task-status-name')).toHaveText('Done');
        await page.keyboard.press('Enter');
        await expect(complete).toHaveAttribute('aria-pressed', 'false');

        const addSubtask = dialog.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Add subtask' });
        await addSubtask.focus();
        await page.keyboard.press('Enter');
        await expect(dialog.getByRole('tab', { name: /Subtasks/ })).toHaveAttribute('aria-selected', 'true');
        await expect(dialog.locator('.ah-subtasks__create')).toBeVisible();

        const points = dialog.locator('.story-points').getByRole('button', { name: 'Empty' });
        await points.focus();
        await page.keyboard.press('Enter');
        await expect(dialog.locator('.story-points .sp-menu')).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);
    });
});

test.describe('accessibility: command palette', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('Meta+K opens it from Home, its results are axe clean, and Escape hands focus back', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();
        const opener = page.getByRole('button', { name: 'Search or ask AI' });
        await opener.focus();

        await page.keyboard.press('Meta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        const field = palette.getByRole('combobox', { name: 'Search, go to or run a command' });
        await expect(field).toBeFocused();

        await page.keyboard.type('E2E Task');
        const results = palette.getByRole('listbox');
        await expect(results.getByRole('option', { name: /E2E Task One/ })).toBeVisible();
        await expect(palette.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
        expect(await blockingViolations(page)).toEqual([]);

        await page.keyboard.press('Tab');
        await expect(palette.getByRole('toolbar').getByRole('button', { name: 'Open', exact: true })).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();
        await expect(opener).toBeFocused();
    });
});
