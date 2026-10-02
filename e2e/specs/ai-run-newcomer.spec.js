const { MongoClient, ObjectId } = require('mongodb');
const { test, expect } = require('../support/test');
const { createApiClient } = require('../support/api');
const { PASSWORD, assertOk, uniqueSuffix } = require('../support/fixtures');
const { resolveMongoUrl } = require('../support/env');
const { skipFirstRun } = require('../support/pages');

// The workspace and its sample project are made while the person waits.
test.describe.configure({ timeout: 120000 });

/* A second account, made the way a newcomer's is: registered, and its address marked verified because mail is not
 * delivered in the suite (as tests/integration/invitation-signed-in-accept.int.test.js does). It owns the workspace
 * it creates, so nothing here touches the shared owner's. */
async function registerAccount(state, { firstName, lastName }) {
    const email = `newcomer.${uniqueSuffix()}@e2e.alianhub.test`;
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

test.describe('a newcomer', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('signs up, picks a focus and opens a workspace with a sample project, a next step and Simple mode', async ({ page, state }) => {
        const email = await registerAccount(state, { firstName: 'Nina', lastName: 'Newcomer' });
        const workspace = `Newcomer ${uniqueSuffix()}`;

        await page.goto('/#/login');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(PASSWORD);
        await page.locator('.auth__actions button[type="submit"]').click();

        await page.getByRole('textbox', { name: 'Name your workspace' }).fill(workspace);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'What does your team mainly do?' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open my workspace' })).toBeDisabled();
        await page.getByRole('radio', { name: 'Software', exact: true }).click();
        await page.getByRole('button', { name: 'Open my workspace' }).click();

        await expect(page).toHaveURL(/#\/[0-9a-f]{24}\/welcome\/connect-ai/, { timeout: 80000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
        await page.getByRole('button', { name: 'Skip for now' }).click();

        await expect(page).toHaveURL(/#\/[0-9a-f]{24}(\?.*)?$/);
        const companyId = page.url().match(/#\/([0-9a-f]{24})/)[1];
        expect(companyId).not.toBe(state.companyId);
        await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();

        const next = page.getByRole('region', { name: 'What next' });
        await expect(next).toBeVisible();
        await expect(next.getByRole('button')).toBeVisible();

        const rail = page.getByRole('navigation', { name: 'Primary' });
        await expect(rail.getByRole('link', { name: 'Home' })).toBeVisible();
        await expect(rail.getByRole('link', { name: 'Everything' })).toHaveCount(0);
        await expect(rail.getByRole('link', { name: 'Chat' })).toHaveCount(0);

        await page.goto(`/#/${companyId}/settings/my-profile`);
        await expect(page.getByRole('radio', { name: /^Simple/ })).toBeChecked();

        await page.goto(`/#/${companyId}/project`);
        await expect(page.getByText('Welcome to AlianHub', { exact: true }).first()).toBeVisible();
    });
});
