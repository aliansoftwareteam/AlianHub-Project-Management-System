const { test, expect, asRole } = require('../support/test');
const { settingsNav } = require('../support/pages');

const INSTANCE_SCREENS = [
    ['Health', 'health'],
    ['Settings', 'settings'],
    ['Backups', 'backups'],
    ['Upgrade', 'upgrade'],
    ['Logs', 'logs'],
    ['Stats', 'stats'],
];

const WORKSPACE_SCREENS = ['setting', 'language', 'members', 'projects', 'template', 'security-permissions', 'notifications', 'company', 'time-tracking', 'audit-logs'];

function trackPageErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    return errors;
}

async function runningVersion(request, state) {
    const res = await request.get(`${state.baseURL}/version`);
    return (await res.json()).data;
}

test.describe('instance console as the owner', () => {
    test.use(asRole('owner'));

    test('opens every Instance screen from the settings navigation', async ({ page, state }) => {
        const errors = trackPageErrors(page);
        await page.goto(`/#/${state.companyId}/settings/notifications`);
        const nav = settingsNav(page);
        await expect(nav.getByText('Instance', { exact: true })).toBeVisible();

        for (const [label, path] of INSTANCE_SCREENS) {
            const access = page.waitForResponse((res) => res.url().includes('/api/v2/instance/') && res.request().method() === 'GET');
            await nav.getByRole('link', { name: label, exact: true }).click();
            await expect(page).toHaveURL(new RegExp(`/settings/instance/${path}$`));
            expect((await access).status()).toBe(200);
            await expect(page.locator('.in-banner--danger')).toHaveCount(0);
            await expect(page.locator('.ah-empty', { hasText: 'Loading…' })).toHaveCount(0);
        }
        expect(errors).toEqual([]);
    });

    test('Health shows a healthy database', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/instance/health`);
        await expect(page.getByText('Healthy', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('Database', { exact: true }).first()).toBeVisible();
    });

    test('Stats shows the running build label', async ({ page, request, state }) => {
        const build = await runningVersion(request, state);
        await page.goto(`/#/${state.companyId}/settings/instance/stats`);
        await expect(page.locator('[data-test="version-label"]')).toHaveText(`v${build.version}`);
        const line = page.locator('[data-test="version-line"]');
        await expect(line).toContainText(build.channel);
        if (build.commit) await expect(line).toContainText(build.commit);
        await expect(page.getByText(state.companyName).first()).toBeVisible();
    });

    test('Upgrade shows the running build label and the build log', async ({ page, request, state }) => {
        const build = await runningVersion(request, state);
        await page.goto(`/#/${state.companyId}/settings/instance/upgrade`);
        await expect(page.locator('.ah-chip--mono', { hasText: `v${build.version}` })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Migrations', { exact: true })).toBeVisible();
        if (build.channel === 'beta') {
            await expect(page.locator('[data-test="build-row"]').first()).toBeVisible();
        }
    });

    test('INS-07 saves a changed setting from Instance > Settings', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const name = `[QA instance] ${Date.now()}`;
        try {
            await page.goto(`/#/${state.companyId}/settings/instance/settings`);
            await page.locator('#f-APP_NAME').fill(name);
            const saved = page.waitForResponse((res) => res.url().includes('/api/v2/instance/settings') && res.request().method() === 'PUT');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            expect((await saved).status()).toBe(200);
            await expect(page.getByText('Settings saved.')).toBeVisible();
        } finally {
            await owner.api.put('/api/v2/instance/settings', { APP_NAME: '' });
        }
    });

    test('opens the workspace settings screens of the area without page errors', async ({ page, state }) => {
        const errors = trackPageErrors(page);
        for (const path of WORKSPACE_SCREENS) {
            await page.goto(`/#/${state.companyId}/settings/${path}`);
            await expect(page).toHaveURL(new RegExp(`/settings/${path}$`));
            await expect(settingsNav(page)).toBeVisible();
        }
        expect(errors).toEqual([]);
    });

    test('Audit log lists events and offers the CSV export', async ({ page, state }) => {
        const list = page.waitForResponse((res) => res.url().includes('/api/v1/audit-logs?'));
        await page.goto(`/#/${state.companyId}/settings/audit-logs`);
        expect((await list).status()).toBe(200);
        await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

        const exported = page.waitForResponse((res) => res.url().includes('/api/v1/audit-logs/export'));
        await page.getByRole('button', { name: 'Export CSV' }).click();
        const res = await exported;
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('text/csv');
    });
});

test.describe('instance console as an admin', () => {
    test.use(asRole('admin'));

    test('offers the Audit log but not the Instance section', async ({ page, state }) => {
        const access = page.waitForResponse((res) => res.url().includes('/api/v2/instance/access'));
        await page.goto(`/#/${state.companyId}/settings/notifications`);
        expect((await access).status()).toBe(403);

        const nav = settingsNav(page);
        await expect(nav.getByRole('link', { name: 'Audit Log', exact: true })).toBeVisible();
        await expect(nav.getByText('Instance', { exact: true })).toHaveCount(0);
    });

    test('an Instance address does not show the console', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/instance/stats`);
        await expect(page.locator('[data-test="version-label"]')).toHaveCount(0);
    });
});

for (const role of ['member', 'guest']) {
    test.describe(`administration as a ${role}`, () => {
        test.use(asRole(role));

        test('hides the Audit log and the Instance section', async ({ page, state }) => {
            const access = page.waitForResponse((res) => res.url().includes('/api/v2/instance/access'));
            await page.goto(`/#/${state.companyId}/settings/notifications`);
            expect((await access).status()).toBe(403);

            const nav = settingsNav(page);
            await expect(nav.getByText('Personal', { exact: true })).toBeVisible();
            await expect(nav.getByRole('link', { name: 'Audit Log', exact: true })).toHaveCount(0);
            await expect(nav.getByText('Instance', { exact: true })).toHaveCount(0);
        });

        test('an Instance address does not show the console', async ({ page, state }) => {
            await page.goto(`/#/${state.companyId}/settings/instance/stats`);
            await expect(page.locator('[data-test="version-label"]')).toHaveCount(0);
        });
    });
}
