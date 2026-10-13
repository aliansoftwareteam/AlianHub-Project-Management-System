const { test, expect } = require('../support/test');
const { createProject, createTask, listSprints } = require('../support/fixtures');
const { listRow, signInThroughForm, skipFirstRun } = require('../support/pages');
const { newMember } = require('../support/twoPeople');

test.describe.configure({ timeout: 90000 });

async function projectWithPrivateList({ state, owner, member, suffix }) {
    const marker = `Zpriv${suffix}`;
    const project = await createProject(owner.api, { name: `TWO PRIVATE LIST ${suffix}`, assigneeIds: [owner.uid, member.userId], createdBy: owner.uid });
    const assigneeIds = [owner.uid, member.userId];
    const open = { name: `Open ${marker}` };
    open.task = await createTask(owner.api, { project, name: open.name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds });

    const sprintName = `Private list ${suffix}`;
    const added = await owner.api.post('/api/v1/sprint', {
        companyId: state.companyId,
        projectId: String(project._id),
        sprintName,
        projectName: project.ProjectName,
        userData: { id: owner.uid, Employee_Name: 'Olivia Owner' },
        private: false,
        icon: {},
        folder: null,
    });
    expect(added.status).toBe(200);
    const sprint = (await listSprints(owner.api, project._id)).find((row) => row.name === sprintName);
    const made = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: String(project._id),
        updateObject: { $set: { private: true, AssigneeUserId: [owner.uid] } },
    });
    expect(made.body.status).toBe(true);

    const hidden = { name: `Hidden ${marker}` };
    hidden.task = await createTask(owner.api, { project, name: hidden.name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds, sprint: { ...sprint, _id: String(sprint._id) } });
    return { project, marker, open, hidden };
}

test.describe('a private list as a member who is not on it', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('its tasks are missing from the List, Everything and search', async ({ page, state, loginAs }) => {
        const { owner, member, email, suffix } = await newMember({ state, loginAs, firstName: 'Lena' });
        const { project, marker, open, hidden } = await projectWithPrivateList({ state, owner, member, suffix });

        const ownerSees = await owner.api.post('/api/v2/search', { query: marker });
        expect((ownerSees.body.data.tasks || []).map((task) => task.TaskName)).toContain(hidden.name);

        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });

        await page.goto(`/#/${state.companyId}/project/${project._id}/p`);
        await expect(listRow(page, open.name)).toBeVisible();
        await expect(listRow(page, hidden.name)).toHaveCount(0);

        await page.goto(`/#/${state.companyId}/everything`);
        await page.getByRole('searchbox', { name: 'Search tasks' }).fill(marker);
        const rows = page.getByRole('listitem');
        await expect(rows.filter({ has: page.getByRole('button', { name: open.name, exact: true }) })).toBeVisible();
        await expect(rows.filter({ has: page.getByRole('button', { name: hidden.name, exact: true }) })).toHaveCount(0);

        await page.goto(`/#/${state.companyId}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Today & Overdue' })).toBeVisible();
        await page.getByRole('button', { name: 'Search or ask AI' }).focus();
        await page.keyboard.press('Meta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await palette.getByRole('combobox', { name: 'Search, go to or run a command' }).fill(marker);
        const results = palette.getByRole('listbox');
        await expect(results.getByRole('option', { name: new RegExp(open.name) })).toBeVisible();
        await expect(results.getByRole('option', { name: new RegExp(hidden.name) })).toHaveCount(0);
    });
});
