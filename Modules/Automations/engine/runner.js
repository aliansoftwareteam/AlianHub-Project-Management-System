const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { getAction } = require('./registry');
const { evaluate } = require('./expression');
const { render } = require('./template');
const { contextFor } = require('./matcher');

// Executes one rule against one event, and records what it did.
//
// Two properties matter more than speed here:
//
// 1. A restart mid-run must not replay completed steps. The runner writes
//    { cursor, outputs } after EVERY step, and a resumed run starts at the
//    cursor. These actions mutate real tasks; replaying step 1 because step 3
//    died means a second comment on someone's ticket.
//
// 2. The run log IS the product. Users trust automation exactly as far as they
//    can see what it did, so every step records its input, output, duration and
//    error whether it succeeded or not.

const LOG_PREFIX = '[automation-runner]';
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
const MAX_STEPS = 25;

const isDeterministic = (error) => error?.deterministic === true || error?.name === 'DeterministicError';

const patchRun = (companyId, runId, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AUTOMATION_RUNS,
    data: [{ _id: runId }, { $set: set }],
}, 'updateOne').catch((e) => logger.error(`${LOG_PREFIX} could not patch run ${runId}: ${e.message}`));

/* Create the run, or discover this event was already handled.
 *
 * The unique index on { ruleId, eventId } is what makes double delivery safe: the
 * second insert fails, we return null, and nothing runs twice. Doing this with a
 * find-then-insert would leave exactly the race the index closes. */
async function createRun(companyId, rule, envelope) {
    try {
        const run = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUTOMATION_RUNS,
            data: {
                ruleId: String(rule._id),
                ruleName: rule.name || '',
                eventId: envelope.id,
                eventType: envelope.type,
                entity: envelope.entity,
                envelope,
                status: 'queued',
                cursor: 0,
                attempts: 0,
                steps: [],
                outputs: {},
                startedAt: new Date(),
            },
        }, 'save');
        return run;
    } catch (error) {
        if (error && (error.code === 11000 || /duplicate key/i.test(error.message || ''))) {
            logger.info(`${LOG_PREFIX} duplicate event ${envelope.id} for rule ${rule._id} — dropped`);
            return null;
        }
        throw error;
    }
}

/* Steps are a flat list in phase 0; `branch` is deliberately absent until the
 * builder can express it, because a control-flow primitive nobody can author is
 * just untested code. `condition` can still stop a run early. */
async function executeStep(step, { companyId, envelope, outputs, context }) {
    const ctx = contextFor(envelope, outputs);

    if (step.type === 'condition') {
        const passed = evaluate(step.condition, ctx);
        return { output: { passed }, stop: !passed };
    }

    if (step.type !== 'action') {
        return { output: { skipped: `unknown step type "${step.type}"` } };
    }

    const action = getAction(step.action);
    if (!action) {
        const err = new Error(`unknown action "${step.action}"`);
        err.deterministic = true;
        throw err;
    }

    const config = render(step.config || {}, ctx);
    const output = await action.run({ companyId, entity: envelope.entity, config, context: { ...context, task: envelope.data } });
    return { output };
}

async function runOnce(companyId, run, rule, envelope) {
    const steps = Array.isArray(rule.steps) ? rule.steps.slice(0, MAX_STEPS) : [];
    const outputs = { ...(run.outputs || {}) };
    const recorded = Array.isArray(run.steps) ? run.steps.slice() : [];
    const context = { runId: String(run._id), ruleId: String(rule._id), ruleName: rule.name, depth: envelope.depth };

    // Resume point. Everything before the cursor already ran and already mutated.
    for (let i = Number(run.cursor) || 0; i < steps.length; i++) {
        const step = steps[i];
        const startedAt = Date.now();
        try {
            const { output, stop } = await executeStep(step, { companyId, envelope, outputs, context });
            if (step.id) outputs[step.id] = output;
            recorded[i] = { id: step.id || `s${i + 1}`, type: step.type, action: step.action || null, output, durationMs: Date.now() - startedAt };

            await patchRun(companyId, run._id, { cursor: i + 1, outputs, steps: recorded, status: 'running' });

            if (stop) {
                await patchRun(companyId, run._id, { status: 'stopped', finishedAt: new Date() });
                return { status: 'stopped' };
            }
        } catch (error) {
            recorded[i] = {
                id: step.id || `s${i + 1}`, type: step.type, action: step.action || null,
                error: String(error.message || error).slice(0, 500),
                deterministic: isDeterministic(error),
                durationMs: Date.now() - startedAt,
            };
            await patchRun(companyId, run._id, { steps: recorded, outputs });
            throw error;
        }
    }

    await patchRun(companyId, run._id, { status: 'success', finishedAt: new Date(), outputs, steps: recorded });
    return { status: 'success' };
}

/* Retry policy. Transient failures — a dropped connection, a 5xx, a Mongo
 * timeout — are worth backing off and retrying. Deterministic ones (no such
 * status, no such task, unknown action) will fail identically forever, so
 * retrying them just multiplies the cost of a broken rule by three. */
async function execute({ companyId, runId, ruleId, enqueue }) {
    const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RUNS, data: [{ _id: runId }] }, 'findOne');
    if (!run || !run._id) { logger.error(`${LOG_PREFIX} run ${runId} vanished`); return { status: 'missing' }; }
    if (run.status === 'success' || run.status === 'failed' || run.status === 'stopped') return { status: run.status };

    const rule = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id: ruleId || run.ruleId }] }, 'findOne');
    if (!rule || !rule._id) {
        await patchRun(companyId, runId, { status: 'failed', error: 'rule no longer exists', finishedAt: new Date() });
        return { status: 'failed' };
    }

    const attempts = (Number(run.attempts) || 0) + 1;
    await patchRun(companyId, runId, { attempts, status: 'running' });

    try {
        return await runOnce(companyId, run, rule, run.envelope || {});
    } catch (error) {
        const message = String(error.message || error).slice(0, 500);
        const permanent = isDeterministic(error) || attempts >= MAX_ATTEMPTS;
        if (permanent) {
            await patchRun(companyId, runId, { status: 'failed', error: message, finishedAt: new Date() });
            logger.error(`${LOG_PREFIX} run ${runId} failed permanently: ${message}`);
            return { status: 'failed', error: message };
        }
        const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
        await patchRun(companyId, runId, { status: 'retrying', error: message });
        if (typeof enqueue === 'function') {
            await enqueue({ companyId, runId: String(runId), ruleId: String(rule._id) }, { runAt: new Date(Date.now() + delay) });
        }
        logger.info(`${LOG_PREFIX} run ${runId} retrying in ${delay}ms (attempt ${attempts}): ${message}`);
        return { status: 'retrying', error: message };
    }
}

module.exports = { createRun, execute, runOnce, executeStep, MAX_ATTEMPTS, BACKOFF_MS, isDeterministic };
