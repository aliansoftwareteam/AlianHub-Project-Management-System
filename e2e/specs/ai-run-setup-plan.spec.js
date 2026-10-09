const path = require('node:path');
const { test, expect } = require('../support/test');
const { STATE_DIR, resolveMongoUrl } = require('../support/env');
const { createApiClient } = require('../support/api');
const { createProject, findTasksByName, listSprints, login, readTask, uniqueSuffix } = require('../support/fixtures');
const { startServer } = require('../support/server');
const { listRow, signInThroughForm, skipFirstRun } = require('../support/pages');

/* The whole of "set up my project": a connected AI sends one plan through the MCP endpoint, the person leaves two
 * parts out on the card in the Inbox and approves, and the project holds what stayed ticked and nothing else of
 * the plan. The suite's own server runs without the setup and task tools, so this drives one that has them, on the
 * same database, with names no other spec uses. */

const idOf = (doc) => String(doc._id || doc.id);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test.describe('a setup plan from a connected AI, approved in part', () => {
    test.describe.configure({ mode: 'serial', timeout: 240000 });

    let server;

    test.beforeAll(async () => {
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, 'setup-plan-server.log'),
            env: { MCP_TOOLS_WORK: 'on', MCP_TOOLS_MANAGE: 'on' },
        });
    });

    test.afterAll(async () => {
        if (server) await server.stop();
    });

    test('only what stays ticked is made: statuses, lists, fields, a view, an automation and tasks', async ({ browser, state }) => {
        const session = await login(server.baseURL, state.users.owner.email, state.password);
        const api = createApiClient({ baseURL: server.baseURL, accessToken: session.accessToken, companyId: state.companyId });
        const sfx = uniqueSuffix();
        const project = await createProject(api, { name: `PLAN ${sfx}`, assigneeIds: [session.uid], createdBy: session.uid });
        const projectId = idOf(project);

        const names = {
            review: `Review ${sfx}`, parked: `Parked ${sfx}`,
            backlog: `Backlog ${sfx}`, later: `Later ${sfx}`,
            budget: `Budget ${sfx}`, region: `Region ${sfx}`,
            board: `Review view ${sfx}`,
            comment: `Ready for review ${sfx}`,
            brief: `Write the brief ${sfx}`, kickoff: `Book the kickoff ${sfx}`, logins: `Collect the logins ${sfx}`,
        };
        const reason = `Kickoff plan ${sfx}`;
        const plan = {
            projectId,
            statuses: [names.review, names.parked],
            lists: [names.backlog, names.later],
            fields: [{ name: names.budget, type: 'money' }, { name: names.region, type: 'text' }],
            views: [{ name: names.board, kind: 'list', groupBy: 'status', showFields: [names.budget] }],
            rules: [{
                trigger: 'task.status_changed',
                conditions: [{ field: 'statusRef', op: 'changedTo', value: names.review }],
                actions: [{ action: 'add_comment', config: { body: names.comment } }],
            }],
            tasks: [
                { name: names.brief, list: names.backlog, status: names.review, assigneeId: session.uid, dueDate: day(14) },
                { name: names.kickoff, list: names.later },
                { name: names.logins },
            ],
            reason,
        };

        const minted = await api.post('/api/v2/api-tokens/mcp', { name: `E2E plan ${sfx}`, mode: 'personal', grants: ['tasks:manage'], expiresInDays: 1 });
        expect(minted.body.status, JSON.stringify(minted.body).slice(0, 300)).toBe(true);
        const { token, _id: tokenId } = minted.body.data;
        const context = await browser.newContext({ baseURL: server.baseURL });

        try {
            const agent = createApiClient({ baseURL: server.baseURL, accessToken: token, companyId: state.companyId });
            const called = await agent.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'project.setup', arguments: plan } });
            expect(called.status).toBe(200);
            const answer = JSON.parse(called.body.result.content[0].text);
            expect(answer, JSON.stringify(answer).slice(0, 500)).toMatchObject({ pending: true, approval: 'pending' });

            expect((await listSprints(api, projectId)).map((list) => list.name)).not.toContain(names.backlog);
            expect(await findTasksByName(api, projectId, names.brief)).toHaveLength(0);

            const page = await context.newPage();
            await skipFirstRun(page);
            await signInThroughForm(page, { email: state.users.owner.email, password: state.password, companyId: state.companyId });
            await page.goto(`/#/${state.companyId}/inbox?tab=approval`);

            const row = page.getByRole('region', { name: 'Needs your approval' }).getByRole('listitem').filter({ hasText: reason });
            await expect(row).toHaveCount(1);
            await expect(row).toContainText(`wants to set up the project “${project.ProjectName}”`);
            const tick = (name) => row.getByRole('checkbox', { name, exact: true });
            const tickOf = (name) => row.getByRole('checkbox', { name: new RegExp(`^${name}`) });
            for (const name of [names.review, names.parked, names.backlog, names.later]) await expect(tick(name)).toBeChecked();
            await expect(tickOf(names.kickoff)).toBeChecked();
            await expect(row.getByRole('definition').filter({ hasText: names.comment })).toContainText('starts switched off');

            await tick(names.parked).uncheck();
            await tick(names.later).uncheck();
            await expect(tickOf(names.kickoff)).not.toBeChecked();
            await expect(row.getByRole('status')).toContainText(`${names.kickoff}`);
            await expect(row.getByRole('status')).toContainText('left out too');
            await expect(tickOf(names.brief)).toBeChecked();
            await expect(row.getByText('Ticked: 1 of 2 statuses, 1 of 2 lists, 2 of 3 first tasks.')).toBeVisible();

            await tick(names.later).check();
            await expect(tickOf(names.kickoff)).toBeChecked();
            await expect(row.getByRole('status')).toContainText('is back too');
            await tick(names.later).uncheck();
            await expect(tickOf(names.kickoff)).not.toBeChecked();

            await row.getByRole('button', { name: /^Approve:/ }).click();
            await expect(row).toHaveCount(0);

            await expect.poll(async () => (await findTasksByName(api, projectId, names.logins)).length, { timeout: 30000 }).toBe(1);

            const stored = (await api.get(`/api/v1/project/${projectId}`)).body;
            const statuses = stored.taskStatusData.map((status) => status.name);
            expect(statuses).toContain(names.review);
            expect(statuses).not.toContain(names.parked);
            expect(stored.ProjectRequiredComponent.map((view) => view.title)).toContain(names.board);

            const lists = await listSprints(api, projectId);
            expect(lists.map((list) => list.name)).toContain(names.backlog);
            expect(lists.map((list) => list.name)).not.toContain(names.later);
            const backlog = lists.find((list) => list.name === names.backlog);

            const fields = (await api.get('/api/v1/customField', { query: { global: 'false' } })).body;
            const ofProject = fields.filter((field) => [].concat(field.projectId || []).map(String).includes(projectId)).map((field) => field.fieldTitle);
            expect(ofProject.sort()).toEqual([names.budget, names.region].sort());

            const rules = (await api.get('/api/v2/automations')).body.data.filter((rule) => ((rule.scope && rule.scope.projectIds) || []).map(String).includes(projectId));
            expect(rules).toHaveLength(1);
            expect(rules[0].enabled).toBe(false);
            expect(JSON.stringify(rules[0].steps)).toContain(names.comment);

            const [brief] = await findTasksByName(api, projectId, names.brief);
            expect(brief).toBeTruthy();
            const briefTask = await readTask(api, idOf(brief));
            expect(String(briefTask.sprintId)).toBe(idOf(backlog));
            expect((briefTask.AssigneeUserId || []).map(String)).toEqual([session.uid]);
            expect(briefTask.status && briefTask.status.text).toBe(names.review);
            expect(await findTasksByName(api, projectId, names.kickoff)).toHaveLength(0);

            await page.goto(`/#/${state.companyId}/project/${projectId}/s/${idOf(backlog)}`);
            await expect(listRow(page, names.brief)).toBeVisible();
            await expect(listRow(page, names.kickoff)).toHaveCount(0);

            await page.goto(`/#/${state.companyId}/automations`);
            const rule = page.locator('.au__rule', { hasText: names.comment });
            await expect(rule).toBeVisible();
            await expect(rule).toHaveClass(/au__rule--off/);
        } finally {
            await context.close();
            await api.delete(`/api/v2/api-tokens/${tokenId}`);
        }
    });
});
