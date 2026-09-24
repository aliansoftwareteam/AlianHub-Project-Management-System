/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

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
        const project = await createProject(owner.api, { name: `FIRST RUN ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `First run ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid });

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

        for (const workspaceStep of ['Invite your team', 'Create a project', 'Review member permissions', 'Choose project apps', 'Remove the sample data']) {
            await expect(checklist).not.toContainText(workspaceStep);
        }
        await expect(checklist).toContainText('Open a project');
        // The shell tour used to open itself 600 ms after landing, on top of the checklist.
        await page.waitForTimeout(1500);
        await expect(page.locator('.driver-popover')).toHaveCount(0);
    });
});
