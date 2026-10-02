const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

async function openNewChannel(page, state, name) {
    await page.goto(`/#/${state.companyId}/chat`);
    // The page opens the first channel by itself once the list is loaded; creating one before that would be undone by it.
    await expect(page.getByRole('combobox', { name: 'Type here' }).or(page.getByRole('heading', { name: /^Welcome to/ }))).toBeVisible();
    await page.getByRole('button', { name: 'New channel' }).first().click();
    const sidebar = page.getByPlaceholder('Enter Channel Name');
    await sidebar.fill(name);
    await page.getByRole('button', { name: 'Create Channel', exact: true }).click();
    await page.waitForURL(/\/chat\/[0-9a-f]{24}\/[0-9a-f]{24}/);
}

/* The panel mounts again once the new channel is open, so a fill can land on the one that goes away. */
async function send(scope, text) {
    await expect(async () => {
        await scope.getByRole('combobox', { name: 'Type here' }).fill(text);
        await scope.getByRole('button', { name: 'Send', exact: true }).click({ timeout: 2000 });
    }).toPass();
}

test.describe('chat in a channel', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a new channel is listed and opens', async ({ page, state }) => {
        const name = `channel-${uniqueSuffix()}`;

        await openNewChannel(page, state, name);
        await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
        await expect(page.getByRole('combobox', { name: 'Type here' })).toBeVisible();

        await page.reload();
        await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    });

    test('a message sent in a channel is shown and is still there after a reload', async ({ page, state }) => {
        const suffix = uniqueSuffix();
        const message = `Hello channel ${suffix}`;

        await openNewChannel(page, state, `hello-${suffix}`);
        await send(page, message);
        await expect(page.getByText(message, { exact: true })).toBeVisible();

        await page.reload();
        await expect(page.getByText(message, { exact: true })).toBeVisible();
    });

    test('a reply in a thread is posted under its message', async ({ page, state }) => {
        const suffix = uniqueSuffix();
        const message = `Question ${suffix}`;
        const reply = `Answer ${suffix}`;

        await openNewChannel(page, state, `thread-${suffix}`);
        await send(page, message);
        const posted = page.getByText(message, { exact: true });
        await expect(posted).toBeVisible();

        await posted.hover();
        await page.getByRole('main').getByRole('button', { name: 'More actions', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Reply in thread' }).click();
        const thread = page.getByRole('complementary', { name: 'Thread' });
        await send(thread, reply);

        await expect(thread.getByText(reply, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open the thread, 1 reply' })).toBeVisible();
    });
});
