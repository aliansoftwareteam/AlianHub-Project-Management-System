/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, firstSprint, uniqueSuffix } = require('../support/fixtures');

const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

const rememberProject = (page, companyId, projectId) => page.addInitScript(([cid, pid]) => {
    const uid = localStorage.getItem('userId');
    if (uid) localStorage.setItem(`ah.quickCreate.lastProject.${cid}.${uid}`, pid);
}, [companyId, projectId]);

async function tasksNamed(api, projectId, name) {
    const res = await api.post('/api/v1/task/find', {
        findQuery: { $match: { $or: [{ objId: { ProjectID: projectId } }, { ProjectID: projectId }], TaskName: name, deletedStatusKey: 0 } },
    });
    return Array.isArray(res.body) ? res.body : [];
}

test.describe('create a task from anywhere', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('c on the Inbox opens the dialog and Enter creates the task in the last used project', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `QC Last ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        await firstSprint(owner.api, project._id);
        await rememberProject(page, state.companyId, String(project._id));

        await page.goto(`/#/${state.companyId}/inbox`);
        const heading = page.getByRole('heading', { level: 1, name: 'Inbox' });
        await expect(heading).toBeVisible();
        await heading.click();

        await page.keyboard.press('c');
        const dialog = page.getByRole('dialog', { name: 'New task' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('textbox', { name: 'Task name' })).toBeFocused();
        await expect(dialog.getByRole('combobox', { name: 'Project' })).toHaveValue(String(project._id));

        const name = `Quick ${uniqueSuffix()}`;
        await page.keyboard.type(name);
        await page.keyboard.press('Enter');
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('status').filter({ hasText: 'Task created' })).toBeVisible();
        await expect.poll(async () => (await tasksNamed(owner.api, String(project._id), name)).length, { timeout: 15000 }).toBe(1);
    });

    test('the palette runs "new task" on Enter instead of asking AI', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/inbox`);
        await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();

        await page.keyboard.press('Meta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        await page.keyboard.type('new task');
        await expect(palette.getByRole('option').first()).toContainText('New task');
        await page.keyboard.press('Enter');

        await expect(palette).toBeHidden();
        const dialog = page.getByRole('dialog', { name: 'New task' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('textbox', { name: 'Task name' })).toBeFocused();
        expect(page.url()).not.toContain('/ai/ask');

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });
});
