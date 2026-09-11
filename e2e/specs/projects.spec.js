const { test, expect, asRole } = require('../support/test');

const go = async (page, hash) => {
    await page.goto(hash);
    await page.waitForLoadState('networkidle').catch(() => {});
};

test.describe('projects and planning as the owner', () => {
    test.use(asRole('owner'));

    test('the projects list shows the shared project', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/project`);
        await expect(page.getByText(state.projects.shared.name, { exact: false }).first()).toBeVisible();
    });

    test('the project shell opens on its List view', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/project/${state.projects.shared._id}/p`);
        await expect(page.getByText('List', { exact: true }).first()).toBeVisible();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.waitForTimeout(500);
        expect(errors).toEqual([]);
    });

    test('the recurring-tasks screen renders its empty state', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/project/${state.projects.shared._id}/recurring`);
        await expect(page.getByText('Recurring tasks', { exact: false }).first()).toBeVisible();
        await expect(page.getByText('No rules yet', { exact: false })).toBeVisible();
    });

    test('the portfolio screen renders', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/portfolio`);
        await expect(page.getByText('New portfolio', { exact: false }).first()).toBeVisible();
    });

    test('the capacity planning screen renders on a desktop viewport', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/reports/capacity`);
        await expect(page.getByText('This view is desktop-only', { exact: false })).toHaveCount(0);
        await expect(page.getByText(/Capacity/i).first()).toBeVisible();
    });

    test('the sprint report screen renders its report tabs', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/reports/sprint`);
        await expect(page.getByText('Velocity', { exact: false }).first()).toBeVisible();
    });

    test('the milestone report screen renders', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/report/milestone`);
        await expect(page.getByText('Milestone Report', { exact: false }).first()).toBeVisible();
    });
});

test.describe('projects and planning as a member', () => {
    test.use(asRole('member'));

    test('a private project the member is not in is absent from the list', async ({ page, state }) => {
        await go(page, `/#/${state.companyId}/project`);
        await expect(page.getByText(state.projects.shared.name, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(state.projects.restricted.name, { exact: true })).toHaveCount(0);
    });
});

test.describe('projects and planning — folder deep link (PRJ-07)', () => {
    test.use(asRole('owner'));

    test.fail('a folder deep link opens the folder view instead of redirecting to the list', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const folderName = `Folder ${Date.now()}`;
        const folder = await owner.api.post('/api/v1/folder', {
            companyId: owner.companyId, projectId: state.projects.shared._id, folderName,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' }, projectName: state.projects.shared.name, mainChat: true,
        });
        const folderId = folder.body.data._id;
        const sprintName = `Folder sprint ${Date.now()}`;
        await owner.api.post('/api/v1/sprint', {
            companyId: owner.companyId, projectId: state.projects.shared._id, sprintName,
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner' }, projectName: state.projects.shared.name,
            folder: { folderId, folderName }, private: false,
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await go(page, `/#/${state.companyId}/project/${state.projects.shared._id}/f/${folderId}`);
        await page.waitForTimeout(1000);
        expect(errors).toEqual([]);
        await expect(page.getByText(sprintName, { exact: false })).toBeVisible();
    });
});
