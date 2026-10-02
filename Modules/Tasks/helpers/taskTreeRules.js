/* The rules of the subtask tree, with nothing required, so the web app can share them. */

/* The longest `ancestors` a task may store: task, subtask, sub-subtask. */
const MAX_DEPTH = 2;
const PLACEMENT_FIELDS = Object.freeze(['ProjectID', 'sprintId', 'sprintArray', 'folderObjId']);

const REFUSALS = Object.freeze({
    PARENT_AT_MAX_DEPTH: 'Subtasks nest three levels deep at most, and that parent is already on the third.',
    SUBTREE_TOO_DEEP: 'Subtasks nest three levels deep at most, and the subtasks of this task would go past the third.',
    PARENT_NOT_FOUND: 'The parent task was not found.',
    PARENT_IS_DESCENDANT: 'A task cannot go under itself or under one of its own subtasks.',
});

/* A row written before the field existed has none and reads as a top-level task. */
const ancestorsOf = (task) => (task && Array.isArray(task.ancestors) ? task.ancestors.map(String) : []);

const depthOf = (task) => ancestorsOf(task).length;

const ancestorsFor = (parent) => [...ancestorsOf(parent), String(parent._id)];

const rootIdOf = (task) => ancestorsOf(task)[0] || String(task._id);

const subtreeHeight = (top, descendants = []) => descendants.reduce((height, row) => Math.max(height, depthOf(row) - depthOf(top)), 0);

const refusal = (code) => ({ ok: false, code, reason: REFUSALS[code] });

const canNest = (parent, height = 0) => {
    if (depthOf(parent) >= MAX_DEPTH) return refusal('PARENT_AT_MAX_DEPTH');
    if (depthOf(parent) + 1 + height > MAX_DEPTH) return refusal('SUBTREE_TOO_DEEP');
    return { ok: true };
};

const wouldCycle = (task, parent) => String(parent._id) === String(task._id) || ancestorsOf(parent).includes(String(task._id));

/* Whether `task`, with the rows under it, may go under `parent`. */
const canMoveUnder = (task, descendants, parent) => (wouldCycle(task, parent)
    ? refusal('PARENT_IS_DESCENDANT')
    : canNest(parent, subtreeHeight(task, descendants)));

/* A stamp names the task whose archive or delete carried the row; it means nothing once that task is no longer above it. */
const staleStamp = (row, chain) => Boolean(row.cascadedBy) && !chain.map(String).includes(String(row.cascadedBy));

const placementFrom = (root) => Object.fromEntries(PLACEMENT_FIELDS
    .filter((field) => root[field] !== undefined && root[field] !== null)
    .map((field) => [field, root[field]]));

/* Orders rows that name their parent by a file-local `_id` into the passes that create them,
 * parents first. A row below level three goes under its level-two ancestor; a row whose parent
 * is not among the rows, or whose chain loops, becomes a task. Each is listed in `adjusted`.
 * `stored` maps an id a row may name to a task already saved, as `{ id, ancestors }`: a chain that
 * ends on one hangs under it, and `storedParentOf` holds the saved id a row goes under. */
const levelRows = (rows, stored = new Map()) => {
    const byId = new Map(rows.filter((row) => row._id !== undefined && row._id !== null && row._id !== '').map((row) => [String(row._id), row]));
    const parentNamedBy = (row) => (row.ParentTaskId ? String(row.ParentTaskId) : '');
    const levels = Array.from({ length: MAX_DEPTH + 1 }, () => []);
    const parentIdOf = new Map();
    const storedParentOf = new Map();
    const adjusted = [];
    const place = (row, level, parent, reason) => {
        levels[level].push(row);
        parentIdOf.set(row, (parent && parent.row) || '');
        if (parent && parent.stored) storedParentOf.set(row, parent.stored);
        if (reason) adjusted.push({ _id: row._id, TaskName: row.TaskName, reason });
    };
    rows.forEach((row) => {
        const above = [];
        const seen = new Set([row]);
        let id = parentNamedBy(row);
        while (byId.has(id) && !seen.has(byId.get(id))) {
            above.push(id);
            seen.add(byId.get(id));
            id = parentNamedBy(byId.get(id));
        }
        if (byId.has(id)) return place(row, 0, null, 'CYCLE');
        const anchor = stored.get(id);
        const chain = [
            ...(anchor ? [...(anchor.ancestors || []), anchor.id].map((saved) => ({ stored: String(saved) })) : []),
            ...above.slice().reverse().map((fileId) => ({ row: fileId })),
        ];
        if (!chain.length) return place(row, 0, null, parentNamedBy(row) ? 'PARENT_MISSING' : null);
        if (chain.length > MAX_DEPTH) return place(row, MAX_DEPTH, chain[MAX_DEPTH - 1], 'TOO_DEEP');
        return place(row, chain.length, chain[chain.length - 1], null);
    });
    return { levels, parentIdOf, storedParentOf, adjusted };
};

const LIVE = 0;
const DELETED = 1;
const ARCHIVED = 2;
/* What a row carried by its top holds while the top is live, deleted or archived. */
const CARRIED_KEY = Object.freeze({ [LIVE]: LIVE, [DELETED]: DELETED, [ARCHIVED]: 3 });

/* What one row adds to its sprint's `tasks` and `archiveTaskCount` when its state changes. */
const sprintCountChange = (from, to, rows = 1) => {
    const live = (key) => (!key ? 1 : 0);
    const archived = (key) => (key === ARCHIVED || key === CARRIED_KEY[ARCHIVED] ? 1 : 0);
    const change = { tasks: rows * (live(to) - live(from)), archiveTaskCount: rows * (archived(to) - archived(from)) };
    return Object.fromEntries(Object.entries(change).filter(([, by]) => by !== 0));
};

module.exports = {
    MAX_DEPTH, PLACEMENT_FIELDS, REFUSALS, LIVE, DELETED, ARCHIVED, CARRIED_KEY,
    ancestorsOf, depthOf, ancestorsFor, rootIdOf, subtreeHeight, refusal, canNest, wouldCycle, canMoveUnder, staleStamp,
    placementFrom, levelRows, sprintCountChange,
};
