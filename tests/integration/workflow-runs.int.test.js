const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The engine's guarantees only mean anything against a real MongoDB: a unique
// index, an atomic findOneAndUpdate and a lease that really expires. This suite
// drives the engine in process against the harness's database.
//
// It works in a tenant database of its own, named after a random id that belongs
// to no company, so nothing here can touch the fixture company's data and no
// other suite can perturb these counts. mongoQueries resolves its connection
// from MONGODB_URL, so that is set before it is required.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '150,150,150';
process.env.WORKFLOW_TENANT_CONCURRENCY = '2';
process.env.WORKFLOW_LEASE_MS = '5000';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const store = require('../../Modules/Workflows/store');
const engine = require('../../Modules/Workflows/engine');
const executors = require('../../Modules/Workflows/executors');
const idempotency = require('../../Modules/Workflows/idempotency');

const COMPANY = crypto.randomBytes(12).toString('hex');
const LEASE_MS = 800;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
const calls = [];
let behaviour = () => ({ ok: true });
let inFlight = 0;
let peakInFlight = 0;

executors.register('probe', async ({ run, step }) => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    calls.push(`${run._id}/${step.stepId}`);
    try {
        return await behaviour({ run, step, attempt: step.attempts });
    } finally {
        inFlight -= 1;
    }
});

const startRun = (steps, over = {}) => store.createRun(COMPANY, {
    workflowId: 'probe',
    name: 'probe workflow',
    source: 'test',
    dedupeKey: `probe:${crypto.randomBytes(6).toString('hex')}`,
    steps,
    ...over,
});

const probeStep = (id, dependsOn = [], over = {}) => ({ id, type: 'probe', dependsOn, maxAttempts: 3, ...over });

/* Plain objects: a Mongoose document cannot be diffed by toMatchObject. */
const stepRow = async (runId, stepId) => {
    const row = await store.getStep(COMPANY, runId, stepId);
    return row ? row.toObject() : row;
};

/* A test that deliberately leaves a claim in hand would otherwise spend one of
 * the tenant's concurrency slots for the rest of the file. */
const releaseEveryClaim = () => MongoDbCrudOpration(COMPANY, {
    type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS,
    data: [{ status: 'running' }, { $set: { status: 'stopped', leaseExpiresAt: null, finishedAt: new Date() } }],
}, 'updateMany');

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
});

afterAll(async () => {
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    // The close events land on the next tick; without this they arrive after teardown.
    await sleep(50);
});

beforeEach(async () => {
    calls.length = 0;
    behaviour = () => ({ ok: true });
    inFlight = 0;
    peakInFlight = 0;
    await releaseEveryClaim();
});

describe('the unique index on run and step', () => {
    it('gives a run exactly one row per step', async () => {
        const run = await startRun([probeStep('a'), probeStep('b', ['a'])]);
        expect((await store.listSteps(COMPANY, run._id)).map((s) => s.stepId)).toEqual(['a', 'b']);

        const second = MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS,
            data: [store.stepRowsFor(run._id, [probeStep('a')])],
        }, 'insertMany');
        await expect(second).rejects.toMatchObject({ code: 11000 });
    });

    it('drops a workflow run whose dedupe key has already been used', async () => {
        const dedupeKey = `probe:${crypto.randomBytes(6).toString('hex')}`;
        expect(await startRun([probeStep('a')], { dedupeKey })).not.toBeNull();
        expect(await startRun([probeStep('a')], { dedupeKey })).toBeNull();
    });
});

describe('two workers racing for one step', () => {
    it('lets exactly one of them win', async () => {
        const run = await startRun([probeStep('a')]);
        const claims = await Promise.all([
            store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'worker-1', lease: LEASE_MS }),
            store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'worker-2', lease: LEASE_MS }),
        ]);
        const winners = claims.filter(Boolean);
        expect(winners).toHaveLength(1);
        expect(winners[0].fencingToken).toBe(1);
        expect(winners[0].attempts).toBe(1);
    });

    it('lets exactly one of ten win', async () => {
        const run = await startRun([probeStep('a')]);
        const claims = await Promise.all(Array.from({ length: 10 }, (unused, i) => store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: `worker-${i}`, lease: LEASE_MS })));
        expect(claims.filter(Boolean)).toHaveLength(1);
        expect((await stepRow(run._id, 'a')).attempts).toBe(1);
    });
});

