// Reading a workflow run the way a person needs it: what the graph looks like,
// what a step cost, what went wrong and which control is honest about fixing it.
//
// Every function here is pure so the view stays a template and the rules stay
// testable — the API shapes are Modules/Workflows/store.js and its step types.

export const STEP_TYPES = Object.freeze([
    "agent_run", "tool_call", "human_approval", "fan_out", "fan_in",
    "condition", "wait", "timer", "loop", "automation_rule"
]);

export const STEP_STATUSES = Object.freeze(["pending", "running", "success", "failed", "skipped", "stopped"]);

export const RUN_STATUSES = Object.freeze(["queued", "running", "success", "failed", "stopped", "blocked"]);

export const BLOCK_CODES = Object.freeze([
    "deadline_exceeded", "budget_exhausted", "loop_depth_exceeded",
    "unknown_step_type", "contract_mismatch", "run_limit"
]);

export const LOOP_STOPS = Object.freeze(["iteration_cap", "budget", "condition", "body_failed", "run_limit"]);

const known = (list, value, fallback) => (list.includes(String(value)) ? String(value) : fallback);

export const stepTypeOf = (step) => known(STEP_TYPES, step?.type, "unknown");
export const stepStatusOf = (step) => known(STEP_STATUSES, step?.status, "pending");
export const runStatusOf = (run) => known(RUN_STATUSES, run?.status, "queued");

/* The same reading Modules/Workflows/hop.js does: an agent run reports its
 * spend, a step that costs nothing reports nothing, and nothing is zero. */
export const costOf = (output) => {
    const spend = output && typeof output.spend === "object" ? Number(output.spend?.usd) : NaN;
    const found = [Number(output?.costUsd), Number(output?.spendUsd), spend].find((n) => Number.isFinite(n) && n >= 0);
    return found === undefined ? 0 : found;
};

export const stepCostOf = (step) => costOf(step?.output);

export const durationMsOf = (step, now = Date.now()) => {
    const start = step?.startedAt ? new Date(step.startedAt).getTime() : NaN;
    if (!Number.isFinite(start)) return null;
    const end = step?.finishedAt ? new Date(step.finishedAt).getTime() : now;
    return Math.max(0, end - start);
};

const SETTLED = ["success", "failed", "skipped", "stopped"];

export const tallyOf = (steps = []) => steps.reduce((out, step) => {
    const status = stepStatusOf(step);
    out[status] += 1;
    out.total += 1;
    if (SETTLED.includes(status)) out.settled += 1;
    return out;
}, { total: 0, settled: 0, pending: 0, running: 0, success: 0, failed: 0, skipped: 0, stopped: 0 });

const WORTH_SHOWING = ["failed", "running"];

/* A fan-out of fifty is one node with a tally, not fifty boxes. The children
 * that earn a row without being asked for are the ones a person can act on — a
 * failure to recover and a child still working — and the rest stay behind
 * "show all", so a definition at the fan bound cannot make the page unusable
 * just by expanding. */
export const CHILD_PREVIEW = 5;

export const groupSteps = (steps = [], { expanded = [] } = {}) => {
    const rows = [...steps].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    const children = new Map();
    rows.filter((step) => step.parentStepId).forEach((step) => {
        const key = String(step.parentStepId);
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(step);
    });
    return rows.filter((step) => !step.parentStepId).map((step) => {
        const own = children.get(String(step.stepId)) || [];
        const open = expanded.includes(String(step.stepId));
        const notable = own.filter((child) => WORTH_SHOWING.includes(stepStatusOf(child)));
        const shown = open ? own : notable.slice(0, CHILD_PREVIEW);
        return {
            step,
            children: own,
            shown,
            hidden: own.length - shown.length,
            expandable: own.length > shown.length || (open && own.length > 0),
            expanded: open,
            tally: own.length ? tallyOf(own) : null
        };
    });
};

export const isDeterministic = (step) => step?.failure?.deterministic === true;

/* The one control that applies.
 *
 * A deterministic failure will fail the same way on the next attempt, so
 * offering retry would be offering a button that cannot work: the way past it
 * is to skip the step. A transient one is what retry is for. A step holding a
 * claim whose lease has lapsed is neither — nobody is working it, and resume is
 * what takes it back. */
