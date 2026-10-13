const { test, expect, asRole } = require('../support/test');
const { createProject, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 45000 });

test.describe('project details: limits on agents', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    async function openCard({ page, state, loginAs }) {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `AGENT LIMITS ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const url = `/#/${state.companyId}/project/${project._id}/p?tab=ProjectDetail`;
        await page.goto(url);
        const card = page.getByRole('region', { name: 'Agents working at the same time' });
        await expect(card).toBeVisible();
        return { card, url };
    }

    test('the number of agents working at once is kept after a reload', async ({ page, state, loginAs }) => {
        const { card, url } = await openCard({ page, state, loginAs });
        const atOnce = card.getByRole('combobox', { name: 'Agents at work at once' });
        await expect(atOnce).toBeEnabled();

        const options = await atOnce.getByRole('option').allTextContents();
        const before = await atOnce.inputValue();
        const wanted = options.map((text) => text.trim()).find((text) => text !== before);
        test.skip(!wanted, 'the range allows one number only');

        await atOnce.selectOption({ label: wanted });
        await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

        await page.goto(url);
        await page.reload();
        const reloaded = page.getByRole('region', { name: 'Agents working at the same time' }).getByRole('combobox', { name: 'Agents at work at once' });
        await expect(reloaded).toHaveValue(wanted);
    });

    test('pausing all agents shows the note and the header chip, and resuming takes both away', async ({ page, state, loginAs }) => {
        const { card, url } = await openCard({ page, state, loginAs });
        const note = card.getByRole('status').filter({ hasText: 'Agents are paused in this project.' });
        const chip = page.getByText('Agents paused', { exact: true });
        await expect(note).toHaveCount(0);

        await card.getByRole('button', { name: 'Pause all agents' }).click();
        await expect(note).toBeVisible();
        await expect(card.getByRole('button', { name: 'Resume agents' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'Pause all agents' })).toHaveCount(0);

        await page.goto(url);
        await page.reload();
        await expect(chip).toBeVisible();
        await expect(note).toBeVisible();

        await card.getByRole('button', { name: 'Resume agents' }).click();
        await expect(note).toHaveCount(0);
        await expect(card.getByRole('button', { name: 'Pause all agents' })).toBeVisible();

        await page.reload();
        await expect(card.getByRole('button', { name: 'Pause all agents' })).toBeVisible();
        await expect(chip).toHaveCount(0);
    });
});
