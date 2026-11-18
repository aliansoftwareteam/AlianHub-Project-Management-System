const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

test.describe('chat', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    // The first message of a new direct conversation is never shown: POST /api/v1/comments answers 404 and the page logs "MainChat: send failed".
    test.fixme('a reply in a thread is posted under its message', async ({ page, state }) => {
        const suffix = uniqueSuffix();
        const message = `Question ${suffix}`;
        const reply = `Answer ${suffix}`;

        await page.goto(`/#/${state.companyId}/chat`);
        await page.getByRole('button', { name: 'New message', exact: true }).click();
        await page.getByRole('button', { name: /Max Member/ }).click();
        const composer = page.getByPlaceholder('Type here');
        await composer.click();
        await composer.pressSequentially(message);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByText(message)).toBeVisible();

        await page.getByText(message).hover();
        await page.getByRole('button', { name: 'Reply in thread', exact: true }).first().click();
        const thread = page.getByRole('complementary', { name: 'Thread' });
        const threadComposer = thread.getByPlaceholder('Type here');
        await threadComposer.fill(reply);
        await threadComposer.press('Enter');

        await expect(thread.getByText(reply, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /1 reply/ })).toBeVisible();
    });
});
