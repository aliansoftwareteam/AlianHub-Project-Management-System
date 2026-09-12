const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

// The sprint 5 exit gate, against a real MongoDB: a fifteen-step workflow killed
// at step eleven resumes at eleven with no duplicate writes, and an approval step
// reassigns and escalates on its deadline.
//
// The kill is the point of the first half, so it is simulated the way a crash
// happens rather than the way a shutdown does: the worker's step eleven never
// settles, its heartbeat never renews the lease (WORKFLOW_HEARTBEAT_MS is longer
// than the suite), and the claim is simply abandoned. Another worker may only
// take the step back once the lease has lapsed on its own.
//
// Each step's effect is a row of its own under an idempotency key of its own, so
// "exactly once" is a count rather than a claim about the code.
//
// Like the other engine suites, this works in a tenant database named after an id
// that belongs to no company.

process.env.MONGODB_URL = resolveMongoUrl();
process.env.WORKFLOW_ENGINE = 'on';
process.env.WORKFLOW_BACKOFF_MS = '100,100,100';
process.env.WORKFLOW_TENANT_CONCURRENCY = '10';
process.env.WORKFLOW_LEASE_MS = '600';
process.env.WORKFLOW_HEARTBEAT_MS = '600000';
process.env.WORKFLOW_APPROVAL_POLL_MS = '60';

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const store = require('../../Modules/Workflows/store');
const engine = require('../../Modules/Workflows/engine');
const executors = require('../../Modules/Workflows/executors');
const idempotency = require('../../Modules/Workflows/idempotency');
const approvals = require('../../Modules/Workflows/approvals');
const stepTypes = require('../../Modules/Workflows/stepTypes');

const COMPANY = crypto.randomBytes(12).toString('hex');
const LEASE_MS = 600;
const STEPS = 15;
const KILL_AT = 's11';
const SECOND_WORKER = 'worker-that-took-it-back';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let client;
const calls = [];
let killAt = null;
let hang = null;
let releaseHang = null;

const effects = () => client.db(COMPANY).collection('gate_effects');

const effectKey = (runId, stepId) => `${idempotency.keyFor({ runId, stepId })}:effect`;

/* One step, one row. The write happens under its own idempotency key, so a step
 * that runs a second time after a crash records nothing a second time — which is
 * the whole of "no duplicate writes", counted rather than asserted. */
executors.register('gate_effect', async ({ companyId, run, step }) => {
    const stepId = String(step.stepId);
    calls.push(stepId);
    await idempotency.once(companyId, {
        key: effectKey(run._id, stepId),
        actor: engine.stepActor(run),
        entry: {
            action: 'gate.effect',
            reason: 'sprint 5 exit gate',
            entityType: 'workflow_run',
            entityId: String(run._id),
            entityName: stepId,
            params: { stepId },
        },
    }, () => effects().insertOne({ runId: String(run._id), stepId, at: new Date() }));

    if (stepId === killAt) {
        killAt = null;
        return hang;
    }
    return { ok: true };
});

const chain = (count, type = 'gate_effect') => Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    type,
    dependsOn: i ? [`s${i}`] : [],
}));

const startRun = (steps, over = {}) => store.createRun(COMPANY, {
    workflowId: 'gate',
    name: 'exit gate workflow',
    source: 'test',
    dedupeKey: `gate:${crypto.randomBytes(6).toString('hex')}`,
    steps,
    ...over,
});

const rows = async (runId) => (await store.listSteps(COMPANY, runId)).map((step) => step.toObject());
const row = async (runId, stepId) => (await store.getStep(COMPANY, runId, stepId)).toObject();
const statuses = async (runId) => (await rows(runId)).reduce((acc, step) => ({ ...acc, [step.stepId]: step.status }), {});

/* Ticks until the run settles or the ticks run out, waiting out whatever the last
 * tick asked for. A run still going when the ticks run out is the honest answer
 * for a run blocked on a person. */
const drive = async (runId, { maxTicks = 80, workerId } = {}) => {
    let result = { status: 'running' };
    for (let i = 0; i < maxTicks; i++) {
        // eslint-disable-next-line no-await-in-loop
        result = await engine.tick(COMPANY, runId, workerId ? { workerId } : {});
        if (['success', 'failed', 'stopped', 'blocked', 'missing'].includes(result.status)) return result;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(Number(result.retryInMs) || 10, 120));
    }
    return result;
};

