const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

async function taskWithField({ state, loginAs, fieldType }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `Fields ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid, apps: ['CustomFields'] });
    const fieldTitle = `Reference ${suffix}`;
    const field = await owner.api.post('/api/v1/customField', {
        type: 'save',
        updateObject: {
            fieldTitle, fieldDescription: fieldTitle, fieldType, fieldTaskTypes: [], type: 'task', global: false, isDelete: true, projectId: [String(project._id)], userId: owner.uid, createdAt: new Date(),
        },
    });
    if (field.status !== 200) throw new Error(`create field failed (${field.status}): ${JSON.stringify(field.body).slice(0, 300)}`);
    const name = `Field task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });
    const url = `/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`;
    return { owner, task, name, fieldTitle, url, suffix };
}

const storedTask = async (api, taskId) => JSON.stringify((await api.get(`/api/v1/task/${taskId}`)).body);

test.describe('filling a custom field on a task', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a text field filled in the task panel is saved on the task', async ({ page, state, loginAs }) => {
        const { owner, task, name, fieldTitle, url, suffix } = await taskWithField({ state, loginAs, fieldType: 'text' });
        const value = `REF-${suffix}`;

        await page.goto(url);
        const panel = taskPanel(page);
        await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();
        const field = panel.getByRole('textbox', { name: fieldTitle });
        await field.fill(value);
        await field.press('Tab');

        await expect.poll(() => storedTask(owner.api, task._id)).toContain(value);
    });

    test('a filled field keeps its value when the task is opened again', async ({ page, state, loginAs }) => {
        const { owner, task, name, fieldTitle, url, suffix } = await taskWithField({ state, loginAs, fieldType: 'text' });
        const value = `KEEP-${suffix}`;

        await page.goto(url);
        const panel = taskPanel(page);
        await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();
        const field = panel.getByRole('textbox', { name: fieldTitle });
        await field.fill(value);
        await field.press('Tab');
        await expect.poll(() => storedTask(owner.api, task._id)).toContain(value);

        await page.reload();
        await expect(taskPanel(page).getByRole('textbox', { name: fieldTitle })).toHaveValue(value);
    });
});
