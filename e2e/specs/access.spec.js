const { test, expect, asRole } = require('../support/test');

test.describe('access screens as the owner', () => {
    test.use(asRole('owner'));

    test('Members lists the workspace members', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/members`);
        await expect(page.getByText('Members', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Invite', { exact: true }).first()).toBeVisible();
    });

    test('SSO screen renders the sign-in options', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/sso`);
        await expect(page.getByText('Sign-in & SSO', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('SAML / OIDC single sign-on')).toBeVisible();
    });

    test('SCIM screen renders the provisioning panel', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/scim`);
        await expect(page.getByText('SCIM Provisioning')).toBeVisible();
        await expect(page.getByText('SCIM base URL')).toBeVisible();
    });

    test('Teams screen renders', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/teams`);
        await expect(page.getByText('Teams', { exact: true }).first()).toBeVisible();
    });

    test('Two-factor and change-password screens render', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/two-factor-auth`);
        await expect(page).toHaveTitle(/Two-Factor/i);
        await page.goto(`/#/${state.companyId}/settings/change-password`);
        await expect(page).toHaveTitle(/Change Password/i);
    });
});

test.describe('access — SSO admin config is refused for a member', () => {
    test.use(asRole('member'));

    test('the SSO config request is 403 for a member', async ({ page, state }) => {
        const configResponse = page.waitForResponse(
            (res) => res.url().includes('/api/v2/sso/config'),
            { timeout: 30000 },
        );
        await page.goto(`/#/${state.companyId}/settings/sso`);
        expect((await configResponse).status()).toBe(403);
    });
});
