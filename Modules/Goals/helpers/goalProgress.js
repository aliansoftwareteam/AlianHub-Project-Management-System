const MEASURED_KINDS = Object.freeze(['number', 'currency']);

const clamp = (ratio) => Math.min(1, Math.max(0, ratio));

/* A target counted from tasks is as far as its last count says; with nothing counted it has not started. */
const countedRatio = (counted) => {
    const [done, total] = [counted && counted.done, counted && counted.total].map(Number);
    return Number.isFinite(done) && total > 0 ? clamp(done / total) : 0;
};

/* How far a target is, from 0 to 1. A range that runs downwards (start above target) is measured the
 * same way, and a range with no width is reached only when the current value is the target. */
const targetRatio = (target) => {
    if (!target) return 0;
    if (target.kind === 'boolean') return target.done === true ? 1 : 0;
    if (target.kind === 'tasks') return countedRatio(target.counted);
    if (!MEASURED_KINDS.includes(target.kind)) return 0;
    const [start, end, current] = [target.start, target.target, target.current].map(Number);
    if (![start, end, current].every(Number.isFinite)) return 0;
    if (end === start) return current === end ? 1 : 0;
    return clamp((current - start) / (end - start));
};

/* 100 is kept for a ratio that has arrived, so a target at 99.6% never reads as done. */
const pctOf = (ratio) => (ratio >= 1 ? 100 : Math.min(99, Math.round(clamp(ratio) * 100)));

const weightOf = (target) => (Number.isFinite(Number(target && target.weight)) && Number(target.weight) > 0 ? Number(target.weight) : 1);

const goalRatio = (targets = []) => {
    const total = targets.reduce((sum, target) => sum + weightOf(target), 0);
    if (!total) return 0;
    return targets.reduce((sum, target) => sum + weightOf(target) * targetRatio(target), 0) / total;
};

/* reachedAt keeps the moment of the crossing: it is set once when a target arrives and cleared when it falls back. */
const measuredTarget = (target, now) => {
    const ratio = targetRatio(target);
    return { ...target, progressPct: pctOf(ratio), reachedAt: ratio >= 1 ? (target.reachedAt || now) : null };
};

const withProgress = (targets = [], now = new Date()) => ({
    targets: targets.map((target) => measuredTarget(target, now)),
    progressPct: pctOf(goalRatio(targets)),
});

module.exports = { targetRatio, goalRatio, pctOf, weightOf, withProgress };
