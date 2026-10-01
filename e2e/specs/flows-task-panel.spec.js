const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, findTasksByName, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

async function openTaskPanel({ page, state, loginAs, label, assigneeIds }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: assigneeIds || [owner.uid], createdBy: owner.uid });
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
    await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
    const panel = taskPanel(page);
    await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();
    return { owner, project, task, name, panel, suffix };
}

test.describe('everyday flows in the task panel', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a task takes a subtask and that subtask takes one more, and the third level takes none', async ({ page, state, loginAs }) => {
        const { owner, project, task, panel, suffix } = await openTaskPanel({ page, state, loginAs, label: 'Tree' });
        const addSubtask = panel.getByRole('group', { name: 'Quick actions' }).getByRole('button', { name: 'Add subtask' });
        const names = [2, 3].map((level) => `Level ${level} ${suffix}`);

        for (const name of names) {
            await addSubtask.click();
            const field = panel.getByPlaceholder('Task name');
            await field.fill(name);
            await field.press('Enter');
            await panel.getByRole('button', { name, exact: true }).click();
            await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();
        }

        await expect(panel.getByText('Subtasks go three levels deep, and this one is on the third.')).toBeVisible();
        await expect(addSubtask).toHaveCount(0);

        const parents = [task._id];
        for (const name of names) {
            const [made] = await findTasksByName(owner.api, project._id, name);
            expect(String(made.ParentTaskId)).toBe(parents[parents.length - 1]);
            parents.push(String(made._id));
        }
    });

    test('a comment that mentions a teammate is posted and is still there after a reload', async ({ page, state, loginAs }) => {
        const { panel, suffix } = await openTaskPanel({
            page, state, loginAs, label: 'Mention', assigneeIds: [state.users.owner.userId, state.users.member.userId],
        });
        const text = `please look at this ${suffix}`;
        const posted = new RegExp(`Max Member.{0,3}${text}`);

        const composer = panel.getByPlaceholder('Type here');
        await composer.click();
        await composer.pressSequentially('@Max');
        await page.getByRole('listbox', { name: 'People to mention' }).getByRole('option', { name: 'Max Member' }).click();
        await expect(composer).toHaveValue(/@\[Max Member\]\(.+\) $/);
        await composer.pressSequentially(text);
        await composer.press('Enter');

        await expect(panel.getByText(posted)).toBeVisible();
        await expect(composer).toHaveValue('');

        await page.reload();
        await expect(taskPanel(page).getByText(posted)).toBeVisible();
    });
});
