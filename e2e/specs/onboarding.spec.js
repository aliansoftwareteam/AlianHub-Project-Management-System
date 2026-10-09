/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, emailFor, inviteMember, uniqueSuffix } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun } = require('../support/pages');

const skipTours = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
});

/* What sits on top at the centre of a control: the control itself (or its content), or something covering it. */
const coveredBy = (locator) => locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top && (el === top || el.contains(top)) ? null : (top && (top.className || top.tagName)) || 'nothing';
});

test.describe('first run at 1280 × 800', () => {
    test.use({ ...asRole('owner'), viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipTours(page));

    test('an open task keeps its timer and comment Send clickable', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `FIRST RUN ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid, apps: ['TimeTracking'] });
        const task = await createTask(owner.api, { project, name: `First run ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}`);
        await page.locator('.lv2__row .lv2__name').first().click();
        const dialog = page.getByRole('dialog', { name: 'Task detail' });
        await expect(dialog).toBeVisible();

        await expect(page.locator('.ah-gs')).toHaveCount(0);
        await expect(page.getByRole('region', { name: /Getting started|Workspace setup|Get going/ })).toHaveCount(0);

        const timer = dialog.locator('.ah-timer button:visible').first();
        await expect(timer).toBeVisible();
        expect(await coveredBy(timer)).toBeNull();
        await timer.click({ trial: true });

        const send = dialog.getByRole('button', { name: 'Send', exact: true }).first();
        await send.scrollIntoViewIfNeeded();
        await expect(send).toBeVisible();
        expect(await coveredBy(send)).toBeNull();
        await send.click({ trial: true });
    });
});

test.describe('a new member', () => {
    test.use({ ...asRole('member'), viewport: { width: 1280, height: 800 } });

    test('gets one personal checklist with no workspace steps', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}`);
        const checklist = page.getByRole('region', { name: 'Get going' });
        await expect(checklist).toBeVisible();
        await expect(page.getByRole('region', { name: /Getting started|Workspace setup/ })).toHaveCount(0);
        await expect(page.locator('.ah-gs')).toHaveCount(0);

        for (const ownStep of ['Open My Work', 'Set your notifications', 'Learn the shortcuts']) {
            await expect(checklist.getByRole('list')).toContainText(ownStep);
        }
        for (const workspaceStep of ['Invite your team', 'Create or import a project', 'Add a task', 'Pick a look', 'Remove sample data']) {
            await expect(checklist).not.toContainText(workspaceStep);
        }
    });
});

test.describe('a brand-new account', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    const SIMPLE = ['Home', 'My work', 'Projects', 'Inbox', 'Ask', 'App connections'];

    // A member made for this test: the saved role sessions are shared by every other spec and stay on the full rail.
    test('starts on six places, still reaches the rest, and switches to Full in one click', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const email = emailFor('member', suffix);
        await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Nia', lastName: `Newcomer${suffix}`, navMode: null });
        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

        const rail = page.getByRole('navigation', { name: 'Primary' });
        const places = rail.locator('.ah-rail__items > a.ah-rail__item .ah-rail__label');
        await expect(places.first()).toHaveText('Home');
        const shown = await places.allTextContents();
        expect(shown.map((label) => label.trim()).filter((label) => !SIMPLE.includes(label))).toEqual([]);
        expect(shown.length).toBeLessThanOrEqual(SIMPLE.length);
        await expect(rail.getByRole('link', { name: 'Planner' })).toHaveCount(0);

        await rail.getByRole('button', { name: 'More' }).click();
        await expect(page.getByRole('menu')).toContainText('More places');
        await page.getByRole('menuitem', { name: 'Planner' }).click();
        await expect(page).toHaveURL(/\/planner/);
        await expect(rail.getByRole('link', { name: 'Planner' })).toBeVisible();

        await page.goto(`/#/${state.companyId}/goals`);
        await expect(page).toHaveURL(/\/goals/);
        await expect(rail.getByRole('link', { name: 'Goals' })).toBeVisible();

        await page.goto(`/#/${state.companyId}/settings/my-profile`);
        const choice = page.locator('[data-test="nav-mode"]');
        await expect(choice.getByRole('radio', { name: /Simple/ })).toBeChecked();
        await choice.getByRole('radio', { name: /Full/ }).check();
        await expect(rail.getByRole('link', { name: 'Chat' })).toBeVisible();
        await expect(rail.getByRole('link', { name: 'Everything' })).toBeVisible();

        await page.reload();
        await expect(page.locator('[data-test="nav-mode"]').getByRole('radio', { name: /Full/ })).toBeChecked();
        await expect(rail.getByRole('link', { name: 'Everything' })).toBeVisible();
    });

    test('skips Connect your AI in one click and lands in the app', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const email = emailFor('member', suffix);
        await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Cal', lastName: `Connector${suffix}`, navMode: null });
        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

        await page.goto(`/#/${state.companyId}/welcome/connect-ai`);
        await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
        await expect(page.locator('[data-test="connect-ai-sign"]')).toContainText('Not connected yet');
        await expect(page.locator('[data-test="connect-ai-way-token"]')).toBeVisible();

        await page.getByRole('button', { name: 'Skip for now' }).click();
        await expect(page).not.toHaveURL(/welcome/);
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    });
});
