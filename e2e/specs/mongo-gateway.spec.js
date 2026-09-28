const { test, expect } = require('../support/test');
const { emailFor, uniqueSuffix } = require('../support/fixtures');

test.describe('invitation page while signed out', () => {
    test('shows the invited email from the invitation preview', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const email = emailFor(`invitee-ui-${uniqueSuffix()}`);
        const invite = await owner.api.post('/api/v2/sendInvitationEmail', {
            email, companyId: state.companyId, companyName: 'E2E Workspace', role: 3, designation: 0,
        });
        const memberId = invite.body.data._id;
        const token = invite.body.data.linkId;

        const preview = page.waitForResponse((res) => res.url().includes('/api/v2/auth/invitation-preview'));
        await page.goto(`/#/invitation?companyId=${state.companyId}-${memberId}&token=${token}`);
        expect((await preview).status()).toBe(200);
        await expect(page.locator('#inv-email')).toHaveText(email);
    });
});
