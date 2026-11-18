const { test, expect, asRole } = require('../support/test');
const { createProject, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 30000 });

test.describe('project detail as an owner', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('shows the agent settings card and the standing approvals card', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `AGENT CARDS ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });

        await page.goto(`/#/${state.companyId}/project/${project._id}/p?tab=ProjectDetail`);

        const settings = page.getByRole('region', { name: 'Agents in this project' });
        await expect(settings).toBeVisible();
        await expect(settings.getByRole('group', { name: 'Agents and Done' })).toBeVisible();
        await expect(settings.getByRole('radio').first()).toBeEnabled();
        await expect(settings.getByText('An owner or admin changes these settings.')).toHaveCount(0);

        const standing = page.getByRole('region', { name: 'Always do this' });
        await expect(standing).toBeVisible();
        await expect(standing.getByText(/^None yet\./)).toBeVisible();
    });
});
