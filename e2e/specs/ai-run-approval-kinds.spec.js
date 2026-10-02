const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, listSprints, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun } = require('../support/pages');
const { createAgent } = require('../support/proposals');
const { createToken, openKinds } = require('../support/proposalKinds');

test.describe.configure({ timeout: 60000 });

test.describe('Inbox: one card for each kind of waiting proposal', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    let kinds;
    test.beforeEach(async ({ state }) => {
        kinds = await openKinds(state);
    });
    test.afterEach(async () => {
        await kinds.close();
    });

    const rowFor = (page, why) => page.getByRole('region', { name: 'Needs your approval' }).getByRole('listitem').filter({ hasText: why });
    async function expectLine(card, label, text) {
        await expect(card.getByRole('term').filter({ hasText: label }).first()).toBeVisible();
        await expect(card.getByRole('definition').filter({ hasText: text }).first()).toBeVisible();
    }
    async function expectPlanLines(row) {
        await expectLine(row, 'New statuses', 'In Review');
        await expectLine(row, 'New lists', 'Backlog');
        await expectLine(row, 'New lists', 'This week');
        await expectLine(row, 'Field', 'Budget: Money');
        await expectLine(row, 'Field', 'Region: Dropdown (North, South)');
        await expectLine(row, 'New view', 'Review board: Board');
        await expectLine(row, 'Grouped by', 'Status');
        await expectLine(row, 'Columns', 'Budget');
    }

    async function cleanUp({ owner, agent, tokenId }) {
        await owner.api.delete(`/api/v2/agents/${agent._id}`);
        await owner.api.delete(`/api/v2/api-tokens/${tokenId}`);
    }

    async function filed({ loginAs }, label) {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `KINDS ${label} ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const agent = await createAgent(owner.api, { project, name: `[QA kinds] ${label} ${suffix}` });
        const tokenId = await createToken(owner.api, `[QA kinds] ${label} ${suffix}`);
        return { owner, suffix, project, agent, tokenId, why: `Needs a decision ${label} ${suffix}` };
    }

    test('a project setup card lists its parts', async ({ page, state, loginAs }) => {
        const { owner, project, agent, tokenId, why } = await filed({ loginAs }, 'setup');
        const id = await kinds.seedSetup({ agent, project, requestedBy: owner.uid, tokenId, why });
        try {
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            const row = rowFor(page, why);
            await expect(row).toHaveCount(1);
            await expect(row).toContainText(`wants to set up the project “${project.ProjectName}”`);
            await expect(row.getByText('Project setup', { exact: true })).toBeVisible();
            await expectLine(row, 'Where', project.ProjectName);
            await expectPlanLines(row);
            expect(await kinds.statusOf(id)).toBe('pending');
        } finally {
            await cleanUp({ owner, agent, tokenId });
        }
    });

    test('a new project card names the project and says who is on it', async ({ page, state, loginAs }) => {
        const { owner, project, agent, tokenId, suffix, why } = await filed({ loginAs }, 'project');
        const name = `Kinds relaunch ${suffix}`;
        const id = await kinds.seedProject({ agent, project, requestedBy: owner.uid, tokenId, why, name, description: `Everything for ${name}.` });
        try {
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            const row = rowFor(page, why);
            await expect(row).toHaveCount(1);
            await expect(row).toContainText(`wants to create the project “${name}”`);
            await expect(row.getByText('New project', { exact: true })).toBeVisible();
            await expectLine(row, 'On it', 'Only the person who approves it, at first.');
            await expectLine(row, 'Description', `Everything for ${name}.`);
            await expectPlanLines(row);
            expect(await kinds.statusOf(id)).toBe('pending');
        } finally {
            await cleanUp({ owner, agent, tokenId });
        }
    });

    test('an automation card shows the rule and that it starts switched off', async ({ page, state, loginAs }) => {
        const { owner, project, agent, tokenId, suffix, why } = await filed({ loginAs }, 'automation');
        const message = `Kinds done notice ${suffix}`;
        const id = await kinds.seedAutomation({ agent, project, requestedBy: owner.uid, tokenId, why, message });
        try {
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            const row = rowFor(page, why);
            await expect(row).toHaveCount(1);
            await expect(row).toContainText('wants to add the automation');
            await expect(row.getByText('New automation', { exact: true })).toBeVisible();
            await expectLine(row, 'Where', project.ProjectName);
            await expectLine(row, 'Starts when', /\S/);
            await expectLine(row, 'Rule', 'a task status changes to');
            await expectLine(row, 'Step 1', message);
            await expectLine(row, 'Works on', 'Tasks of this project');
            await expectLine(row, 'Once approved', 'switched off until you turn it on');
            expect(await kinds.statusOf(id)).toBe('pending');
        } finally {
            await cleanUp({ owner, agent, tokenId });
        }
    });

    test('a batch card names the tasks it changes', async ({ page, state, loginAs }) => {
        const { owner, project, agent, tokenId, suffix, why } = await filed({ loginAs }, 'batch');
        const names = [1, 2, 3].map((n) => `Kinds task ${n} ${suffix}`);
        const tasks = [];
        for (const name of names) {
            tasks.push(await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] }));
        }
        const id = await kinds.seedBatch({ agent, project, tasks, requestedBy: owner.uid, tokenId, why, status: 'In Progress' });
        try {
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
            const row = rowFor(page, why);
            await expect(row).toHaveCount(1);
            await expect(row).toContainText('wants to change 3 tasks');
            await expect(row.getByText('Several tasks', { exact: true })).toBeVisible();
            await expect(row.getByText('3 tasks', { exact: true })).toBeVisible();
            await expectLine(row, 'Status', 'In Progress, on 3 tasks');
            for (const name of names) await expect(row.getByRole('button', { name, exact: true })).toBeVisible();
            expect(await kinds.statusOf(id)).toBe('pending');
        } finally {
            await cleanUp({ owner, agent, tokenId });
        }
    });

    async function approveSetup({ page, state, loginAs }, label) {
        const made = await filed({ loginAs }, label);
        const id = await kinds.seedSetup({ agent: made.agent, project: made.project, requestedBy: made.owner.uid, tokenId: made.tokenId, why: made.why });
        await page.goto(`/#/${state.companyId}/inbox?tab=approval`);
        const row = rowFor(page, made.why);
        await expect(row).toHaveCount(1);
        const decided = page.waitForResponse((res) => res.url().endsWith(`/${id}/approve`));
        await row.getByRole('button', { name: /^Approve:/ }).click();
        const answer = await (await decided).json();
        expect(JSON.stringify(answer), 'the approval answer').toContain('"ok":true');
        await expect(row).toHaveCount(0);
        await expect.poll(() => kinds.statusOf(id)).toBe('approved');
        return { ...made, answer };
    }
    const views = (page) => page.getByRole('group', { name: 'Project views' });
    const reviewBoard = (page) => views(page).getByRole('button', { name: /Review board/ });

    test('approving the project setup makes its parts in the project', async ({ page, state, loginAs }) => {
        const { owner, project, agent, tokenId, answer } = await approveSetup({ page, state, loginAs }, 'approve setup');
        try {
            await page.goto(`/#/${state.companyId}/project/${project._id}`);
            await expect(reviewBoard(page), JSON.stringify(answer)).toBeVisible();
            await reviewBoard(page).click();
            const lists = await listSprints(owner.api, project._id);
            expect(lists.map((list) => list.name)).toEqual(expect.arrayContaining(['Backlog', 'This week']));
        } finally {
            await cleanUp({ owner, agent, tokenId });
        }
    });

    test('Undo after approving the project setup takes its parts back', async ({ page, state, loginAs }) => {
        const { owner, project, agent, tokenId } = await approveSetup({ page, state, loginAs }, 'undo setup');
        try {
            await page.getByRole('status').filter({ hasText: 'Approved' }).getByRole('button', { name: 'Undo' }).click();
            await expect(page.getByText('Approval undone.')).toBeVisible();

            await page.goto(`/#/${state.companyId}/project/${project._id}`);
            await expect(views(page).getByRole('button', { name: /^List/ })).toBeVisible();
            await expect(reviewBoard(page)).toHaveCount(0);
            const lists = await listSprints(owner.api, project._id);
            expect(lists.filter((list) => !Number(list.deletedStatusKey || 0)).map((list) => list.name)).not.toContain('This week');
        } finally {
            await cleanUp({ owner, agent, tokenId });
        }
    });
});
