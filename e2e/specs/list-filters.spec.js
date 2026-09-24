/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');

const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

test.describe('List view filters', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('"Me" and search narrow the List rows and survive a reload', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `LISTF ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        let sprintId = '';
        for (let n = 1; n <= 11; n += 1) {
            const created = await createTask(owner.api, {
                project,
                name: n === 7 ? `Kilo target ${suffix}` : `List row ${n} ${suffix}`,
                user: state.users.owner,
                companyOwnerId: owner.uid,
                assigneeIds: n <= 3 ? [owner.uid] : [],
            });
            sprintId = created.sprintId;
        }

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${sprintId}`);
        const rows = page.locator('.lv2__row:not(.is-sub) .lv2__name');
        await expect(rows).toHaveCount(11);

        const me = page.locator('.pft .manage__filter-users button[aria-pressed]').first();
        await me.click();
        await expect(rows).toHaveCount(3);
        await expect(me).toHaveAttribute('aria-pressed', 'true');

        await page.reload();
        await expect(rows).toHaveCount(3);
        await expect(page.locator('.pft .manage__filter-users button[aria-pressed]').first()).toHaveAttribute('aria-pressed', 'true');

        await page.locator('.pft .manage__filter-users button[aria-pressed]').first().click();
        await expect(rows).toHaveCount(11);

        const search = page.locator('.pft__input');
        await search.fill('Kilo target');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Kilo target');

        await page.reload();
        await expect(page.locator('.pft__input')).toHaveValue('Kilo target');
        await expect(rows).toHaveCount(1);

        await page.locator('.pft__input').fill(`nothing matches ${suffix}`);
        const clear = page.getByRole('button', { name: 'Clear filters' });
        await expect(clear).toBeVisible();
        await clear.click();
        await expect(page.locator('.pft__input')).toHaveValue('');
        await expect(rows).toHaveCount(11);
    });

    test('group by Assignee lists each assignee and Unassigned, and is remembered', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `LISTG ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const mine = await createTask(owner.api, { project, name: `Mine ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        await createTask(owner.api, { project, name: `Nobody ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${mine.sprintId}`);
        await expect(page.locator('.lv2__row .lv2__name')).toHaveCount(2);

        await page.getByRole('button', { name: 'Group by' }).click();
        await page.locator('#group_by').getByText('Assignee', { exact: true }).click();
        const unassigned = page.locator('.lv2__group').filter({ has: page.locator('.lv2__group-name', { hasText: 'Unassigned' }) });
        await expect(unassigned.locator('.lv2__name')).toHaveText([`Nobody ${suffix}`]);

        await page.reload();
        await expect(page.getByRole('button', { name: 'Group by' })).toContainText('Assignee');
        await expect(unassigned.locator('.lv2__name')).toHaveText([`Nobody ${suffix}`]);
    });
});
