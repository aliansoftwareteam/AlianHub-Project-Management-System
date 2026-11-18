const { test, expect } = require('../support/test');
const { createProject, createTask } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun } = require('../support/pages');
const { createAgent, openProposals } = require('../support/proposals');
const { newMember } = require('../support/twoPeople');

test.describe.configure({ timeout: 60000 });

test.describe('Inbox approvals as a member', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a waiting proposal in an open project shows, one in a project the member is not on does not', async ({ page, state, loginAs }) => {
        const { owner, member, email, suffix } = await newMember({ state, loginAs, firstName: 'Ines' });
        const proposals = await openProposals(state);
        const agents = [];

        try {
            const file = async ({ label, assigneeIds, isPrivate }) => {
                const project = await createProject(owner.api, { name: `TWO INBOX ${label} ${suffix}`, assigneeIds, createdBy: owner.uid, isPrivate });
                const task = await createTask(owner.api, { project, name: `Inbox task ${label} ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
                const agent = await createAgent(owner.api, { project, name: `[QA two people] ${label} ${suffix}` });
                agents.push(agent);
                const why = `Needs a decision ${label} ${suffix}`;
                await proposals.seed({ agent, project, task, what: `Comment on ${task._id}`, why });
                return why;
            };
            const openWhy = await file({ label: 'open', assigneeIds: [owner.uid, member.userId], isPrivate: false });
            const closedWhy = await file({ label: 'closed', assigneeIds: [owner.uid], isPrivate: true });

            await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);

            const queue = page.getByRole('region', { name: 'Needs your approval' });
            await expect(queue.getByRole('listitem').filter({ hasText: openWhy })).toBeVisible();
            await expect(queue.getByRole('listitem').filter({ hasText: closedWhy })).toHaveCount(0);
        } finally {
            await proposals.close();
            for (const agent of agents) await owner.api.delete(`/api/v2/agents/${agent._id}`);
        }
    });
});
