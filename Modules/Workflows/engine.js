const crypto = require('node:crypto');
const logger = require('../../Config/loggerConfig');
const telemetry = require('../../Config/telemetry');
const store = require('./store');
const scheduler = require('./scheduler');
const executors = require('./executors');
const concurrency = require('./concurrency');
const idempotency = require('./idempotency');
const retry = require('./retry');
const agentRunner = require('./agentRun');
const hop = require('./hop');
const typed = require('./typed');
const { leaseMs, heartbeatMs } = require('./flag');

// The engine: check the step may run at all, claim it, hold it under a lease,
// run it once, check what it produced, record it, and decide whether a failure
// comes back.
//
// Four gates stand between a ready step and its executor, and all four are shut
// before anything is spent: the input it reads must match what its producers
// declared, the run must have deadline left, it must have budget left, and the
// step must not be past the re-entry depth guard. The first is a contract
// mismatch and fails that step; the other three are the run running out, and
// block the whole run — nothing after it could do better.
//
// Everything durable lives on the two collections; nothing about a run is held
// in this process between ticks. That is what makes a run resumable — a tick
// after a restart reads the same rows and carries on from the ready set.

const LOG_PREFIX = '[workflow-engine]';
const CAPACITY_RETRY_MS = 5000;
const WORKER_ID = `${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

const stepActor = (run) => ({
    kind: 'agent',
    userId: run.startedBy || '',
    agentId: null,
    agentName: run.name || run.ruleName || 'Workflow',
    viaAccount: 'workspace',
    traceId: run.traceId || null,
});

/* Renews the lease while a slow step runs. A false answer means the lease was
 * taken; the executor is told so it can stop, and the settle would refuse the
 * write anyway. */
const startHeartbeat = (companyId, claim, lost) => {
    const every = heartbeatMs();
    const timer = setInterval(async () => {
        try {
            const held = await store.heartbeat(companyId, claim);
            if (!held) {
                lost.value = true;
                clearInterval(timer);
                logger.warn(`${LOG_PREFIX} ${claim.runId}/${claim.stepId}: lease lost while the step was still running`);
            }
        } catch (error) {
            logger.error(`${LOG_PREFIX} ${claim.runId}/${claim.stepId}: heartbeat failed: ${error.message}`);
        }
    }, every);
    if (timer.unref) timer.unref();
    return () => clearInterval(timer);
};

const claimOf = (step) => ({ runId: String(step.runId), stepId: String(step.stepId), fencingToken: Number(step.fencingToken) });

/* Fail a step that never ran, which needs a claim of its own to write under. */
const failUnclaimed = async (companyId, run, pending, { workerId, error, code }) => {
    await store.claimStep(companyId, { runId: run._id, stepId: pending.stepId, workerId });
    const claimed = await store.getStep(companyId, run._id, pending.stepId);
    if (!claimed) return false;
    await store.failStep(companyId, claimOf(claimed), {
        error,
        failure: { type: 'deterministic', code, deterministic: true },
    });
    return true;
};

/* One step, start to finish. Returns what the tick should do next. */
const runStep = async (companyId, run, pending, { workerId = WORKER_ID, context = {}, steps = [] } = {}) => {
    const executor = executors.get(pending.type);
    if (!executor) {
        await failUnclaimed(companyId, run, pending, { workerId, error: `no executor is registered for step type "${pending.type}"`, code: 'unknown_step_type' });
        return { outcome: 'failed' };
    }

    // The inbound edge. A step that reads a field its producer does not have is
    // stopped here rather than reading undefined somewhere downstream, where the
    // symptom would be a branch that is quietly always false.
    const inputs = typed.checkInputs(pending, steps);
    if (!inputs.valid) {
        const error = `step ${pending.stepId} (${pending.type}) cannot be given its input: ${inputs.errors.join('; ')}`;
        await failUnclaimed(companyId, run, pending, { workerId, error, code: 'contract_mismatch' });
        logger.error(`${LOG_PREFIX} ${run._id}/${pending.stepId}: ${error}`);
        return { outcome: 'failed', reason: error };
    }

    // What the run has left, against what this hop needs. Refused before the
    // claim, so a chain that cannot finish has not started a model call it will
    // have to abandon.
    const permit = hop.allow(run, steps, pending);
    if (!permit.ok) {
        await failUnclaimed(companyId, run, pending, { workerId, error: permit.reason, code: permit.code });
        logger.warn(`${LOG_PREFIX} ${run._id}/${pending.stepId} refused (${permit.code}): ${permit.reason}`);
        return { outcome: 'blocked', code: permit.code, reason: permit.reason, stepId: String(pending.stepId) };
    }

    const capacity = await concurrency.atCapacity(companyId);
    if (capacity.full) return { outcome: 'deferred', retryInMs: CAPACITY_RETRY_MS, reason: `tenant concurrency ${capacity.live}/${capacity.limit}` };

    const claimed = await store.claimStep(companyId, { runId: run._id, stepId: pending.stepId, workerId, lease: leaseMs() });
    if (!claimed) return { outcome: 'taken' };

    if (!(await concurrency.admit(companyId, claimed))) {
        return { outcome: 'deferred', retryInMs: CAPACITY_RETRY_MS, reason: 'tenant concurrency' };
    }

    const claim = claimOf(claimed);
    // What this hop was given out of what the run had left, on the row before it
    // runs: the answer to "why did this step only get ninety seconds" has to
    // outlive the tick that decided it.
    await store.noteStep(companyId, claim, { deadlineAt: permit.grant.deadlineAt, budgetUsd: permit.grant.budgetUsd, depth: permit.depth });
    const lost = { value: false };
    const stopHeartbeat = startHeartbeat(companyId, claim, lost);
    const key = idempotency.keyFor({ runId: run._id, stepId: claimed.stepId, action: claimed.action });

    try {
        const attributes = { 'workflow.run.id': String(run._id), 'workflow.step.id': claimed.stepId, 'workflow.step.type': claimed.type, 'tenant.id': String(companyId) };
        const result = await telemetry.withTrace(run.traceId || null, () => telemetry.withSpan(`workflow.step ${claimed.type}`, attributes, () => idempotency.once(
            companyId,
            {
                key,
                actor: stepActor(run),
                entry: {
                    action: `workflow.${claimed.type}`,
                    reason: run.ruleName || run.name || '',
                    entityType: 'workflow_run',
                    entityId: String(run._id),
                    entityName: claimed.stepId,
                    params: { stepId: claimed.stepId, type: claimed.type, action: claimed.action || null },
                },
            },
            () => executor({
                companyId,
                run,
                step: claimed,
                claim,
                // The agent runner comes from here rather than from every caller of
                // tick: a step type asks for `context.runAgent` and gets one.
                context: {
                    ...agentRunner.contextFor(companyId, claim),
                    ...context,
                    // What is left after this hop takes its share — the executor
                    // passes it on rather than inventing a budget of its own.
                    deadlineAt: permit.grant.deadlineAt,
                    budgetUsd: permit.grant.budgetUsd,
                    depth: permit.depth,
                    keepAlive: () => store.heartbeat(companyId, claim),
                    leaseLost: () => lost.value,
                },
            }),
        )));
        // A replay has no output of its own; the one the first attempt recorded stands.
        const output = result.output || claimed.output || {};
        // The outbound edge, before the output is written and therefore before
        // anything can read it.
        typed.assertOutput(claimed, output);
        const costUsd = hop.costOf(output);
        await store.succeedStep(companyId, claim, { output, auditId: result.auditId, replayed: result.replayed, costUsd });
        if (costUsd > 0) await store.spendOnRun(companyId, run._id, costUsd);
        return { outcome: 'success', replayed: result.replayed, output, costUsd };
    } catch (error) {
        if (error instanceof store.StaleLeaseError) throw error;
        const decision = retry.decide(error, { attempt: Number(claimed.attempts) || 1, maxAttempts: Number(claimed.maxAttempts) || 3 });
        const message = String(error.message || error).slice(0, 500);
        const failure = { ...decision.failure, deterministic: decision.failure.deterministic };
        if (!decision.retry) {
            await store.failStep(companyId, claim, { error: message, failure });
            logger.error(`${LOG_PREFIX} ${run._id}/${claimed.stepId} failed (${decision.reason}): ${message}`);
            return { outcome: 'failed', reason: decision.reason };
        }
        const runAt = new Date(Date.now() + decision.delayMs);
        await store.deferStep(companyId, claim, { error: message, failure, runAt });
        logger.info(`${LOG_PREFIX} ${run._id}/${claimed.stepId} retrying in ${decision.delayMs}ms (attempt ${claimed.attempts}): ${message}`);
        return { outcome: 'retrying', retryInMs: decision.delayMs, reason: message };
    } finally {
        stopHeartbeat();
    }
};

const skipBlocked = async (companyId, runId, steps) => {
    for (const { step, blockers } of scheduler.blockedSet(steps)) {
        const reason = blockers.map(({ id, dependency }) => `${id} is ${dependency ? dependency.status : 'not a step of this run'}`).join(', ');
        // eslint-disable-next-line no-await-in-loop
        await store.skipStep(companyId, runId, step.stepId, `skipped: ${reason}`);
    }
};

const finish = async (companyId, run, steps, blocked = null) => {
    // A blocked run has a verdict of its own and it outranks whatever the step
    // rows add up to: the steps behind the refused hop are skipped, which would
    // otherwise read as an ordinary failure and hide the reason.
    if (blocked) {
        await store.blockRun(companyId, run._id, blocked);
        return 'blocked';
    }
    const status = scheduler.runStatus(steps);
    if (!status) return null;
    const failed = steps.find((step) => step.status === 'failed');
    await store.patchRun(companyId, run._id, {
        status,
        finishedAt: new Date(),
        ...(failed ? { error: failed.error || 'a step failed' } : {}),
    });
    return status;
};

/* Drives one run as far as it can go right now: the ready set, then whatever
 * that unblocked, until nothing is ready. A step that asked to come back later
 * schedules one more job for itself and nothing else. */
const tick = async (companyId, runId, { enqueue = null, workerId = WORKER_ID, context = {}, maxSteps = 50 } = {}) => {
    const run = await store.getRun(companyId, runId);
    if (!run || !run._id) { logger.error(`${LOG_PREFIX} workflow run ${runId} vanished`); return { status: 'missing' }; }
    if (store.TERMINAL.includes(run.status)) return { status: run.status };

    if (run.status === 'queued') await store.patchRun(companyId, run._id, { status: 'running' });

    const outputs = { ...(run.outputs || {}) };
    let retryInMs = null;
    let executed = 0;
    let spent = 0;
    let blocked = null;

    for (let guard = 0; guard < maxSteps; guard++) {
        // eslint-disable-next-line no-await-in-loop
        const steps = await store.listSteps(companyId, run._id);
        // eslint-disable-next-line no-await-in-loop
        await skipBlocked(companyId, run._id, steps);
        const ready = scheduler.readySet(steps);
        if (!ready.length) break;
        // The budget the last step took, so the next hop of this same tick is
        // measured against what is actually left rather than against the run row
        // as it was read before any of them ran.
        run.spentUsd = Number(run.spentUsd || 0) + spent;
        spent = 0;

        // eslint-disable-next-line no-await-in-loop
        const result = await runStep(companyId, run, ready[0], { workerId, context, steps });
        if (result.outcome === 'success') {
            outputs[ready[0].stepId] = result.output;
            spent += result.costUsd || 0;
            executed += 1;
        }
        if (result.outcome === 'blocked') {
            blocked = { code: result.code, reason: result.reason, stepId: result.stepId };
            break;
        }
        if (result.outcome === 'deferred' || result.outcome === 'retrying') {
            retryInMs = result.retryInMs;
            break;
        }
        if (result.outcome === 'taken') break;
    }

    const steps = await store.listSteps(companyId, run._id);
    await skipBlocked(companyId, run._id, steps);
    const settled = await store.listSteps(companyId, run._id);
    await store.patchRun(companyId, run._id, { outputs });
    const status = await finish(companyId, run, settled, blocked);

    if (!status && retryInMs !== null && typeof enqueue === 'function') {
        await enqueue({ companyId: String(companyId), workflowRunId: String(run._id), runId: run.automationRunId || null, ruleId: run.ruleId || null }, { runAt: new Date(Date.now() + retryInMs) });
    }

    return { status: status || 'running', executed, retryInMs, ...(blocked ? { blocked } : {}) };
};

module.exports = { tick, runStep, finish, skipBlocked, failUnclaimed, WORKER_ID, CAPACITY_RETRY_MS, stepActor };
