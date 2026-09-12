const { RUN_LOCK_MS, MINUTE } = require('../Agents/engine/timeouts');

// WORKFLOW_ENGINE is off by default, and off means today's behaviour exactly:
// dispatch creates the automation run and the queue job calls the runner, with
// no workflow row written anywhere. On, the same runner executes the same rule
// as the one node of a workflow run, and the lease, the claim and the retry
// decision move out of the runner and onto the step row.

const number = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const enabled = () => ['on', 'true', '1'].includes(String(process.env.WORKFLOW_ENGINE || 'off').toLowerCase());

/* The lease has to outlive the longest thing a step can legitimately do, or a
 * working step is reclaimed under itself. RUN_LOCK_MS is that number already —
 * the model timeout plus the act budget plus a margin — so the two cannot drift. */
const leaseMs = () => number(process.env.WORKFLOW_LEASE_MS, RUN_LOCK_MS);

const heartbeatMs = () => number(process.env.WORKFLOW_HEARTBEAT_MS, Math.max(5000, Math.round(leaseMs() / 3)));

const tenantConcurrency = () => number(process.env.WORKFLOW_TENANT_CONCURRENCY, 5);

const maxAttempts = () => number(process.env.WORKFLOW_MAX_ATTEMPTS, 3);

const DEFAULT_BACKOFF_MS = [30 * 1000, 2 * MINUTE, 10 * MINUTE];

/* Same ladder the automation runner has always used. Overridable as a
 * comma-separated list, which is how a test asks for a backoff it can wait out. */
const backoffLadder = () => {
    const raw = String(process.env.WORKFLOW_BACKOFF_MS || '').trim();
    if (!raw) return DEFAULT_BACKOFF_MS;
    const parsed = raw.split(',').map((part) => Number(part.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    return parsed.length ? parsed : DEFAULT_BACKOFF_MS;
};

/* The bounds the step types carry (sprint 5 step 2). A fan-out and a loop are
 * the two places where a workflow can expand without a person asking it to, so
 * both have a ceiling the definition cannot raise — a definition may ask for
 * less, never for more. */
const maxFanOut = () => number(process.env.WORKFLOW_MAX_FAN_OUT, 50);

const maxLoopIterations = () => number(process.env.WORKFLOW_MAX_LOOP_ITERATIONS, 25);

/* The hourly run limit the loop admits iterations against (sprint 5 step 5).
 * Zero is no ceiling for the installation, which is today's behaviour: without
 * it a loop is bounded by a definition's own number or by the rule's stored
 * `limits.maxRunsPerHour`, and by nothing else. */
const maxRunsPerHour = () => number(process.env.WORKFLOW_MAX_RUNS_PER_HOUR, 0);

/* How long a company-and-agent hour of run starts is trusted before it is read
 * again. The window itself rolls in memory; this is only how quickly a run some
 * other process started is noticed. */
const runLimitCacheMs = () => number(process.env.WORKFLOW_RUN_LIMIT_CACHE_MS, 60 * 1000);

/* The workspace ceiling on how long a whole run may take and what it may spend
 * (sprint 5 step 4). Unset means unbounded, which is what every run written
 * before this existed is; a caller may ask for less and never for more. */
const optional = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
};

const runDeadlineMs = () => optional(process.env.WORKFLOW_RUN_DEADLINE_MS);

const runBudgetUsd = () => optional(process.env.WORKFLOW_RUN_BUDGET_USD);

/* How often a waiting step is looked at again. A person deciding an approval is
 * not polled for: deciding wakes the step, and this is only the floor that
 * catches a deadline nobody else noticed. */
const approvalPollMs = () => number(process.env.WORKFLOW_APPROVAL_POLL_MS, 5 * MINUTE);

/* A join and a loop wait on rows this process just wrote, so they come back
 * quickly; a wait or a timer sleeps until its own moment and never uses this. */
const joinPollMs = () => number(process.env.WORKFLOW_JOIN_POLL_MS, 2000);

/* An approval with no deadline of its own expires rather than waiting forever:
 * a step nobody can ever finish is a run that never ends. */
const approvalDeadlineMs = () => number(process.env.WORKFLOW_APPROVAL_DEADLINE_MS, 3 * 24 * 60 * MINUTE);

module.exports = {
    enabled, leaseMs, heartbeatMs, tenantConcurrency, maxAttempts, backoffLadder, DEFAULT_BACKOFF_MS,
    maxFanOut, maxLoopIterations, maxRunsPerHour, runLimitCacheMs, approvalPollMs, joinPollMs, approvalDeadlineMs,
    runDeadlineMs, runBudgetUsd,
};
