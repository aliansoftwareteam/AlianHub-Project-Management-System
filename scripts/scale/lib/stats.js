const ascending = (values) => values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

const median = (values) => {
    const sorted = ascending(values);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/* Nearest rank: the smallest measured value that at least p% of the runs did not exceed. With 20 runs p95 is the 19th. */
const percentile = (values, p) => {
    const sorted = ascending(values);
    if (!sorted.length) return null;
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
};

const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

const summarise = (values) => {
    const sorted = ascending(values);
    return {
        runs: sorted.length,
        median: round(median(sorted)),
        p95: round(percentile(sorted, 95)),
        min: sorted.length ? round(sorted[0]) : null,
        max: sorted.length ? round(sorted[sorted.length - 1]) : null,
    };
};

module.exports = { median, percentile, summarise };
