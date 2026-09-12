const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { leaseMs, maxAttempts } = require('./flag');

// Every durable read and write of a workflow run and its step runs.
//
// The two properties this file exists to hold:
//
// 1. A step is claimed by winning a compare-and-set on its own row, not by
//    reading it and then writing it. Two workers that race therefore produce
//    exactly one winner and one `null`, with no window between the two.
//
// 2. Every write a worker makes after its claim is guarded on the fencing token
//    that claim handed it. A worker whose lease expired has already had its
//    token superseded by whoever reclaimed the step, so its late write matches
//    nothing and is refused instead of overwriting the new worker's result.

const RUNS = SCHEMA_TYPE.WORKFLOW_RUNS;
const STEPS = SCHEMA_TYPE.WORKFLOW_STEP_RUNS;

const TERMINAL = Object.freeze(['success', 'failed', 'stopped']);
const STEP_TERMINAL = Object.freeze(['success', 'failed', 'skipped', 'stopped']);

class StaleLeaseError extends Error {
    constructor(runId, stepId, fencingToken) {
        super(`workflow step ${runId}/${stepId}: the lease was lost (fencing token ${fencingToken} is stale), the write was refused`);
        this.name = 'StaleLeaseError';
        this.deterministic = true;
        this.runId = String(runId);
        this.stepId = String(stepId);
        this.fencingToken = fencingToken;
    }
}

const isDuplicateKey = (e) => Boolean(e && (e.code === 11000 || /duplicate key/i.test(e.message || '')));

const call = (companyId, type, data, method) => MongoDbCrudOpration(companyId, { type, data }, method);

/* Snapshotted at start: editing the rule mid-run must not change the graph the
 * run is already executing. */
const stepRowsFor = (runId, steps) => steps.map((step, index) => ({
    runId: String(runId),
    stepId: String(step.id || `s${index + 1}`),
    index,
    type: String(step.type),
    action: step.action ? String(step.action) : null,
    dependsOn: (step.dependsOn || []).map(String),
    config: step.config || {},
    status: 'pending',
    attempts: 0,
    maxAttempts: Number(step.maxAttempts) > 0 ? Number(step.maxAttempts) : maxAttempts(),
    fencingToken: 0,
}));

/* Returns null when the dedupe key says this trigger has already started a run. */
const createRun = async (companyId, { workflowId, name, source, dedupeKey, ruleId, ruleName, automationRunId, eventId, eventType, entity, envelope, traceId, startedBy, steps }) => {
    let run;
    try {
        run = await call(companyId, RUNS, {
            workflowId: String(workflowId),
            name: name || '',
            source: source || 'automation_rule',
            ...(dedupeKey ? { dedupeKey: String(dedupeKey) } : {}),
            ruleId: ruleId ? String(ruleId) : null,
            ruleName: ruleName || '',
            automationRunId: automationRunId ? String(automationRunId) : null,
            eventId: eventId ? String(eventId) : null,
            eventType: eventType || null,
            entity: entity || {},
            envelope: envelope || {},
            traceId: traceId || null,
            startedBy: startedBy ? String(startedBy) : null,
            status: 'queued',
            definition: { steps },
            outputs: {},
            startedAt: new Date(),
        }, 'save');
    } catch (error) {
        if (isDuplicateKey(error)) return null;
        throw error;
    }
    await call(companyId, STEPS, [stepRowsFor(run._id, steps)], 'insertMany');
    return run;
};

const getRun = (companyId, runId) => call(companyId, RUNS, [{ _id: String(runId) }], 'findOne');

const patchRun = (companyId, runId, set) => call(companyId, RUNS, [{ _id: String(runId) }, { $set: set }], 'updateOne');

const listSteps = (companyId, runId) => call(companyId, STEPS, [{ runId: String(runId) }, null, { sort: { index: 1 } }], 'find');

const getStep = (companyId, runId, stepId) => call(companyId, STEPS, [{ runId: String(runId), stepId: String(stepId) }], 'findOne');

/* Claim a step, or discover somebody else holds it.
 *
 * The filter is the whole mechanism: a pending step, or a running one whose
 * lease has run out, and in either case one that is not waiting out a backoff.
 * The update flips the status and bumps the fencing token in the same write, so
 * the loser of a race sees a running step with a live lease and gets null. */
