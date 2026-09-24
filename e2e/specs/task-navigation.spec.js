const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

test.describe('task detail navigation', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('j and k walk the list the task was opened from, and history and reload follow', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `NAV ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const ids = {};
        for (const label of ['Alpha', 'Bravo', 'Charlie']) {
            const name = `Nav ${label} ${suffix}`;
            ids[name] = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
        }
        const sprintId = Object.values(ids)[0].sprintId;
        const openTaskIs = (name) => expect(page).toHaveURL(new RegExp(`[?&]task=${ids[name]._id}`));

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
        const rows = page.locator('.lv2__row .lv2__name');
        await expect(rows).toHaveCount(3);
        const order = await rows.allTextContents();

        await rows.first().click();
        const dialog = page.getByRole('dialog', { name: 'Task detail' });
        await expect(dialog).toBeVisible();
        await openTaskIs(order[0]);
        const prev = dialog.getByRole('button', { name: 'Previous task' });
        const next = dialog.getByRole('button', { name: 'Next task' });
        await expect(prev).toBeDisabled();
        await expect(next).toBeEnabled();

        await page.keyboard.press('j');
        await openTaskIs(order[1]);
        await expect(dialog.locator('.ah-detail__nav-pos')).toHaveText('2 / 3');
        await page.keyboard.press('j');
        await openTaskIs(order[2]);
        await expect(next).toBeDisabled();
        await page.keyboard.press('j');
        await openTaskIs(order[2]);

        await page.keyboard.press('k');
        await openTaskIs(order[1]);

        await page.goBack();
        await openTaskIs(order[2]);
        await expect(dialog).toBeVisible();

        await page.reload();
        await expect(dialog).toBeVisible();
        await openTaskIs(order[2]);
        await expect(dialog.locator('.ah-detail__nav-pos')).toHaveText('3 / 3');
        await next.focus();
        await prev.focus();
        await page.keyboard.press('ArrowUp');
        await openTaskIs(order[1]);
        await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    });

    test('a task opened from Inbox-style links has no arrows', async ({ page, state }) => {
        const task = state.tasks[0];
        await page.goto(`/#/${state.companyId}/inbox?task=${task._id}`);
        const dialog = page.getByRole('dialog', { name: 'Task detail' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Copy task link' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Next task' })).toHaveCount(0);
    });
});
