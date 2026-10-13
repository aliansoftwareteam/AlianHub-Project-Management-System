/* eslint-env browser */
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { fadesFinished, skipFirstRun } = require('../support/pages');
const { createAgent, openProposals } = require('../support/proposals');

test.describe.configure({ timeout: 45000 });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/* Violations that stay until the product is fixed. Each entry names the rule, the screens it applies to
 * (every screen when omitted) and why it is tolerated. */
const ALLOWED = [];

const allowed = (screen, violation) => ALLOWED.some((entry) => entry.rule === violation.id && (!entry.screens || entry.screens.includes(screen)));

// Unlike a11y.spec.js this suite keeps colour contrast on, because dark mode is half of what it covers.
async function blockingViolations(page, screen) {
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    return violations
        .filter((v) => (v.impact === 'serious' || v.impact === 'critical') && !allowed(screen, v))
        .map((v) => `${v.id} (${v.impact}): ${v.help}: ${v.nodes.map((n) => `${n.target.join(' ')} [${(n.any[0] && n.any[0].message) || ''}]`).join(' | ')}`);
}

const VARIANTS = [
    { name: 'light', theme: 'light', viewport: { width: 1280, height: 800 } },
    { name: 'dark', theme: 'dark', viewport: { width: 1280, height: 800 } },
    { name: '390 px wide', theme: 'light', viewport: { width: 390, height: 844 } },
    { name: 'dark and 390 px wide', theme: 'dark', viewport: { width: 390, height: 844 } },
];

const SCREENS = [
    {
        name: 'Inbox with Needs your approval open',
        async open(page, { state, owner }, cleanup) {
            const suffix = uniqueSuffix();
            const project = await createProject(owner.api, { name: `A11Y APPROVAL ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
            const task = await createTask(owner.api, { project, name: `A11y approval task ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
            const agent = await createAgent(owner.api, { project, name: `[QA a11y] ${suffix}` });
            const proposals = await openProposals(state);
            cleanup.push(async () => {
                await proposals.close();
                await owner.api.delete(`/api/v2/agents/${agent._id}`);
            });
            const why = `Needs a decision ${suffix}`;
            await proposals.seed({ agent, project, task, what: `Comment on ${task._id}`, why });
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
            const row = page.getByRole('region', { name: 'Needs your approval' }).getByRole('listitem').filter({ hasText: why });
            await expect(row).toBeVisible();
        },
    },
    {
        name: 'Connect your AI',
        async open(page, { state }) {
            await page.goto(`/#/${state.companyId}/ai/connect`);
            await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
            await expect(page.locator('[data-test="connect-ai-sign"]')).toBeVisible();
        },
    },
    {
        name: 'project details with the agent cards',
        async open(page, { state, owner }) {
            const project = await createProject(owner.api, { name: `A11Y AGENT CARDS ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
            await page.goto(`/#/${state.companyId}/project/${project._id}/p?tab=ProjectDetail`);
            await expect(page.getByRole('region', { name: 'Agents in this project' })).toBeVisible();
            await expect(page.getByRole('region', { name: 'Always do this' })).toBeVisible();
        },
    },
    {
        name: 'Settings, AI, Accounts, Modes',
        async open(page, { state }) {
            await page.goto(`/#/${state.companyId}/ai/accounts`);
            await expect(page.locator('.ah-toolbar__title').first()).toHaveText('Coding accounts');
            await expect(page.getByText('Modes this workspace permits')).toBeVisible();
        },
    },
    {
        name: 'Members',
        async open(page, { state }) {
            await page.goto(`/#/${state.companyId}/settings/members`);
            await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
        },
    },
    {
        name: 'Home with the What next card',
        async open(page, { state }) {
            await page.goto(`/#/${state.companyId}`);
            await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();
            await expect(page.getByRole('region', { name: 'What next' })).toBeVisible();
        },
    },
    {
        name: 'the quick create dialog',
        async open(page, { state }) {
            await page.goto(`/#/${state.companyId}/inbox`);
            const heading = page.getByRole('heading', { level: 1, name: 'Inbox' });
            await expect(heading).toBeVisible();
            await heading.click();
            await page.keyboard.press('c');
            const dialog = page.getByRole('dialog', { name: 'New task' });
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole('textbox', { name: 'Task name' })).toBeFocused();
        },
    },
];

for (const variant of VARIANTS) {
    test.describe(`accessibility of the new screens: ${variant.name}`, () => {
        // The other worker's activity reloads a list at any moment, and what it draws fades in: without motion axe reads colours at rest.
        test.use({ ...asRole('owner'), viewport: variant.viewport, colorScheme: variant.theme, reducedMotion: 'reduce' });
        test.beforeEach(async ({ page }) => {
            await skipFirstRun(page);
            await page.addInitScript((theme) => localStorage.setItem('ah.theme', theme), variant.theme);
        });

        for (const screen of SCREENS) {
            test(screen.name, async ({ page, state, loginAs }) => {
                const owner = await loginAs('owner');
                const cleanup = [];
                try {
                    await screen.open(page, { state, owner }, cleanup);
                    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
                    await fadesFinished(page);
                    expect(await blockingViolations(page, screen.name)).toEqual([]);
                } finally {
                    for (const undo of cleanup) await undo();
                }
            });
        }
    });
}