export const recoveryControlOf = (step, now = Date.now()) => {
    const status = stepStatusOf(step);
    if (status === "failed") return isDeterministic(step) ? "skip" : "retry";
    if (status === "running") {
        const lease = step?.leaseExpiresAt ? new Date(step.leaseExpiresAt).getTime() : NaN;
        return Number.isFinite(lease) && lease <= now ? "resume" : null;
    }
    return null;
};

export const agentRunIdOf = (step) => String(step?.output?.agentRunId || step?.config?.agentRunId || "") || null;

/* Compensating undoes what a step already did, which is a different question
 * from how it failed — so it stands apart from the recovery control, wherever
 * there is an agent run to revert and no revert already recorded. */
export const canCompensate = (step) => stepTypeOf(step) === "agent_run" && Boolean(agentRunIdOf(step)) && !step?.compensation;

export const attemptsOf = (step) => ({
    attempts: Math.max(0, Number(step?.attempts) || 0),
    maxAttempts: Math.max(1, Number(step?.maxAttempts) || 1)
});

/* What the engine waits out before it looks at this step again: the moment the
 * row already carries, or the backoff the classifier asked for. */
export const backoffOf = (step, now = Date.now()) => {
    const at = step?.nextAttemptAt ? new Date(step.nextAttemptAt).getTime() : NaN;
    const asked = Number(step?.failure?.retryAfterMs);
    const ms = Number.isFinite(at) ? Math.max(0, at - now) : (Number.isFinite(asked) && asked > 0 ? asked : null);
    return ms === null ? null : { ms, at: Number.isFinite(at) ? new Date(at) : null };
};

export const failureOf = (step, now = Date.now()) => {
    if (stepStatusOf(step) !== "failed") return null;
    const failure = step.failure || {};
    const deterministic = failure.deterministic === true;
    return {
        message: String(step.error || failure.message || ""),
        code: failure.code ? String(failure.code) : "",
        deterministic,
        ...attemptsOf(step),
        backoff: deterministic ? null : backoffOf(step, now),
        control: recoveryControlOf(step, now),
        compensable: canCompensate(step)
    };
};

const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

/* A loop's counters, whether it is still going round or has stopped. A running
 * loop carries them on the row it defers against; a finished one carries them
 * in the output it settled with. */
export const loopStateOf = (step) => {
    if (stepTypeOf(step) !== "loop") return null;
    const output = step.output || {};
    const config = step.config || {};
    const status = stepStatusOf(step);
    const running = !SETTLED.includes(status);
    return {
        running,
        iterations: Math.max(1, Number(output.iterations ?? step.iteration) || 1),
        cap: positive(output.cap) || positive(config.maxIterations),
        budgetUsedUsd: Math.max(0, Number(output.budgetUsedUsd ?? step.budgetUsedUsd) || 0),
        budgetUsd: positive(output.budgetUsd) || positive(config.budgetUsd),
        stoppedBy: known(LOOP_STOPS, output.stoppedBy, null),
        runLimit: output.runLimit || null,
        stoppable: running && status === "pending"
    };
};

/* Why a run is not moving. A terminal `blocked` is the run's own record — it ran
 * out of deadline, of budget or of depth and cannot become runnable by waiting.
 * Anything else is a step waiting on a person, a timer or its children, and the
 * reason to show is the first one in step order: naming five tells nobody more. */
export const blockedOf = (run, steps = []) => {
    if (runStatusOf(run) === "blocked" && run?.blocked) {
        return {
            terminal: true,
            code: known(BLOCK_CODES, run.blocked.code, "unknown"),
            reason: String(run.blocked.reason || run.error || ""),
            stepId: String(run.blocked.stepId || ""),
            at: run.blocked.at || null
        };
    }
    const waiting = steps
        .filter((step) => stepStatusOf(step) === "pending" && step.waitReason)
        .sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    if (!waiting.length) return null;
    const first = waiting[0];
    return {
        terminal: false,
        stepId: String(first.stepId),
        type: stepTypeOf(first),
        reason: String(first.waitReason),
        until: first.waitUntil || null,
        also: waiting.length - 1
    };
};

export const runTotalsOf = (steps = []) => ({
    ...tallyOf(steps),
    costUsd: steps.reduce((sum, step) => sum + stepCostOf(step), 0)
});

export const ENGINE_OFF_STATUS = 503;

export const isEngineOff = (error) => Number(error?.status) === ENGINE_OFF_STATUS;
