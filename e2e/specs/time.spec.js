const { test, expect, asRole } = require('../support/test');

test.describe('time screens as the owner', () => {
    test.use(asRole('owner'));

    test('the approvals screen renders the manager view', async ({ page, state }) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
        await page.goto(`/#/${state.companyId}/approvals`);
        await expect(page.locator('.tv-title', { hasText: 'Approvals' })).toBeVisible();
        await expect(page.getByText('Only owners and admins review approvals.')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('the variance report renders', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/reports/variance`);
        await expect(page.locator('.tv-title', { hasText: 'Variance' })).toBeVisible();
    });

    test('the time-off screen shows the request form', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/time-off`);
        await expect(page.getByText('Request time off')).toBeVisible();
    });
});

test.describe('time screens as a member', () => {
    test.use(asRole('member'));

    test('the approvals screen refuses a member', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/approvals`);
        await expect(page.getByText('Only owners and admins review approvals.')).toBeVisible();
    });

    test('a member can open their own time-off screen', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/time-off`);
        await expect(page.getByText('Request time off')).toBeVisible();
    });
});
