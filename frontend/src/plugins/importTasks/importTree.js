const REASONS = [
    { reason: "TOO_DEEP", count: "tooDeep", key: "too_deep" },
    { reason: "PARENT_MISSING", count: "parentMissing", key: "parent_missing" },
    { reason: "CYCLE", count: "cycle", key: "cycle" }
];

/* An import can run as several requests; each answers what the server had to re-hang. */
export function adjustedTotals(results) {
    const totals = { tooDeep: 0, parentMissing: 0, cycle: 0, rows: [] };
    (results || []).forEach((result) => {
        const adjusted = result?.adjusted;
        if (!adjusted) return;
        REASONS.forEach(({ count }) => { totals[count] += Number(adjusted[count] || 0); });
        totals.rows.push(...(adjusted.rows || []));
    });
    totals.rows.sort((a, b) => REASONS.findIndex((entry) => entry.reason === a.reason) - REASONS.findIndex((entry) => entry.reason === b.reason));
    return totals;
}

export function adjustedLines(totals, t, prefix) {
    return REASONS
        .filter(({ count }) => totals?.[count] > 0)
        .map(({ reason, count, key }) => ({
            reason,
            text: t(`${prefix}_${key}`, { count: totals[count] }),
            names: (totals.rows || []).filter((row) => row.reason === reason).map((row) => row.name).filter(Boolean).join(", ")
        }));
}

export const droppedFieldValuesTotal = (results) => (results || []).reduce((sum, result) => sum + Number(result?.droppedFieldValues || 0), 0);

/* A file that names parents goes in one request: a subtask sent without its parent would arrive as a task. */
export function importChunks(rows, mapping, size) {
    if (mapping?.parent) return [rows];
    const chunks = [];
    for (let start = 0; start < rows.length; start += size) chunks.push(rows.slice(start, start + size));
    return chunks;
}