const claimStep = async (companyId, { runId, stepId, workerId, now = new Date(), lease = leaseMs() }) => {
    const claimable = { $or: [{ status: 'pending' }, { status: 'running', leaseExpiresAt: { $lte: now } }] };
    const due = { $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] };
    return call(companyId, STEPS, [
        { runId: String(runId), stepId: String(stepId), $and: [claimable, due] },
        {
            $set: { status: 'running', workerId: String(workerId), claimedAt: now, leaseExpiresAt: new Date(now.getTime() + lease), startedAt: now, nextAttemptAt: null, error: null },
            $inc: { fencingToken: 1, attempts: 1 },
        },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
};

/* Extends the lease of a step this worker still holds. False means the lease was
 * taken: the caller has lost the step and must stop touching it. */
const heartbeat = async (companyId, { runId, stepId, fencingToken, now = new Date(), lease = leaseMs() }) => {
    const result = await call(companyId, STEPS, [
        { runId: String(runId), stepId: String(stepId), status: 'running', fencingToken: Number(fencingToken) },
        { $set: { leaseExpiresAt: new Date(now.getTime() + lease) } },
    ], 'updateOne');
    return Boolean(result && result.matchedCount > 0);
};

/* Every post-claim write goes through here, so there is exactly one place where
 * a stale fencing token is turned into a refusal. */
const settleStep = async (companyId, { runId, stepId, fencingToken, set, inc }) => {
    const updated = await call(companyId, STEPS, [
        { runId: String(runId), stepId: String(stepId), status: 'running', fencingToken: Number(fencingToken) },
        { $set: set, ...(inc ? { $inc: inc } : {}) },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    if (!updated) throw new StaleLeaseError(runId, stepId, fencingToken);
    return updated;
};

const DONE_WAITING = { waitUntil: null, waitReason: null };

const succeedStep = (companyId, claim, { output, auditId, replayed }) => settleStep(companyId, {
    ...claim,
    set: { status: 'success', output: output || {}, error: null, failure: null, auditId: auditId || null, replayed: Boolean(replayed), finishedAt: new Date(), leaseExpiresAt: null, ...DONE_WAITING },
});

const failStep = (companyId, claim, { error, failure }) => settleStep(companyId, {
    ...claim,
    set: { status: 'failed', error: String(error || '').slice(0, 500), failure: failure || null, finishedAt: new Date(), leaseExpiresAt: null, ...DONE_WAITING },
});

/* A transient failure: back to pending, with the time it may next be claimed.
 *
 * A wait comes back through here too, because handing a worker back is handing a
 * worker back — but it is not a failure, so it is recorded as what it is: the
 * reason and the moment it waits for instead of an error, and the attempt given
 * back, so `attempts` keeps meaning "times this step ran" and a step waiting a
 * week on a person does not spend a retry budget meant for a broken one. */
const deferStep = (companyId, claim, { error, failure, runAt }) => {
    const waiting = failure && failure.type === 'waiting' ? (failure.wait || {}) : null;
    if (!waiting) {
        return settleStep(companyId, {
            ...claim,
            set: { status: 'pending', error: String(error || '').slice(0, 500), failure: failure || null, nextAttemptAt: runAt, workerId: null, claimedAt: null, leaseExpiresAt: null },
        });
    }
    return settleStep(companyId, {
        ...claim,
        set: {
            status: 'pending',
            error: null,
            failure: null,
            nextAttemptAt: runAt,
            workerId: null,
            claimedAt: null,
            leaseExpiresAt: null,
            waitUntil: waiting.until || runAt,
            waitReason: String(waiting.reason || 'waiting').slice(0, 500),
            ...(waiting.set || {}),
        },
        inc: { attempts: -1 },
    });
};

/* Handing a claim back untaken — the tenant is at its concurrency limit. The
 * attempt is given back too, because nothing ran. */
const releaseStep = async (companyId, claim) => {
    const released = await call(companyId, STEPS, [
        { runId: String(claim.runId), stepId: String(claim.stepId), status: 'running', fencingToken: Number(claim.fencingToken) },
        { $set: { status: 'pending', workerId: null, claimedAt: null, leaseExpiresAt: null, startedAt: null }, $inc: { attempts: -1 } },
    ], 'updateOne');
    return Boolean(released && released.matchedCount > 0);
};

const skipStep = (companyId, runId, stepId, reason) => call(companyId, STEPS, [
    { runId: String(runId), stepId: String(stepId), status: 'pending' },
    { $set: { status: 'skipped', error: String(reason || '').slice(0, 500), finishedAt: new Date() } },
], 'updateOne');

/* The per-tenant claim count. A query, not a counter in this process: two
 * workers on two nodes see the same number, which is the only way a limit that
 * says "per tenant" means anything. */
const countLiveClaims = (companyId, now = new Date()) => call(companyId, STEPS, [
    { status: 'running', leaseExpiresAt: { $gt: now } },
], 'countDocuments');

/* How many live claims were taken before this one. Ordering by (claimedAt, _id)
 * is total, so each claimant reaches the same verdict about itself and exactly
 * the ones past the limit stand down. */
const countClaimsAhead = (companyId, claimed, now = new Date()) => call(companyId, STEPS, [
    {
        status: 'running',
        leaseExpiresAt: { $gt: now },
        _id: { $ne: claimed._id },
        $or: [
            { claimedAt: { $lt: claimed.claimedAt } },
            { claimedAt: claimed.claimedAt, _id: { $lt: claimed._id } },
        ],
    },
], 'countDocuments');

/* Fan-out children are rows the definition never named, written while the run is
 * going. The fractional index keeps them between the step that expanded them and
 * the join that waits for them, which is the order a tick walks its ready set. */
const childRowsFor = (runId, parent, items, { type, config = {}, maxAttempts: attempts } = {}) => items.map((item, i) => ({
    runId: String(runId),
    stepId: `${parent.stepId}#${i + 1}`,
    index: Number(parent.index || 0) + ((i + 1) / (items.length + 1)),
    type: String(type),
    action: config.action ? String(config.action) : null,
    dependsOn: [String(parent.stepId)],
    config: { ...config, item, itemIndex: i },
    parentStepId: String(parent.stepId),
    childIndex: i,
    item: item !== null && typeof item === 'object' && !Array.isArray(item) ? item : { value: item },
    status: 'pending',
    attempts: 0,
    maxAttempts: Number(attempts) > 0 ? Number(attempts) : maxAttempts(),
    fencingToken: 0,
}));

/* Unordered, and a duplicate is tolerated: a step that expanded, died and was
 * claimed again writes the same child ids, and the unique index on
 * { runId, stepId } makes the second write a no-op rather than a twin. */
const addSteps = async (companyId, rows) => {
    if (!rows.length) return [];
    try {
        return await call(companyId, STEPS, [rows, { ordered: false }], 'insertMany');
    } catch (error) {
        if (isDuplicateKey(error)) return [];
        throw error;
    }
};

const listChildren = (companyId, runId, parentStepId) => call(companyId, STEPS, [
    { runId: String(runId), parentStepId: String(parentStepId) }, null, { sort: { childIndex: 1 } },
], 'find');

/* A loop iteration starts from steps that look untouched, or the ready set would
 * never offer them again. The attempt count goes back with them: each iteration
 * gets the retry budget the definition asked for, not what the last one left.
 *
 * `iteration` re-keys the action, and it has to: idempotency is keyed on the run,
 * the step and the action, and a loop is the one place where running the same
 * step again is the point rather than the bug. Without the iteration in the key,
 * the second pass of a body would find its own first pass applied and do
 * nothing. Written as a pipeline so the iteration replaces the last one rather
 * than accumulating on the end of the string. */
const iterationTag = (iteration) => ({
    $concat: [{ $arrayElemAt: [{ $split: [{ $ifNull: ['$action', ''] }, '#'] }, 0] }, '#', String(iteration)],
});

const resetSteps = async (companyId, runId, stepIds, { iteration = null } = {}) => {
    if (!stepIds.length) return 0;
    const result = await call(companyId, STEPS, [
        { runId: String(runId), stepId: { $in: stepIds.map(String) } },
        [{
            $set: {
                status: 'pending', attempts: 0, output: { $literal: {} }, error: null, failure: null,
                workerId: null, claimedAt: null, leaseExpiresAt: null, nextAttemptAt: null,
                startedAt: null, finishedAt: null, waitUntil: null, waitReason: null, waitingSince: null,
                ...(iteration === null ? {} : { action: iterationTag(iteration) }),
            },
        }],
    ], 'updateMany');
    return Number((result && result.modifiedCount) || 0);
};

/* What a decision does to the step that waited for it: take away its reason to
 * sleep, so the next tick claims it and the executor reads the decision itself. */
const wakeStep = async (companyId, runId, stepId) => {
    const woken = await call(companyId, STEPS, [
        { runId: String(runId), stepId: String(stepId), status: 'pending' },
        { $set: { nextAttemptAt: null, waitUntil: null } },
    ], 'updateOne');
    return Boolean(woken && woken.modifiedCount > 0);
};

/* The outputs as they are now, read from the step rows rather than from the run:
 * a condition or a loop asking what a step produced is usually asking about a
 * step that finished inside this same tick, which the run row does not yet know. */
const outputsOf = async (companyId, runId) => {
    const steps = await listSteps(companyId, runId);
    return steps.reduce((acc, step) => {
        if (step.status === 'success') acc[String(step.stepId)] = step.output || {};
        return acc;
    }, {});
};

module.exports = {
    RUNS, STEPS, TERMINAL, STEP_TERMINAL, StaleLeaseError, isDuplicateKey, stepRowsFor,
    createRun, getRun, patchRun, listSteps, getStep,
    claimStep, heartbeat, settleStep, succeedStep, failStep, deferStep, releaseStep, skipStep,
    childRowsFor, addSteps, listChildren, resetSteps, wakeStep, outputsOf,
    countLiveClaims, countClaimsAhead,
};
