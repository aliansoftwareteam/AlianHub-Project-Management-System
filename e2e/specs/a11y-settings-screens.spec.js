/* eslint-env browser */
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, asRole } = require('../support/test');
const { createProject, uniqueSuffix } = require('../support/fixtures');
const { fadesFinished, skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 45000 });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/* Violations that stay until the product is fixed. Each entry names the rule, the screens it applies to
 * (every screen when omitted) and why it is tolerated. */
const ALLOWED = [
    { rule: 'target-size', screens: ['Workspace settings, priorities and statuses'], why: 'The milestone status colour swatch is 12px and sits against the name field; a 24px swatch needs a redesign of that field.' },
];

const allowed = (screen, violation) => ALLOWED.some((entry) => entry.rule === violation.id && (!entry.screens || entry.screens.includes(screen)));

// Colour contrast stays on, because dark mode is half of what this suite covers.
async function blockingViolations(page, screen) {
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    return violations
        .filter((v) => (v.impact === 'serious' || v.impact === 'critical') && !allowed(screen, v))
        .map((v) => `${v.id} (${v.impact}): ${v.help}: ${v.nodes.map((n) => `${n.target.join(' ')} [${(n.any[0] && n.any[0].message) || ''}]`).join(' | ')}`);
}

const VARIANTS = [
    { name: 'light', theme: 'light' },
    { name: 'dark', theme: 'dark' },
];

const settingsScreen = (name, route, title) => ({
    name,
    async open(page, { state }) {
        await page.goto(`/#/${state.companyId}/${route}`);
        await expect(page.locator('h1.ah-toolbar__title')).toHaveText(title);
        await page.waitForLoadState('networkidle');
    },
});

/* The screens this suite cannot reach yet; each carries the reason it is not asserted. */
const PENDING = [
    { name: 'Roles and permissions', why: 'The harness workspace is on a plan that locks the screen, and the locked preview is dimmed to half opacity and blurred (.sp__body--locked), below 4.5:1.' },
    { name: 'Connected apps', why: 'The tab only exists when OAuth is on, and the harness server runs with it off (/api/v2/oauth-grants answers 404).' },
    { name: 'API tokens', why: 'The ApiTokens route is not registered in the frontend, so the Integrations link to it never renders.' },
];

const SCREENS = [
    settingsScreen('Workspace settings, priorities and statuses', 'settings/setting', 'General'),
    settingsScreen('Members', 'settings/members', 'Members'),
    settingsScreen('Custom fields', 'settings/custom-field', 'Custom Field Manager'),
    settingsScreen('Templates', 'settings/template', 'Templates'),
    settingsScreen('Task templates', 'settings/task-templates', 'Task templates'),
    settingsScreen('Integrations', 'settings/integrations', 'Integrations'),
    settingsScreen('Notifications', 'settings/notifications', 'Notifications'),
    settingsScreen('Profile', 'settings/my-profile', 'My settings'),
    settingsScreen('Projects list in settings', 'settings/projects', 'Projects'),
    {
        name: 'Project details',
        async open(page, { state, owner }) {
            const project = await createProject(owner.api, { name: `A11Y SETTINGS ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
            await page.goto(`/#/${state.companyId}/project/${project._id}/p?tab=ProjectDetail`);
            await expect(page.getByRole('region', { name: 'Agents in this project' })).toBeVisible();
            await page.waitForLoadState('networkidle');
        },
    },
];

for (const variant of VARIANTS) {
    test.describe(`accessibility of the settings screens: ${variant.name}`, () => {
        // The other worker's activity reloads a list at any moment, and what it draws fades in: without motion axe reads colours at rest.
        test.use({ ...asRole('owner'), viewport: { width: 1280, height: 800 }, colorScheme: variant.theme, reducedMotion: 'reduce' });
        test.beforeEach(async ({ page }) => {
            await skipFirstRun(page);
            await page.addInitScript((theme) => localStorage.setItem('ah.theme', theme), variant.theme);
        });

        for (const screen of SCREENS) {
            test(screen.name, async ({ page, state, loginAs }) => {
                const owner = await loginAs('owner');
                await screen.open(page, { state, owner });
                await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
                await fadesFinished(page);
                expect(await blockingViolations(page, screen.name)).toEqual([]);
            });
        }

        for (const screen of PENDING) {
            test.fixme(screen.name, () => {
                // ${screen.why}
            });
        }
    });
}
