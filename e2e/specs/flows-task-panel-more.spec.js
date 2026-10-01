const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, readTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

async function openTaskPanel({ page, state, loginAs, label }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
    await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
    const panel = taskPanel(page);
    await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();
    return { owner, task, panel, suffix };
}

test.describe('description and files in the task panel', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a description typed in the panel saves by itself and is there after a reload', async ({ page, state, loginAs }) => {
        const { owner, task, panel, suffix } = await openTaskPanel({ page, state, loginAs, label: 'Describe' });
        const text = `What this task is about ${suffix}`;

        await panel.getByRole('button', { name: 'Add description', exact: true }).click();
        const editor = panel.getByRole('group', { name: 'Description', exact: true }).locator('[contenteditable="true"]').first();
        await editor.click();
        await page.keyboard.type(text);

        await expect.poll(async () => JSON.stringify(await readTask(owner.api, task._id))).toContain(text);

        await page.reload();
        await expect(taskPanel(page).getByText(text)).toBeVisible();
    });

    test('a file attached in the Files tab is stored on the task', async ({ page, state, loginAs }) => {
        const { owner, task, panel, suffix } = await openTaskPanel({ page, state, loginAs, label: 'Attach' });
        const fileName = `notes-${suffix}.txt`;

        const chooser = page.waitForEvent('filechooser');
        await panel.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Attach', exact: true }).click();
        await (await chooser).setFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(`hello ${suffix}`) });

        await expect(panel.getByRole('heading', { name: /Attachments\(1\)/ })).toBeVisible();
        await expect.poll(async () => JSON.stringify((await readTask(owner.api, task._id)).attachments || [])).toContain(fileName);
    });
});
