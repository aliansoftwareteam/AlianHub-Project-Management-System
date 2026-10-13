const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// Defect 17 against a real MongoDB: the hourly run limit, stored on every v2
// rule since it was written and read by nothing, as the loop's admission
// control.
//
// The claims are about rows, which is why this is not a unit test: the hour is
// counted from the `agent_runs` rows an earlier iteration actually wrote, the
// reason lands on the workflow run and in the audit log, and a run that started
// over an hour ago is not in the hour any more.
//
// The `agent_run` executor is stubbed to write the row a real one would and
// nothing else — the runner itself is the agents' code, proved in its own suite,
// and what is under test here is what the loop does with the rows.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_TENANT_CONCURRENCY = '10';
process.env.WORKFLOW_LEASE_MS = '10000';
process.env.WORKFLOW_JOIN_POLL_MS = '40';
process.env.WORKFLOW_RUN_LIMIT_CACHE_MS = '30000';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const store = require('../../Modules/Workflows/store');
const engine = require('../../Modules/Workflows/engine');
const executors = require('../../Modules/Workflows/executors');
const stepTypes = require('../../Modules/Workflows/stepTypes');
const runLimit = require('../../Modules/Workflows/runLimit');
const agentRunType = require('../../Modules/Workflows/stepTypes/agentRun');

const COMPANY = crypto.randomBytes(12).toString('hex');
const AGENT = crypto.randomBytes(12).toString('hex');
const HOUR_MS = 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
const started = [];

const saveRun = (agentId, startedAt) => MongoDbCrudOpration(COMPANY, {
    type: SCHEMA_TYPE.AGENT_RUNS,
    data: { agentId: String(agentId), status: 'done', trigger: 'workflow', startedAt, finishedAt: startedAt, spend: { usd: 0, tokens: 0 } },
}, 'save');

/* What a real agent-run step leaves behind, without the runner: one row, at the
 * moment it ran. */
const stubbedAgentRun = async ({ step }) => {
    const agentId = String((step.config || {}).agentId);
    const row = await saveRun(agentId, new Date());
    started.push(agentId);
    return { agentRunId: String(row._id), status: 'done', costUsd: 0, findings: [] };
};

const startRun = (steps, over = {}) => store.createRun(COMPANY, {
    workflowId: 'run-limit',
    name: 'a repeating cycle',
    source: 'test',
    dedupeKey: `run-limit:${crypto.randomBytes(6).toString('hex')}`,
    steps,
    ...over,
});

const row = async (runId, stepId) => (await store.getStep(COMPANY, runId, stepId)).toObject();

const refusals = () => MongoDbCrudOpration(COMPANY, {
    type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ action: 'agent.action_refused' }],
}, 'find');

const drive = async (runId, { maxTicks = 80 } = {}) => {
    let result = { status: 'running' };
    for (let i = 0; i < maxTicks; i++) {
        // eslint-disable-next-line no-await-in-loop
        result = await engine.tick(COMPANY, runId);
        if (['success', 'failed', 'stopped', 'missing'].includes(result.status)) return result;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(Number(result.retryInMs) || 10, 120));
    }
    return result;
};

/* A loop over a body of one agent run. The body runs once before the loop step
 * exists, so the loop governs every pass after the first. */
const cycle = (config) => [
    { id: 'sWork', type: stepTypes.AGENT_RUN, dependsOn: [], config: { agentId: AGENT, taskId: 'task-1' } },
    { id: 'sAgain', type: stepTypes.LOOP, dependsOn: ['sWork'], config: { body: ['sWork'], maxIterations: 20, ...config } },
];

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
    executors.register(agentRunType.TYPE, stubbedAgentRun);
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    await sleep(50);
});

beforeEach(async () => {
    started.length = 0;
    runLimit.forget();
    await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{}] }, 'deleteMany');
    await MongoDbCrudOpration(COMPANY, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ action: 'agent.action_refused' }] }, 'deleteMany');
});

