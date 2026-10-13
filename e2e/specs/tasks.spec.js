const { test, expect, asRole } = require('../support/test');

test.describe('tasks & collaboration screens as the owner', () => {
    test.use(asRole('owner'));

    test('the Trash screen renders its heading', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/trash`);
        await expect(page.getByText('Deleted work stays here until you restore it.')).toBeVisible();
    });

    test('the Personal List screen renders', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/personal`);
        await expect(page.getByText('Only you', { exact: true })).toBeVisible();
    });

    test('a task created for this test opens in the task detail overlay', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
        const name = `UI Findable ${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `TSK UI ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}/${task._id}`);
        await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    });
});

test.describe('tasks & collaboration as a guest', () => {
    test.use(asRole('guest'));

    // TSK-05 (UI): global search must not surface a project the guest is not a member of.
    test('TSK-05: search does not leak an owner-only project to a guest', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
        const marker = `Zleak${uniqueSuffix()}`;
        const project = await createProject(owner.api, { name: `TSK Leak ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        await createTask(owner.api, { project, name: `Leak ${marker}`, user: state.users.owner, companyOwnerId: owner.uid });

        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v2/search', { query: marker });
        const leaked = (res.body.data.tasks || []).some((t) => String(t.ProjectID) === String(project._id));
        expect(leaked).toBe(false);
    });
});
