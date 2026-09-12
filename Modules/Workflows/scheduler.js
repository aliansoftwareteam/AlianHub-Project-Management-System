// Ready-set scheduling over the step graph.
//
// A step is ready when it is claimable — pending, or running under a lease that
// has lapsed — every step it depends on has finished successfully, and any
// backoff it is serving has elapsed. A step whose
// dependency failed, stopped or was skipped can never become ready, so it is
// skipped rather than left pending forever — which is what turns a failed step
// into a finished run instead of a stuck one.
//
// Pure, on the step rows as loaded. The engine does the writing.

const SUCCEEDED = 'success';
const BLOCKING = Object.freeze(['failed', 'stopped', 'skipped']);

const byId = (steps) => new Map(steps.map((step) => [String(step.stepId), step]));

/* A person who skips a failed step is saying "go on without it", so their skip
 * satisfies the steps that depend on it. A skip the engine wrote, because the
 * dependency could never run, means the opposite and still blocks. */
const skippedByPerson = (step) => Boolean(step && step.status === 'skipped' && step.skippedBy);

const settledWell = (step) => Boolean(step) && (step.status === SUCCEEDED || skippedByPerson(step));

const due = (step, now) => !step.nextAttemptAt || new Date(step.nextAttemptAt).getTime() <= now.getTime();

const dependencies = (step, index) => (step.dependsOn || []).map((id) => index.get(String(id)));

/* An unknown dependency id is a blocked step, not an ignored one: silently
 * treating a typo as "no dependency" would run the step out of order. */
const blockedBy = (step, index) => (step.dependsOn || [])
    .map((id) => ({ id: String(id), dependency: index.get(String(id)) || null }))
    .filter(({ dependency }) => !dependency || (BLOCKING.includes(dependency.status) && !skippedByPerson(dependency)));

const satisfied = (step, index) => dependencies(step, index).every(settledWell);

/* A worker that died holding a claim leaves a `running` row nobody is working,
 * and the lapsed lease is what says so. Offering it again is the other half of
 * the mechanism `store.claimStep` already has: its filter takes back a running
 * step whose lease has run out, under a fresh fencing token, so the worker that
 * eventually comes back has its write refused rather than applied. Without this
 * a run killed mid-step waits for a person to press resume. */
const abandoned = (step, now) => step.status === 'running'
    && Boolean(step.leaseExpiresAt)
    && new Date(step.leaseExpiresAt).getTime() <= now.getTime();

const claimable = (step, now) => step.status === 'pending' || abandoned(step, now);

const readySet = (steps, now = new Date()) => {
    const index = byId(steps);
    return steps
        .filter((step) => claimable(step, now) && !blockedBy(step, index).length && satisfied(step, index) && due(step, now))
        .sort((a, b) => (a.index || 0) - (b.index || 0));
};

/* Pending steps that can never run, with the dependency that settled it.
 *
 * Transitive: a step behind a blocked step is blocked too, so one pass answers
 * for the whole tail of a graph rather than one layer per tick — otherwise a run
 * whose first step failed would need as many ticks as it has depth to finish. */
const blockedSet = (steps) => {
    const index = byId(steps);
    const blocked = new Map();
    let changed = true;
    while (changed) {
        changed = false;
        for (const step of steps) {
            if (step.status !== 'pending' || blocked.has(String(step.stepId))) continue;
            const blockers = blockedBy(step, index).concat(
                (step.dependsOn || []).map(String).filter((id) => blocked.has(id)).map((id) => ({ id, dependency: index.get(id) || null })),
            );
            if (!blockers.length) continue;
            blocked.set(String(step.stepId), { step, blockers });
            changed = true;
        }
    }
    return steps.filter((step) => blocked.has(String(step.stepId))).map((step) => blocked.get(String(step.stepId)));
};

/* The earliest a pending step could next be claimed, or null when none is waiting. */
const nextAttemptAt = (steps) => {
    const times = steps
        .filter((step) => step.status === 'pending' && step.nextAttemptAt)
        .map((step) => new Date(step.nextAttemptAt).getTime());
    return times.length ? new Date(Math.min(...times)) : null;
};

const allSettled = (steps) => steps.every((step) => step.status !== 'pending' && step.status !== 'running');

/* The run's verdict once nothing is left to do. A failed step fails the run; a
 * stopped one (a condition that said no) stops it without calling it a failure. */
const runStatus = (steps) => {
    if (!allSettled(steps)) return null;
    if (steps.some((step) => step.status === 'failed')) return 'failed';
    if (steps.some((step) => step.status === 'stopped')) return 'stopped';
    return 'success';
};

module.exports = { readySet, abandoned, blockedSet, nextAttemptAt, allSettled, runStatus, byId, skippedByPerson, settledWell, SUCCEEDED, BLOCKING };
