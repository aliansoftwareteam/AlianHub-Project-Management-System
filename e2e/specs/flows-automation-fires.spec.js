const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

const ruleFor = (projectId, body) => ({
    name: `E2E fires ${uniqueSuffix()}`,
    trigger: { event: 'task.created' },
    scope: { allProjects: false, projectIds: [String(projectId)] },
    conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body } }],
});

async function projectFor({ loginAs, label }) {
    const owner = await loginAs('owner');
    const project = await createProject(owner.api, { name: `${label} ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
    return { owner, project };
}

const listedRule = async (api, match) => ((await api.get('/api/v2/automations')).body.data || []).find(match);

const commentsSaying = async (api, { project, task, body }) => {
    const res = await api.get('/api/v1/comments/get-paginated-messages', {
        query: { projectId: String(project._id), taskId: String(task._id), isDefault: 'true', batchLimit: 100 },
    });
    return ((res.body && res.body.data) || []).filter((comment) => comment.message === body);
};

const ruleRow = (page, text) => page.getByText(text, { exact: false }).first().locator('xpath=..');

test.describe('an automation rule fires', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a rule switched on from the list comments on a task created afterwards', async ({ page, state, loginAs }) => {
        const { owner, project } = await projectFor({ loginAs, label: 'Switch' });
        const body = `Posted by the rule ${uniqueSuffix()}`;
        const created = await owner.api.post('/api/v2/automations', ruleFor(project._id, body));
        const ruleId = created.body.data._id;
        try {
            await page.goto(`/#/${state.companyId}/automations`);
            const row = ruleRow(page, body);
            await expect(row).toBeVisible();
            await row.getByRole('button', { name: 'Turn on' }).click();
            await expect.poll(async () => (await listedRule(owner.api, (rule) => rule._id === ruleId))?.enabled).toBe(true);

            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
            await expect.poll(async () => (await commentsSaying(owner.api, { project, task, body })).length).toBe(1);

            await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
            await expect(taskPanel(page).getByText(body, { exact: true })).toBeVisible();
        } finally {
            await owner.api.patch(`/api/v2/automations/${ruleId}/enabled`, { enabled: false });
            await owner.api.delete(`/api/v2/automations/${ruleId}`);
        }
    });

    test('a rule written as a sentence in the builder is saved, switched on and fires', async ({ page, state, loginAs }) => {
        const { owner, project } = await projectFor({ loginAs, label: 'Builder' });
        const body = `Welcome aboard ${uniqueSuffix()}`;
        let ruleId = '';
        try {
            await page.goto(`/#/${state.companyId}/automations`);
            await page.getByRole('button', { name: 'New automation' }).first().click();
            const sentence = page.getByRole('textbox', { name: 'When a task status changes to Blocked, post a comment saying "needs help".' });
            await sentence.fill(`When a task is created, post a comment saying "${body}"`);
            await sentence.press('Enter');
            await expect(page.getByText('COMPILED RULE · EDIT ANY PART')).toBeVisible();
            await page.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'any project' }) }).selectOption({ label: project.ProjectName });
            await page.getByRole('button', { name: 'Save automation' }).click();

            const row = ruleRow(page, body);
            await expect(row).toBeVisible();
            await expect(row.getByRole('button', { name: 'Turn off' })).toBeVisible();
            const saved = await listedRule(owner.api, (rule) => JSON.stringify(rule).includes(body));
            ruleId = saved._id;
            expect(saved.enabled).toBe(true);

            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
            await expect.poll(async () => (await commentsSaying(owner.api, { project, task, body })).length).toBe(1);
        } finally {
            if (ruleId) {
                await owner.api.patch(`/api/v2/automations/${ruleId}/enabled`, { enabled: false });
                await owner.api.delete(`/api/v2/automations/${ruleId}`);
            }
        }
    });

    test('the run history of a rule names the task it ran on', async ({ page, state, loginAs }) => {
        const { owner, project } = await projectFor({ loginAs, label: 'History' });
        const body = `Logged by the rule ${uniqueSuffix()}`;
        const created = await owner.api.post('/api/v2/automations', ruleFor(project._id, body));
        const ruleId = created.body.data._id;
        try {
            await owner.api.patch(`/api/v2/automations/${ruleId}/enabled`, { enabled: true });
            const name = `Run history task ${uniqueSuffix()}`;
            const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
            await expect.poll(async () => (await commentsSaying(owner.api, { project, task, body })).length).toBe(1);

            await page.goto(`/#/${state.companyId}/automations`);
            await ruleRow(page, body).getByRole('button', { name: 'History' }).click();
            const drawer = page.getByRole('dialog', { name: 'Run history' });
            await expect(drawer.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
            await drawer.getByRole('button', { name: 'Close' }).click();
            await expect(drawer).toBeHidden();
        } finally {
            await owner.api.patch(`/api/v2/automations/${ruleId}/enabled`, { enabled: false });
            await owner.api.delete(`/api/v2/automations/${ruleId}`);
        }
    });

    test('a rule can be switched off and then deleted from the list', async ({ page, state, loginAs }) => {
        const { owner, project } = await projectFor({ loginAs, label: 'Off' });
        const body = `Leaves the list ${uniqueSuffix()}`;
        const created = await owner.api.post('/api/v2/automations', ruleFor(project._id, body));
        const ruleId = created.body.data._id;
        try {
            await owner.api.patch(`/api/v2/automations/${ruleId}/enabled`, { enabled: true });

            await page.goto(`/#/${state.companyId}/automations`);
            const row = ruleRow(page, body);
            await row.getByRole('button', { name: 'Turn off' }).click();
            await expect(row.getByRole('button', { name: 'Turn on' })).toBeVisible();
            await expect.poll(async () => (await listedRule(owner.api, (rule) => rule._id === ruleId))?.enabled).toBe(false);

            await row.getByRole('button', { name: 'Delete' }).click();
            await expect(page.getByText(body, { exact: false })).toHaveCount(0);
            await expect.poll(async () => Boolean(await listedRule(owner.api, (rule) => rule._id === ruleId))).toBe(false);
        } finally {
            await owner.api.delete(`/api/v2/automations/${ruleId}`);
        }
    });
});
