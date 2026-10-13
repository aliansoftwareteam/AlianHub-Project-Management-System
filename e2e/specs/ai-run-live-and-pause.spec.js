const { MongoClient, ObjectId } = require('mongodb');
const { test, expect, asRole, storageStatePath } = require('../support/test');
const { createApiClient } = require('../support/api');
const { PASSWORD, assertOk, createFolder, createList, createProject, createTask, createWorkspace, emailFor, inviteMember, login, readState, registerVerifiedAccount, uniqueSuffix } = require('../support/fixtures');
const { resolveMongoUrl } = require('../support/env');
const { signInThroughForm, skipFirstRun } = require('../support/pages');

test.describe.configure({ timeout: 90000 });

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (name) => new RegExp(escapeRegex(name));
const LIMITS = '/api/v2/agents/project-limits';
const POLICY = '/api/v2/agents/policy';
const NAV_PREFERENCES = '/api/v2/users/nav-preferences';
const WIDE = { width: 1440, height: 900 };
const RAW_KEY = /^[a-z_]+(\.[a-z_]+)+$/;

async function memberPage(browser, state, options = {}) {
    const context = await browser.newContext({ baseURL: state.baseURL, storageState: storageStatePath('member'), ...options });
    const page = await context.newPage();
    await skipFirstRun(page);
    return { context, page };
}

const treeOf = (page) => page.getByRole('tree', { name: 'Projects and lists' });
const treeItem = (page, name) => treeOf(page).getByRole('treeitem', { name: named(name) });

async function changeList(api, { state, project, sprintId, updateObject, extra = {} }) {
    const res = await api.patch(`/api/v1/sprint/${sprintId}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: String(project._id),
        sprintName: extra.sprintName || '',
        projectData: { id: String(project._id), ProjectName: project.ProjectName },
        updateObject: { $set: updateObject },
        ...extra,
    });
    expect(res.body.status, `list change ${JSON.stringify(updateObject)}`).toBe(true);
}

test.describe('lists and projects follow live', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('a member\'s project tree follows a list added, renamed, moved into a folder, archived and made private', async ({ page, browser, state, loginAs }) => {
        const suffix = uniqueSuffix();
        const owner = await loginAs('owner');
        const memberId = state.users.member.userId;
        const project = await createProject(owner.api, { name: `LIVE LISTS ${suffix}`, assigneeIds: [owner.uid, memberId], createdBy: owner.uid });
        const projectUrl = `/#/${state.companyId}/project/${project._id}/p`;
        const seen = await memberPage(browser, state);

        try {
            await page.goto(projectUrl);
            await expect(page.getByText(project.ProjectName).first()).toBeVisible();
            await seen.page.goto(projectUrl);
            await expect(treeItem(seen.page, project.ProjectName)).toBeVisible();

            const first = `Live first ${suffix}`;
            const list = await createList(owner.api, { project, name: first, user: owner });
            await expect(treeItem(seen.page, first)).toBeVisible();

            const renamed = `Live renamed ${suffix}`;
            const rename = await owner.api.patch(`/api/v1/sprint/${list._id}`, { type: 'editSprintName', companyId: state.companyId, projectId: String(project._id), sprintName: renamed });
            expect(rename.body.status).toBe(true);
            await expect(treeItem(seen.page, renamed)).toBeVisible();
            await expect(treeItem(seen.page, first)).toHaveCount(0);

            const folderName = `Live folder ${suffix}`;
            const folder = await createFolder(owner.api, { project, name: folderName, user: owner });
            await expect(treeItem(seen.page, folderName)).toBeVisible();
            await changeList(owner.api, { state, project, sprintId: list._id, updateObject: { folderId: folder._id, folderName }, extra: { sprintName: renamed, folderId: null, historyData: { type: 'moved' } } });

            const folderItem = treeItem(seen.page, folderName);
            await expect(folderItem).toHaveAttribute('aria-expanded', /^(true|false)$/);
            if ((await folderItem.getAttribute('aria-expanded')) === 'false') {
                await treeOf(seen.page).locator('.pt-row').filter({ has: seen.page.getByRole('treeitem', { name: named(folderName) }) }).locator('.pt-row__chev').click();
                await expect(folderItem).toHaveAttribute('aria-expanded', 'true');
            }
            const folderLevel = Number(await folderItem.getAttribute('aria-level'));
            await expect(treeItem(seen.page, renamed)).toHaveAttribute('aria-level', String(folderLevel + 1));

            await changeList(owner.api, { state, project, sprintId: list._id, updateObject: { deletedStatusKey: 2 }, extra: { sprintName: renamed, folderId: folder._id } });
            await expect(treeItem(seen.page, renamed)).toHaveCount(0);

            const secret = `Live private ${suffix}`;
            const hidden = await createList(owner.api, { project, name: secret, user: owner });
            await expect(treeItem(seen.page, secret)).toBeVisible();
            await changeList(owner.api, { state, project, sprintId: hidden._id, updateObject: { private: true, AssigneeUserId: [owner.uid] }, extra: { sprintName: secret } });
            await expect(treeItem(seen.page, secret)).toHaveCount(0);
            await expect(treeItem(seen.page, folderName)).toBeVisible();
        } finally {
            await seen.context.close();
        }
    });

    test('a project the owner makes and shares appears in a member\'s project list with no reload', async ({ browser, state, loginAs }) => {
        const suffix = uniqueSuffix();
        const owner = await loginAs('owner');
        const seen = await memberPage(browser, state);

        try {
            await seen.page.goto(`/#/${state.companyId}/project`);
            await expect(seen.page.getByText(state.projects.shared.name).first()).toBeVisible();

            const name = `LIVE PROJECT ${suffix}`;
            await createProject(owner.api, { name, assigneeIds: [owner.uid, state.users.member.userId], createdBy: owner.uid });
            await expect(seen.page.getByText(name).first()).toBeVisible();
        } finally {
            await seen.context.close();
        }
    });

    test('a new empty list says it has no tasks yet and offers Create task, in List and Table', async ({ page, state, loginAs }) => {
        const suffix = uniqueSuffix();
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `EMPTY LIST ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        await createTask(owner.api, { project, name: `First task ${suffix}`, user: owner, companyOwnerId: owner.uid });
        const name = `Nothing yet ${suffix}`;
        const list = await createList(owner.api, { project, name, user: owner });

        await page.goto(`/#/${state.companyId}/project/${project._id}/s/${list._id}`);
        const title = page.getByText(`${name} has no tasks yet`, { exact: true });
        const create = page.getByRole('button', { name: 'Create task', exact: true });
        await expect(title).toBeVisible();
        await expect(create).toBeVisible();

        await page.getByRole('button', { name: 'Add View', exact: true }).click();
        await page.getByRole('button', { name: /^Table/ }).click();
        await page.getByRole('button', { name: 'Table', exact: true }).click();
        const table = page.locator('.tv2__empty');
        await expect(table.getByText(`${name} has no tasks yet`, { exact: true })).toBeVisible();
        await expect(table.getByRole('button', { name: 'Create task', exact: true })).toBeVisible();
    });
});

