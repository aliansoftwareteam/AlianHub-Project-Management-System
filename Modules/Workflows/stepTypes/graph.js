const store = require('../store');

// Reading and pruning the step graph from inside a step.
//
// A condition that took the "yes" branch and an approval that was refused both
// need the same thing: the steps on the path not taken must stop being pending,
// or the run waits forever for work nobody will ever do. Skipping the head of a
// branch is enough — the scheduler already treats a step behind a skipped one as
// blocked — but a refused approval has no named branch, so it prunes everything
// that depends on it instead.

const num = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

const ids = (value) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

const deterministic = (message) => Object.assign(new Error(message), { name: 'DeterministicError', deterministic: true });

const descendantsOf = (steps, stepId) => {
    const found = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const step of steps) {
            const id = String(step.stepId);
            if (id === String(stepId) || found.has(id)) continue;
            const depends = (step.dependsOn || []).map(String);
            if (depends.includes(String(stepId)) || depends.some((d) => found.has(d))) {
                found.add(id);
                changed = true;
            }
        }
    }
    return [...found];
};

const skipAll = async (companyId, runId, stepIds, reason) => {
    const skipped = [];
    for (const id of stepIds) {
        // eslint-disable-next-line no-await-in-loop
        await store.skipStep(companyId, runId, id, reason);
        skipped.push(String(id));
    }
    return skipped;
};

/* The evaluation context a condition and a loop are given: the run's entity
 * under the roots the expression language already knows, and every finished
 * step's output under `$<stepId>`. */
const contextFor = (run, outputs) => ({
    task: (run.entity && run.entity.data) || run.entity || {},
    entity: run.entity || {},
    previous: run.envelope || {},
    actor: { userId: run.startedBy || null },
    scope: { workflowId: run.workflowId || null, runId: String(run._id) },
    steps: outputs || {},
});

module.exports = { num, ids, deterministic, descendantsOf, skipAll, contextFor };
