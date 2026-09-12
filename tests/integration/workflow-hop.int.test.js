const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// Task 028 sprint 5 step 4 against a real MongoDB, because all four claims are
// claims about rows: a step whose result breaks the next step's contract fails
// deterministically naming the field, a chain that would outlive its deadline is
// refused at the hop rather than mid-call, a chain that would outspend its
// budget likewise, and re-entry past the depth guard is refused.
//
// Like the other workflow suites, this works in a tenant database of its own,
// named after an id that belongs to no company.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '50,50,50';
process.env.WORKFLOW_TENANT_CONCURRENCY = '10';
process.env.WORKFLOW_LEASE_MS = '10000';
process.env.WORKFLOW_JOIN_POLL_MS = '40';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const store = require('../../Modules/Workflows/store');
const engine = require('../../Modules/Workflows/engine');
const executors = require('../../Modules/Workflows/executors');
const hop = require('../../Modules/Workflows/hop');

const COMPANY = crypto.randomBytes(12).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
const calls = [];
let behaviour = () => ({ matched: true, taken: [], skipped: [] });

// Registered as `condition` so it inherits that type's real contract, which is
// what the engine is being held to here.
executors.register('condition', async ({ step }) => {
    calls.push(String(step.stepId));
    return behaviour(step) || {};
});

const startRun = (steps, over = {}) => store.createRun(COMPANY, {
    workflowId: 'hop',
    name: 'hop workflow',
    source: 'test',
    dedupeKey: `hop:${crypto.randomBytes(6).toString('hex')}`,
    steps,
    ...over,
});

const row = async (runId, stepId) => (await store.getStep(COMPANY, runId, stepId)).toObject();
const runRow = async (runId) => (await store.getRun(COMPANY, runId)).toObject();

const drive = async (runId, { maxTicks = 20 } = {}) => {
    let result = { status: 'running' };
    for (let i = 0; i < maxTicks; i++) {
        // eslint-disable-next-line no-await-in-loop
        result = await engine.tick(COMPANY, runId);
        if (['success', 'failed', 'stopped', 'blocked', 'missing'].includes(result.status)) return result;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(Number(result.retryInMs) || 10, 120));
    }
    return result;
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
});

beforeEach(() => {
    calls.length = 0;
    behaviour = () => ({ matched: true, taken: [], skipped: [] });
});

afterAll(async () => {
    if (client) { await client.db(`company_${COMPANY}`).dropDatabase().catch(() => {}); await client.close(); }
    await Promise.resolve(closeConnection()).catch(() => {});
});

describe('typed results at each edge', () => {
    it('fails the producer deterministically, naming the field it did not produce', async () => {
        behaviour = () => ({ matched: true, taken: [] });
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'always' } } },
        ]);

        const result = await drive(run._id);
        expect(result.status).toBe('failed');

        const first = await row(run._id, 's1');
        expect(first.status).toBe('failed');
        expect(first.error).toContain('"skipped"');
        expect(first.error).toContain('broke its own contract');
        expect(first.failure.deterministic).toBe(true);
        expect(first.attempts).toBe(1);
        // The next step never became anybody's input: it was not run at all.
        expect(calls).toEqual(['s1']);
        expect((await row(run._id, 's2')).status).toBe('skipped');
    });

    it('refuses a consumer that reads a field its producer does not declare', async () => {
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'eq', args: [{ field: '$s1.winner' }, { value: 1 }] } } },
        ]);

        const result = await drive(run._id);
        expect(result.status).toBe('failed');

        const second = await row(run._id, 's2');
        expect(second.status).toBe('failed');
        expect(second.error).toContain('"$s1.winner"');
        expect(second.error).toContain('produces no "winner"');
        expect(second.failure.code).toBe('contract_mismatch');
        // Refused before the claim ran anything: the executor saw only s1.
        expect(calls).toEqual(['s1']);
    });

    it('lets a consumer read a field the contract does declare', async () => {
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'eq', args: [{ field: '$s1.matched' }, { value: true }] } } },
        ]);
        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['s1', 's2']);
    });
});

