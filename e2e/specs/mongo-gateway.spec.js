const { test, expect, asRole } = require('../support/test');
const { emailFor, uniqueSuffix } = require('../support/fixtures');

test.describe('task panel logged time as a member', () => {
    test.use(asRole('member'));

    test('the logged-time query still goes through the gateway', async ({ page, state }) => {
        const [task] = state.tasks;
        const gateway = page.waitForResponse((res) => res.url().includes('/api/v1/mongoOpration'), { timeout: 45000 });
        await page.goto(`/#/${state.companyId}/project/${task.projectId}/s/${task.sprintId}/${task._id}`);
        const res = await gateway;
        expect(res.status()).toBe(200);
        expect((await res.json()).status).toBe(true);
    });
});

test.describe('invitation page while signed out', () => {
    test('shows the invited email from the invitation preview', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const email = emailFor(`invitee-ui-${uniqueSuffix()}`);
        const invite = await owner.api.post('/api/v2/sendInvitationEmail', {
            email, companyId: state.companyId, companyName: 'E2E Workspace', role: 3, designation: 0,
        });
        const memberId = invite.body.data._id;

        const preview = page.waitForResponse((res) => res.url().includes('/api/v2/auth/invitation-preview'));
        await page.goto(`/#/invitation?companyId=${state.companyId}-${memberId}`);
        expect((await preview).status()).toBe(200);
        await expect(page.locator('#inv-email')).toHaveText(email);
    });
});