/* The pause holds every connected agent of a workspace, and other spec files work with agents in the suite's
 * workspace while this one runs: the pause is made in a workspace no other spec opens. */
async function workspaceOfItsOwn(state) {
    const suffix = uniqueSuffix();
    const ownerEmail = emailFor('owner', `pause${suffix}`);
    await registerVerifiedAccount(state.baseURL, { firstName: 'Opal', lastName: `Owner${suffix}`, email: ownerEmail });
    const companyId = await createWorkspace(state.baseURL, { email: ownerEmail, name: `Pause ${suffix}` });
    const session = await login(state.baseURL, ownerEmail);
    const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId });
    assertOk(await api.put(NAV_PREFERENCES, { mode: 'full' }), `full rail for ${ownerEmail}`);
    const memberEmail = emailFor('member', `pause${suffix}`);
    await inviteMember({ baseURL: state.baseURL, ownerApi: api, companyId, role: 'member', email: memberEmail, firstName: 'Milo', lastName: `Member${suffix}` });
    return { companyId, api, ownerEmail, memberEmail };
}

test.describe('AI > Accounts: the pause for connected agents', () => {
    test.describe.configure({ mode: 'serial', timeout: 150000 });
    // At 1280 px and under the AI sidebar is an icon rail without its usage block, where the paused line and Resume are.
    test.use({ viewport: WIDE });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    let workspace;

    test.beforeAll(async () => {
        workspace = await workspaceOfItsOwn(readState());
    });

    test.afterAll(async () => {
        if (workspace) assertOk(await workspace.api.put(POLICY, { connectedPaused: false }), 'connected agents resumed');
    });

    test('the owner pauses connected agents, a member sees the paused line without Resume, and the owner resumes', async ({ page, browser, state }) => {
        const url = `/#/${workspace.companyId}/ai/accounts`;
        const pause = page.locator('[data-test="connected-pause-switch"]');
        const sidebar = page.locator('.ai-side__usage');
        const pausedLine = (target) => target.locator('.ai-side__usage').getByText('Connected agents are paused', { exact: true });
        const resume = (target) => target.getByRole('button', { name: 'Resume connected agents', exact: true });
        const policyRead = (target) => target.waitForResponse((res) => res.url().includes(POLICY) && res.request().method() === 'GET' && res.ok());
        const seenContext = await browser.newContext({ baseURL: state.baseURL, viewport: WIDE });
        const seen = { context: seenContext, page: await seenContext.newPage() };

        try {
            await skipFirstRun(seen.page);
            await signInThroughForm(seen.page, { email: workspace.memberEmail, password: PASSWORD, companyId: workspace.companyId });
            await signInThroughForm(page, { email: workspace.ownerEmail, password: PASSWORD, companyId: workspace.companyId });

            const read = policyRead(page);
            await page.goto(url);
            await read;
            await expect(pause).toBeVisible();
            await expect(pause).toBeEnabled();
            await expect(pause).not.toBeChecked();
            await expect(pausedLine(page)).toHaveCount(0);

            await pause.check();
            await expect(page.locator('[data-test="connected-pause-saved"]')).toBeVisible();
            await expect(pause).toBeEnabled();
            await expect(pause).toBeChecked();
            await expect(pausedLine(page)).toBeVisible();
            await expect(resume(sidebar)).toBeVisible();

            await seen.page.goto(url);
            await expect(pausedLine(seen.page)).toBeVisible();
            await expect(resume(seen.page)).toHaveCount(0);
            await expect(seen.page.locator('[data-test="connected-pause-switch"]')).toBeDisabled();

            await resume(sidebar).click();
            await expect(pausedLine(page)).toHaveCount(0);
            await expect(resume(sidebar)).toHaveCount(0);
            await expect(sidebar.locator('[data-test="pause-all"]')).toBeVisible();
            await expect(pause).not.toBeChecked();

            const readAgain = policyRead(seen.page);
            await seen.page.reload();
            expect((await (await readAgain).json()).data.connectedPaused).toBe(false);
            await expect(seen.page.locator('.ai-side__usage')).toBeVisible();
            await expect(pausedLine(seen.page)).toHaveCount(0);
        } finally {
            await seen.context.close();
        }
    });
});

