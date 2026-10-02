const { test, expect, asRole } = require('../support/test');
const { createProject, listSprints, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

async function channelUrl({ state, loginAs }) {
    const owner = await loginAs('owner');
    const project = await createProject(owner.api, { name: `Chat ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const [channel] = await listSprints(owner.api, project._id);
    return `/#/${state.companyId}/chat/${project._id}/${channel._id || channel.id}`;
}

async function send(page, text) {
    const composer = page.getByRole('combobox', { name: 'Type here' });
    await composer.fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test.describe('chat in a channel', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a message sent in a channel is shown and is still there after a reload', async ({ page, state, loginAs }) => {
        const url = await channelUrl({ state, loginAs });
        const message = `Hello channel ${uniqueSuffix()}`;

        await page.goto(url);
        await send(page, message);
        await expect(page.getByText(message, { exact: true })).toBeVisible();

        await page.reload();
        await expect(page.getByText(message, { exact: true })).toBeVisible();
    });

    test('a reply in a thread is posted under its message', async ({ page, state, loginAs }) => {
        const url = await channelUrl({ state, loginAs });
        const suffix = uniqueSuffix();
        const message = `Question ${suffix}`;
        const reply = `Answer ${suffix}`;

        await page.goto(url);
        await send(page, message);
        const posted = page.getByText(message, { exact: true });
        await expect(posted).toBeVisible();

        await posted.hover();
        await page.getByRole('button', { name: 'More', exact: true }).last().click();
        await page.getByRole('menuitem', { name: 'Reply in thread' }).click();
        const thread = page.getByRole('complementary', { name: 'Thread' });
        const threadComposer = thread.getByRole('combobox', { name: 'Type here' });
        await threadComposer.fill(reply);
        await thread.getByRole('button', { name: 'Send', exact: true }).click();

        await expect(thread.getByText(reply, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open the thread, 1 reply' })).toBeVisible();
    });
});