describe('the hourly run limit as the loop’s admission control', () => {
    it('stops the loop once the hour’s allowance is spent, and records why', async () => {
        const run = await startRun(cycle({ maxRunsPerHour: 3 }));
        expect((await drive(run._id)).status).toBe('success');

        expect(started).toHaveLength(3);
        const loop = await row(run._id, 'sAgain');
        expect(loop.status).toBe('success');
        expect(loop.output).toMatchObject({ stoppedBy: 'run_limit', iterations: 3 });
        expect(loop.output.runLimit).toMatchObject({ agentId: AGENT, limit: 3, used: 3 });

        const blocked = (await store.getRun(COMPANY, run._id)).blocked;
        expect(blocked).toMatchObject({ reason: 'run_limit', stepId: 'sAgain', agentId: AGENT, limit: 3, used: 3 });
        expect(blocked.detail).toBe('Hourly run limit reached (3 of 3 in the last hour).');
        expect(new Date(blocked.resetsAt).getTime()).toBeGreaterThan(Date.now());

        const rows = await refusals();
        expect(rows).toHaveLength(1);
        expect(rows[0].meta).toMatchObject({ action: 'workflow.loop.run_limit', reason: blocked.detail, ran: false });
        expect(rows[0].meta.params).toMatchObject({ stepId: 'sAgain', agentId: AGENT, limit: 3, used: 3 });
    });

    it('counts the runs the hour already holds, whoever started them', async () => {
        await saveRun(AGENT, new Date(Date.now() - 10 * 60 * 1000));
        await saveRun(AGENT, new Date(Date.now() - 20 * 60 * 1000));

        const run = await startRun(cycle({ maxRunsPerHour: 3 }));
        expect((await drive(run._id)).status).toBe('success');

        expect(started).toHaveLength(1);
        expect((await row(run._id, 'sAgain')).output).toMatchObject({ stoppedBy: 'run_limit', iterations: 1 });
    });

    it('lets the allowance refill as the hour rolls past the runs in it', async () => {
        await saveRun(AGENT, new Date(Date.now() - HOUR_MS - 60 * 1000));
        await saveRun(AGENT, new Date(Date.now() - HOUR_MS - 2 * 60 * 1000));
        await saveRun(AGENT, new Date(Date.now() - HOUR_MS - 3 * 60 * 1000));

        const run = await startRun(cycle({ maxRunsPerHour: 2 }));
        expect((await drive(run._id)).status).toBe('success');

        expect(started).toHaveLength(2);
        const loop = await row(run._id, 'sAgain');
        expect(loop.output).toMatchObject({ stoppedBy: 'run_limit' });
        expect(loop.output.runLimit).toMatchObject({ limit: 2, used: 2 });
    });

    it('means no limit at zero, and stops at the iteration cap instead', async () => {
        const run = await startRun(cycle({ maxRunsPerHour: 0, maxIterations: 4 }));
        expect((await drive(run._id)).status).toBe('success');

        expect(started).toHaveLength(4);
        const loop = await row(run._id, 'sAgain');
        expect(loop.output).toMatchObject({ stoppedBy: 'iteration_cap', iterations: 4 });
        expect(loop.output.runLimit).toBeUndefined();
        expect((await store.getRun(COMPANY, run._id)).blocked).toBeFalsy();
        expect(await refusals()).toHaveLength(0);
    });

    it('reads the limit the rule has been storing all along', async () => {
        const rule = await MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.AUTOMATION_RULES,
            data: { name: 'a cycle', version: 2, limits: { maxRunsPerHour: 2 } },
        }, 'save');

        const run = await startRun(cycle({}), { ruleId: String(rule._id) });
        expect((await drive(run._id)).status).toBe('success');

        expect(started).toHaveLength(2);
        expect((await row(run._id, 'sAgain')).output).toMatchObject({ stoppedBy: 'run_limit' });
    });

    it('lets a loop whose body starts no agent run alone', async () => {
        executors.register('probe', async () => ({ ok: true }));
        const run = await startRun([
            { id: 'sScan', type: 'probe', dependsOn: [], config: {} },
            { id: 'sAgain', type: stepTypes.LOOP, dependsOn: ['sScan'], config: { body: ['sScan'], maxIterations: 3, maxRunsPerHour: 1 } },
        ]);
        expect((await drive(run._id)).status).toBe('success');
        expect((await row(run._id, 'sAgain')).output).toMatchObject({ stoppedBy: 'iteration_cap', iterations: 3 });
    });
});
