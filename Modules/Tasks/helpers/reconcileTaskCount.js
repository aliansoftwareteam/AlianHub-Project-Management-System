/**
 * BUG-033 / #87 — reconciliation helpers for sprint/folder task counts.
 *
 * Background: several task mutation flows (moveTaskFunction,
 * convertToListSubTask, mergeTask, etc.) write a primary update and then
 * fire one or more secondary `$inc` operations to keep
 * `sprints.tasks` / `folders.tasks` denormalised counts in sync. Each
 * secondary op is independent — if it fails, the cached count drifts
 * away from the actual tasks-collection state and the sidebar shows the
 * wrong number until manual cleanup.
 *
 * Why not real transactions? `MongoDbCrudOpration` is a thin abstraction
 * that doesn't thread a session through, and Mongo transactions require
 * a replica-set deployment which AlianHub's self-hosted footprint can't
 * guarantee. Recomputing from source-of-truth works in every deployment
 * mode and is idempotent.
 *
 * Usage: call `reconcileSprintTaskCount(companyId, sprintId)` from the
 * `.catch` of a secondary `$inc`. The helper recomputes the canonical
 * count from the tasks collection (deletedStatusKey ∈ {0, undefined})
 * and `$set`s it back onto the sprint document.
 */

const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

function toObjectIdOrNull(id) {
    if (!id) return null;
    try {
        return new mongoose.Types.ObjectId(id);
    } catch (e) {
        return null;
    }
}

/**
 * Returns the actual number of live tasks belonging to a sprint.
 * "Live" = `deletedStatusKey` is 0 or unset (consistent with
 * BUG-032's filter pattern).
 */
exports.computeLiveTaskCount = async (companyId, sprintId) => {
    const sprintObjectId = toObjectIdOrNull(sprintId);
    if (!sprintObjectId) {
        throw new Error(`reconcile: invalid sprintId ${sprintId}`);
    }
    const query = {
        type: SCHEMA_TYPE.TASKS,
        data: [
            [
                {
                    $match: {
                        sprintId: sprintObjectId,
                        deletedStatusKey: { $in: [0, undefined] }
                    }
                },
                { $count: 'count' }
            ]
        ]
    };
    const response = await MongoDbCrudOpration(companyId, query, 'aggregate');
    return (response && response[0] && response[0].count) || 0;
};

/**
 * Recomputes the canonical count and writes it back to the sprint. Safe
 * to call repeatedly. Resolves to the corrected count (or `null` if the
 * sprintId is missing/invalid — we never throw, this is best-effort).
 */
exports.reconcileSprintTaskCount = async (companyId, sprintId) => {
    const sprintObjectId = toObjectIdOrNull(sprintId);
    if (!sprintObjectId) return null;
    try {
        const liveCount = await exports.computeLiveTaskCount(companyId, sprintId);
        const updateObj = {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                { _id: sprintObjectId },
                { $set: { tasks: liveCount } },
                { returnDocument: 'after' }
            ]
        };
        await MongoDbCrudOpration(companyId, updateObj, 'findOneAndUpdate');
        logger.info(`reconcileSprintTaskCount: sprint=${sprintId} corrected to ${liveCount}`);
        return liveCount;
    } catch (error) {
        logger.error(`reconcileSprintTaskCount failed (sprint=${sprintId}): ${error && error.message ? error.message : error}`);
        return null;
    }
};

/**
 * Convenience: if a primary task write succeeds but a downstream count
 * update fails, schedule a reconciliation. Decouples the recovery from
 * the original error path so the caller doesn't have to chain another
 * promise.
 */
exports.scheduleReconciliation = (companyId, sprintIds) => {
    const ids = Array.isArray(sprintIds) ? sprintIds : [sprintIds];
    setImmediate(() => {
        ids.filter(Boolean).forEach(id => {
            exports.reconcileSprintTaskCount(companyId, id).catch(err => {
                logger.error(`scheduleReconciliation outer: ${err && err.message ? err.message : err}`);
            });
        });
    });
};
