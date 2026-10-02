/* eslint-env browser */
const { test, expect, asRole } = require('../support/test');
const { createProject, findTasksByName, firstSprint, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 45000 });

test.describe('quick create from the Inbox', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('the task lands in the project the person last had open, not the one last used', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const used = await createProject(owner.api, { name: `QC Used ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const opened = await createProject(owner.api, { name: `QC Opened ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        await firstSprint(owner.api, used._id);
        await firstSprint(owner.api, opened._id);

        await page.addInitScript(([cid, pid]) => {
            const uid = localStorage.getItem('userId');
            if (uid) localStorage.setItem(`ah.quickCreate.lastProject.${cid}.${uid}`, pid);
        }, [state.companyId, String(used._id)]);
        // Both workers sign in as the same owner, so the server's list of visits changes under a running test.
        await page.route(/\/api\/v2\/recent-visits\?types=project,sprint/, (route) => route.fulfill({
            json: { status: true, data: [{ type: 'project', route: { projectId: String(opened._id) } }] },
        }));

        await page.goto(`/#/${state.companyId}/inbox`);
        const heading = page.getByRole('heading', { level: 1, name: 'Inbox' });
        await expect(heading).toBeVisible();
        await heading.click();

        await page.keyboard.press('c');
        const dialog = page.getByRole('dialog', { name: 'New task' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('combobox', { name: 'Project' })).toHaveValue(String(opened._id));

        const name = `Opened first ${uniqueSuffix()}`;
        await dialog.getByRole('textbox', { name: 'Task name' }).fill(name);
        await page.keyboard.press('Enter');
        await expect(dialog).toBeHidden();

        await expect.poll(async () => (await findTasksByName(owner.api, String(opened._id), name)).length, { timeout: 15000 }).toBe(1);
        expect(await findTasksByName(owner.api, String(used._id), name)).toHaveLength(0);
    });
});