describe('a stalled lease', () => {
    it('is reclaimed, and the stalled worker\'s write is refused', async () => {
        const run = await startRun([probeStep('a')]);
        const stalled = await store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'stalled', lease: 60 });
        expect(stalled.fencingToken).toBe(1);

        await sleep(120);
        const reclaimed = await store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'fresh', lease: LEASE_MS });
        expect(reclaimed).not.toBeNull();
        expect(reclaimed.fencingToken).toBe(2);
        expect(reclaimed.workerId).toBe('fresh');

        expect(await store.heartbeat(COMPANY, { runId: run._id, stepId: 'a', fencingToken: 1 })).toBe(false);
        await expect(store.succeedStep(COMPANY, { runId: run._id, stepId: 'a', fencingToken: 1 }, { output: { from: 'stalled' } }))
            .rejects.toThrow(store.StaleLeaseError);

        await store.succeedStep(COMPANY, { runId: run._id, stepId: 'a', fencingToken: 2 }, { output: { from: 'fresh' } });
        const settled = await stepRow(run._id, 'a');
        expect(settled.status).toBe('success');
        expect(settled.output).toEqual({ from: 'fresh' });
    });

    it('is not reclaimed while the holder keeps renewing it', async () => {
        const run = await startRun([probeStep('a')]);
        const held = await store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'holder', lease: 200 });
        await sleep(120);
        expect(await store.heartbeat(COMPANY, { runId: run._id, stepId: 'a', fencingToken: held.fencingToken, lease: 2000 })).toBe(true);
        await sleep(150);
        expect(await store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'thief', lease: LEASE_MS })).toBeNull();
    });
});

describe('deterministic versus transient failures', () => {
    it('does not retry a deterministic failure', async () => {
        const run = await startRun([probeStep('a')]);
        behaviour = () => { throw Object.assign(new Error('no such status'), { deterministic: true }); };

        const enqueued = [];
        const result = await engine.tick(COMPANY, run._id, { enqueue: (data, opts) => enqueued.push({ data, opts }) });

        expect(result.status).toBe('failed');
        expect(calls).toHaveLength(1);
        expect(enqueued).toHaveLength(0);
        const step = await stepRow(run._id, 'a');
        expect(step).toMatchObject({ status: 'failed', attempts: 1 });
        expect(step.failure.deterministic).toBe(true);
        expect((await store.getRun(COMPANY, run._id)).status).toBe('failed');
    });

    it('retries a transient failure after a backoff, and succeeds', async () => {
        const run = await startRun([probeStep('a')]);
        behaviour = ({ attempt }) => {
            if (attempt < 2) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
            return { recovered: true };
        };

        const enqueued = [];
        const first = await engine.tick(COMPANY, run._id, { enqueue: (data, opts) => enqueued.push({ data, opts }) });
        expect(first.status).toBe('running');
        expect(first.retryInMs).toBeGreaterThan(0);
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].data.workflowRunId).toBe(String(run._id));

        const deferred = await stepRow(run._id, 'a');
        expect(deferred).toMatchObject({ status: 'pending', attempts: 1 });
        expect(deferred.failure.deterministic).toBe(false);
        expect(new Date(deferred.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() - 50);

        // The backoff is real: claiming before it elapses finds nothing.
        expect(await store.claimStep(COMPANY, { runId: run._id, stepId: 'a', workerId: 'early' })).toBeNull();

        await sleep(250);
        const second = await engine.tick(COMPANY, run._id, {});
        expect(second.status).toBe('success');
        expect(calls).toHaveLength(2);
        expect(await stepRow(run._id, 'a')).toMatchObject({ status: 'success', attempts: 2, output: { recovered: true } });
    });

    it('gives up on a transient failure once the attempts are spent', async () => {
        const run = await startRun([probeStep('a', [], { maxAttempts: 2 })]);
        behaviour = () => { throw Object.assign(new Error('still down'), { code: 'ECONNREFUSED' }); };

        await engine.tick(COMPANY, run._id, {});
        await sleep(250);
        const final = await engine.tick(COMPANY, run._id, {});

        expect(final.status).toBe('failed');
        expect(calls).toHaveLength(2);
        expect(await stepRow(run._id, 'a')).toMatchObject({ status: 'failed', attempts: 2 });
    });
});

describe('dependencies and the ready set', () => {
    it('runs a diamond in dependency order and finishes the run', async () => {
        const run = await startRun([probeStep('a'), probeStep('b', ['a']), probeStep('c', ['a']), probeStep('d', ['b', 'c'])]);
        const result = await engine.tick(COMPANY, run._id, {});

        expect(result.status).toBe('success');
        expect(calls.map((c) => c.split('/')[1])).toEqual(['a', 'b', 'c', 'd']);
        expect((await store.getRun(COMPANY, run._id)).outputs).toMatchObject({ a: { ok: true }, d: { ok: true } });
    });

    it('skips the tail of a graph whose first step failed, rather than stranding it', async () => {
        const run = await startRun([probeStep('a'), probeStep('b', ['a']), probeStep('c', ['b'])]);
        behaviour = () => { throw Object.assign(new Error('broken'), { deterministic: true }); };

        expect((await engine.tick(COMPANY, run._id, {})).status).toBe('failed');
        const steps = await store.listSteps(COMPANY, run._id);
        expect(steps.map((s) => s.status)).toEqual(['failed', 'skipped', 'skipped']);
        expect(calls).toHaveLength(1);
    });
});

