/* eslint-env browser */
const { MongoClient, ObjectId } = require('mongodb');
const { test, expect, asRole } = require('../support/test');
const { emailFor, readTask, uniqueSuffix } = require('../support/fixtures');
const { resolveMongoUrl } = require('../support/env');
const { settingsNav, skipFirstRun, taskPanel } = require('../support/pages');

test.describe('opening a notification from the Inbox', () => {
    test.use(asRole('admin'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    let client;
    const seeded = [];
    test.beforeAll(async () => {
        client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
        await client.connect();
    });
    test.afterAll(async () => {
        if (!client) return;
        const [first] = seeded;
        if (first) await client.db(first.companyId).collection('notifications').deleteMany({ _id: { $in: seeded.map((s) => s._id) } });
        await client.close();
    });

    test('Open on a task notification opens that task over the Inbox', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const task = state.tasks[1];
        const taskName = (await readTask(owner.api, task._id)).TaskName;
        const doc = {
            _id: new ObjectId(),
            key: 'task_status',
            message: `<p>Open me ${suffix}</p>`,
            projectId: new ObjectId(String(task.projectId)),
            sprintId: new ObjectId(String(task.sprintId)),
            taskId: task._id,
            type: 'tasks',
            userId: state.users.owner.userId,
            assigneeUsers: [state.users.admin.userId],
            notSeen: [state.users.admin.userId],
            receiverID: state.users.admin.userId,
            notificationType: 'push',
            companyId: state.companyId,
            uniqueId: uniqueSuffix(),
            createdAt: new Date(Date.now() + 60 * 60 * 1000),
            updatedAt: new Date(Date.now() + 60 * 60 * 1000),
        };
        await client.db(state.companyId).collection('notifications').insertOne(doc);
        seeded.push({ _id: doc._id, companyId: state.companyId });

        // The Inbox opens on "Needs your approval" whenever another spec has a change waiting for the owner.
        await page.goto(`/#/${state.companyId}/inbox?tab=primary`);
        const card = page.getByRole('article').filter({ hasText: suffix });
        await expect(card).toHaveCount(1);
        await card.getByRole('button', { name: /^Open( task)?$/ }).click();

        await expect(taskPanel(page).getByRole('heading', { level: 2, name: taskName })).toBeVisible();
    });
});

test.describe('inviting a member', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a sent invitation shows as a pending row and stays after a reload', async ({ page, state }) => {
        const email = emailFor('member', `invitee.${uniqueSuffix()}`);

        await page.goto(`/#/${state.companyId}/settings/members`);
        await page.getByRole('button', { name: 'Invite', exact: true }).click();
        await page.getByRole('textbox', { name: 'Invite by email', exact: true }).fill(email);
        await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption({ label: 'Member' });
        await page.getByRole('button', { name: 'Send', exact: true }).click();

        await expect(page.getByText(email, { exact: true })).toBeVisible();
        await expect(page.getByText(/^invited /)).toBeVisible();

        await page.reload();
        await expect(page.getByText(email, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'resend', exact: true })).toBeVisible();
    });
});

test.describe('theme, look and accent in My profile', () => {
    test.use(asRole('admin'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    const html = (page) => page.locator('html');

    test('Theme and Look are applied at once and kept after a reload', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/my-profile`);
        await expect(settingsNav(page)).toBeVisible();

        await page.getByRole('radiogroup', { name: 'Theme', exact: true }).getByRole('radio', { name: 'Dark', exact: true }).click();
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');

        await page.getByRole('radiogroup', { name: 'Look', exact: true }).getByRole('radio', { name: /^Airy/ }).check();
        await expect(html(page)).toHaveAttribute('data-variant', 'c');

        await page.reload();
        await expect(html(page)).toHaveAttribute('data-theme', 'dark');
        await expect(html(page)).toHaveAttribute('data-variant', 'c');
        await expect(page.getByRole('radiogroup', { name: 'Theme', exact: true }).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
        await expect(page.getByRole('radiogroup', { name: 'Look', exact: true }).getByRole('radio', { name: /^Airy/ })).toBeChecked();
    });

    test('the accent colour changes the page and is kept after a reload', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/my-profile`);

        await page.getByRole('radiogroup', { name: 'Accent colour' }).getByRole('radio', { name: 'Teal', exact: true }).check();
        await expect(html(page)).toHaveAttribute('data-accent', 'teal');

        await page.reload();
        await expect(html(page)).toHaveAttribute('data-accent', 'teal');
        await expect(page.getByRole('radio', { name: 'Teal', exact: true })).toBeChecked();
    });
});
