const path = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

/* Sprint 10 slice S6 against the real app and database: a member's personal access token on /mcp
 * with MCP_TOOLS_DATA on reads only the projects the web app shows them and comments on a task
 * they can open, the comment stored escaped as the comments route stores it. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;

let server;
let mongo;
let owner;
let member;
let fx;
const tokens = [];

const mcp = async (accessToken, message) => {
    const res = await fetch(`${server.baseURL}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}`, companyid: state.companyId },
        body: JSON.stringify(message),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};
const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const payloadOf = (res) => JSON.parse(res.body.result.content[0].text);

const personalToken = async (session) => {
    const api = createApiClient({ baseURL: server.baseURL, accessToken: session.accessToken, companyId: state.companyId });
    const res = await api.post('/api/v2/api-tokens', { name: `[QA mcp data tools] ${uniqueSuffix()}`, scopes: ['read', 'write'], expiresInDays: 1 });
    expect(res.body.status).toBe(true);
    tokens.push({ api, id: res.body.data._id });
    return res.body.data.token;
};

beforeAll(async () => {
    mongo = await MongoClient.connect(resolveMongoUrl());
    const admin = await loginAs('owner');
    const mate = await loginAs('member');
    const open = await createProject(admin.api, { assigneeIds: [admin.uid, mate.uid], createdBy: admin.uid });
    const closed = await createProject(admin.api, { assigneeIds: [admin.uid], createdBy: admin.uid, isPrivate: true });
    const task = await createTask(admin.api, { project: open, name: `S10S6 ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: admin.uid, assigneeIds: [mate.uid] });
    fx = { open: String(open._id), closed: String(closed._id), task: String(task._id) };

    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'mcp-data-tools-server.log'),
        env: { MCP_TOOLS_DATA: 'on', MCP_TOOLS_V2: 'on', NODE_ENV: 'test' },
    });
    owner = await login(server.baseURL, emailFor('owner'));
    member = await login(server.baseURL, emailFor('member'));
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    for (const { api, id } of tokens) await api.delete(`/api/v2/api-tokens/${id}`).catch(() => {});
    if (server) await server.stop();
    if (mongo) await mongo.close();
}, BOOT_TIMEOUT_MS);

describe('the data tools on /mcp with a personal access token', () => {
    it('lists them only while MCP_TOOLS_DATA is on', async () => {
        const token = await personalToken(member);
        const listed = await mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
        const names = listed.body.result.tools.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(['projects.list', 'project.get', 'sprints.list', 'statuses.list', 'comments.list', 'pages.search', 'page.get', 'timesheet.read', 'comment.create', 'timelog.create']));

        const harness = createApiClient({ baseURL: state.baseURL, accessToken: token, companyId: state.companyId });
        const off = await harness.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
        expect(off.body.result.tools.map((t) => t.name)).not.toContain('projects.list');
    });

    it('projects.list shows a member the projects the web app shows them, and the owner every one', async () => {
        const walk = async (token) => {
            const seen = [];
            let cursor;
            do {
                const out = payloadOf(await mcp(token, call('projects.list', { limit: 100, ...(cursor ? { cursor } : {}) })));
                seen.push(...out.projects.map((p) => p.projectId));
                cursor = out.nextCursor;
            } while (cursor);
            return seen;
        };
        const memberSees = await walk(await personalToken(member));
        expect(memberSees).toContain(fx.open);
        expect(memberSees).not.toContain(fx.closed);
        const ownerSees = await walk(await personalToken(owner));
        expect(ownerSees).toEqual(expect.arrayContaining([fx.open, fx.closed]));

        const memberToken = await personalToken(member);
        expect(payloadOf(await mcp(memberToken, call('project.get', { projectId: fx.closed })))).toEqual({ error: 'project not found' });
        const statuses = payloadOf(await mcp(memberToken, call('statuses.list', { projectId: fx.open })));
        expect(statuses.statuses.length).toBeGreaterThan(0);
    });

    it('comment.create posts on a task the member can open, stored escaped, and comments.list reads it back', async () => {
        const token = await personalToken(member);
        const text = `<script>alert("s10s6")</script> ${uniqueSuffix()}`;
        const res = await mcp(token, call('comment.create', { taskId: fx.task, text }));
        expect(res.status).toBe(200);
        const out = payloadOf(res);
        expect(out).toMatchObject({ ok: true, undoable: true, result: { commentId: expect.any(String) } });

        const stored = await mongo.db(state.companyId).collection('comments').findOne({ _id: new ObjectId(out.result.commentId) });
        expect(stored.message).toBe(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
        expect(String(stored.taskId)).toBe(fx.task);
        expect(stored.userId).toBe(member.uid);

        const listed = payloadOf(await mcp(token, call('comments.list', { taskId: fx.task })));
        expect(listed.comments.map((c) => c.commentId)).toContain(out.result.commentId);
    });
});
