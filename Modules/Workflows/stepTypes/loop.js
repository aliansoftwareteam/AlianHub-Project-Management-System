const executors = require('../executors');
const store = require('../store');
const flag = require('../flag');
const { evaluate } = require('../../Automations/engine/expression');
const { waitFor } = require('./waiting');
const { num, ids, deterministic, contextFor } = require('./graph');

// A loop as bounded re-entry, which is how a monitoring cycle is expressed
// without an unbounded graph.
//
// Config: { body, maxIterations, budgetUsd, while, pollMs }
// Output: { iterations, stoppedBy, budgetUsedUsd }
//
// The loop step sits behind its body — it depends on the body's last step — and
// every time the body finishes it decides whether there is another iteration in
// the bounds. If there is, it puts the body back to pending and waits; if there
// is not, it succeeds, and whatever depends on the loop finally runs.
//
// Three bounds, checked in this order, and the run records which one stopped it:
// the iteration cap, the spend the body has taken, and the loop's own condition.
// The cap is not only the definition's: WORKFLOW_MAX_LOOP_ITERATIONS is a
// ceiling a definition can ask for less than and never more, because the whole
// point of expressing a cycle this way is that it cannot run away.

const TYPE = 'loop';

const RUNNING = Object.freeze(['pending', 'running']);
const BROKEN = Object.freeze(['failed', 'stopped', 'skipped']);

/* What one pass of the body cost. An agent run reports its spend; a step that
 * costs nothing reports nothing, and nothing is zero. */
const costOf = (output = {}) => {
    const spend = output.spend && typeof output.spend === 'object' ? Number(output.spend.usd) : NaN;
    const candidates = [Number(output.costUsd), Number(output.spendUsd), spend];
    return candidates.find((value) => Number.isFinite(value) && value >= 0) || 0;
};

const execute = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const body = ids(config.body);
    if (!body.length) throw deterministic(`loop ${step.stepId}: needs a "body" of step ids`);

    const steps = await store.listSteps(companyId, run._id);
    const rows = steps.filter((row) => body.includes(String(row.stepId)));
    if (rows.length !== body.length) {
        const known = new Set(rows.map((row) => String(row.stepId)));
        throw deterministic(`loop ${step.stepId}: no step ${body.filter((id) => !known.has(id)).join(', ')} in this run`);
    }

    const iteration = num(step.iteration, 1);
    const inFlight = rows.filter((row) => RUNNING.includes(row.status));
    if (inFlight.length) {
        return waitFor(`iteration ${iteration}: ${inFlight.length} of ${rows.length} body steps still running`, num(config.pollMs, flag.joinPollMs()));
    }

    const spent = Number(step.budgetUsedUsd || 0) + rows.reduce((total, row) => total + costOf(row.output || {}), 0);
    const cap = Math.min(num(config.maxIterations, flag.maxLoopIterations()), flag.maxLoopIterations());
    const budget = Number(config.budgetUsd) > 0 ? Number(config.budgetUsd) : null;

    const broken = rows.filter((row) => BROKEN.includes(row.status));
    const outputs = await store.outputsOf(companyId, run._id);
    const stoppedBy = (() => {
        if (broken.length) return 'body_failed';
        if (iteration >= cap) return 'iteration_cap';
        if (budget !== null && spent >= budget) return 'budget';
        if (config.while && !evaluate(config.while, contextFor(run, outputs))) return 'condition';
        return null;
    })();

    if (stoppedBy) return { iterations: iteration, stoppedBy, budgetUsedUsd: spent, cap, budgetUsd: budget };

    const next = iteration + 1;
    await store.resetSteps(companyId, run._id, body, { iteration: next });
    return waitFor(`iteration ${next} of at most ${cap}`, num(config.pollMs, flag.joinPollMs()), { set: { iteration: next, budgetUsedUsd: spent } });
};

executors.register(TYPE, execute);

module.exports = { TYPE, execute, costOf };
