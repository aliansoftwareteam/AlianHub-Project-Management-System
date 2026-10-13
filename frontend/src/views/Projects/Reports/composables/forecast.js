// Velocity forecast for the next sprint (16b). Pure: no DB, no Vue, no I/O, so
// the band the chart draws is the band the test asserts.
// Unit-tested in tests/velocity-forecast.test.js.

// Below this many measured sprints the spread is noise, not a signal, and the
// view says so instead of drawing a band nobody should plan against.
const MIN_SAMPLES = 3;

const numbers = (values) => (Array.isArray(values) ? values : [])
    // Number(null) is 0, which would quietly drag an average down; only values
    // that are actually numeric count.
    .filter((v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)))
    .map((v) => Number(v));

const mean = (values) => {
    const xs = numbers(values);
    if (!xs.length) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
};

// Population standard deviation: these are all the sprints there are, not a
// sample drawn from a larger set.
const stdDev = (values) => {
    const xs = numbers(values);
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length);
};

/* Forecast band for the next sprint from what the last few actually completed.
   Returns { ok:false, reason, samples } when there is not enough history — the
   caller must say that plainly rather than drawing a band. */
const forecastBand = (values, { minSamples = MIN_SAMPLES, window = 6, spread = 1 } = {}) => {
    const xs = numbers(values).slice(-Math.max(1, window));
    if (xs.length < minSamples) {
        return { ok: false, reason: 'not-enough-history', samples: xs.length, minSamples };
    }
    const centre = mean(xs);
    const sd = stdDev(xs);
    const margin = sd * spread;
    const low = Math.max(0, Math.round(centre - margin));
    const high = Math.round(centre + margin);
    return {
        ok: true,
        samples: xs.length,
        mean: Math.round(centre * 10) / 10,
        stdDev: Math.round(sd * 10) / 10,
        low,
        // A flat history gives a zero-width band; keep low <= high so the chart
        // never draws an inverted range.
        high: Math.max(low, high),
    };
};

/* The completed-points series a velocity payload implies, honouring the
   human-only toggle (29c). Rows without a split contribute nothing to the
   human series — omitted, never guessed. */
const completedSeries = (rows, { humanOnly = false } = {}) => (Array.isArray(rows) ? rows : []).map((row) => {
    if (!humanOnly) return Number(row && row.completed) || 0;
    const human = row && (row.completedHuman !== undefined ? row.completedHuman : row.humanCompleted);
    return Number.isFinite(Number(human)) ? Number(human) : null;
});

/* True when every row carries a human/agent split, so the toggle is honest. */
const hasActorSplit = (rows) => Array.isArray(rows) && rows.length > 0 && rows.every((row) => {
    const human = row && (row.completedHuman !== undefined ? row.completedHuman : row.humanCompleted);
    const agent = row && (row.completedAgent !== undefined ? row.completedAgent : row.agentCompleted);
    return Number.isFinite(Number(human)) && Number.isFinite(Number(agent));
});

module.exports = { MIN_SAMPLES, mean, stdDev, forecastBand, completedSeries, hasActorSplit };
