const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

test.describe('custom fields', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a field made with only a name is saved and listed after a reload', async ({ page, state }) => {
        const title = `Field ${uniqueSuffix()}`;

        await page.goto(`/#/${state.companyId}/settings/custom-field`);
        await page.getByRole('button', { name: 'Field', exact: true }).click();
        const label = page.getByRole('dialog', { name: 'Create Custom Field' }).getByRole('textbox', { name: 'Field Label' });
        await label.fill(title);
        await label.press('Enter');

        const row = page.getByRole('button', { name: new RegExp(title) }).first();
        await expect(row).toBeVisible();

        await page.reload();
        await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible();
    });
});
