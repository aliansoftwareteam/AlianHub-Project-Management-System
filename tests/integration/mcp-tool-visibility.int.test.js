const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(120000);

const withRetry = async (fn) => {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try { return await fn(); } catch (err) { lastErr = err; await new Promise((r) => setTimeout(r, 300)); }
    }
    throw lastErr;
};

const makeSprintPrivate = async (owner, projectId, assigneeIds) => {
    const sprint = await firstSprint(owner.api, projectId);
    const res = await owner.api.patch(`/api/v1/sprint/${sprint._id}`, {
        type: 'updateSprint',
        companyId: state.companyId,
        projectId: String(projectId),
        updateObject: { $set: { private: true, AssigneeUserId: assigneeIds.map(String) } },
    });
    expect(res.body.status).toBe(true);
};

const mcpCall = async (client, name, args) => {
    const res = await client.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    expect(res.status).toBe(200);
    return JSON.parse(res.body.result.content[0].text);
};

describe('MCP tools answer only for what the caller can open in the web app', () => {
    const tag = `mcpvis${uniqueSuffix()}`;
    const tokens = [];
    let owner;
    let member;
    let fx;

    const tokenFor = async (session, extra = {}) => {
        const path = extra.projectIds ? '/api/v2/api-tokens/mcp' : '/api/v2/api-tokens';
        const res = await session.api.post(path, { name: `[QA mcp visibility] ${uniqueSuffix()}`, scopes: ['read', 'write'], expiresInDays: 1, ...extra });
        expect(res.body.status).toBe(true);
        tokens.push({ session, id: res.body.data._id });
        return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
    };

    const webSearch = async (session) => {
        const res = await session.api.post('/api/v2/search', { query: tag });
        expect(res.body.status).toBe(true);
        return new Set(res.body.data.tasks.map((t) => String(t._id)));
    };

    beforeAll(async () => {
        owner = await loginAs('owner');
        member = await loginAs('member');
        const build = async (label, { isPrivate = false, assignees, privateSprintFor = null }) => {
            const project = await createProject(owner.api, { assigneeIds: assignees.map((s) => s.uid), createdBy: owner.uid, isPrivate });
            const task = await withRetry(() => createTask(owner.api, { project, name: `${tag} ${label}`, user: state.users.owner, companyOwnerId: owner.uid, assigneeIds: [member.uid] }));
            if (privateSprintFor) await makeSprintPrivate(owner, project._id, privateSprintFor.map((s) => s.uid));
            return { projectId: String(project._id), taskId: String(task._id) };
        };
        fx = {
            open: await build('open', { assignees: [owner, member] }),
            privateSpace: await build('private space', { isPrivate: true, assignees: [owner] }),
            privateSprint: await build('private sprint', { assignees: [owner, member], privateSprintFor: [owner] }),
        };
    });

    afterAll(async () => {
        for (const { session, id } of tokens) await session.api.delete(`/api/v2/api-tokens/${id}`);
    });

    it('tasks.search and task.get match the web app search for a member, and hide the private sprint', async () => {
        const client = await tokenFor(member);
        const web = await webSearch(member);
        const found = new Set((await mcpCall(client, 'tasks.search', { query: tag, limit: 50 })).tasks.map((t) => t.taskId));

        for (const { taskId } of Object.values(fx)) {
            expect(found.has(taskId)).toBe(web.has(taskId));
            const brief = await mcpCall(client, 'task.get', { taskId });
            if (web.has(taskId)) expect(brief.taskId).toBe(taskId); else expect(brief).toEqual({ error: 'task not found' });
        }
        expect(found.has(fx.open.taskId)).toBe(true);
        expect(found.has(fx.privateSprint.taskId)).toBe(false);
        expect((await member.api.get(`/api/v1/task/${fx.privateSprint.taskId}`)).status).toBe(404);
    });

    it('never widens a project-restricted token through the projectId argument', async () => {
        const client = await tokenFor(member, { projectIds: [fx.open.projectId] });
        const outside = await mcpCall(client, 'tasks.search', { query: tag, projectId: fx.privateSprint.projectId, limit: 50 });
        expect(outside.tasks).toEqual([]);
        expect((await mcpCall(client, 'tasks.search', { query: tag, limit: 50 })).tasks.map((t) => t.taskId)).toEqual([fx.open.taskId]);
    });

    it('refuses a write on a task in a private sprint the member is not on', async () => {
        const client = await tokenFor(member);
        const res = await client.post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'task.comment', arguments: { taskId: fx.privateSprint.taskId, body: 'x' } } });
        expect(res.body.result.isError).toBe(true);
        const out = JSON.parse(res.body.result.content[0].text);
        expect(out).toMatchObject({ refused: true, action: 'task.comment', reason: expect.stringMatching(/^not_visible/) });
    });

    it('answers the owner for every project, as the web app does', async () => {
        const client = await tokenFor(owner);
        const found = new Set((await mcpCall(client, 'tasks.search', { query: tag, limit: 50 })).tasks.map((t) => t.taskId));
        for (const { taskId } of Object.values(fx)) {
            expect(found.has(taskId)).toBe(true);
            expect((await mcpCall(client, 'task.get', { taskId })).taskId).toBe(taskId);
        }
    });
});
