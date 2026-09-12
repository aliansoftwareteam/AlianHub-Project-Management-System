const { MAX_DEPTH } = require('../../event/domainEventBus');
const { LOOP_DEPTH_EXCEEDED } = require('../Agents/runs');
const flag = require('./flag');

// What a run may still spend, how long it may still take, and how deep it has
// re-entered — read fresh before every hop.
//
// A run starts with a deadline and a budget. Each step takes its share and hands
// on what is left, so a chain cannot outlive or outspend the moment it began:
// the twentieth step of a run works against the same wall clock and the same
// dollar the first one did, minus what the nineteen before it used.
//
// A step that asks for more than remains is refused before it runs rather than
// clamped down to fit. Clamping looks kinder and is worse: a step given a tenth
// of the deadline it said it needs will usually fail part-way through, having
// spent the money and made half the changes. Refusing is the honest answer, and
// it is recorded on the run as `blocked` with the reason, not as a failure the
// step could have avoided.

const DEADLINE_EXCEEDED = 'deadline_exceeded';
const BUDGET_EXHAUSTED = 'budget_exhausted';

const clamp = (value) => Math.max(0, Number(value) || 0);

const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

const money = (usd) => `$${Number(usd).toFixed(2)}`;

const seconds = (ms) => `${Math.round(ms / 1000)}s`;

/* What one finished step cost. An agent run reports its spend; a step that costs
 * nothing reports nothing, and nothing is zero. Deliberately the same reading
 * `loop.js` does — a loop's budget and a run's are the same dollar. */
const costOf = (output) => {
    const spend = output && output.spend && typeof output.spend === 'object' ? Number(output.spend.usd) : NaN;
    const candidates = [Number(output && output.costUsd), Number(output && output.spendUsd), spend];
    return candidates.find((value) => Number.isFinite(value) && value >= 0) || 0;
};

/* How deeply nested each step is inside its own run.
 *
 * Re-entry is what the depth guard counts, and a workflow has two ways of
 * re-entering: a fan-out expands into children, and a loop repeats a body. Both
 * are one level below the step that opened them, and both nest — a loop body
 * containing a fan-out is two. Repetition is not depth: the twelfth iteration of
 * a loop is as deep as the first, because the iteration cap bounds that instead.
 */
const nestingOf = (steps = []) => {
    const opens = new Map();
    for (const step of steps) {
        const id = String(step.stepId);
        if (step.parentStepId) opens.set(id, String(step.parentStepId));
        const body = (step.config || {}).body;
        if (Array.isArray(body)) body.map(String).forEach((child) => { if (!opens.has(child)) opens.set(child, id); });
    }
    const below = (id, seen = new Set()) => {
        if (!opens.has(id) || seen.has(id)) return 0;
        seen.add(id);
        return 1 + below(opens.get(id), seen);
    };
    return new Map(steps.map((step) => [String(step.stepId), below(String(step.stepId))]));
};

/* The depth a step's agent hop starts at: what the run inherited from whatever
 * started it, plus how far inside the run this step sits. One counter — the one
 * `Modules/Agents/runs.canStart` already enforces against `MAX_DEPTH`. */
const depthOf = (run, steps, step) => clamp(run && run.depth) + (nestingOf(steps).get(String(step.stepId)) || 0);

/* The ceiling the workspace puts on a run, which a caller may ask for less than
 * and never more. Absent on either side means unbounded there, which is what
 * every run written before this existed is. */
const ceilingFor = ({ deadlineMs, budgetUsd } = {}) => {
    const wantedMs = [positive(deadlineMs), flag.runDeadlineMs()].filter((value) => value !== null);
    const wantedUsd = [positive(budgetUsd), flag.runBudgetUsd()].filter((value) => value !== null);
    return {
        deadlineAt: wantedMs.length ? new Date(Date.now() + Math.min(...wantedMs)) : null,
        budgetUsd: wantedUsd.length ? Math.min(...wantedUsd) : null,
    };
};

/* What is left of the run right now. Null on either side means that side was
 * never bounded. */
const remainingOf = (run, now = new Date()) => {
    const deadlineAt = run && run.deadlineAt ? new Date(run.deadlineAt) : null;
    const budgetUsd = positive(run && run.budgetUsd);
    return {
        deadlineAt,
        ms: deadlineAt ? deadlineAt.getTime() - now.getTime() : null,
        budgetUsd,
        spentUsd: clamp(run && run.spentUsd),
        usd: budgetUsd === null ? null : budgetUsd - clamp(run && run.spentUsd),
    };
};

const refusal = (code, reason) => ({ ok: false, code, reason });

/* May this step run, and with what?
 *
 * Three refusals, each named by the thing that ran out, and each decided before
 * the executor is reached: the point is that a chain is stopped at the hop
 * rather than half-way through a model call nobody can take back.
 */
const allow = (run, steps, step, now = new Date()) => {
    const config = (step && step.config) || {};
    const left = remainingOf(run, now);
    const depth = depthOf(run, steps, step);

    if (depth >= MAX_DEPTH) {
        return refusal(LOOP_DEPTH_EXCEEDED, `step ${step.stepId} is ${depth} levels of re-entry deep, and the guard stops at ${MAX_DEPTH}`);
    }

    if (left.ms !== null) {
        if (left.ms <= 0) return refusal(DEADLINE_EXCEEDED, `the run's deadline passed ${seconds(-left.ms)} ago, so step ${step.stepId} was not started`);
        const wanted = positive(config.deadlineMs);
        if (wanted !== null && wanted > left.ms) {
            return refusal(DEADLINE_EXCEEDED, `step ${step.stepId} asks for ${seconds(wanted)} and the run has ${seconds(left.ms)} left, so it was not started`);
        }
    }

    if (left.usd !== null) {
        if (left.usd <= 0) return refusal(BUDGET_EXHAUSTED, `the run's budget of ${money(left.budgetUsd)} is spent, so step ${step.stepId} was not started`);
        const wanted = positive(config.budgetUsd);
        if (wanted !== null && wanted > left.usd) {
            return refusal(BUDGET_EXHAUSTED, `step ${step.stepId} asks for ${money(wanted)} and the run has ${money(left.usd)} left, so it was not started`);
        }
    }

    // What the hop is handed: what it asked for when that is less than remains,
    // and the whole remainder when it named nothing of its own.
    const wantedMs = positive(config.deadlineMs);
    const wantedUsd = positive(config.budgetUsd);
    return {
        ok: true,
        depth,
        grant: {
            deadlineAt: left.ms === null
                ? (wantedMs === null ? null : new Date(now.getTime() + wantedMs))
                : new Date(now.getTime() + Math.min(wantedMs === null ? left.ms : wantedMs, left.ms)),
            budgetUsd: left.usd === null ? wantedUsd : Math.min(wantedUsd === null ? left.usd : wantedUsd, left.usd),
        },
    };
};

module.exports = {
    MAX_DEPTH, LOOP_DEPTH_EXCEEDED, DEADLINE_EXCEEDED, BUDGET_EXHAUSTED,
    costOf, nestingOf, depthOf, remainingOf, ceilingFor, allow,
};
