const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');

async function createAgent(api, state, name) {
    const res = await api.post('/api/v2/agents', {
        name,
        description: 'playwright agent',
        autonomy: 1,
        spendCapUsd: 1,
        projectIds: [state.projects.shared._id],
        skills: [],
        allowedActions: ['task.comment'],
    });
    expect(res.body.status).toBe(true);
    return res.body.data;
}

test.describe('ai agents as the owner', () => {
    test.use(asRole('owner'));

    test('the hub lists an agent created for this test', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const name = `[QA agents] hub ${uniqueSuffix()}`;
        const agent = await createAgent(owner.api, state, name);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await page.goto(`/#/${state.companyId}/ai`);
        await expect(page.locator('.ah-toolbar__title')).toHaveText('AI Agents');
        await expect(page.getByRole('button', { name: 'New agent' })).toBeVisible();
        await expect(page.locator('.ai-agent__name', { hasText: name })).toBeVisible();
        expect(errors).toEqual([]);

        await owner.api.delete(`/api/v2/agents/${agent._id}`);
    });

    test('agent settings open for that agent', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const name = `[QA agents] settings ${uniqueSuffix()}`;
        const agent = await createAgent(owner.api, state, name);

        await page.goto(`/#/${state.companyId}/ai/agent/${agent._id}`);
        await expect(page.getByText(name).first()).toBeVisible();
        await expect(page.getByText('Stop this agent')).toBeVisible();

        await owner.api.delete(`/api/v2/agents/${agent._id}`);
    });

    test('the skill library lists the action registry', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/ai/skills`);
        await expect(page.locator('.ah-toolbar__title')).toHaveText('Skill library');
        await expect(page.getByRole('cell', { name: 'task.comment', exact: true })).toBeVisible();
    });
});

test.describe('ai agents as a member', () => {
    test.use(asRole('member'));

    test('the AI Inbox opens', async ({ page, state }) => {
        const proposals = page.waitForResponse((res) => res.url().includes('/api/v2/agents/proposals'));
        await page.goto(`/#/${state.companyId}/ai/inbox`);
        expect((await proposals).status()).toBe(200);
        await expect(page.locator('.ah-toolbar__title', { hasText: 'AI Inbox' })).toBeVisible();
    });
});

test.describe('ai agents as a guest', () => {
    test.use(asRole('guest'));

    test.fail('AGT-01 the hub does not offer New agent to a guest', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/ai`);
        await expect(page.locator('.ah-toolbar__title')).toHaveText('AI Agents');
        await expect(page.getByRole('button', { name: 'New agent' })).toHaveCount(0, { timeout: 5000 });
    });
});
