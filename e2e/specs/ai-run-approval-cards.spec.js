const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');
const { createAgent } = require('../support/proposals');
const { openCards } = require('../support/proposalCards');

test.describe.configure({ timeout: 45000 });

test.describe('Inbox: cards for what a connected AI files', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    let cards;
    test.beforeEach(async ({ state }) => {
        cards = await openCards(state);
    });
    test.afterEach(async () => {
        await cards.close();
    });

    const rowFor = (page, why) => page.getByRole('region', { name: 'Needs your approval' }).getByRole('listitem').filter({ hasText: why });
    async function expectLine(card, label, text) {
        await expect(card.getByRole('term').filter({ hasText: label }).first()).toBeVisible();
        await expect(card.getByRole('definition').filter({ hasText: text }).first()).toBeVisible();
    }

    async function fileFor({ loginAs, state }, label) {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `CARDS ${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const agent = await createAgent(owner.api, { project, name: `[QA cards] ${label} ${suffix}` });
        return { owner, suffix, project, agent, why: `Needs a decision ${label} ${suffix}`, user: state.users.owner };
    }

    test('a waiting batch is one card that names several tasks', async ({ page, state, loginAs }) => {
        const made = await fileFor({ loginAs, state }, 'batch');
        const { owner, project, agent, suffix, why } = made;
        const names = [1, 2, 3].map((n) => `Batch task ${n} ${suffix}`);
        const tasks = [];
        for (const name of names) {
            tasks.push(await createTask(owner.api, { project, name, user: made.user, companyOwnerId: owner.uid, assigneeIds: [owner.uid] }));
        }
        const id = await cards.seedBatch({ agent, project, tasks, requestedBy: owner.uid, why, status: 'In Progress' });

        try {
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            const row = rowFor(page, why);
            await expect(row).toHaveCount(1);
            await expect(row).toContainText('wants to change 3 tasks');

            await expect(row.getByText('Several tasks', { exact: true })).toBeVisible();
            await expect(row.getByText('3 tasks', { exact: true })).toBeVisible();
            await expectLine(row, 'Status', 'In Progress, on 3 tasks');
            for (const name of names) await expect(row.getByRole('button', { name, exact: true })).toBeVisible();

            await expect(row.getByRole('button', { name: /^Approve:/ })).toBeEnabled();
            expect(await cards.statusOf(id)).toBe('pending');
        } finally {
            await owner.api.delete(`/api/v2/agents/${agent._id}`);
        }
    });

    test('a waiting project plan is one card that lists what it will set up', async ({ page, state, loginAs }) => {
        const { owner, project, agent, why } = await fileFor({ loginAs, state }, 'plan');
        const id = await cards.seedSetup({ agent, project, requestedBy: owner.uid, why });

        try {
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            const row = rowFor(page, why);
            await expect(row).toHaveCount(1);
            await expect(row).toContainText(`wants to set up the project “${project.ProjectName}”`);

            await expect(row.getByText('Project setup', { exact: true })).toBeVisible();
            await expectLine(row, 'Where', project.ProjectName);
            await expectLine(row, 'New statuses', 'In Review');
            await expectLine(row, 'New lists', 'Backlog, This week');
            await expectLine(row, 'Field', 'Budget: Money');
            await expectLine(row, 'Field', 'Region: Dropdown (North, South)');
            await expectLine(row, 'New view', 'Review board: Board');
            await expectLine(row, 'Grouped by', 'Status');
            await expectLine(row, 'Columns', 'Budget');

            await expect(row.getByRole('button', { name: /^Approve:/ })).toBeEnabled();
            expect(await cards.statusOf(id)).toBe('pending');
        } finally {
            await owner.api.delete(`/api/v2/agents/${agent._id}`);
        }
    });
});
