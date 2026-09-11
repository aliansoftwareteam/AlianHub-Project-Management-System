const { test, expect, asRole } = require('../support/test');
const { settingsNav, signInThroughForm } = require('../support/pages');

test.describe('sign-in', () => {
    test('the owner signs in through the form and lands on Home', async ({ page, state }) => {
        await signInThroughForm(page, { email: state.users.owner.email, password: state.password, companyId: state.companyId });
        await expect(page.locator('.ah-toolbar__title')).toHaveText('Today & Overdue');
    });
});

test.describe('instance console as the owner', () => {
    test.use(asRole('owner'));

    test('Instance > Stats shows the running version', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/notifications`);
        const nav = settingsNav(page);
        await expect(nav.getByText('Instance', { exact: true })).toBeVisible();
        await nav.getByRole('link', { name: 'Stats', exact: true }).click();
        await expect(page.locator('[data-test="version-label"]')).toHaveText(/^v14\./);
    });
});

test.describe('instance console as a member', () => {
    test.use(asRole('member'));

    test('the Instance section is not offered', async ({ page, state }) => {
        const access = page.waitForResponse((res) => res.url().includes('/api/v2/instance/access'));
        await page.goto(`/#/${state.companyId}/settings/notifications`);
        expect((await access).status()).toBe(403);

        const nav = settingsNav(page);
        await expect(nav.getByText('Personal', { exact: true })).toBeVisible();
        await expect(nav.getByText('Instance', { exact: true })).toHaveCount(0);
        await expect(nav.getByRole('link', { name: 'Stats', exact: true })).toHaveCount(0);
    });
});
