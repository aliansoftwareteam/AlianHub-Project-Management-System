const { test, expect, asRole } = require('../support/test');
const { createProject, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

async function newDoc({ state, loginAs, text }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `Docs ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const title = `Doc ${suffix}`;
    const created = await owner.api.post('/api/v2/pages', {
        title,
        projectId: String(project._id),
        contentBlocks: [{ type: 'paragraph', data: { text: text || `Body ${suffix}` } }],
    });
    if (created.status !== 200) throw new Error(`create doc failed (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`);
    return { owner, suffix, title, pageId: String(created.body.data._id), url: `/#/${state.companyId}/pages/${created.body.data._id}` };
}

const commentsPanel = (page) => page.getByRole('complementary', { name: 'Comments' });
const docText = async (api, pageId) => JSON.stringify((await api.get(`/api/v2/pages/${pageId}`)).body);

test.describe('commenting on a doc', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a comment on the whole doc is posted and is still there after a reload', async ({ page, state, loginAs }) => {
        const { url, suffix } = await newDoc({ state, loginAs });
        const comment = `Looks right ${suffix}`;

        await page.goto(url);
        await page.getByRole('button', { name: /^Comments/ }).click();
        const panel = commentsPanel(page);
        await panel.getByRole('combobox', { name: /^Add a comment/ }).fill(comment);
        await panel.getByRole('button', { name: 'Comment', exact: true }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeVisible();

        await page.reload();
        await page.getByRole('button', { name: /^Comments/ }).click();
        await expect(commentsPanel(page).getByText(comment, { exact: true })).toBeVisible();
    });

    test('a reply is added under the comment and the thread can be resolved and reopened', async ({ page, state, loginAs }) => {
        const { url, suffix } = await newDoc({ state, loginAs });
        const comment = `Question ${suffix}`;
        const reply = `Answer ${suffix}`;

        await page.goto(url);
        await page.getByRole('button', { name: /^Comments/ }).click();
        const panel = commentsPanel(page);
        await panel.getByRole('combobox', { name: /^Add a comment/ }).fill(comment);
        await panel.getByRole('button', { name: 'Comment', exact: true }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeVisible();

        await panel.getByRole('button', { name: 'Reply', exact: true }).click();
        const replyBox = panel.getByRole('combobox', { name: /^Reply\./ });
        await replyBox.fill(reply);
        await replyBox.press('Enter');
        await expect(panel.getByText(reply, { exact: true })).toBeVisible();

        await panel.getByRole('button', { name: 'Resolve', exact: true }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeHidden();
        await panel.getByRole('tab', { name: /^Resolved/ }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeVisible();

        await panel.getByRole('button', { name: 'Reopen', exact: true }).click();
        await panel.getByRole('tab', { name: /^Open/ }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeVisible();
    });

    test('a comment can be deleted by its author', async ({ page, state, loginAs }) => {
        const { url, suffix } = await newDoc({ state, loginAs });
        const comment = `Remove me ${suffix}`;

        await page.goto(url);
        await page.getByRole('button', { name: /^Comments/ }).click();
        const panel = commentsPanel(page);
        await panel.getByRole('combobox', { name: /^Add a comment/ }).fill(comment);
        await panel.getByRole('button', { name: 'Comment', exact: true }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeVisible();

        page.once('dialog', (dialog) => dialog.accept());
        await panel.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(panel.getByText(comment, { exact: true })).toBeHidden();

        await page.reload();
        await page.getByRole('button', { name: /^Comments/ }).click();
        await expect(commentsPanel(page).getByText(comment, { exact: true })).toBeHidden();
    });
});

test.describe('editing a doc and its version history', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('text typed into the body is saved by itself', async ({ page, state, loginAs }) => {
        const { url, owner, pageId, suffix } = await newDoc({ state, loginAs, text: `Seed ${uniqueSuffix()}` });
        const added = `typed${suffix}`;

        await page.goto(url);
        const paragraph = page.locator('[contenteditable="true"]').first();
        await expect(paragraph).toBeVisible();
        await paragraph.click();
        await page.keyboard.press('End');
        await page.keyboard.type(` ${added}`);

        await expect.poll(() => docText(owner.api, pageId)).toContain(added);
        await page.reload();
        await expect(page.getByText(added)).toBeVisible();
    });

    test('a version saved by hand is listed in the history', async ({ page, state, loginAs }) => {
        const { url, suffix } = await newDoc({ state, loginAs });
        const versionName = `Checkpoint ${suffix}`;

        await page.goto(url);
        await page.getByRole('button', { name: 'History', exact: true }).click();
        const history = page.getByRole('dialog', { name: 'Version history' });
        await history.getByRole('textbox', { name: 'Version name' }).fill(versionName);
        await history.getByRole('button', { name: 'Save a version', exact: true }).click();

        await expect(history.getByRole('list', { name: 'Versions' }).getByRole('listitem').filter({ hasText: versionName })).toHaveCount(1);
        await expect(history.getByRole('list', { name: 'Versions' }).getByRole('listitem').filter({ hasText: 'Saved by hand' }).first()).toBeVisible();
    });

    test('restoring a version brings back the title it was saved with', async ({ page, state, loginAs }) => {
        const { url, owner, pageId, suffix, title } = await newDoc({ state, loginAs });
        const versionName = `Before rename ${suffix}`;
        const renamed = `${title} renamed`;

        await page.goto(url);
        await page.getByRole('button', { name: 'History', exact: true }).click();
        const history = page.getByRole('dialog', { name: 'Version history' });
        await history.getByRole('textbox', { name: 'Version name' }).fill(versionName);
        await history.getByRole('button', { name: 'Save a version', exact: true }).click();
        await expect(history.getByRole('listitem').filter({ hasText: versionName })).toHaveCount(1);
        await history.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(history).toBeHidden();

        await page.getByPlaceholder('Untitled').fill(renamed);
        await expect.poll(() => docText(owner.api, pageId)).toContain(renamed);

        await page.getByRole('button', { name: 'History', exact: true }).click();
        await history.getByRole('listitem').filter({ hasText: versionName }).getByRole('button').click();
        await history.getByRole('button', { name: 'Restore this version', exact: true }).click();
        await page.getByRole('button', { name: 'Restore this version', exact: true }).last().click();

        await expect(page.getByText('Version restored.')).toBeVisible();
        await expect.poll(() => docText(owner.api, pageId)).toContain(`"title":"${title}"`);
        await expect(page.getByPlaceholder('Untitled')).toHaveValue(title);
    });
});
