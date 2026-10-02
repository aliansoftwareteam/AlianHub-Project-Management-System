const { test, expect } = require('../support/test');
const { createProject, createTask, emailFor, inviteMember, uniqueSuffix } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun } = require('../support/pages');
const { createAgent, openProposals } = require('../support/proposals');

test.describe.configure({ timeout: 30000 });

test.describe('Home: what next', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    // A member made for each test, so the line depends on nothing another test leaves behind.
    async function newMember({ state, loginAs }) {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const email = emailFor('member', suffix);
        const member = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Nora', lastName: `Next${suffix}` });
        const project = await createProject(owner.api, { name: `WHAT NEXT ${suffix}`, assigneeIds: [owner.uid, member.userId], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name: `Own task ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [member.userId] });
        return { owner, member, project, task, email, suffix };
    }

    test('names the one thing to do when nothing is due', async ({ page, state, loginAs }) => {
        const { email } = await newMember({ state, loginAs });
        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

        // A proposal another test files in an open project is this member's to see too, so either line may show.
        const next = page.getByRole('region', { name: 'What next' });
        await expect(next).toBeVisible();
        await expect(next).toContainText(/Nothing is due today and nothing is waiting on you\.|needs? your approval\./);
        await expect(next.getByRole('button', { name: /^(Add a task|Review)$/ })).toBeVisible();
    });

    test('points at the Inbox when something waits for approval', async ({ page, state, loginAs }) => {
        const { owner, member, project, task, email, suffix } = await newMember({ state, loginAs });
        const agent = await createAgent(owner.api, { project, name: `[QA what next] ${suffix}` });
        const proposals = await openProposals(state);
        try {
            await proposals.seed({ agent, project, task, what: `Comment on ${task._id}`, why: `Waiting for ${member.email} ${suffix}` });
            await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

            const next = page.getByRole('region', { name: 'What next' });
            await expect(next).toContainText('One thing needs your approval.');
            await next.getByRole('button', { name: 'Review' }).click();
            await expect(page).toHaveURL(/\/inbox\?tab=approval/);
            await expect(page.getByRole('region', { name: 'Needs your approval' })).toBeVisible();
        } finally {
            await proposals.close();
            await owner.api.delete(`/api/v2/agents/${agent._id}`);
        }
    });
});
