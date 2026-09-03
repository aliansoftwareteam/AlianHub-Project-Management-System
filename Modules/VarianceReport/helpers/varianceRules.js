// REP-04 — pure estimate-vs-actual variance math (everything in MINUTES).
// Unit-tested in tests/variance-rules.test.js and tests/variance-summary-rules.test.js.

const round = (n) => Math.round(n);

// Per-task variance from estimated + actual minutes.
// variance > 0 = over estimate; < 0 = under; status flags the case.
const taskVariance = (estimatedMinutes, actualMinutes) => {
    const est = Number(estimatedMinutes) || 0;
    const act = Number(actualMinutes) || 0;
    const variance = act - est;
    const variancePct = est > 0 ? round((variance / est) * 100) : (act > 0 ? 100 : 0);
    let status = 'on-track';
    if (est === 0 && act > 0) status = 'no-estimate';
    else if (variance > 0) status = 'over';
    else if (variance < 0) status = 'under';
    return { estimatedMinutes: est, actualMinutes: act, variance, variancePct, status };
};

// Roll up rows (each having estimatedMinutes / actualMinutes / status).
const rollup = (rows = []) => {
    const t = rows.reduce((a, r) => {
        a.totalEstimated += r.estimatedMinutes || 0;
        a.totalActual += r.actualMinutes || 0;
        if (r.status === 'over') a.over++;
        else if (r.status === 'under') a.under++;
        else if (r.status === 'no-estimate') a.noEstimate++;
        else a.onTrack++;
        return a;
    }, { tasks: rows.length, totalEstimated: 0, totalActual: 0, over: 0, under: 0, onTrack: 0, noEstimate: 0 });
    t.totalVariance = t.totalActual - t.totalEstimated;
    t.totalVariancePct = t.totalEstimated > 0 ? round((t.totalVariance / t.totalEstimated) * 100) : 0;
    return t;
};

/* Group task rows by a key (projectId / userId), largest absolute delta first. */
const groupVariance = (rows = [], keyOf, nameOf = () => '') => {
    const map = {};
    rows.forEach((r) => {
        const key = String(keyOf(r) || '');
        if (!key) return;
        const g = map[key] || (map[key] = { key, name: nameOf(r, key), estimatedMinutes: 0, actualMinutes: 0, tasks: 0 });
        g.estimatedMinutes += r.estimatedMinutes || 0;
        g.actualMinutes += r.actualMinutes || 0;
        g.tasks += 1;
    });
    return Object.values(map)
        .map((g) => ({ ...g, ...taskVariance(g.estimatedMinutes, g.actualMinutes) }))
        .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
};

/* Average drift (%) for tasks matching each named predicate — "where estimates drift most". */
const driftDrivers = (rows = [], drivers = []) => drivers.map((d) => {
    const hit = rows.filter((r) => r.estimatedMinutes > 0 && d.test(r));
    const est = hit.reduce((s, r) => s + r.estimatedMinutes, 0);
    const act = hit.reduce((s, r) => s + r.actualMinutes, 0);
    return { key: d.key, tasks: hit.length, driftPct: est > 0 ? round(((act - est) / est) * 100) : 0 };
}).sort((a, b) => b.driftPct - a.driftPct);

/* The single task that explains the most over-run: the takeaway line's subject. */
const biggestOverrun = (rows = []) => rows
    .filter((r) => r.variance > 0)
    .sort((a, b) => b.variance - a.variance)[0] || null;

module.exports = { taskVariance, rollup, groupVariance, driftDrivers, biggestOverrun };
