const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');
const { createAgent, openProposals } = require('../support/proposals');

test.describe.configure({ timeout: 30000 });

test.describe('Inbox: Needs your approval', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    let proposals;
    test.beforeEach(async ({ state }) => {
        proposals = await openProposals(state);
    });
    test.afterEach(async () => {
        await proposals.close();
    });

    async function fileProposal({ state, loginAs }, label) {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `APPROVAL ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Approval task ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        const agent = await createAgent(owner.api, { project, name: `[QA approvals] ${label} ${suffix}` });
        const why = `Needs a decision ${suffix}`;
        const id = await proposals.seed({ agent, project, task, what: `Comment on ${task._id}`, why });
        return { id, why, agent, owner };
    }

    const queueRow = (page, why) => page.getByRole('region', { name: 'Needs your approval' }).getByRole('listitem').filter({ hasText: why });

    test('approving a waiting proposal takes it out of the list', async ({ page, state, loginAs }) => {
        const { id, why, agent, owner } = await fileProposal({ state, loginAs }, 'approve');

        await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
        const row = queueRow(page, why);
        await expect(row).toBeVisible();
        await expect(row).toContainText(agent.name);

        await row.getByRole('button', { name: /^Approve:/ }).click();
        await expect(row).toHaveCount(0);
        await expect.poll(() => proposals.statusOf(id)).toBe('approved');

        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
        await expect(page.getByRole('listitem').filter({ hasText: why })).toHaveCount(0);

        await owner.api.delete(`/api/v2/agents/${agent._id}`);
    });

    test('declining a waiting proposal takes it out of the list', async ({ page, state, loginAs }) => {
        const { id, why, agent, owner } = await fileProposal({ state, loginAs }, 'decline');

        await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
        const row = queueRow(page, why);
        await expect(row).toBeVisible();

        await row.getByRole('button', { name: /^Decline:/ }).click();
        await row.getByRole('button', { name: 'Decline without a reason' }).click();
        await expect(row).toHaveCount(0);
        await expect.poll(() => proposals.statusOf(id)).toBe('declined');

        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
        await expect(page.getByRole('listitem').filter({ hasText: why })).toHaveCount(0);

        await owner.api.delete(`/api/v2/agents/${agent._id}`);
    });
});
