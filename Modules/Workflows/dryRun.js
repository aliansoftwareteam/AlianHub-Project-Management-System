const scheduler = require('./scheduler');
const hop = require('./hop');
const stepTypes = require('./stepTypes');

// What a workflow would do, without doing any of it.
//
// The planner runs the definition through the same two things a real start does
// — `stepTypes.validateSteps` and the ready-set scheduler — against step rows
// held in memory, so the order, the grants and the refusals an author sees here
// are the ones the engine would reach. Nothing is written: no run row, no step
// row, no queue job, no audit row, and no executor is called.
//
// The answer is data rather than sentences, because every word a person reads
// on the builder comes from the locale file.

const WRITES = Object.freeze({
    [stepTypes.AGENT_RUN]: 'writes',
    [stepTypes.TOOL_CALL]: 'writes',
    [stepTypes.HUMAN_APPROVAL]: 'asks',
});

const STEP_REF = /\$([0-9a-zA-Z_-]+)(\.[0-9a-zA-Z_.-]+)?/g;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/* Every `$step.field` the step's configuration reads, at any depth. */
const referencesIn = (node, found = new Set(), depth = 0) => {
    if (depth > 10 || node === null || node === undefined) return found;
    if (typeof node === 'string') {
        for (const [ref] of node.matchAll(STEP_REF)) found.add(ref);
        return found;
    }
    if (Array.isArray(node)) { node.forEach((child) => referencesIn(child, found, depth + 1)); return found; }
    if (isPlainObject(node)) { Object.values(node).forEach((child) => referencesIn(child, found, depth + 1)); return found; }
    return found;
};

const rowsFor = (steps) => steps.map((step, index) => ({
    stepId: String(step.id),
    index,
    type: String(step.type),
    dependsOn: (step.dependsOn || []).map(String),
    config: step.config || {},
    status: 'pending',
}));

/* The waves the ready set would hand out: everything with nothing left to wait
 * for, then everything that was waiting only on those, and so on. A step still
 * pending when no wave can be cut depends on a cycle, so it is named rather
 * than silently dropped. */
const wavesOf = (rows) => {
    const state = rows.map((row) => ({ ...row }));
    const waves = [];
    for (;;) {
        const ready = scheduler.readySet(state);
        if (!ready.length) break;
        waves.push(ready.map((row) => String(row.stepId)));
        const done = new Set(ready.map((row) => String(row.stepId)));
        state.forEach((row) => { if (done.has(String(row.stepId))) row.status = 'success'; });
    }
    return { waves, unreachable: state.filter((row) => row.status === 'pending').map((row) => String(row.stepId)) };
};

const number = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

/* The plan. `input` is whatever the author picked to try the workflow against —
 * resolved by the caller, because reading a task is a company-scoped query and
 * this file does no I/O. */
const plan = ({ steps = [], deadlineMs = null, budgetUsd = null, input = null } = {}) => {
    const checked = stepTypes.validateSteps(steps);
    if (!checked.valid) return { valid: false, errors: checked.errors, input, steps: [], waves: [], unreachable: [], summary: null };

    const rows = rowsFor(steps);
    const { waves, unreachable } = wavesOf(rows);
    const waveOf = new Map();
    waves.forEach((wave, i) => wave.forEach((stepId) => waveOf.set(stepId, i + 1)));

    const bounds = hop.ceilingFor({ deadlineMs, budgetUsd });
    const now = new Date();
    let spentUsd = 0;

    const planned = [...rows]
        .sort((a, b) => (waveOf.get(String(a.stepId)) || Infinity) - (waveOf.get(String(b.stepId)) || Infinity) || a.index - b.index)
        .map((row) => {
            const at = waveOf.get(String(row.stepId)) || null;
            // Each step is judged against what the steps planned before it have
            // already claimed, which is what makes a budget that runs out part
            // way through a workflow visible here rather than in a run.
            const verdict = hop.allow({ ...bounds, spentUsd, depth: 0 }, rows, row, now);
            const asked = number((row.config || {}).budgetUsd);
            if (at) spentUsd += asked || 0;
            const contract = stepTypes.get(row.type);
            return {
                stepId: String(row.stepId),
                type: row.type,
                label: contract ? contract.label : row.type,
                wave: at,
                dependsOn: row.dependsOn,
                effect: WRITES[row.type] || 'none',
                reads: [...referencesIn(row.config)],
                deadlineMs: number((row.config || {}).deadlineMs),
                budgetUsd: asked,
                refused: verdict.ok ? null : { code: verdict.code, reason: verdict.reason },
                grant: verdict.ok && verdict.grant
                    ? {
                        deadlineMs: verdict.grant.deadlineAt ? verdict.grant.deadlineAt.getTime() - now.getTime() : null,
                        budgetUsd: verdict.grant.budgetUsd === null ? null : Number(verdict.grant.budgetUsd),
                    }
                    : null,
            };
        });

    return {
        valid: true,
        errors: [],
        input,
        steps: planned,
        waves,
        unreachable,
        bounds: {
            deadlineMs: bounds.deadlineAt ? bounds.deadlineAt.getTime() - now.getTime() : null,
            budgetUsd: bounds.budgetUsd,
        },
        summary: {
            stepCount: planned.length,
            waveCount: waves.length,
            writeCount: planned.filter((step) => step.effect === 'writes').length,
            approvalCount: planned.filter((step) => step.effect === 'asks').length,
            refusedCount: planned.filter((step) => step.refused).length,
            declaredBudgetUsd: Number(spentUsd.toFixed(4)),
        },
    };
};

module.exports = { plan, referencesIn, wavesOf };