describe('per-tenant concurrency', () => {
    it('holds under parallel runs', async () => {
        behaviour = async () => { await sleep(120); return { ok: true }; };
        const runs = await Promise.all(Array.from({ length: 6 }, () => startRun([probeStep('a')])));

        const drive = async (run) => {
            for (let attempt = 0; attempt < 40; attempt++) {
                // eslint-disable-next-line no-await-in-loop
                const result = await engine.tick(COMPANY, run._id, {});
                if (store.TERMINAL.includes(result.status)) return result.status;
                // eslint-disable-next-line no-await-in-loop
                await sleep(40);
            }
            return 'timeout';
        };

        const outcomes = await Promise.all(runs.map(drive));
        expect(outcomes).toEqual(runs.map(() => 'success'));
        expect(calls).toHaveLength(6);
        expect(peakInFlight).toBeLessThanOrEqual(2);
        expect(peakInFlight).toBeGreaterThan(0);
    });

    it('leaves a step that could not be admitted claimable, with its attempt given back', async () => {
        const run = await startRun([probeStep('a')]);
        const blockers = await Promise.all(Array.from({ length: 2 }, async (unused, i) => {
            const other = await startRun([probeStep('a')]);
            return store.claimStep(COMPANY, { runId: other._id, stepId: 'a', workerId: `blocker-${i}`, lease: 4000 });
        }));
        expect(blockers.filter(Boolean)).toHaveLength(2);

        const result = await engine.tick(COMPANY, run._id, {});
        expect(result.status).toBe('running');
        expect(calls).toHaveLength(0);
        expect(await stepRow(run._id, 'a')).toMatchObject({ status: 'pending', attempts: 0 });

        for (const blocker of blockers) {
            // eslint-disable-next-line no-await-in-loop
            await store.succeedStep(COMPANY, { runId: blocker.runId, stepId: 'a', fencingToken: blocker.fencingToken }, { output: {} });
        }
        expect((await engine.tick(COMPANY, run._id, {})).status).toBe('success');
    });
});

describe('action-level idempotency', () => {
    it('does not repeat the effect of a step that is replayed', async () => {
        const run = await startRun([probeStep('a')]);
        expect((await engine.tick(COMPANY, run._id, {})).status).toBe('success');
        expect(calls).toHaveLength(1);

        const key = idempotency.keyFor({ runId: run._id, stepId: 'a' });
        const audit = await client.db(COMPANY).collection('audit_logs').findOne({ 'meta.idempotencyKey': key });
        expect(audit.meta.state).toBe('applied');

        // A redelivered job: the step row is put back and the run re-ticked.
        await MongoDbCrudOpration(COMPANY, {
            type: SCHEMA_TYPE.WORKFLOW_STEP_RUNS,
            data: [{ runId: String(run._id), stepId: 'a' }, { $set: { status: 'pending', finishedAt: null } }],
        }, 'updateOne');
        await store.patchRun(COMPANY, run._id, { status: 'running', finishedAt: null });

        expect((await engine.tick(COMPANY, run._id, {})).status).toBe('success');
        expect(calls).toHaveLength(1);
        expect(await stepRow(run._id, 'a')).toMatchObject({ status: 'success', replayed: true });
        expect(await client.db(COMPANY).collection('audit_logs').countDocuments({ 'meta.idempotencyKey': key })).toBe(1);
    });

    it('keeps one audit row per action key, whatever races for it', async () => {
        const run = await startRun([probeStep('a')]);
        const key = idempotency.keyFor({ runId: run._id, stepId: 'a' });
        const entry = { action: 'workflow.probe', entityType: 'workflow_run', entityId: String(run._id), params: {} };
        const actor = engine.stepActor({ _id: run._id, name: 'probe' });

        const ran = [];
        const results = await Promise.all([1, 2, 3].map((n) => idempotency.once(COMPANY, { key, actor, entry }, async () => { ran.push(n); return { n }; }).catch((e) => e)));

        expect(results.filter((r) => r instanceof Error)).toEqual([]);
        expect(await client.db(COMPANY).collection('audit_logs').countDocuments({ 'meta.idempotencyKey': key })).toBe(1);
        expect(await idempotency.once(COMPANY, { key, actor, entry }, async () => { ran.push('after'); return {}; })).toMatchObject({ replayed: true });
        expect(ran).not.toContain('after');
    });
});
