const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { testCert } = require('../fixtures/testCert');

/* Sprint 11 slice S2. A second server runs with the secrets store and taint routing on, and resolves one declared
 * host to an https server this suite runs (tests/fixtures/declaredReadsResolve.js), so a data skill's declared read
 * goes through every run-time rule end to end without a real outbound request. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const RUN_DEADLINE_MS = 30000;
const HOSTNAME = 'reads.alianhub-e2e.com';
const TOKEN = `rk_${crypto.randomBytes(20).toString('hex')}`;
const PRELOAD = path.join(__dirname, '..', 'fixtures', 'declaredReadsResolve.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const seen = [];
let reads;
let host;
let workDir;
let server;
let owner;
let harnessOwner;
let client;
let replays;
let lists;
let task;
let skillKey;
let agentId;
let secretHandle;

const version = async () => ((await lists.findOne({ _id: 'workspace' })) || {}).version || 0;
const setHosts = async (hosts) => {
    const res = await owner.put(`/api/v2/instance/egress/${state.companyId}`, { hosts, version: await version() });
    if (res.status !== 200) throw new Error(`allowlist save failed (${res.status}): ${JSON.stringify(res.body)}`);
};

const finishedRun = async (body) => {
    const started = await owner.post('/api/v2/agents/runs', body);
    if (started.status !== 200 || !started.body.status) throw new Error(`start run failed (${started.status}): ${JSON.stringify(started.body)}`);
    const runId = started.body.data._id;
    const deadline = Date.now() + RUN_DEADLINE_MS;
    for (;;) {
        const res = await owner.get(`/api/v2/agents/runs/${runId}`);
        if (res.body.data && !['queued', 'running'].includes(res.body.data.run.status)) return res.body.data;
        if (Date.now() > deadline) throw new Error(`run ${runId} did not finish: ${JSON.stringify(res.body.data && res.body.data.run)}`);
        await sleep(250);
    }
};

beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alianhub-reads-'));
    const { key, cert } = testCert([HOSTNAME]);
    const caFile = path.join(workDir, 'ca.pem');
    fs.writeFileSync(caFile, cert);
    reads = https.createServer({ key, cert }, (req, res) => {
        seen.push({ path: req.url, method: req.method, authorization: req.headers.authorization || null });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ title: 'Release notes for AR-7', state: 'open' }));
    });
    await new Promise((resolve) => reads.listen(0, '127.0.0.1', resolve));
    host = `${HOSTNAME}:${reads.address().port}`;

    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'skill-declared-reads-run-server.log'),
        env: {
            SECRETS_STORE: 'true',
            SECRETS_KEY: crypto.randomBytes(24).toString('hex'),
            AGENT_TAINT_ROUTING: 'on',
            E2E_DECLARED_READ_HOSTS: HOSTNAME,
            NODE_OPTIONS: `--require "${PRELOAD}"`,
            NODE_EXTRA_CA_CERTS: caFile,
        },
    });
    const session = await login(server.baseURL, emailFor('owner'));
    owner = createApiClient({ baseURL: server.baseURL, accessToken: session.accessToken, companyId: state.companyId });
    harnessOwner = await loginAs('owner');
    client = await MongoClient.connect(resolveMongoUrl());
    replays = client.db(state.companyId).collection('ai_replays');
    lists = client.db(state.companyId).collection('egress_allowlists');

    const project = await createProject(owner, { name: `[QA reads] ${uniqueSuffix()}`, assigneeIds: [harnessOwner.uid], createdBy: harnessOwner.uid });
    task = await createTask(owner, { project, name: `[QA reads] AR-7 ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: harnessOwner.uid });
    await setHosts([host]);

    const secret = await owner.post('/api/v2/secrets', { name: '[QA reads] token', kind: 'skill_read', value: TOKEN, hosts: [host] });
    expect(secret.status).toBe(201);
    secretHandle = secret.body.data.handle;

    skillKey = `qa-reads-run-${uniqueSuffix()}`;
    const skill = await owner.post('/api/v2/agents/skills', {
        key: skillKey,
        name: `[QA reads] ${skillKey}`,
        inputs: [],
        gather: [{ reader: 'api', as: 'pr', params: { host, path: '/repos/acme/app/pulls/{{TaskKey}}', format: 'json', credential: secretHandle, timeoutMs: 5000 } }],
        prompt: { template: 'PR: {{gather.pr.text}}', output: '{"summary":"..."}' },
        fallback: 'Read: {{gather.pr.json.title}}',
        emit: [{ action: 'task.comment', label: 'Note the read', params: { body: '{{fallback}}' } }],
    });
    expect(skill.status).toBe(201);
    const agent = await owner.post('/api/v2/agents', {
        name: `[QA reads] ${uniqueSuffix()}`, description: 'declared reads', autonomy: 2, spendCapUsd: 1,
        projectIds: [project._id], skills: [{ key: skillKey, enabled: true }], allowedActions: ['task.comment'],
    });
    expect(agent.body.status).toBe(true);
    agentId = agent.body.data._id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    if (owner && agentId) await owner.delete(`/api/v2/agents/${agentId}`).catch(() => null);
    if (owner && skillKey) await owner.delete(`/api/v2/agents/skills/${skillKey}`).catch(() => null);
    if (client && secretHandle) await client.db(state.companyId).collection('secrets').deleteOne({ handle: secretHandle });
    if (lists) await lists.deleteMany({});
    if (client) await client.close();
    if (server) await server.stop();
    if (reads) await new Promise((resolve) => { reads.closeAllConnections(); reads.close(resolve); });
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
}, BOOT_TIMEOUT_MS);

describe('a data skill with a declared read, end to end', () => {
    let view;

    beforeAll(async () => {
        seen.length = 0;
        view = await finishedRun({ agentId, taskId: task._id, skill: skillKey });
    }, 60000);

    it('fetches the declared host once, with GET and the credential in the header', () => {
        expect(seen).toEqual([{ path: expect.stringMatching(/^\/repos\/acme\/app\/pulls\/[A-Z0-9]+-\d+$/), method: 'GET', authorization: `Bearer ${TOKEN}` }]);
    });

    it('acts on what it read', () => {
        expect(view.run.status).toBe('done');
        expect(view.run.decisions).toEqual([expect.objectContaining({ action: 'task.comment', decision: 'act' })]);
    });

    it('is tainted by the host it read', () => {
        expect(view.run.tainted).toBe(true);
        expect(view.run.taintSources).toEqual([{ kind: 'fetch', ref: HOSTNAME, at: expect.any(String) }]);
    });

    it('keeps the credential out of the run, its audit and its replay', async () => {
        expect(JSON.stringify(view)).not.toContain(TOKEN);
        const replay = await owner.get(`/api/v2/agents/runs/${view.run._id}/replay`);
        expect(JSON.stringify(replay.body)).not.toContain(TOKEN);
        expect(fs.readFileSync(server.logFile, 'utf8')).not.toContain(TOKEN);
    });
});

describe('a dry run of the same skill', () => {
    it('fetches through the same checks and writes no replay', async () => {
        seen.length = 0;
        const before = await replays.countDocuments({});
        const res = await owner.post(`/api/v2/agents/skills/${skillKey}/dry-run`, { taskId: task._id });
        expect(res.body.status).toBe(true);
        expect(res.body.data.gathered.gather.pr.json).toEqual({ title: 'Release notes for AR-7', state: 'open' });
        expect(seen).toHaveLength(1);
        expect(JSON.stringify(res.body)).not.toContain(TOKEN);
        expect(await replays.countDocuments({})).toBe(before);
    });

    it('is refused once the host leaves the workspace allowlist, before any request', async () => {
        seen.length = 0;
        await setHosts(['example.com']);
        const res = await owner.post(`/api/v2/agents/skills/${skillKey}/dry-run`, { taskId: task._id });
        expect(res.body.status).toBe(false);
        expect(JSON.stringify(res.body)).toContain('allowlist');
        expect(seen).toEqual([]);
        await setHosts([host]);
    });
});
