/* Finish-to-start collisions for the Gantt: a task that starts before the task blocking
 * it is due. Dragging a bar never cascades onto its dependents, so this is the only
 * signal that a move broke the chain. CommonJS so the jest suite can require it. */

const toTime = (value) => {
    if (value === null || value === undefined || value === '') return NaN;
    return (value instanceof Date ? value : new Date(value)).getTime();
};

const rowId = (row) => String((row && (row.id !== undefined ? row.id : row._id)) || '');

/* [{ id, startDate, DueDate, blocks: [id] }] → Set of `${source}_${target}`, the Gantt's link ids. */
const fsCollisionLinks = (tasks) => {
    const byId = new Map((tasks || []).map((row) => [rowId(row), row]));
    const hits = new Set();
    byId.forEach((row, sourceId) => {
        const due = toTime(row.DueDate);
        if (Number.isNaN(due)) return;
        (row.blocks || []).forEach((targetId) => {
            const target = byId.get(String(targetId));
            const start = target ? toTime(target.startDate) : NaN;
            if (!Number.isNaN(start) && start < due) hits.add(`${sourceId}_${targetId}`);
        });
    });
    return hits;
};

module.exports = { fsCollisionLinks };