test.describe('Project Details: limits on agents', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('the limits at once and on direct tasks are saved, hold after a reload and are put back', async ({ page, state, loginAs }) => {
        const suffix = uniqueSuffix();
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { name: `LIMITS ${suffix}`, assigneeIds: [owner.uid], createdBy: owner.uid });
        const url = `/#/${state.companyId}/project/${project._id}/p?tab=ProjectDetail`;
        const card = () => page.getByRole('region', { name: 'Agents working at the same time' });
        const controls = [
            () => card().getByRole('combobox', { name: 'Agents at work at once' }),
            () => card().getByRole('combobox', { name: 'Tasks a connected agent changes on its own' }),
        ];
        const saved = () => page.waitForResponse((res) => res.url().includes(`${LIMITS}/${project._id}`) && res.request().method() === 'PUT' && res.ok());

        async function choose(control, label) {
            const answer = saved();
            await control().selectOption({ label });
            await answer;
            await expect(control()).toBeEnabled();
        }

        await page.goto(url);
        await expect(card()).toBeVisible();
        const originals = [];
        const wanted = [];
        for (const control of controls) {
            await expect(control()).toBeEnabled();
            const options = (await control().getByRole('option').allTextContents()).map((text) => text.trim());
            const before = await control().evaluate((select) => select.selectedOptions[0].textContent.trim());
            originals.push(before);
            wanted.push(options.find((text) => text !== before));
        }
        test.skip(wanted.some((label) => !label), 'a range allows one number only');

        try {
            for (const [at, control] of controls.entries()) await choose(control, wanted[at]);

            await page.goto(url);
            await page.reload();
            await expect(card()).toBeVisible();
            for (const [at, control] of controls.entries()) {
                await expect(control()).toBeEnabled();
                await expect(control().locator('option:checked')).toHaveText(wanted[at]);
            }
        } finally {
            for (const [at, control] of controls.entries()) {
                if ((await control().evaluate((select) => select.selectedOptions[0].textContent.trim())) !== originals[at]) await choose(control, originals[at]);
            }
        }

        await page.reload();
        for (const [at, control] of controls.entries()) await expect(control().locator('option:checked')).toHaveText(originals[at]);
    });
});

test.describe('Settings > Audit log, in words', () => {
    test.use(asRole('owner'));
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    let client;
    let seeded = [];

    test.beforeEach(async ({ state }) => {
        client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        const now = Date.now();
        const row = (at, action, meta = {}) => ({
            _id: new ObjectId(),
            action,
            actorId: state.users.owner.userId,
            actorName: 'Olivia Owner',
            actorType: 'user',
            entityType: 'project',
            entityId: String(new ObjectId()),
            entityName: `Audit words ${uniqueSuffix()}`,
            meta,
            createdAt: new Date(now + at),
        });
        const docs = [
            row(3, 'member.update'),
            row(2, 'agent.project_policy_changed'),
            row(1, 'agent.action', { action: 'task.comment' }),
            row(0, 'zz.not_worded_yet'),
        ];
        await client.db(state.companyId).collection('audit_logs').insertMany(docs);
        seeded = docs.map((doc) => doc._id);
    });

    test.afterEach(async ({ state }) => {
        if (!client) return;
        await client.db(state.companyId).collection('audit_logs').deleteMany({ _id: { $in: seeded } });
        await client.close();
        client = null;
    });

    test('no Event cell shows a raw key and a row\'s Details opens', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/settings/audit-logs`);
        const rows = page.locator('table.al__table tbody tr');
        await expect(rows.first()).toBeVisible();
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(seeded.length);

        const events = await page.locator('table.al__table tbody tr td:nth-child(3)').allInnerTexts();
        expect(events.length).toBe(count);
        for (const event of events) expect(event.trim(), 'an Event cell').not.toMatch(RAW_KEY);

        const details = rows.first().locator('details[data-test="row-details"]');
        await details.getByText('Details', { exact: true }).click();
        await expect(details).toHaveAttribute('open', '');
        await expect(details.locator('.al__detail').first()).toBeVisible();
    });
});
