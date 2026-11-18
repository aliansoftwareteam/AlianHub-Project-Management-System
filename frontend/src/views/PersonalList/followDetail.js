/* The open task's panel hears its own task's changes (the taskDetail_taskUpdate event); a row of the list shows them too. */
export function withDetailChange(rows, change) {
    const doc = change && change.fullDocument;
    if (!doc || !doc._id || change.isSubTaskUpdate) return rows;
    const id = String(doc._id);
    if (!rows.some((row) => String(row._id) === id)) return rows;
    return rows.map((row) => (String(row._id) === id ? { ...row, ...doc } : row));
}
