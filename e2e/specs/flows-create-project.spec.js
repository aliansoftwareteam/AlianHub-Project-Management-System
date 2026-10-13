const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

const newProjectDialog = (page) => page.getByRole('dialog', { name: 'New project' });

const projectNamed = async (api, name) => {
    const list = await api.get('/api/v1/project');
    return (Array.isArray(list.body) ? list.body : []).find((project) => project.ProjectName === name);
};

test.describe('creating a project', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('New project from Home creates a blank project and opens it', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const name = `Made from Home ${suffix}`;
        const key = `H${suffix.toUpperCase()}`;
        await page.goto(`/#/${state.companyId}`);
        await page.getByRole('button', { name: '+ New' }).click();
        await page.getByRole('menuitem', { name: 'New project' }).click();

        const dialog = newProjectDialog(page);
        await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
        await dialog.getByRole('textbox', { name: 'Key', exact: true }).fill(key);
        await dialog.getByRole('button', { name: 'Create project' }).click();

        await expect(dialog).toBeHidden();
        await page.waitForURL(/\/project\/[0-9a-f]{24}/);
        const projectId = /\/project\/([0-9a-f]{24})/.exec(page.url())[1];
        await expect.poll(async () => (await projectNamed(owner.api, name))?._id).toBe(projectId);
        expect((await projectNamed(owner.api, name)).ProjectCode).toBe(key);
    });

    test('New project on the Projects page adds the project to the list', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const name = `Made from list ${suffix}`;
        await page.goto(`/#/${state.companyId}/project`);
        await page.getByRole('button', { name: 'New project' }).first().click();

        const dialog = newProjectDialog(page);
        await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
        await dialog.getByRole('textbox', { name: 'Key', exact: true }).fill(`L${suffix.toUpperCase()}`);
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await page.waitForURL(/\/project\/[0-9a-f]{24}/);
        await expect.poll(async () => Boolean(await projectNamed(owner.api, name))).toBe(true);

        await page.goto(`/#/${state.companyId}/project`);
        await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible();
    });

    test('a project name that is too short is refused before anything is created', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const name = 'ab';

        await page.goto(`/#/${state.companyId}/project`);
        await page.getByRole('button', { name: 'New project' }).first().click();
        const dialog = newProjectDialog(page);
        await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
        await dialog.getByRole('button', { name: 'Create project' }).click();

        await expect(dialog.getByText('Use at least 3 characters.')).toBeVisible();
        await expect(dialog).toBeVisible();
        expect(await projectNamed(owner.api, name)).toBeUndefined();

        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
    });

    test('a project set to Only people I add is hidden from a member who was not added', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const suffix = uniqueSuffix();
        const name = `Made private ${suffix}`;
        await page.goto(`/#/${state.companyId}/project`);
        await page.getByRole('button', { name: 'New project' }).first().click();

        const dialog = newProjectDialog(page);
        await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
        await dialog.getByRole('textbox', { name: 'Key', exact: true }).fill(`P${suffix.toUpperCase()}`);
        await dialog.getByRole('combobox', { name: 'Visibility' }).selectOption({ label: 'Only people I add' });
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await page.waitForURL(/\/project\/[0-9a-f]{24}/);

        await expect.poll(async () => (await projectNamed(owner.api, name))?.isPrivateSpace).toBe(true);
        const seenByMember = (await member.api.get('/api/v1/project')).body;
        expect(seenByMember.map((project) => project.ProjectName)).not.toContain(name);
    });
});