const until = async (predicate, { timeoutMs = 10000, everyMs = 20 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        if (await predicate()) return true;
        // eslint-disable-next-line no-await-in-loop
        await sleep(everyMs);
    }
    return false;
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    for (const type of [SCHEMA_TYPE.WORKFLOW_RUNS, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, SCHEMA_TYPE.WORKFLOW_APPROVALS, SCHEMA_TYPE.AUDIT_LOGS]) {
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(COMPANY, { type, data: [] }, 'syncIndexes');
    }
});

afterAll(async () => {
    if (releaseHang) releaseHang({ ok: true, late: true });
    if (client) {
        await client.db(COMPANY).dropDatabase().catch(() => {});
        await client.close();
    }
    closeConnection(COMPANY);
    await sleep(50);
});

beforeEach(() => {
    calls.length = 0;
    killAt = null;
    hang = new Promise((resolve) => { releaseHang = resolve; });
});

describe('a fifteen-step workflow killed at step eleven', () => {
    it('resumes at eleven, re-executes nothing behind it, and writes every effect exactly once', async () => {
        const run = await startRun(chain(STEPS));
        killAt = KILL_AT;

        // The worker that dies. Its tick never returns, because step eleven never
        // settles: the claim is abandoned with the lease still on the row.
        const killed = engine.tick(COMPANY, run._id).then(() => null, (error) => error);

        // Step eleven's effect is written before the worker stops answering, so
        // eleven rows is the moment the kill lands mid-step.
        expect(await until(async () => (await effects().countDocuments({ runId: String(run._id) })) === 11)).toBe(true);
        expect(calls).toEqual(chain(11).map((step) => step.id));
        expect((await row(run._id, KILL_AT)).status).toBe('running');

        const abandoned = await row(run._id, KILL_AT);
        expect(abandoned.attempts).toBe(1);
        expect(abandoned.fencingToken).toBe(1);
        expect(new Date(abandoned.leaseExpiresAt).getTime()).toBeGreaterThan(Date.now());

        // Nobody may take the step while the lease is alive.
        expect(await store.claimStep(COMPANY, { runId: run._id, stepId: KILL_AT, workerId: 'worker-b' })).toBeNull();

        // The dead worker renews nothing, so the lease lapses on its own.
        await sleep(LEASE_MS + 300);
        calls.length = 0;

        const resumed = await drive(run._id, { workerId: SECOND_WORKER });
        expect(resumed.status).toBe('success');

        // Steps one to ten were not touched again: the second worker started at eleven.
        expect(calls).toEqual(chain(STEPS).map((step) => step.id).slice(10));

        const settled = await statuses(run._id);
        expect(Object.values(settled).every((status) => status === 'success')).toBe(true);

        const eleven = await row(run._id, KILL_AT);
        expect(eleven.status).toBe('success');
        expect(eleven.attempts).toBe(2);
        expect(eleven.fencingToken).toBe(2);
        expect(String(eleven.workerId)).toBe(SECOND_WORKER);

        // Every effect exists exactly once, step eleven's included, even though its
        // executor ran twice.
        const written = await effects().find({ runId: String(run._id) }).toArray();
        expect(written).toHaveLength(STEPS);
        expect(written.map((doc) => doc.stepId).sort()).toEqual(chain(STEPS).map((step) => step.id).sort());
        expect(await effects().countDocuments({ runId: String(run._id), stepId: KILL_AT })).toBe(1);

        const audits = client.db(COMPANY).collection('audit_logs');
        expect(await audits.countDocuments({ 'meta.idempotencyKey': effectKey(run._id, KILL_AT) })).toBe(1);
        expect(await audits.countDocuments({ 'meta.action': 'gate.effect', entityId: String(run._id) })).toBe(STEPS);
        // The engine's own row per step, step eleven's included, is one row too.
        expect(await audits.countDocuments({ 'meta.action': 'workflow.gate_effect', entityId: String(run._id) })).toBe(STEPS);

        // And when the worker everybody gave up on finally comes back, its write is
        // refused rather than overwriting the result the second worker recorded.
        releaseHang({ ok: true, late: true });
        const late = await killed;
        expect(late).toBeInstanceOf(store.StaleLeaseError);
        expect((await row(run._id, KILL_AT)).output).toEqual({ ok: true });
    }, 60000);
});

