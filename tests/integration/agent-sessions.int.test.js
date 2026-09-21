const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { io } = require('socket.io-client');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

/* Sprint 10 slice S7 on the real app and database: a person delegates a task to an outside OAuth client, the client
 * hears of it by a signed webhook, reports typed activities over /mcp, and the task panel's socket room sees them. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const REDIRECT = 'http://127.0.0.1:47293/callback';
const ALLOWLIST_KEY = 'WEBHOOK_ALLOWED_PRIVATE_HOSTS';

const newVerifier = () => crypto.randomBytes(32).toString('base64url');
const challengeOf = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');
const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined)).toString();

async function waitFor(check, { timeoutMs = 25000, intervalMs = 200 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

const announcements = [];
let sink;
let server;
let mongo;
let owner;
let member;
let ownerApi;
let clientId;
let secret;
let project;
let privateProject;
const sockets = [];

const authorize = async (scope) => {
    const verifier = newVerifier();
    const query = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 's10s7',
        code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
    });
    const authorized = await fetch(`${server.baseURL}/oauth/authorize?${query}`, {
        redirect: 'manual',
        headers: { authorization: `Bearer ${owner.accessToken}`, companyid: state.companyId, 'x-oauth-test-consent': 'approve' },
    });
    expect(authorized.status).toBe(302);
    const code = new URL(authorized.headers.get('location')).searchParams.get('code');
    const res = await fetch(`${server.baseURL}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${server.baseURL}/mcp` }),
    });
    expect(res.status).toBe(200);
    return res.json();
};

const mcp = async (accessToken, name, args) => {
    const res = await fetch(`${server.baseURL}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}`, 'mcp-protocol-version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    const payload = body && body.result ? JSON.parse(body.result.content[0].text) : null;
    return { status: res.status, body, payload, isError: Boolean(body && body.result && body.result.isError) };
};

const connect = (session) => new Promise((resolve, reject) => {
    const socket = io(`${server.baseURL}/userid_${state.companyId}_${session.uid}`, {
        transports: ['websocket'], auth: { token: session.accessToken }, query: { userRole: 3 }, reconnection: false, timeout: 10000,
    });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
});

const watchTask = async (session, taskId) => {
    const socket = await connect(session);
    const got = [];
    socket.on('taskDetail_agentSession', (payload) => got.push({ payload, at: Date.now() }));
    socket.emit('joinTaskDetail', { taskId, socketId: socket.id });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return got;
};

const newTask = (target, name) => createTask(ownerApi, { project: target, name: `S10S7 ${name} ${uniqueSuffix()}`, user: { userId: owner.uid, role: 'owner' }, companyOwnerId: owner.uid });
const delegate = (taskId) => ownerApi.post('/api/v2/agent-sessions', { taskId, clientId });
const sessionsOf = async (taskId) => (await ownerApi.get(`/api/v2/agent-sessions?taskId=${taskId}`)).body.data || [];

beforeAll(async () => {
    await new Promise((resolve) => {
        const listener = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => { announcements.push({ url: req.url, headers: req.headers, body, at: Date.now() }); res.statusCode = 202; res.end('ok'); });
        });
        listener.listen(0, '127.0.0.1', () => { sink = { listener, port: listener.address().port }; resolve(); });
    });
    mongo = await MongoClient.connect(resolveMongoUrl());
    const admin = await loginAs('owner');
    expect((await admin.api.put('/api/v2/instance/settings', { [ALLOWLIST_KEY]: '127.0.0.1' })).status).toBe(200);
    project = await createProject(admin.api, { assigneeIds: [admin.uid, state.users.member.userId], createdBy: admin.uid });
    privateProject = await createProject(admin.api, { assigneeIds: [admin.uid], createdBy: admin.uid, isPrivate: true });

    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'agent-sessions-server.log'),
        env: { MCP_OAUTH: 'both', MCP_OAUTH_DCR: 'on', NODE_ENV: 'test', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000', EXTERNAL_AGENT_SESSIONS: 'on' },
    });
    owner = await login(server.baseURL, emailFor('owner'));
    member = await login(server.baseURL, emailFor('member'));
    ownerApi = createApiClient({ baseURL: server.baseURL, accessToken: owner.accessToken, companyId: state.companyId });

    const registered = await fetch(`${server.baseURL}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'S10S7 coding agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }),
    });
    expect(registered.status).toBe(201);
    clientId = (await registered.json()).client_id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    if (server) await server.stop();
    const admin = await loginAs('owner');
    await admin.api.put('/api/v2/instance/settings', { [ALLOWLIST_KEY]: '' });
    if (mongo) await mongo.close();
    if (sink) await new Promise((done) => sink.listener.close(done));
}, BOOT_TIMEOUT_MS);

describe('outside agent sessions with EXTERNAL_AGENT_SESSIONS on', () => {
    it('refuses a delivery URL on plain http to a host nobody allowed, and keeps one to an allowed host', async () => {
        const refused = await ownerApi.put('/api/v2/agent-sessions/endpoints', { clientId, url: 'http://agent.example.com/hook' });
        expect(refused.body).toMatchObject({ status: false, statusText: 'The delivery URL must use https.' });
        const byMember = await createApiClient({ baseURL: server.baseURL, accessToken: member.accessToken, companyId: state.companyId })
            .put('/api/v2/agent-sessions/endpoints', { clientId, url: `http://127.0.0.1:${sink.port}/agent` });
        expect(byMember.body.status).toBe(false);
        const saved = await ownerApi.put('/api/v2/agent-sessions/endpoints', { clientId, url: `http://127.0.0.1:${sink.port}/agent` });
        expect(saved.body.status).toBe(true);
        secret = saved.body.data.secret;
        expect(secret).toMatch(/^[a-f0-9]{48}$/);
        const listed = await ownerApi.get('/api/v2/agent-sessions/endpoints');
        expect(JSON.stringify(listed.body)).not.toContain(secret);
    });

    it('refuses a delegation from a person with no grant to the client', async () => {
        const task = await newTask(project, 'no grant');
        const res = await delegate(task._id);
        expect(res.body).toMatchObject({ status: false, statusText: expect.stringMatching(/holds no live grant/) });
    });

    it('announces, takes up, relays and completes a session, keeping the rules on the way', async () => {
        const tokens = await authorize('tasks:read tasks:write');
        const task = await newTask(privateProject, 'private');
        const ownerSees = await watchTask(owner, task._id);
        const memberSees = await watchTask(member, task._id);

        const res = await delegate(task._id);
        expect(res.body).toMatchObject({ status: true, data: { state: 'offered', taskId: task._id } });
        const sessionId = res.body.data.id;
        expect(res.body.data.deliveredAt).toEqual(expect.any(String));

        const announced = await waitFor(() => announcements.find((a) => a.headers['x-alianhub-session'] === sessionId));
        const timestamp = announced.headers['x-alianhub-timestamp'];
        expect(Math.abs(Number(timestamp) * 1000 - announced.at)).toBeLessThan(5000);
        const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${announced.body}`).digest('hex')}`;
        expect(announced.headers['x-alianhub-signature']).toBe(expected);
        const body = JSON.parse(announced.body);
        expect(body).toMatchObject({ type: 'agent_session.offered', sessionId, task: { id: task._id } });
        expect(announced.body).not.toContain(tokens.access_token);
        expect(announced.body).not.toContain(tokens.refresh_token);
        expect(JSON.stringify(announced.headers)).not.toMatch(/authorization/i);

        const stored = await mongo.db(state.companyId).collection('tasks').findOne({ _id: new (require('mongodb').ObjectId)(task._id) });
        expect(stored.AssigneeUserId).toEqual([owner.uid]);
        const notified = await waitFor(() => mongo.db(state.companyId).collection('notifications').findOne({ changeType: 'agent_session_assigned', notSeen: owner.uid }));
        expect(notified).toMatchObject({ assigneeUsers: [owner.uid], changeData: { clientName: 'S10S7 coding agent', taskName: task.name, sessionId } });
        expect(notified.message).not.toContain('S10S7');
        const audited = await waitFor(() => mongo.db(state.companyId).collection('audit_logs').findOne({ action: 'agent_session.delegated', entityId: task._id }));
        expect(audited).toMatchObject({ actorId: owner.uid, meta: { sessionId, clientId } });

        const wrongHandle = await mcp(tokens.access_token, 'session.activity', { sessionId, handle: 'ahs_wrong', type: 'thought', text: 'hello' });
        expect(wrongHandle.isError).toBe(true);
        expect(wrongHandle.payload.reason).toMatch(/handle/);

        const sentAt = Date.now();
        const first = await mcp(tokens.access_token, 'session.activity', { sessionId, handle: body.handle, type: 'thought', text: 'Reading the brief' });
        expect(first.isError).toBe(false);
        expect(first.payload).toMatchObject({ state: 'active', activityCount: 1 });

        const pushed = await waitFor(() => ownerSees.find((e) => e.payload.state === 'active'), { timeoutMs: 10000, intervalMs: 20 });
        expect(pushed).toBeTruthy();
        expect(pushed.at - sentAt).toBeLessThan(10000);
        expect(pushed.payload.activities).toEqual([expect.objectContaining({ type: 'thought', text: 'Reading the brief' })]);
        expect(memberSees).toEqual([]);

        const taken = await waitFor(() => mongo.db(state.companyId).collection('audit_logs').findOne({ 'meta.action': 'session.taken_up', 'meta.clientId': clientId }));
        expect(taken).toMatchObject({ actorId: clientId, meta: { viaAccount: 'external', delegatedBy: owner.uid, tainted: true } });

        const done = await mcp(tokens.access_token, 'session.complete', { sessionId, summary: 'Opened PR #12' });
        expect(done.payload).toMatchObject({ state: 'completed' });
        const afterDone = await mcp(tokens.access_token, 'session.activity', { sessionId, type: 'action', text: 'late' });
        expect(afterDone.payload.reason).toMatch(/is completed/);
        const [row] = await sessionsOf(task._id);
        expect(row).toMatchObject({ state: 'completed', activities: [{ type: 'thought' }, { type: 'response', text: 'Opened PR #12' }] });
    }, 60000);

    it('keeps the assignee a task already has', async () => {
        await authorize('tasks:read tasks:write');
        const task = await createTask(ownerApi, { project, name: `S10S7 assigned ${uniqueSuffix()}`, user: { userId: owner.uid, role: 'owner' }, companyOwnerId: owner.uid, assigneeIds: [state.users.member.userId] });
        expect((await delegate(task._id)).body.status).toBe(true);
        const stored = await mongo.db(state.companyId).collection('tasks').findOne({ _id: new (require('mongodb').ObjectId)(task._id) });
        expect(stored.AssigneeUserId).toEqual([state.users.member.userId]);
    });

    it('marks an offer nobody takes up unresponsive ten seconds after delivery', async () => {
        await authorize('tasks:read tasks:write');
        const task = await newTask(project, 'silent');
        const res = await delegate(task._id);
        const deliveredAt = new Date(res.body.data.deliveredAt).getTime();
        const row = await waitFor(async () => (await sessionsOf(task._id)).find((s) => s.state === 'unresponsive'), { timeoutMs: 20000, intervalMs: 250 });
        expect(row).toBeTruthy();
        expect(new Date(row.endedAt).getTime() - deliveredAt).toBeGreaterThanOrEqual(10000);
        expect(new Date(row.endedAt).getTime() - deliveredAt).toBeLessThan(13000);
    }, 40000);

    it('stops a session mid-step when its grant is revoked', async () => {
        const tokens = await authorize('tasks:read tasks:write');
        const task = await newTask(project, 'revoked');
        const res = await delegate(task._id);
        const sessionId = res.body.data.id;
        const handle = JSON.parse((await waitFor(() => announcements.find((a) => a.headers['x-alianhub-session'] === sessionId))).body).handle;
        expect((await mcp(tokens.access_token, 'session.activity', { sessionId, handle, type: 'action', text: 'Running the tests' })).payload.state).toBe('active');

        const revoked = await fetch(`${server.baseURL}/oauth/revoke`, {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form({ client_id: clientId, token: tokens.refresh_token, token_type_hint: 'refresh_token' }),
        });
        expect(revoked.status).toBe(200);
        expect((await mcp(tokens.access_token, 'session.activity', { sessionId, type: 'action', text: 'still going' })).status).toBe(401);
        const row = await waitFor(async () => (await sessionsOf(task._id)).find((s) => s.state === 'revoked'), { timeoutMs: 30000, intervalMs: 500 });
        expect(row).toMatchObject({ state: 'revoked', reason: expect.stringMatching(/grant/) });
    }, 60000);
});

describe('outside agent sessions with the flag off', () => {
    it('registers no route', async () => {
        const admin = await loginAs('owner');
        const res = await admin.api.post('/api/v2/agent-sessions', { taskId: state.tasks[0]._id, clientId: 'x' });
        expect(res.body && res.body.status).not.toBe(true);
        expect(res.status).toBe(404);
    });
});
