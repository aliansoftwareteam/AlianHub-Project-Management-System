const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { leaseMs, maxAttempts } = require('./flag');
const hop = require('./hop');

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

/* `blocked` is terminal on purpose: a run that ran out of deadline, of budget
 * or of depth cannot become runnable again by waiting, so a later tick has to
 * stop at the door rather than pick the next step up. */
const TERMINAL = Object.freeze(['success', 'failed', 'stopped', 'blocked']);
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
const createRun = async (companyId, { workflowId, name, source, dedupeKey, ruleId, ruleName, automationRunId, eventId, eventType, entity, envelope, traceId, startedBy, agentId, taskId, projectId, steps, depth, deadlineMs, budgetUsd }) => {
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
            agentId: agentId ? String(agentId) : null,
            taskId: taskId ? String(taskId) : null,
            projectId: projectId ? String(projectId) : null,
            status: 'queued',
            definition: { steps },
            outputs: {},
            // The two the chain spends down and the depth it starts at. Fixed at
            // the start, because a deadline a run can extend is not a deadline.
            ...hop.ceilingFor({ deadlineMs, budgetUsd }),
            spentUsd: 0,
            depth: Math.max(0, Number(depth) || 0),
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

const findRunByDedupeKey = (companyId, dedupeKey) => call(companyId, RUNS, [{ dedupeKey: String(dedupeKey) }], 'findOne');

const LIST_LIMIT = 200;

const listRuns = (companyId, { status, source, agentId, workflowId, limit = 50 } = {}) => call(companyId, RUNS, [
    {
        ...(status ? { status: String(status) } : {}),
        ...(source ? { source: String(source) } : {}),
        ...(agentId ? { agentId: String(agentId) } : {}),
        ...(workflowId ? { workflowId: String(workflowId) } : {}),
    },
    {},
    { sort: { startedAt: -1 }, limit: Math.min(LIST_LIMIT, Math.max(1, Number(limit) || 50)) },
], 'find');

const patchRun = (companyId, runId, set) => call(companyId, RUNS, [{ _id: String(runId) }, { $set: set }], 'updateOne');

/* What a finished step took out of the run's budget, added where every worker
 * sees it. An $inc rather than a read-modify-write, because two steps of the
 * same run finish on two workers and the budget they share has to be the sum of
 * what both of them spent, not whichever wrote last. */
const spendOnRun = async (companyId, runId, usd) => {
    const amount = Number(usd);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return call(companyId, RUNS, [{ _id: String(runId) }, { $inc: { spentUsd: amount } }, { returnDocument: 'after' }], 'findOneAndUpdate');
};

/* A run that ran out of deadline, budget or depth. Terminal, and it carries the
 * hop that was refused, because "blocked" without the step is not a reason. */
const blockRun = (companyId, runId, { code, reason, stepId }) => call(companyId, RUNS, [
    { _id: String(runId) },
    { $set: { status: 'blocked', finishedAt: new Date(), error: String(reason || '').slice(0, 500), blocked: { code: String(code), reason: String(reason || '').slice(0, 500), stepId: String(stepId), at: new Date() } } },
], 'updateOne');

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

/* What a step learnt before it finished — the agent run it started, above all.
 * Recorded under the same fence, and best-effort: a note that cannot be written
 * because the lease moved on must not fail the work the step is doing. */
const noteStep = async (companyId, claim, set) => {
    try {
        await settleStep(companyId, { ...claim, set });
        return true;
    } catch (error) {
        if (error instanceof StaleLeaseError) return false;
        throw error;
    }
};

const DONE_WAITING = { waitUntil: null, waitReason: null };

const succeedStep = (companyId, claim, { output, auditId, replayed, costUsd = 0 }) => settleStep(companyId, {
    ...claim,
    set: { status: 'success', output: output || {}, error: null, failure: null, auditId: auditId || null, replayed: Boolean(replayed), costUsd: Math.max(0, Number(costUsd) || 0), finishedAt: new Date(), leaseExpiresAt: null, ...DONE_WAITING },
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

/* The operator controls, as one conditional write each.
 *
 * The status filter is the permission: retry only applies to a step that has
 * finished badly, skip only to one that has not succeeded, resume only to one
 * that is failed or holding a claim nobody is working. A step in the wrong state
 * matches nothing and the caller is told so, rather than a live step being
 * yanked out from under the worker running it.
 *
 * Every one of them bumps the fencing token, because the worker whose attempt
 * this control is overriding may still be alive: with a new token its late write
 * matches nothing and is refused, exactly as a lapsed lease is. */
const control = async (companyId, runId, stepId, { from, set, unset }) => call(companyId, STEPS, [
    { runId: String(runId), stepId: String(stepId), status: { $in: from } },
    { $set: set, $inc: { fencingToken: 1 }, ...(unset ? { $unset: unset } : {}) },
    { returnDocument: 'after' },
], 'findOneAndUpdate');

const CLEARED = Object.freeze({ workerId: null, claimedAt: null, leaseExpiresAt: null, nextAttemptAt: null, finishedAt: null });

const controlEntry = (action, by, reason) => ({ action, by: by ? String(by) : null, at: new Date(), reason: String(reason || '').slice(0, 500) });

/* A fresh attempt budget: the person asking for a retry is saying the reason it
 * failed is gone, which is a different claim from "try the ladder again". */
const retryStep = (companyId, runId, stepId, { by, reason } = {}) => control(companyId, runId, stepId, {
    from: ['failed', 'skipped'],
    set: { ...CLEARED, status: 'pending', attempts: 0, error: null, failure: null, skippedBy: null, startedAt: null, control: controlEntry('retry', by, reason) },
});

/* An operator skip carries who asked for it, and that is what lets the steps
 * behind it run: a step skipped because its dependency failed blocks its own
 * dependents, and a step a person skipped does not. */
const operatorSkipStep = (companyId, runId, stepId, { by, reason } = {}) => control(companyId, runId, stepId, {
    from: ['pending', 'failed'],
    set: { status: 'skipped', skippedBy: by ? String(by) : null, error: String(reason || 'skipped by a person').slice(0, 500), finishedAt: new Date(), leaseExpiresAt: null, workerId: null, control: controlEntry('skip', by, reason) },
});

/* Resume keeps the attempts already spent: it is "carry on from here", not "start
 * again". A running step is included because a worker that died holding the claim
 * leaves one, and the bumped token is what makes taking it back safe. */
const resumeStep = (companyId, runId, stepId, { by, reason } = {}) => control(companyId, runId, stepId, {
    from: ['failed', 'running'],
    set: { ...CLEARED, status: 'pending', error: null, control: controlEntry('resume', by, reason) },
});

const recordCompensation = (companyId, runId, stepId, compensation) => call(companyId, STEPS, [
    { runId: String(runId), stepId: String(stepId) },
    { $set: { compensation: { ...compensation, at: new Date() } } },
    { returnDocument: 'after' },
], 'findOneAndUpdate');

/* A run a control has touched is open again: it has work to do, and its verdict,
 * its error and whatever it was blocked on belong to the attempt the control
 * just replaced — so a person who extends a deadline and retries is not refused
 * by the record of the refusal. */
const reopenRun = (companyId, runId) => call(companyId, RUNS, [
    { _id: String(runId) },
    { $set: { status: 'running', finishedAt: null, error: null, blocked: null } },
], 'updateOne');

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
    createRun, getRun, findRunByDedupeKey, listRuns, patchRun, spendOnRun, blockRun, listSteps, getStep,
    retryStep, operatorSkipStep, resumeStep, recordCompensation, reopenRun,
    claimStep, heartbeat, settleStep, noteStep, succeedStep, failStep, deferStep, releaseStep, skipStep,
    childRowsFor, addSteps, listChildren, resetSteps, wakeStep, outputsOf,
    countLiveClaims, countClaimsAhead,
};