describe('the deadline shrinking per hop', () => {
    it('gives each step what is left rather than what the run started with', async () => {
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'always' } } },
        ], { deadlineMs: 60000 });

        expect((await drive(run._id)).status).toBe('success');
        const first = await row(run._id, 's1');
        const second = await row(run._id, 's2');
        const deadlineAt = new Date((await runRow(run._id)).deadlineAt).getTime();
        expect(new Date(first.deadlineAt).getTime()).toBeLessThanOrEqual(deadlineAt);
        expect(new Date(second.deadlineAt).getTime()).toBeLessThanOrEqual(new Date(first.deadlineAt).getTime());
    });

    it('refuses the hop, not the call, when the run would be outlived', async () => {
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'always' }, deadlineMs: 3600000 } },
        ], { deadlineMs: 30000 });

        const result = await drive(run._id);
        expect(result.status).toBe('blocked');

        const blocked = await runRow(run._id);
        expect(blocked.blocked.code).toBe(hop.DEADLINE_EXCEEDED);
        expect(blocked.blocked.stepId).toBe('s2');
        expect(blocked.blocked.reason).toContain('3600s');
        expect(blocked.error).toContain('was not started');
        // s2 never reached its executor.
        expect(calls).toEqual(['s1']);
        expect((await row(run._id, 's2')).status).toBe('failed');
    });

    it('refuses every step once the deadline has already passed', async () => {
        const run = await startRun([{ id: 's1', type: 'condition', config: { when: { op: 'always' } } }], { deadlineMs: 20 });
        await sleep(60);
        expect((await drive(run._id)).status).toBe('blocked');
        expect(calls).toEqual([]);
        expect((await runRow(run._id)).blocked.reason).toContain("deadline passed");
    });

    it('is terminal: a later tick does not pick the run up again', async () => {
        const run = await startRun([{ id: 's1', type: 'condition', config: { when: { op: 'always' } } }], { deadlineMs: 20 });
        await sleep(60);
        await drive(run._id);
        expect(await engine.tick(COMPANY, run._id)).toEqual({ status: 'blocked' });
        expect(calls).toEqual([]);
    });
});

describe('the budget shrinking per hop', () => {
    it('takes each step cost off the run and refuses the hop that would overspend', async () => {
        behaviour = () => ({ matched: true, taken: [], skipped: [], costUsd: 0.6 });
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'always' }, budgetUsd: 0.9 } },
        ], { budgetUsd: 1 });

        const result = await drive(run._id);
        expect(result.status).toBe('blocked');

        const after = await runRow(run._id);
        expect(after.spentUsd).toBeCloseTo(0.6, 6);
        expect(after.blocked.code).toBe(hop.BUDGET_EXHAUSTED);
        expect(after.blocked.reason).toContain('$0.90');
        expect(after.blocked.reason).toContain('$0.40');
        expect(calls).toEqual(['s1']);
        expect((await row(run._id, 's1')).costUsd).toBeCloseTo(0.6, 6);
    });

    it('refuses the next hop once the budget is spent, inside the same tick', async () => {
        behaviour = () => ({ matched: true, taken: [], skipped: [], costUsd: 1 });
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'always' } } },
        ], { budgetUsd: 1 });

        expect((await drive(run._id)).status).toBe('blocked');
        expect(calls).toEqual(['s1']);
        expect((await runRow(run._id)).blocked.reason).toContain('is spent');
    });

    it('lets a chain that stays inside its budget finish', async () => {
        behaviour = () => ({ matched: true, taken: [], skipped: [], costUsd: 0.25 });
        const run = await startRun([
            { id: 's1', type: 'condition', config: { when: { op: 'always' } } },
            { id: 's2', type: 'condition', dependsOn: ['s1'], config: { when: { op: 'always' } } },
        ], { budgetUsd: 1 });

        expect((await drive(run._id)).status).toBe('success');
        expect((await runRow(run._id)).spentUsd).toBeCloseTo(0.5, 6);
    });
});

describe('the depth guard on workflow re-entry', () => {
    it('refuses a fan-out child inside a loop body when the run already started deep', async () => {
        const run = await startRun([
            { id: 'sBody', type: 'condition', config: { when: { op: 'always' } } },
            { id: 'sLoop', type: 'condition', dependsOn: ['sBody'], config: { when: { op: 'always' }, body: ['sBody'] } },
        ], { depth: hop.MAX_DEPTH - 1 });

        const result = await drive(run._id);
        expect(result.status).toBe('blocked');

        const blocked = await runRow(run._id);
        expect(blocked.blocked.code).toBe(hop.LOOP_DEPTH_EXCEEDED);
        expect(blocked.blocked.stepId).toBe('sBody');
        expect(blocked.blocked.reason).toContain('levels of re-entry deep');
        expect(calls).toEqual([]);
    });

    it('records the depth each step ran at', async () => {
        const run = await startRun([
            { id: 'sBody', type: 'condition', config: { when: { op: 'always' } } },
            { id: 'sLoop', type: 'condition', dependsOn: ['sBody'], config: { when: { op: 'always' }, body: ['sBody'] } },
        ], { depth: 1 });

        expect((await drive(run._id)).status).toBe('success');
        expect((await row(run._id, 'sBody')).depth).toBe(2);
        expect((await row(run._id, 'sLoop')).depth).toBe(1);
    });

    it('lets the same graph run when the run did not start deep', async () => {
        const run = await startRun([
            { id: 'sBody', type: 'condition', config: { when: { op: 'always' } } },
            { id: 'sLoop', type: 'condition', dependsOn: ['sBody'], config: { when: { op: 'always' }, body: ['sBody'] } },
        ]);
        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['sBody', 'sLoop']);
    });
});
