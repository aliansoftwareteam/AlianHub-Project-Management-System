/* Subtask progress ("7/9") for a parent row in the List view.
 *
 * The list query fetches parents only, so a collapsed row has no subtaskArray and cannot
 * count its own closed children. The closed count therefore comes from one aggregate per
 * group, keyed by parent id, over the same subtask documents the expanded rows render --
 * which is what keeps a collapsed row, an expanded row and the detail panel's pill from
 * disagreeing. CommonJS so tests/list-subtask-progress.test.js can require it directly,
 * like composables/taskRisk.js. */

const CLOSED = "close";

const isClosedTask = (task) => (task?.status?.type || task?.statusType) === CLOSED;

const liveSubtasks = (task) => (Array.isArray(task?.subtaskArray) ? task.subtaskArray : []).filter((sub) => sub && !sub.deletedStatusKey);

const hasSubtasks = (task) => Boolean(task?.isParentTask && ((task.subtaskArray || []).length || Number(task.subTasks)));

/* subTasks is a denormalized counter maintained by a chain of $inc calls, so it is the
 * last resort: an aggregate of the real children outranks it whenever we have one. */
const subtaskTotal = (task, counts) => Number(counts?.total) || liveSubtasks(task).length || Number(task?.subTasks) || 0;

const subtaskProgress = (task, counts) => {
    const total = subtaskTotal(task, counts);
    if (!total) return null;
    const loaded = liveSubtasks(task);
    if (loaded.length >= total) return { done: loaded.filter(isClosedTask).length, total };
    const completed = Number(counts?.completed);
    return Number.isInteger(completed) ? { done: completed, total } : null;
};

const progressQuery = (parentIds) => [
    { $match: { ParentTaskId: { $in: (parentIds || []).map(String) }, deletedStatusKey: { $in: [0, undefined] } } },
    {
        $group: {
            _id: "$ParentTaskId",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$statusType", CLOSED] }, 1, 0] } }
        }
    }
];

const indexProgress = (rows) => (Array.isArray(rows) ? rows : []).reduce((out, row) => {
    if (!row || !row._id) return out;
    out[String(row._id)] = { total: Number(row.total) || 0, completed: Number(row.completed) || 0 };
    return out;
}, {});

const progressSignature = (rows) => (Array.isArray(rows) ? rows : [])
    .filter(hasSubtasks)
    .map((task) => `${task._id}:${Number(task.subTasks) || 0}:${(task.subtaskArray || []).length}`)
    .sort()
    .join(",");

/* Rows arrive after their group is opened, so the toolbar's expand state has to be applied
 * again as they land -- but only to parents it has not already been applied to, or it would
 * keep reopening rows the user collapsed by hand. */
const pendingExpandIds = (rows, appliedIds) => {
    const applied = new Set((appliedIds || []).map(String));
    return (Array.isArray(rows) ? rows : [])
        .filter((task) => hasSubtasks(task) && !applied.has(String(task._id)))
        .map((task) => String(task._id));
};

module.exports = {
    CLOSED,
    isClosedTask,
    hasSubtasks,
    subtaskTotal,
    subtaskProgress,
    progressQuery,
    indexProgress,
    progressSignature,
    pendingExpandIds,
};
