const { test, expect, asRole } = require('../support/test');
const { createProject, createTask, uniqueSuffix } = require('../support/fixtures');
const { skipFirstRun, taskPanel } = require('../support/pages');

const myWorkUrl = (state) => `/#/${state.companyId}?filter=assigned`;

async function assignedTask({ state, loginAs, label, assignTo = 'owner', extraMembers = [] }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const others = await Promise.all(extraMembers.map((role) => loginAs(role)));
    const people = [owner, ...others];
    const project = await createProject(owner.api, { name: `${label} ${suffix}`, assigneeIds: people.map((person) => person.uid), createdBy: owner.uid });
    const assignee = assignTo === 'owner' ? owner : others.find((person) => person.email.startsWith(assignTo));
    const name = `${label} task ${suffix}`;
    const task = await createTask(owner.api, { project, name, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [assignee.uid] });
    return { owner, project, task, name, suffix };
}

test.describe('Home and My work', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a task added for today stays after a reload and moves to Done when ticked', async ({ page, state }) => {
        const name = `Quick task ${uniqueSuffix()}`;

        await page.goto(myWorkUrl(state));
        const add = page.getByRole('textbox', { name: 'Add a task for today…' });
        await add.fill(name);
        await add.press('Enter');
        await expect(page.getByText('Added to your Personal List')).toBeVisible();
        const box = page.getByRole('checkbox', { name, exact: true });
        await expect(box).toBeVisible();

        await page.reload();
        await expect(box).toBeVisible();

        await box.click();
        await expect(page.getByText('Marked as done')).toBeVisible();
        await expect(box).toHaveCount(0);

        await page.reload();
        await expect(box).toHaveCount(0);
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
    });

    test('a task assigned in a project shows under My work and opens from its title', async ({ page, state, loginAs }) => {
        const { name } = await assignedTask({ state, loginAs, label: 'Assigned' });

        await page.goto(myWorkUrl(state));
        await expect(page.getByRole('checkbox', { name, exact: true })).toBeVisible();
        await page.getByRole('button', { name, exact: true }).click();

        await expect(taskPanel(page).getByRole('heading', { level: 2, name })).toBeVisible();
    });

    test('ticking an assigned task on My work closes it in the project too', async ({ page, state, loginAs }) => {
        const { owner, task, name } = await assignedTask({ state, loginAs, label: 'Tick' });

        await page.goto(myWorkUrl(state));
        await page.getByRole('checkbox', { name, exact: true }).click();
        await expect(page.getByText('Marked as done')).toBeVisible();

        await expect.poll(async () => {
            const row = (await owner.api.get(`/api/v1/task/${task._id}`)).body;
            return (row.data || row).statusType;
        }).toMatch(/^(done|close)$/);
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
    });

    test('a task handed to a teammate is listed under Delegated and not under To Do', async ({ page, state, loginAs }) => {
        const { name } = await assignedTask({ state, loginAs, label: 'Handed over', assignTo: 'member', extraMembers: ['member'] });

        await page.goto(myWorkUrl(state));
        await expect(page.getByRole('button', { name: 'To Do', exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox', { name, exact: true })).toHaveCount(0);

        await page.getByRole('button', { name: 'Delegated', exact: true }).click();
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    });

    test('sorting My work by name orders the tasks and is remembered after a reload', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const project = await createProject(owner.api, { name: `Sorted work ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        for (const label of ['Yankee', 'Alpha']) {
            await createTask(owner.api, { project, name: `${label} work ${suffix}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [owner.uid] });
        }
        const titles = page.getByRole('button', { name: new RegExp(`work ${suffix}$`) });

        await page.goto(myWorkUrl(state));
        await expect(titles).toHaveCount(2);
        const sort = page.getByRole('button', { name: /^sort: / });
        for (let step = 0; step < 3 && !/name/.test((await sort.textContent()) || ''); step += 1) await sort.click();
        await expect(sort).toContainText('name');
        await expect(titles).toHaveText([`Alpha work ${suffix}`, `Yankee work ${suffix}`]);

        await page.reload();
        await expect(page.getByRole('button', { name: /^sort: / })).toContainText('name');
        await expect(titles).toHaveText([`Alpha work ${suffix}`, `Yankee work ${suffix}`]);
    });
});
