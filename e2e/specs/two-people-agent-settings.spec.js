const { test, expect } = require('../support/test');
const { createProject } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun } = require('../support/pages');
const { newMember } = require('../support/twoPeople');

test.describe.configure({ timeout: 60000 });

const LIMITS = '/api/v2/agents/project-limits';

test.describe('agent settings as a member', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('the project details leave the agent cards read-only for a member, who cannot pause agents', async ({ page, state, loginAs }) => {
        const { owner, member, email, api, suffix } = await newMember({ state, loginAs, firstName: 'Mina' });
        const project = await createProject(owner.api, { name: `TWO AGENT CARDS ${suffix}`, assigneeIds: [owner.uid, member.userId], createdBy: owner.uid });

        try {
            await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });
            await page.goto(`/#/${state.companyId}/project/${project._id}/p?tab=ProjectDetail`);
            await expect(page.getByText(project.ProjectName).first()).toBeVisible();
            await page.waitForLoadState('networkidle');

            const settings = page.getByRole('region', { name: 'Agents in this project' });
            const limits = page.getByRole('region', { name: 'Agents working at the same time' });
            const standing = page.getByRole('region', { name: 'Always do this' });

            for (const radio of await settings.getByRole('radio').all()) await expect(radio).toBeDisabled();
            for (const box of await limits.getByRole('combobox').all()) await expect(box).toBeDisabled();
            await expect(page.getByRole('button', { name: 'Pause all agents' })).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Resume agents' })).toHaveCount(0);
            await expect(standing.getByRole('button', { name: /^Remove/ })).toHaveCount(0);

            const read = await api.get(`${LIMITS}/${project._id}`);
            expect(read.body.data).toMatchObject({ canEdit: false });
            const pause = await api.put(`${LIMITS}/${project._id}`, { paused: true });
            expect(pause.status).toBe(403);
            const after = await owner.api.get(`${LIMITS}/${project._id}`);
            expect(after.body.data.limits.paused).toBe(false);
        } finally {
            await owner.api.put(`${LIMITS}/${project._id}`, { paused: false });
        }
    });
});

test.describe('Settings > AI > Accounts > Modes as a member', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('the card "A person checks before Done" is disabled', async ({ page, state, loginAs }) => {
        const { email } = await newMember({ state, loginAs, firstName: 'Dara' });

        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });
        await page.goto(`/#/${state.companyId}/ai/accounts`);

        const card = page.getByRole('region', { name: 'A person checks before Done' });
        await expect(card).toBeVisible();
        const check = card.getByRole('checkbox', { name: /^A person checks an agent's work/ });
        await expect(check).toBeVisible();
        await expect(check).toBeDisabled();
        await expect(card.getByText('READ ONLY, AN OWNER OR ADMIN SETS THIS')).toBeVisible();
    });
});
