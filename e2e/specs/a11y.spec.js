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

    test('task detail overlay', async ({ page, state }) => {
        const task = state.tasks[0];
        await page.goto(`/#/${state.companyId}/project/${task.projectId}/s/${task.sprintId}?task=${task._id}`);
        await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();
        await expect(page.locator('.ah-detail__panel .task-status-name')).toBeVisible();
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
});
