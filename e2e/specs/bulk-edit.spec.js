/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

async function openListWithTasks({ page, state, loginAs, count, prefix }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${prefix} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    let sprintId = '';
    for (let i = 1; i <= count; i += 1) {
        const created = await createTask(owner.api, { project, name: `${prefix} ${i} ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid });
        sprintId = created.sprintId;
    }
    await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
    const boxes = page.locator('.lv2__row .lv2__select input[type="checkbox"]');
    await expect(boxes).toHaveCount(count);
    return boxes;
}

test.describe('bulk edit', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('at 390 px the bulk bar sits inside the viewport, above the tab bar, and takes clicks', async ({ page, state, loginAs }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const boxes = await openListWithTasks({ page, state, loginAs, count: 12, prefix: 'BULK390' });
        await boxes.nth(0).click();
        await boxes.nth(1).click();

        const bar = page.getByRole('region', { name: 'Bulk task actions' });
        await expect(bar).toBeVisible();
        await expect(bar).toContainText('2 selected');
        const box = await bar.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(844);

        const tabbar = await page.locator('.ah-tabbar').boundingBox();
        if (tabbar) expect(box.y + box.height).toBeLessThanOrEqual(tabbar.y + 0.5);

        const status = bar.getByRole('button', { name: /Status/ });
        await status.click();
        await expect(bar.locator('.lv2-bulk__menu')).toBeVisible();

        const menu = await bar.locator('.lv2-bulk__menu').boundingBox();
        expect(menu.y).toBeGreaterThanOrEqual(0);
        expect(menu.y + menu.height).toBeLessThanOrEqual(box.y + 0.5);
        await page.keyboard.press('Escape');

        await page.locator('.lv2__scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const lastRow = await page.locator('.lv2__row').last().boundingBox();
        expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(box.y + 0.5);
    });

    test('shift-click selects the rows between two clicks at 1280 px', async ({ page, state, loginAs }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const boxes = await openListWithTasks({ page, state, loginAs, count: 4, prefix: 'RANGE' });
        await boxes.nth(0).click();
        await boxes.nth(2).click({ modifiers: ['Shift'] });

        await expect(page.getByRole('region', { name: 'Bulk task actions' })).toContainText('3 selected');
        await expect(boxes.nth(0)).toBeChecked();
        await expect(boxes.nth(1)).toBeChecked();
        await expect(boxes.nth(2)).toBeChecked();
        await expect(boxes.nth(3)).not.toBeChecked();

        await boxes.nth(2).focus();
        await page.keyboard.press('Shift+ArrowDown');
        await expect(page.getByRole('region', { name: 'Bulk task actions' })).toContainText('4 selected');
        await expect(boxes.nth(3)).toBeFocused();
    });
});
