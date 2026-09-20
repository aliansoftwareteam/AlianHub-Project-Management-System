const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// Step-scoped credentials against a real MongoDB: the engine mints one when it
// claims a step, the row carries its id and expiry, an action under it passes
// while the step is live, and replaying it after the step settled is refused
// and audited. Works in a tenant database of its own, like the engine suite.

const ENV_KEYS = ['WORKFLOW_ENGINE', 'STEP_CREDENTIALS', 'WORKFLOW_BACKOFF_MS', 'WORKFLOW_TENANT_CONCURRENCY', 'WORKFLOW_LEASE_MS', 'JWT_SECRET'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.STEP_CREDENTIALS = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_TENANT_CONCURRENCY = '10';
process.env.WORKFLOW_LEASE_MS = '20000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'step-credentials-integration-secret';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const store = require('../../Modules/Workflows/store');
const engine = require('../../Modules/Workflows/engine');
const stepCredential = require('../../Modules/Workflows/stepCredential');
const actions = require('../../Modules/Agents/actions');
require('../../Modules/Workflows/stepTypes');

const COMPANY = crypto.randomBytes(12).toString('hex');
const STARTER = '6f0000000000000000000101';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
let agentId;
const credentials = {};
const renewed = {};

const actorFor = (token) => ({ kind: 'agent', userId: STARTER, agentId, agentName: 'Reviewer', runId: 'agentrun', viaAccount: 'workspace', tokenId: null, stepCredential: token });

/* Stands in for the agent runner: checks its credential the way perform() does, then reports a finished run. */
const runAgent = async ({ stepId, stepCredential: current, keepAlive }) => {
    credentials[stepId] = current();
    const live = await stepCredential.check(COMPANY, credentials[stepId], { action: 'task.get', actor: actorFor(credentials[stepId]) });
    if (!live.ok) throw Object.assign(new Error(`credential refused inside the step: ${live.reason}`), { deterministic: true });
    if (stepId === 'sTwo') {
        await keepAlive();
        renewed[stepId] = current();
    }
    return { runId: `agentrun-${stepId}`, status: 'done', costUsd: 0, findings: [] };
};

const startRun = (steps) => store.createRun(COMPANY, {
    workflowId: `agent:${agentId}`,
    name: 'credentialed workflow',
    source: 'agent_run',
    dedupeKey: `cred:${crypto.randomBytes(6).toString('hex')}`,
    startedBy: STARTER,
    agentId,
    steps,
});

const agentStep = (id, dependsOn = []) => ({ id, type: 'agent_run', dependsOn, config: { agentId }, maxAttempts: 2 });

const drive = async (runId, { maxTicks = 20 } = {}) => {
    let result = { status: 'running' };
    for (let i = 0; i < maxTicks; i++) {
        // eslint-disable-next-line no-await-in-loop
        result = await engine.tick(COMPANY, runId, { context: { runAgent } });
        if (['success', 'failed', 'stopped', 'blocked', 'missing'].includes(result.status)) return result;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(Number(result.retryInMs) || 10, 120));
    }
    return result;
};

const row = async (runId, stepId) => (await store.getStep(COMPANY, runId, stepId)).toObject();

const refusals = () => MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ action: 'agent.action_refused' }, null, { sort: { createdAt: 1 } }] }, 'find');

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.AUDIT_LOGS, SCHEMA_TYPE.AGENTS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
    const agent = await MongoDbCrudOpration(COMPANY, {
        type: SCHEMA_TYPE.AGENTS,
        data: { name: 'Reviewer', ownerId: STARTER, autonomy: 2, spendCapUsd: 1, paused: false, deletedStatusKey: 0, allowedActions: ['task.get', 'task.comment'] },
    }, 'save');
    agentId = String(agent._id);
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
    await sleep(50);
});

