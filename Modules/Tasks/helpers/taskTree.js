const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { HEX_ID } = require('../../../utils/mongo-handler/objectIdKeys');

const rules = require('./taskTreeRules');

const { LIVE, DELETED, ARCHIVED, CARRIED_KEY, ancestorsOf, depthOf, ancestorsFor, rootIdOf, refusal, canNest, canMoveUnder, staleStamp, placementFrom } = rules;

const storedTask = (companyId, id) => (HEX_ID.test(String(id))
    ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, null, { lean: true }] }, 'findOne')
    : null);

/* A parent migration 064 left without a chain (an orphan, a cycle) reads as its own root. */
const rootOf = async (companyId, parent) => (depthOf(parent) && await storedTask(companyId, rootIdOf(parent))) || parent;

/* What a child of `parentId` stores: its chain, and the placement of the root it sits under. With
 * `moving` (a task and the rows under it), the task must fit there with its subtree and must not
 * end up under itself. */
const slotUnder = async (companyId, parentId, moving = null) => {
    const parent = await storedTask(companyId, parentId);
    if (!parent || parent.deletedStatusKey === 1) return refusal('PARENT_NOT_FOUND');
    /* A task that still holds a chain from when it was a subtask (rows migration 066 has not reached) is a root. */
    if (!parent.ParentTaskId) parent.ancestors = [];
    const nest = moving ? canMoveUnder(moving.task, moving.descendants, parent) : canNest(parent);
    if (!nest.ok) return nest;
    return { ok: true, parent, ancestors: ancestorsFor(parent), placement: placementFrom(await rootOf(companyId, parent)) };
};

const loadSubtree = async (companyId, taskId, { filter = {}, projection = null } = {}) => (await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ ...filter, ancestors: String(taskId) }, projection, { lean: true }],
}, 'find')) || [];

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
 * ParentTaskId. A descendant drops a stamp naming a task that is no longer above it, so that
 * task's restore leaves it alone. updatedAt is kept: nothing a person sees on a descendant changed. */
const rewriteDescendantAncestors = async (companyId, topId, topAncestors) => {
    const top = String(topId);
    const above = topAncestors.map(String);
    const rows = await loadSubtree(companyId, top, { projection: { ancestors: 1, cascadedBy: 1 } });
    if (!rows.length) return 0;
    const ops = rows.map((row) => {
        const own = ancestorsOf(row);
        const ancestors = [...above, ...own.slice(own.indexOf(top))];
        const update = staleStamp(row, ancestors) ? { $set: { ancestors }, $unset: { cascadedBy: '' } } : { $set: { ancestors } };
        return { updateOne: { filter: { _id: row._id, ancestors: top }, update, timestamps: false } };
    });
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [ops, { ordered: false }] }, 'bulkWrite');
    return rows.length;
};

module.exports = {
    ...rules,
    storedTask, rootOf, slotUnder, loadSubtree, rewriteDescendantAncestors, cascadeStatus, placeDescendants,
};
