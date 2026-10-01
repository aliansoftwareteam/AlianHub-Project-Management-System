const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, emailFor, inviteMember, uniqueSuffix } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun, taskPanel } = require('../support/pages');

async function projectWithTask({ owner, state, label, suffix }) {
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
    return { project: { _id: String(project._id), code: project.ProjectCode }, task, name };
}

test.describe('finding work across the workspace', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a task found in the command palette opens from its result', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { name, project } = await projectWithTask({ owner, state, label: 'Palette', suffix: uniqueSuffix() });

        await page.goto(`/#/${state.companyId}`);
        await page.getByRole('button', { name: 'Search or ask AI' }).focus();
        await page.keyboard.press('Meta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await palette.getByRole('button', { name: 'Tasks', exact: true }).click();
        await palette.getByRole('combobox', { name: 'Search, go to or run a command' }).fill(name);
        await palette.getByRole('option', { name: new RegExp(`^${project.code}-\\d+${name}`) }).click();

        await expect(palette).toBeHidden();
        await expect(taskPanel(page).getByRole('heading', { level: 2, name })).toBeVisible();
    });

    test('Everything lists tasks from every project and opens one', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const first = await projectWithTask({ owner, state, label: 'Everything one', suffix });
        const second = await projectWithTask({ owner, state, label: 'Everything two', suffix });

        await page.goto(`/#/${state.companyId}/everything`);
        await expect(page.getByRole('heading', { level: 1, name: 'Everything' })).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search tasks' }).fill(suffix);

        const rows = page.getByRole('listitem').filter({ hasText: suffix });
        await expect(rows).toHaveCount(2);
        await expect(rows.filter({ hasText: first.name })).toHaveCount(1);
        await rows.getByRole('button', { name: second.name, exact: true }).click();
        await expect(taskPanel(page).getByRole('heading', { level: 2, name: second.name })).toBeVisible();
    });
});

test.describe('signing out', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    // A member made for this test: signing out ends the session, and the saved role sessions are shared by every other spec.
    test('Log out in the profile menu ends the session and returns to the sign-in page', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const email = emailFor('member', suffix);
        await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Sasha', lastName: `Leaver${suffix}` });
        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

        await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: `Sasha Leaver${suffix}` }).click();
        await page.getByRole('menuitem', { name: 'Log out' }).click();
        await expect(page.locator('#email')).toBeVisible();
        await expect(page).toHaveURL(/#\/login/);

        await page.goto(`/#/${state.companyId}/inbox`);
        await expect(page.locator('#email')).toBeVisible();
    });
});
