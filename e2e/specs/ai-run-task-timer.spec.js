const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

test.describe.configure({ timeout: 45000 });

const MINUTE = 60 * 1000;

test.describe('the timer in the task panel', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('start, stop and "Time logged" put the minutes on the task', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `TIMER ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid, apps: ['TimeTracking'] });
        const name = `Timer task ${suffix}`;
        const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
        const panel = taskPanel(page);
        await expect(panel.getByRole('heading', { level: 2, name })).toBeVisible();

        // A timer under a minute logs nothing, so the page's clock is moved instead of waiting.
        const started = Date.now();
        await page.clock.setFixedTime(started);
        await panel.getByRole('button', { name: 'Start timer' }).click();
        const stop = panel.getByRole('button', { name: 'Stop and log time' });
        await expect(stop).toBeVisible();

        await page.clock.setFixedTime(started + 3 * MINUTE);
        await stop.click();

        await expect(page.getByText('Time logged', { exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Start timer' })).toBeVisible();
        await expect.poll(async () => {
            const res = await owner.api.get(`/api/v1/timesheet/task/${task._id}`);
            return res.body.data.totalMinutes;
        }, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
    });
});
