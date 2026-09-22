const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { answerAuthorization, approveClient } = require('../support/mcpOAuthClient');

/* Sprint 10 slice S8 on the real app and database: a workflow step is handed to an outside coding agent, which a
 * scripted OAuth client plays through the real consent flow. It completes one step with its actions audited as the
 * client acting for the person, and a revoked grant stops it in the middle of another. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const REDIRECT = 'http://127.0.0.1:47294/callback';
const ALLOWLIST_KEY = 'WEBHOOK_ALLOWED_PRIVATE_HOSTS';
const STEP = 'sCode';

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
let ownerApi;
let clientId;
let project;

const audits = () => mongo.db(state.companyId).collection('audit_logs');

/* The scripted client: PKCE, the consent screen answered as the owner, and the code exchanged for tokens. */
const connectClient = async (scope) => {
    const verifier = newVerifier();
    const query = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 's10s8',
        code_challenge: challengeOf(verifier), code_challenge_method: 'S256', resource: `${server.baseURL}/mcp`,
    });
    const answered = await answerAuthorization(`${server.baseURL}/oauth/authorize?${query}`, { accessToken: owner.accessToken, companyId: state.companyId });
    expect(answered.code).toBeTruthy();
    const res = await fetch(`${server.baseURL}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'authorization_code', client_id: clientId, code: answered.code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${server.baseURL}/mcp` }),
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

const newTask = (name) => createTask(ownerApi, { project, name: `S10S8 ${name} ${uniqueSuffix()}`, user: { userId: owner.uid, role: 'owner' }, companyOwnerId: owner.uid, assigneeIds: [state.users.member.userId] });

const startStep = async (task) => {
    const res = await ownerApi.post('/api/v2/workflows/runs', {
        workflowId: 's10s8', name: `Hand ${task.name} to the coder`, taskId: task._id,
        steps: [{ id: STEP, type: 'external_agent', config: { clientId, deadlineMs: 10 * 60 * 1000 } }],
    });
    expect(res.body.status).toBe(true);
    return String(res.body.data.run._id);
};

const runOf = async (runId) => (await ownerApi.get(`/api/v2/workflows/runs/${runId}`)).body.data;

/* The ten-second clock starts at delivery, so the scripted agent answers from the announcement, not the run view. */
const offerFor = async (task) => {
    const announced = await waitFor(() => announcements.find((a) => JSON.parse(a.body).task.id === String(task._id)), { intervalMs: 20 });
    expect(announced).toBeTruthy();
    const body = JSON.parse(announced.body);
    return { sessionId: body.sessionId, handle: body.handle };
};

beforeAll(async () => {
    await new Promise((resolve) => {
        const listener = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => { announcements.push({ headers: req.headers, body }); res.statusCode = 202; res.end('ok'); });
        });
        listener.listen(0, '127.0.0.1', () => { sink = { listener, port: listener.address().port }; resolve(); });
    });
    mongo = await MongoClient.connect(resolveMongoUrl());
    const admin = await loginAs('owner');
    expect((await admin.api.put('/api/v2/instance/settings', { [ALLOWLIST_KEY]: '127.0.0.1' })).status).toBe(200);
    project = await createProject(admin.api, { assigneeIds: [admin.uid, state.users.member.userId], createdBy: admin.uid });

    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'external-agent-step-server.log'),
        env: {
            MCP_OAUTH: 'both', MCP_OAUTH_DCR: 'on', NODE_ENV: 'test', MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000',
            EXTERNAL_AGENT_SESSIONS: 'on', EXTERNAL_AGENT_STEPS: 'on', WORKFLOW_ENGINE: 'on',
            // The inline driver awaits a delayed job, so a step waiting on an outside agent would hold its request open.
            AUTOMATION_QUEUE_DRIVER: 'agenda',
        },
    });
    owner = await login(server.baseURL, emailFor('owner'));
    ownerApi = createApiClient({ baseURL: server.baseURL, accessToken: owner.accessToken, companyId: state.companyId });

    const registered = await fetch(`${server.baseURL}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'S10S8 coding agent', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }),
    });
    expect(registered.status).toBe(201);
    clientId = (await registered.json()).client_id;
    await approveClient(server.baseURL, { accessToken: owner.accessToken, companyId: state.companyId }, clientId, ['tasks:read', 'tasks:write']);
    const endpoint = await ownerApi.put('/api/v2/agent-sessions/endpoints', { clientId, url: `http://127.0.0.1:${sink.port}/agent` });
    expect(endpoint.body.status).toBe(true);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    if (server) await server.stop();
    const admin = await loginAs('owner');
    await admin.api.put('/api/v2/instance/settings', { [ALLOWLIST_KEY]: '' });
    if (mongo) await mongo.close();
    if (sink) await new Promise((done) => sink.listener.close(done));
}, BOOT_TIMEOUT_MS);

