const { test, expect, asRole } = require('../support/test');
const { settingsNav } = require('../support/pages');

test.describe('inbox as the owner', () => {
    test.use(asRole('owner'));

    test('renders the Inbox and shows the empty state on a fresh workspace', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/inbox`);
        await expect(page.locator('.ah-toolbar__title')).toHaveText('Inbox');
        await expect(page.locator('.ibx__zero-title')).toHaveText("You're all caught up");
    });
});

test.describe('inbox as a member', () => {
    test.use(asRole('member'));

    test('renders the Inbox', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/inbox`);
        await expect(page.locator('.ah-toolbar__title')).toHaveText('Inbox');
    });
});

test.describe("what's new as the owner", () => {
    test.use(asRole('owner'));

    test('shows the changelog with the running version', async ({ page, state }) => {
        const changelog = page.waitForResponse((res) => res.url().includes('/api/v2/changelog'));
        await page.goto(`/#/${state.companyId}/whats-new`);
        expect((await changelog).status()).toBe(200);
        await expect(page.locator('.chg__title')).toHaveText("What's new");
        await expect(page.locator('.chg__chip').first()).toBeVisible();
    });
});

test.describe('chat as the owner', () => {
    test.use(asRole('owner'));

    test('renders the chat workspace', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/chat`);
        await expect(page.getByText('Direct messages', { exact: true })).toBeVisible();
        await expect(page.getByText('Channels', { exact: true })).toBeVisible();
    });
});

test.describe('notification preferences as the owner', () => {
    test.use(asRole('owner'));

    test('opens the Notifications settings screen', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/notifications`);
        await expect(settingsNav(page).getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
        await expect(page.getByText('Agent activity', { exact: true })).toBeVisible();
    });
});
