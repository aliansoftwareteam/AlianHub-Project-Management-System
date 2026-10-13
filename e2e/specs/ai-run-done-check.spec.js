const { test, expect, asRole } = require('../support/test');
const { skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 45000 });

test.describe('Settings, AI, Accounts, Modes', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('"A person checks before Done" is saved and holds after a reload', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const policy = await owner.api.get('/api/v2/agents/policy');
        expect(policy.status).toBe(200);
        const original = Boolean(policy.body.data && policy.body.data.requireCheckBeforeDone);

        const url = `/#/${state.companyId}/ai/accounts`;
        const box = (target) => target.getByRole('region', { name: 'A person checks before Done' })
            .getByRole('checkbox', { name: /A person checks an agent's work before a task is closed/ });
        try {
            await page.goto(url);
            await expect(box(page)).toBeEnabled();
            if (original) await expect(box(page)).toBeChecked();
            else await expect(box(page)).not.toBeChecked();

            await box(page).click();
            await expect(page.getByRole('region', { name: 'A person checks before Done' }).getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
            if (original) await expect(box(page)).not.toBeChecked();
            else await expect(box(page)).toBeChecked();

            await page.reload();
            await expect(box(page)).toBeEnabled();
            if (original) await expect(box(page)).not.toBeChecked();
            else await expect(box(page)).toBeChecked();
        } finally {
            await owner.api.put('/api/v2/agents/policy', { requireCheckBeforeDone: original });
        }
    });
});