describe('an approval step', () => {
    const approvalWorkflow = (config) => [
        { id: 'ask', type: stepTypes.HUMAN_APPROVAL, dependsOn: [], config },
        { id: 'act', type: 'gate_effect', dependsOn: ['ask'] },
    ];

    it('waits, records a reassignment, escalates on its delay and resumes on the decision after the handover', async () => {
        const run = await startRun(approvalWorkflow({
            ownerUserId: 'user-owner',
            prompt: 'ship it?',
            escalateToUserId: 'user-escalation',
            escalateAfterMs: 150,
            deadlineMs: 60000,
        }));

        expect((await engine.tick(COMPANY, run._id)).status).toBe('running');
        expect(calls).toEqual([]);
        const waiting = await row(run._id, 'ask');
        expect(waiting.status).toBe('pending');
        expect(waiting.waitReason).toBe('waiting for user user-owner to approve');
        expect(waiting.attempts).toBe(0);
        expect(stepTypes.blockedReason(await rows(run._id))).toMatchObject({ blocked: true, stepId: 'ask' });

        // Handed on by a person: who moved it, from whom and to whom.
        const moved = await approvals.reassign(COMPANY, { runId: run._id, stepId: 'ask', toUserId: 'user-stand-in', by: 'user-admin', reason: 'owner is away' });
        expect(moved.ownerUserId).toBe('user-stand-in');
        expect(moved.owners).toEqual(['user-owner', 'user-stand-in']);
        expect(moved.reassignedBy).toBe('user-admin');
        expect(moved.reassignments).toHaveLength(1);
        expect(moved.reassignments[0]).toMatchObject({ from: 'user-owner', to: 'user-stand-in', by: 'user-admin', reason: 'owner is away' });
        expect(moved.status).toBe('pending');

        // The escalation delay passes with nobody having decided.
        await sleep(250);
        await engine.tick(COMPANY, run._id);

        const escalated = await approvals.get(COMPANY, run._id, 'ask');
        expect(escalated.escalatedAt).toBeTruthy();
        expect(escalated.ownerUserId).toBe('user-escalation');
        expect(escalated.owners).toEqual(['user-owner', 'user-stand-in', 'user-escalation']);
        expect(escalated.status).toBe('pending');
        expect((await row(run._id, 'ask')).waitReason).toBe('waiting for user user-escalation to approve (escalated)');
        expect(calls).toEqual([]);

        // A decision by the escalation target, after the handover, resumes the run.
        expect(await approvals.decide(COMPANY, { runId: run._id, stepId: 'ask', decision: 'approved', decidedBy: 'user-escalation', comment: 'go' })).not.toBeNull();
        expect((await drive(run._id)).status).toBe('success');
        expect(calls).toEqual(['act']);
        expect((await row(run._id, 'ask')).output).toMatchObject({ decision: 'approved', decidedBy: 'user-escalation', escalated: true });
        expect(await effects().countDocuments({ runId: String(run._id) })).toBe(1);
    }, 30000);

    it.each([
        ['fail', 'failed', { ask: 'failed', act: 'skipped' }, 'expired'],
        ['approve', 'success', { ask: 'success', act: 'success' }, 'approved'],
        ['reject', 'success', { ask: 'success', act: 'skipped' }, 'rejected'],
    ])('honours onDeadline "%s" when nobody decides in time', async (onDeadline, runStatus, stepStatuses, requestStatus) => {
        const run = await startRun(approvalWorkflow({ ownerUserId: 'user-owner', deadlineMs: 120, onDeadline }));
        await engine.tick(COMPANY, run._id);
        await sleep(200);

        expect((await drive(run._id)).status).toBe(runStatus);
        expect(await statuses(run._id)).toMatchObject(stepStatuses);
        expect((await approvals.get(COMPANY, run._id, 'ask')).status).toBe(requestStatus);
    }, 30000);
});
