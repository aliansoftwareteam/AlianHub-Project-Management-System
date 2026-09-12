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

module.exports = { enabled, leaseMs, heartbeatMs, tenantConcurrency, maxAttempts, backoffLadder, DEFAULT_BACKOFF_MS };
