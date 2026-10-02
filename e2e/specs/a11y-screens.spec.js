/* eslint-env browser */
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: '390px', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];

/* Known findings the product has not fixed yet. `target` is matched against the node's selector. */
const ALLOWED = [];

const isAllowed = (rule, target) => ALLOWED.some((entry) => entry.rule === rule && entry.target.test(target));

async function blockingViolations(page, label) {
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    return violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .flatMap((v) => v.nodes.map((n) => ({ rule: v.id, impact: v.impact, target: n.target.join(' '), help: v.help })))
        .filter((v) => !isAllowed(v.rule, v.target))
        .map((v) => `${label} ${v.rule} (${v.impact}): ${v.help}: ${v.target}`);
}

const settle = async (page) => {
    await expect(page.getByRole('main').first()).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
};

/* Opens the screen at each viewport and audits it in each theme; every finding is reported together. */
async function auditScreen(page, open) {
    const found = [];
    for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await open(page, viewport);
        await settle(page);
        for (const theme of THEMES) {
            await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
            found.push(...(await blockingViolations(page, `[${viewport.name} ${theme}]`)));
        }
    }
    expect([...new Set(found)]).toEqual([]);
}

async function projectWithTasks({ owner, state, label }) {
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    const names = [`${label} one ${suffix}`, `${label} two ${suffix}`];
    let task;
    for (const name of names) {
        task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
    }
    return { project, task, name: names[0], url: `/#/${state.companyId}/project/${project._id}/s/${task.sprintId}` };
}

test.describe('accessibility: everyday screens in light and dark, desktop and 390px', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('task panel open', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTasks({ owner, state, label: 'A11Y PANEL' });
        await auditScreen(page, async () => {
            await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
            await expect(page.getByRole('dialog', { name: 'Task detail' })).toBeVisible();
        });
    });

    test('List', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { url, name } = await projectWithTasks({ owner, state, label: 'A11Y LIST' });
        await auditScreen(page, async () => {
            await page.goto(url);
            await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        });
    });

    test('Board', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { url, name } = await projectWithTasks({ owner, state, label: 'A11Y BOARD' });
        await auditScreen(page, async () => {
            await page.goto(url);
            await page.getByRole('button', { name: 'Board', exact: true }).click();
            await expect(page.locator('.kanban-card .card-title', { hasText: name })).toBeVisible();
        });
    });

    for (const view of ['Table', 'Calendar', 'Gantt']) {
        test(view, async ({ page, state, loginAs }) => {
            const owner = await loginAs('owner');
            const { url } = await projectWithTasks({ owner, state, label: `A11Y ${view.toUpperCase()}` });
            await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
            await page.goto(url);
            await page.getByRole('button', { name: 'Add View', exact: true }).click();
            await page.getByRole('button', { name: new RegExp(`^${view}`) }).click();
            await auditScreen(page, async () => {
                await page.goto(url);
                await page.getByRole('button', { name: view, exact: true }).click();
            });
        });
    }

    const screens = [
        ['Everything', 'everything'],
        ['Chat', 'chat'],
        ['Docs', 'pages'],
        ['Goals', 'goals'],
        ['Timesheet', 'timesheet/user'],
        ['Dashboards', 'dashboards'],
        ['Settings, General', 'settings/setting'],
        ['Settings, My profile', 'settings/my-profile'],
        ['Settings, Company', 'settings/company'],
        ['Settings, Notifications', 'settings/notifications'],
        ['Settings, Teams', 'settings/teams'],
        ['Settings, Projects', 'settings/projects'],
    ];
    for (const [title, path] of screens) {
        test(title, async ({ page, state }) => {
            await auditScreen(page, async () => {
                await page.goto(`/#/${state.companyId}/${path}`);
            });
        });
    }
});
