const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');

const ruleFor = (projectId, body) => ({
    name: `E2E automation ${uniqueSuffix()}`,
    trigger: { event: 'task.created' },
    scope: { allProjects: false, projectIds: [projectId] },
    conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body } }],
});

test.describe('automations as the owner', () => {
    test.use(asRole('owner'));

    test('lists a rule switched off and compiles a sentence in the builder', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const marker = `E2E ui ${uniqueSuffix()}`;
        const created = await owner.api.post('/api/v2/automations', ruleFor(state.projects.shared._id, marker));
        const ruleId = created.body.data._id;
        try {
            await page.goto(`/#/${state.companyId}/automations`);
            await expect(page.locator('.ah-toolbar__title')).toHaveText('Automations');
            const row = page.locator('.au__rule', { hasText: marker });
            await expect(row).toBeVisible();
            await expect(row).toHaveClass(/au__rule--off/);

            await page.getByRole('button', { name: 'New automation' }).first().click();
            const sentence = page.getByPlaceholder('When a task status changes to Blocked, post a comment saying "needs help".');
            await sentence.fill('When a task is created, post a comment saying "hello"');
            await sentence.press('Enter');
            await expect(page.getByText('COMPILED RULE · EDIT ANY PART')).toBeVisible();
            await page.getByRole('button', { name: 'Cancel' }).click();
            await expect(row).toBeVisible();
        } finally {
            await owner.api.delete(`/api/v2/automations/${ruleId}`);
        }
    });

    test('opens the coding accounts screen for MCP tokens', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/ai/accounts`);
        await expect(page.locator('.ah-toolbar__title').first()).toHaveText('Coding accounts');
    });
});

test.describe('ask as a guest', () => {
    test.use(asRole('guest'));

    test('shows the question box scoped to the projects the guest can open', async ({ page, state }) => {
        const sources = page.waitForResponse((res) => res.url().includes('/api/v1/ai/ask/sources'));
        await page.goto(`/#/${state.companyId}/ai/ask`);
        expect((await sources).status()).toBe(200);
        await expect(page.locator('.ah-toolbar__title').first()).toHaveText('Ask');
        await expect(page.getByText('Only projects you can already open. Ask never widens what you can see.')).toBeVisible();
    });
});

test.describe('automations as a guest', () => {
    test.use(asRole('guest'));

    test('AUT-04 does not offer a guest the rule builder', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/automations`);
        await expect(page.locator('.ah-toolbar__title')).toHaveText('Automations');
        await expect(page.getByRole('button', { name: 'New automation' })).toHaveCount(0, { timeout: 3000 });
    });
});
