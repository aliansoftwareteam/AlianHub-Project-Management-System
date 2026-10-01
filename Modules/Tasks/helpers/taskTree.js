const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { HEX_ID } = require('../../../utils/mongo-handler/objectIdKeys');

/* The longest `ancestors` a task may store: task, subtask, sub-subtask. */
const MAX_DEPTH = 2;
const PLACEMENT_FIELDS = Object.freeze(['ProjectID', 'sprintId', 'sprintArray', 'folderObjId']);

const REFUSALS = Object.freeze({
    PARENT_AT_MAX_DEPTH: 'Subtasks nest three levels deep at most, and that parent is already on the third.',
    SUBTREE_TOO_DEEP: 'Subtasks nest three levels deep at most, and the subtasks of this task would go past the third.',
    PARENT_NOT_FOUND: 'The parent task was not found.',
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

const placementFrom = (root) => Object.fromEntries(PLACEMENT_FIELDS
    .filter((field) => root[field] !== undefined && root[field] !== null)
    .map((field) => [field, root[field]]));

const storedTask = (companyId, id) => (HEX_ID.test(String(id))
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, null, { lean: true }] }, 'findOne')
    : null);

/* A parent migration 064 left without a chain (an orphan, a cycle) reads as its own root. */
const rootOf = async (companyId, parent) => (depthOf(parent) && await storedTask(companyId, rootIdOf(parent))) || parent;

/* What a new child of `parentId` stores: its chain, and the placement of the root it sits under. */
const slotUnder = async (companyId, parentId) => {
    const parent = await storedTask(companyId, parentId);
    if (!parent || parent.deletedStatusKey === 1) return refusal('PARENT_NOT_FOUND');
    /* A subtask made a task again by a writer that does not maintain the chain yet still holds its old one. */
    if (!parent.ParentTaskId) parent.ancestors = [];
    const nest = canNest(parent);
    if (!nest.ok) return nest;
    return { ok: true, parent, ancestors: ancestorsFor(parent), placement: placementFrom(await rootOf(companyId, parent)) };
};

/* Orders rows that name their parent by a file-local `_id` into the passes that create them,
 * parents first. A row below level three goes under its level-two ancestor; a row whose parent
 * is not among the rows, or whose chain loops, becomes a task. Each is listed in `adjusted`. */
const levelRows = (rows) => {
    const byId = new Map(rows.filter((row) => row._id !== undefined && row._id !== null && row._id !== '').map((row) => [String(row._id), row]));
    const parentNamedBy = (row) => (row.ParentTaskId ? String(row.ParentTaskId) : '');
    const levels = Array.from({ length: MAX_DEPTH + 1 }, () => []);
    const parentIdOf = new Map();
    const adjusted = [];
    const place = (row, level, parentId, reason) => {
        levels[level].push(row);
        parentIdOf.set(row, parentId);
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
        if (byId.has(id)) place(row, 0, '', 'CYCLE');
        else if (!above.length) place(row, 0, '', parentNamedBy(row) ? 'PARENT_MISSING' : null);
        else if (above.length > MAX_DEPTH) place(row, MAX_DEPTH, above[above.length - MAX_DEPTH], 'TOO_DEEP');
        else place(row, above.length, above[0], null);
    });
    return { levels, parentIdOf, adjusted };
};

const loadSubtree = async (companyId, taskId, { filter = {}, projection = null } = {}) => (await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ ...filter, ancestors: String(taskId) }, projection, { lean: true }],
}, 'find')) || [];

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

/* The rows that go with `top` when its deletedStatusKey changes: its live descendants on the way
 * down, and on the way back only the rows this top carried, so one archived or deleted on its
 * own stays as it is. Subtasks archived with their parent before the stamp existed hold key 3
 * and no stamp. Returns the rows it changed, as they are afterwards. */
const cascadeStatus = async (companyId, top, to) => {
    const id = String(top._id);
    const from = top.deletedStatusKey || LIVE;
    if (from === to) return [];
    const carriedBefore = [{ ancestors: id, cascadedBy: id }];
    if (from === ARCHIVED) carriedBefore.push({ ParentTaskId: id, deletedStatusKey: CARRIED_KEY[ARCHIVED], cascadedBy: { $exists: false } });
    const filter = from === LIVE ? { ancestors: id, deletedStatusKey: LIVE } : { $or: carriedBefore };
    const rows = (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, null, { lean: true }] }, 'find')) || [];
    if (!rows.length) return [];
    const update = to === LIVE
        ? { $set: { deletedStatusKey: LIVE }, $unset: { cascadedBy: '' } }
        : { $set: { deletedStatusKey: CARRIED_KEY[to], cascadedBy: id } };
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, update] }, 'updateMany');
    return rows.map(({ cascadedBy, ...row }) => ({ ...row, ...update.$set }));
};

/* Descendants take the placement their top was given; their chains do not change. A deleted
 * row stays where it is, as in the app's own move. Returns the rows as they were. */
const placeDescendants = async (companyId, topId, { set, unset }) => {
    const filter = { ancestors: String(topId), deletedStatusKey: { $ne: DELETED } };
    const rows = (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, null, { lean: true }] }, 'find')) || [];
    if (!rows.length) return [];
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, unset ? { $set: set, $unset: unset } : { $set: set }] }, 'updateMany');
    return rows;
};

/* The top's own row belongs to its writer, which sets `ancestors` in the update that changes
 * ParentTaskId. updatedAt is kept: nothing a person sees on a descendant changed. */
const rewriteDescendantAncestors = async (companyId, topId, topAncestors) => {
    const top = String(topId);
    const above = topAncestors.map(String);
    const rows = await loadSubtree(companyId, top, { projection: { ancestors: 1 } });
    if (!rows.length) return 0;
    const ops = rows.map((row) => {
        const own = ancestorsOf(row);
        return { updateOne: { filter: { _id: row._id, ancestors: top }, update: { $set: { ancestors: [...above, ...own.slice(own.indexOf(top))] } }, timestamps: false } };
    });
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [ops, { ordered: false }] }, 'bulkWrite');
    return rows.length;
};

module.exports = {
    MAX_DEPTH, PLACEMENT_FIELDS, REFUSALS,
    ancestorsOf, depthOf, ancestorsFor, rootIdOf, subtreeHeight, canNest, wouldCycle, placementFrom,
    rootOf, slotUnder, levelRows, loadSubtree, rewriteDescendantAncestors,
    sprintCountChange, cascadeStatus, placeDescendants,
};