describe('a two-step workflow run under step-scoped credentials', () => {
    let run;

    beforeAll(async () => {
        run = await startRun([agentStep('sOne'), agentStep('sTwo', ['sOne'])]);
        const result = await drive(run._id);
        expect(result.status).toBe('success');
    });

    it('completes, each step under a credential of its own that carried its fencing token and expired with its lease', async () => {
        expect(Object.keys(credentials).sort()).toEqual(['sOne', 'sTwo']);
        for (const stepId of ['sOne', 'sTwo']) {
            // eslint-disable-next-line no-await-in-loop
            const step = await row(run._id, stepId);
            const claims = jwt.decode(credentials[stepId]);
            const onTheRow = jwt.decode(renewed[stepId] || credentials[stepId]);
            expect(step.status).toBe('success');
            expect(step.credentialId).toBe(onTheRow.jti);
            expect(new Date(step.credentialExpiresAt).getTime()).toBe(onTheRow.exp * 1000);
            expect(claims).toMatchObject({ kind: 'step_credential', companyId: COMPANY, runId: String(run._id), stepId, fencingToken: step.fencingToken, agentId, startedBy: STARTER, actions: ['task.get', 'task.comment'] });
            expect(new Date(step.credentialExpiresAt).getTime() - new Date(step.claimedAt).getTime()).toBeGreaterThanOrEqual(19000);
        }
        expect(credentials.sOne).not.toBe(credentials.sTwo);
    });

    it('re-mints a step\'s credential when its lease is extended, under the same fencing token, and keeps only the new id on the row', async () => {
        const [first, second] = [jwt.decode(credentials.sTwo), jwt.decode(renewed.sTwo)];
        expect(second.jti).not.toBe(first.jti);
        expect(second).toMatchObject({ runId: first.runId, stepId: 'sTwo', stepRunId: first.stepRunId, fencingToken: first.fencingToken, agentId, startedBy: STARTER });
        expect(second.exp).toBeGreaterThanOrEqual(first.exp);
        const step = await row(run._id, 'sTwo');
        expect(step.credentialId).toBe(second.jti);
        expect(JSON.stringify(step)).not.toContain(renewed.sTwo);
    });

    it('records each step under the engine service identity, on behalf of the person who started the run', async () => {
        const rows = await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ action: 'agent.action', 'meta.action': 'workflow.agent_run' }] }, 'find');
        expect(rows).toHaveLength(2);
        rows.forEach((audit) => {
            expect(audit.actorId).toBe('service:engine');
            expect(audit.meta).toMatchObject({ actorType: 'service', service: 'engine', onBehalfOf: STARTER, runId: String(run._id) });
        });
    });

    it('refuses a step\'s credential replayed after the step settled, and audits the refusal', async () => {
        await expect(actions.perform({ companyId: COMPANY, actor: actorFor(credentials.sOne), action: 'task.comment', params: { taskId: '6f0000000000000000000701', body: 'late' } }))
            .rejects.toMatchObject({ name: 'RefusedError', message: expect.stringContaining(stepCredential.REFUSAL.STEP_FINISHED) });
        await expect(actions.authorizeRead({ companyId: COMPANY, actor: actorFor(credentials.sTwo), action: 'task.get', params: { taskId: '6f0000000000000000000701' } }))
            .rejects.toMatchObject({ name: 'RefusedError' });
        const audited = await refusals();
        expect(audited.length).toBeGreaterThanOrEqual(2);
        const late = audited.find((r) => r.meta && r.meta.action === 'task.comment');
        expect(late).toBeTruthy();
        expect(late.actorId).toBe(agentId);
        expect(late.meta.reason).toContain(stepCredential.REFUSAL.STEP_FINISHED);
        expect(late.meta.ran).toBe(false);
    });

    /* The first claim is dated a minute ago, so by the time the step is reclaimed both its lease
     * and its credential have run out: no sleep, and no whole-second boundary to land on. */
    it('refuses a credential whose step was reclaimed by a later attempt, as reclaimed even though it has also expired', async () => {
        const second = await startRun([agentStep('sRetry')]);
        const then = new Date(Date.now() - 60000);
        const claimed = await store.claimStep(COMPANY, { runId: second._id, stepId: 'sRetry', workerId: 'w1', lease: 500, now: then });
        const first = stepCredential.mint({ companyId: COMPANY, run: second, step: claimed, actions: ['task.get'], now: then });
        const presented = { action: 'task.get', actor: actorFor(first.token) };
        expect((await stepCredential.check(COMPANY, first.token, { ...presented, now: then })).ok).toBe(true);
        expect(jwt.decode(first.token).exp * 1000).toBeLessThan(Date.now());
        const reclaimed = await store.claimStep(COMPANY, { runId: second._id, stepId: 'sRetry', workerId: 'w2', lease: 20000 });
        expect(reclaimed.fencingToken).toBe(claimed.fencingToken + 1);
        const verdict = await stepCredential.check(COMPANY, first.token, presented);
        expect(verdict).toMatchObject({ ok: false, code: stepCredential.REFUSAL.STEP_RECLAIMED });
    });
});