describe('the external_agent step with EXTERNAL_AGENT_STEPS on', () => {
    it('is offered to the builder, naming an outside agent', async () => {
        const res = await ownerApi.get('/api/v2/workflows/step-types');
        const contract = res.body.data.stepTypes.find((c) => c.key === 'external_agent');
        expect(contract).toBeTruthy();
        expect(contract.config.clientId).toMatchObject({ type: 'oauth_client', required: true });
    });

    it('is completed by an outside coding agent whose actions are audited as it, acting for the person', async () => {
        const tokens = await connectClient('tasks:read tasks:write');
        const task = await newTask('complete');
        const started = startStep(task);
        const { sessionId, handle } = await offerFor(task);

        expect((await mcp(tokens.access_token, 'session.activity', { sessionId, handle, type: 'thought', text: 'Reading the brief' })).payload).toMatchObject({ state: 'active' });
        const runId = await started;
        expect((await runOf(runId)).steps.find((s) => s.stepId === STEP).agentSessionId).toBe(sessionId);
        const comment = await mcp(tokens.access_token, 'task.comment', { taskId: task._id, body: 'Opened a pull request for this.' });
        expect(comment.isError).toBe(false);
        expect((await mcp(tokens.access_token, 'session.complete', { sessionId, summary: 'Opened PR #12' })).payload).toMatchObject({ state: 'completed' });

        const done = await waitFor(async () => { const data = await runOf(runId); return data.run.status === 'success' ? data : null; });
        expect(done).toBeTruthy();
        const step = done.steps.find((s) => s.stepId === STEP);
        expect(step.output).toMatchObject({ sessionId, state: 'completed', response: 'Opened PR #12', clientId });
        expect(step.agentSession).toMatchObject({ id: sessionId, state: 'completed', activities: expect.arrayContaining([expect.objectContaining({ type: 'response', text: 'Opened PR #12' })]) });

        const stored = await mongo.db(state.companyId).collection('tasks').findOne({ _id: new (require('mongodb').ObjectId)(task._id) });
        expect(stored.AssigneeUserId).toEqual([state.users.member.userId]);

        const commented = await waitFor(() => audits().findOne({ action: 'agent.action', 'meta.action': 'task.comment', 'meta.clientId': clientId, entityId: task._id }));
        expect(commented).toMatchObject({ actorId: clientId, meta: { viaAccount: 'external', delegatedBy: owner.uid, tainted: true } });
        const delegated = await waitFor(() => audits().findOne({ action: 'agent_session.delegated', 'meta.sessionId': sessionId }));
        expect(delegated).toMatchObject({ actorId: owner.uid, meta: { workflowRunId: runId, workflowStepId: STEP } });
    }, 60000);

    it('is stopped mid-step by a revoked grant: 401, the session revoked, the step failed by name, the refusal attributed', async () => {
        const tokens = await connectClient('tasks:read tasks:write');
        const task = await newTask('revoked');
        const started = startStep(task);
        const { sessionId, handle } = await offerFor(task);
        expect((await mcp(tokens.access_token, 'session.activity', { sessionId, handle, type: 'action', text: 'Running the tests' })).payload).toMatchObject({ state: 'active' });
        const runId = await started;

        const revoked = await fetch(`${server.baseURL}/oauth/revoke`, {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form({ client_id: clientId, token: tokens.refresh_token, token_type_hint: 'refresh_token' }),
        });
        expect(revoked.status).toBe(200);
        expect((await mcp(tokens.access_token, 'task.comment', { taskId: task._id, body: 'still going' })).status).toBe(401);

        const failed = await waitFor(async () => { const data = await runOf(runId); return data.run.status === 'failed' ? data : null; }, { timeoutMs: 30000, intervalMs: 300 });
        expect(failed).toBeTruthy();
        const step = failed.steps.find((s) => s.stepId === STEP);
        expect(step).toMatchObject({ status: 'failed', error: expect.stringMatching(/revoked: the grant behind this session (was revoked|has expired)/) });
        expect(step.agentSession).toMatchObject({ id: sessionId, state: 'revoked' });

        const refusal = await waitFor(() => audits().findOne({ action: 'agent.action_refused', entityType: 'agent_session', entityId: sessionId }));
        expect(refusal).toMatchObject({ actorId: clientId, meta: { viaAccount: 'external', delegatedBy: owner.uid, action: 'task.comment', reason: expect.stringMatching(/grant_not_live/) } });
    }, 60000);
});
