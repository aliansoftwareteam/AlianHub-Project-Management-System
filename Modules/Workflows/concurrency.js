const logger = require('../../Config/loggerConfig');
const store = require('./store');
const { tenantConcurrency } = require('./flag');

// Per-tenant concurrency, held as a distributed claim count.
//
// An in-process counter bounds one node. The number that matters is how many of
// a tenant's steps are running anywhere, so the count is a query over the live
// claims in that tenant's own database — the same rows the lease is written on,
// so there is no second thing to keep in step with reality and nothing to
// reconcile after a crash: a worker that dies stops renewing, its lease lapses,
// and it stops counting.
//
// Admission is optimistic. Checking before claiming would leave a window in
// which every worker sees room and all of them take it, so instead each worker
// claims, then asks how many live claims were taken before its own. Ordering by
// (claimedAt, _id) is total, so the answer is the same for everybody: exactly
// the claimants past the limit hand their step back, and no two workers stand
// down for each other.

const LOG_PREFIX = '[workflow-concurrency]';

const limitOf = (limit) => (Number(limit) > 0 ? Number(limit) : tenantConcurrency());

/* Cheap pre-check: at the limit already, do not even try to claim. */
const atCapacity = async (companyId, { limit, now = new Date() } = {}) => {
    const max = limitOf(limit);
    const live = await store.countLiveClaims(companyId, now);
    return { full: live >= max, live, limit: max };
};

/* Called with a claim already in hand. False means the claim was handed back. */
const admit = async (companyId, claimed, { limit, now = new Date() } = {}) => {
    const max = limitOf(limit);
    const ahead = await store.countClaimsAhead(companyId, claimed, now);
    if (ahead < max) return true;
    const released = await store.releaseStep(companyId, { runId: claimed.runId, stepId: claimed.stepId, fencingToken: claimed.fencingToken });
    if (!released) logger.warn(`${LOG_PREFIX} ${claimed.runId}/${claimed.stepId}: over the limit of ${max} but the claim was already gone`);
    return false;
};

module.exports = { atCapacity, admit, limitOf };
