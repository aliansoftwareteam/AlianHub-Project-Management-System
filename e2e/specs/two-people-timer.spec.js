/* eslint-env browser */
const { test, expect } = require('../support/test');
const { createProject, createTask } = require('../support/fixtures');
const { signInThroughForm, skipFirstRun, taskPanel } = require('../support/pages');
const { newMember } = require('../support/twoPeople');

test.describe.configure({ timeout: 90000 });

const REVIEW = '/api/v2/timesheet-approval';

test.describe('a timer and a week the owner approved', () => {
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('Stop keeps the timer running while the week is approved, and logs the time once it is reopened', async ({ page, state, loginAs }) => {
        const { owner, member, email, api, suffix } = await newMember({ state, loginAs, firstName: 'Tess' });
        const project = await createProject(owner.api, { name: `TWO TIMER ${suffix}`, assigneeIds: [owner.uid, member.userId], createdBy: owner.uid });
        const taskName = `Timed task ${suffix}`;
        const task = await createTask(owner.api, { project, name: taskName, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [member.userId] });
        let approval;

        try {
            await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });
            await page.goto(`/#/${state.companyId}/project/${project._id}/s/${task.sprintId}?task=${task._id}`);
            const panel = taskPanel(page);
            await expect(panel.getByRole('heading', { level: 2, name: taskName })).toBeVisible();
            await panel.getByRole('button', { name: /^Start timer/ }).first().click();

            // A timer under a minute is discarded on Stop, so the stored one starts three minutes ago.
            const key = `ah.timer.${member.userId}`;
            await page.waitForFunction((k) => Boolean(window.localStorage.getItem(k)), key);
            await page.evaluate((k) => {
                const entry = JSON.parse(window.localStorage.getItem(k));
                entry.firstStartedAt -= 180000;
                entry.startedAt -= 180000;
                window.localStorage.setItem(k, JSON.stringify(entry));
            }, key);

            await page.goto(`/#/${state.companyId}/timesheet/user`);
            await page.reload();
            await expect(page.getByRole('heading', { level: 1, name: 'My timesheet' })).toBeVisible();
            const stop = page.getByRole('button', { name: 'Stop', exact: true }).first();
            await expect(stop).toBeVisible();

            await page.getByRole('button', { name: 'Submit week' }).click();
            await expect(page.getByText('Week submitted for approval.')).toBeVisible();

            await expect.poll(async () => {
                const queue = await owner.api.get(`${REVIEW}/queue`, { query: { hoursPerDay: 8 } });
                approval = ((queue.body && queue.body.data) || []).find((row) => String(row.userId) === member.userId);
                return Boolean(approval);
            }).toBe(true);
            const approved = await owner.api.post(`${REVIEW}/${approval._id}/review`, { action: 'approve' });
            expect(approved.body).toMatchObject({ status: true, data: { status: 'approved' } });

            await stop.click();
            await expect(page.getByText(/in an approved week/)).toBeVisible();
            await expect(page.getByText('Your timer was not stopped', { exact: false })).toBeVisible();
            await expect(stop).toBeVisible();
            expect((await api.get(`/api/v1/timesheet/task/${task._id}`)).body.data.totalMinutes).toBe(0);

            const reopened = await owner.api.post(`${REVIEW}/${approval._id}/review`, { action: 'reopen' });
            expect(reopened.body).toMatchObject({ status: true, data: { status: 'submitted' } });

            await stop.click();
            await expect(page.getByText(new RegExp(`^Logged .+ on ${taskName}\\.$`))).toBeVisible();
            await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
            await expect.poll(async () => (await api.get(`/api/v1/timesheet/task/${task._id}`)).body.data.totalMinutes).toBeGreaterThan(0);
        } finally {
            if (approval) await owner.api.post(`${REVIEW}/${approval._id}/review`, { action: 'reopen' });
        }
    });
});
