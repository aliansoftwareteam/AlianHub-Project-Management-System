const { WAITING } = require('../retry');

// How a step says "not yet" without failing and without holding a worker.
//
// An approval can take days, a timer can be a week out and a join waits for
// however long its children take. None of that can be done inside a claim: the
// lease is minutes long by design, and a worker asleep on a step is a worker not
// doing anything else.
//
// So a waiting step throws. The engine hands the claim back and books the next
// look exactly as it does for a transient failure — the one difference is on the
// row, where `store.deferStep` writes the reason and the moment instead of an
// error and gives the attempt back, because waiting is not failing.

class WorkflowWaiting extends Error {
    constructor(reason, { until = null, pollMs = 0, set = null } = {}) {
        super(String(reason || 'waiting'));
        this.name = WAITING;
        this.deterministic = false;
        this.until = until;
        this.retryAfterMs = Math.max(0, Number(pollMs) || 0);
        this.wait = { reason: String(reason || 'waiting'), until, ...(set ? { set } : {}) };
    }
}

const isWaiting = (error) => Boolean(error && error.name === WAITING);

/* Wait until a moment, looking again no later than `pollMs` — whichever comes
 * first, because a deadline that falls before the next poll still has to be
 * noticed on time. */
const waitUntil = (reason, until, { pollMs = 0, set = null } = {}) => {
    const at = until instanceof Date ? until : new Date(until);
    const remaining = at.getTime() - Date.now();
    const poll = Number(pollMs) > 0 ? Math.min(Number(pollMs), Math.max(remaining, 0)) : Math.max(remaining, 0);
    throw new WorkflowWaiting(reason, { until: at, pollMs: poll, set });
};

const waitFor = (reason, ms, { set = null } = {}) => {
    const until = new Date(Date.now() + Math.max(0, Number(ms) || 0));
    throw new WorkflowWaiting(reason, { until, pollMs: Math.max(0, Number(ms) || 0), set });
};

/* A step's wait, as the run view and the API will want to read it: a run with one
 * of these is blocked, and this is the reason to show. */
const waitingOn = (step) => (step && step.status === 'pending' && step.waitReason
    ? {
        stepId: String(step.stepId),
        type: String(step.type),
        reason: String(step.waitReason),
        since: step.waitingSince || null,
        until: step.waitUntil || null,
        approvalId: step.approvalId || null,
    }
    : null);

/* The first thing a run is waiting on, in step order, or null when it is simply
 * working. One reason, not a list: a blocked run is blocked on its first
 * unmet condition, and naming five of them tells a person nothing more. */
const blockedReason = (steps = []) => {
    const waiting = steps.map(waitingOn).filter(Boolean);
    return waiting.length ? { blocked: true, ...waiting[0], also: waiting.length - 1 } : null;
};

module.exports = { WorkflowWaiting, isWaiting, waitUntil, waitFor, waitingOn, blockedReason };
