const { test, expect } = require('../support/test');
const { PASSWORD, registerVerifiedAccount, uniqueSuffix } = require('../support/fixtures');
const { firstScreenSettled, skipFirstRun, watchApiAnswers } = require('../support/pages');

// The suite's server has no ready-made company, so the workspace is set up while the person waits.
test.describe.configure({ timeout: 60000 });

/* Sign-up through the real pages: the account is made by the API, then the person signs in, names a workspace
 * and arrives on the last step. */
async function registerAccount(state, { firstName, lastName }) {
    const email = `signup.${uniqueSuffix()}@e2e.alianhub.test`;
    await registerVerifiedAccount(state.baseURL, { firstName, lastName, email });
    return email;
}

test.describe('sign-up', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('ends on Connect your AI, and Skip for now lands on Home', async ({ page, state }) => {
        const email = await registerAccount(state, { firstName: 'Sia', lastName: 'Signup' });

        await page.goto('/#/login');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(PASSWORD);
        await page.locator('.auth__actions button[type="submit"]').click();

        await page.getByRole('textbox', { name: 'Name your workspace' }).fill(`Signup ${uniqueSuffix()}`);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        const answers = watchApiAnswers(page);
        await page.getByRole('button', { name: 'Skip — start blank' }).click();

        await expect(page.getByRole('status').filter({ hasText: /workspace/ })).toBeVisible();
        await expect(page).toHaveURL(/#\/[0-9a-f]{24}\/welcome\/connect-ai/, { timeout: 40000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
        await firstScreenSettled(page);
        expect(answers.refused).toEqual([]);

        await page.getByRole('button', { name: 'Skip for now' }).click();
        await expect(page).not.toHaveURL(/welcome/);
        await expect(page).toHaveURL(/#\/[0-9a-f]{24}(\?.*)?$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    });
});
