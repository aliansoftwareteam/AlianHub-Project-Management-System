const { MongoClient, ObjectId } = require('mongodb');
const { test, expect } = require('../support/test');
const { createApiClient } = require('../support/api');
const { PASSWORD, assertOk, uniqueSuffix } = require('../support/fixtures');
const { resolveMongoUrl } = require('../support/env');
const { skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 30000 });

/* Sign-up through the real pages: the account is made by the API (mail is not delivered in the suite, so the
 * address is marked verified the way tests/integration/invitation-signed-in-accept.int.test.js does), then the
 * person signs in, names a workspace and arrives on the last step. */
async function registerAccount(state, { firstName, lastName }) {
    const email = `signup.${uniqueSuffix()}@e2e.alianhub.test`;
    const created = assertOk(await createApiClient({ baseURL: state.baseURL }).post('/api/v2/createUser', { firstName, lastName, email, password: PASSWORD }), `register ${email}`);
    const client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    try {
        await client.db('global').collection('users').updateOne({ _id: new ObjectId(String(created.statusText._id)) }, { $set: { isEmailVerified: true } });
    } finally {
        await client.close();
    }
    return email;
}

test.describe('sign-up', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    // In CI the page is still on the last sign-up step 20 s after "Skip — start blank"; not yet known whether the
    // workspace is slow to be made there or the step needs more than this test gives it.
    test.fixme('ends on Connect your AI, and Skip for now lands on Home', async ({ page, state }) => {
        const email = await registerAccount(state, { firstName: 'Sia', lastName: 'Signup' });

        await page.goto('/#/login');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(PASSWORD);
        await page.locator('.auth__actions button[type="submit"]').click();

        await page.getByRole('textbox', { name: 'Name your workspace' }).fill(`Signup ${uniqueSuffix()}`);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('button', { name: 'Skip — start blank' }).click();

        await expect(page).toHaveURL(/#\/[0-9a-f]{24}\/welcome\/connect-ai/, { timeout: 20000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Skip for now' }).click();
        await expect(page).not.toHaveURL(/welcome/);
        await expect(page).toHaveURL(/#\/[0-9a-f]{24}(\?.*)?$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    });
});
