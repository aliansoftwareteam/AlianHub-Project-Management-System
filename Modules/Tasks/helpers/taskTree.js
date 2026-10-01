const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

/* The longest `ancestors` a task may store: task, subtask, sub-subtask. */
const MAX_DEPTH = 2;
const PLACEMENT_FIELDS = Object.freeze(['ProjectID', 'sprintId', 'sprintArray', 'folderObjId']);

const REFUSALS = Object.freeze({
    PARENT_AT_MAX_DEPTH: 'Subtasks nest three levels deep at most, and that parent is already on the third.',
    SUBTREE_TOO_DEEP: 'Subtasks nest three levels deep at most, and the subtasks of this task would go past the third.',
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

const loadSubtree = async (companyId, taskId, { filter = {}, projection = null } = {}) => (await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ ...filter, ancestors: String(taskId) }, projection, { lean: true }],
}, 'find')) || [];

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
    loadSubtree, rewriteDescendantAncestors,
};
