const { test, expect } = require('../support/test');
const { emailFor, inviteMember, uniqueSuffix } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 30000 });

test.describe('Simple and Full navigation', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    // A member made for this test: the saved role sessions are on the full rail and shared by every spec.
    test('a new account starts in Simple; Full and back both work and survive a reload', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const email = emailFor('member', suffix);
        await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Sam', lastName: `Simple${suffix}`, navMode: null });
        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

        const rail = page.getByRole('navigation', { name: 'Primary' });
        const simple = page.getByRole('radio', { name: /^Simple/ });
        const full = page.getByRole('radio', { name: /^Full/ });
        const goToSettings = async () => {
            await page.goto(`/#/${state.companyId}/settings/my-profile`);
            await expect(full).toBeVisible();
        };

        await expect(rail.getByRole('link', { name: 'Home' })).toBeVisible();
        await expect(rail.getByRole('link', { name: 'Everything' })).toHaveCount(0);
        await expect(rail.getByRole('link', { name: 'Chat' })).toHaveCount(0);

        await goToSettings();
        await expect(simple).toBeChecked();

        await full.check();
        await expect(rail.getByRole('link', { name: 'Everything' })).toBeVisible();
        await expect(rail.getByRole('link', { name: 'Chat' })).toBeVisible();

        await page.reload();
        await expect(full).toBeChecked();
        await expect(rail.getByRole('link', { name: 'Everything' })).toBeVisible();

        await simple.check();
        await expect(rail.getByRole('link', { name: 'Everything' })).toHaveCount(0);
        await expect(rail.getByRole('link', { name: 'Chat' })).toHaveCount(0);

        await page.reload();
        await expect(simple).toBeChecked();
        await expect(rail.getByRole('link', { name: 'Everything' })).toHaveCount(0);
        await expect(rail.getByRole('link', { name: 'Home' })).toBeVisible();
    });
});
