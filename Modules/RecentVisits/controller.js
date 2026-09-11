const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { visibleProjectIds } = require("../Agents/scope");

// One document per user+entity, upserted on every visit.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const LIST_LIMIT = 15;

/* Visits belong to the signed-in user. A user id in the request is tolerated only when it is theirs. */
const ownerOf = (req, claimed) => {
    const uid = String(req.uid || '');
    if (!uid) return { refused: 401, statusText: 'Sign in to use recent visits.' };
    if (claimed && String(claimed) !== uid) return { refused: 403, statusText: 'You can only use your own recent visits.' };
    return { uid };
};

/**
 * POST /api/v2/recent-visits
 * body: { entityType: 'task', entityId }
 */
exports.recordVisit = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { entityType, entityId, userData } = req.body || {};
        const owner = ownerOf(req, userData && (userData.id || userData._id));
        if (owner.refused) {
            return res.status(owner.refused).send({ status: false, statusText: owner.statusText });
        }
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        if (entityType !== 'task' || !OBJECT_ID_PATTERN.test(String(entityId || ''))) {
            return res.send({ status: false, statusText: 'A valid task entity is required.' });
        }

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECENTVISITS,
            data: [
                { userId: owner.uid, entityType, entityId: new mongoose.Types.ObjectId(entityId) },
                { $set: { visitedAt: new Date() } },
                { upsert: true },
            ],
        }, 'updateOne');

        return res.send({ status: true, statusText: 'Visit recorded.' });
    } catch (error) {
        logger.error(`ERROR in record recent visit: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/**
 * GET /api/v2/recent-visits
 * The caller's newest task visits with task summaries. Tasks that were deleted, or
 * that moved to a project the caller can no longer open, drop out.
 */
exports.listVisits = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const owner = ownerOf(req, req.query && req.query.uid);
        if (owner.refused) {
            return res.status(owner.refused).send({ status: false, statusText: owner.statusText });
        }
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }

        const visits = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECENTVISITS,
            data: [{ userId: owner.uid, entityType: 'task' }, null, { sort: { visitedAt: -1 }, limit: LIST_LIMIT * 2 }],
        }, 'find');

        if (!visits || !visits.length) {
            return res.send({ status: true, statusText: 'No recent visits.', data: [] });
        }

        const projectIds = (await visibleProjectIds(companyId, owner.uid)).map((id) => new mongoose.Types.ObjectId(String(id)));
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { _id: { $in: visits.map((visit) => visit.entityId) }, ProjectID: { $in: projectIds }, deletedStatusKey: { $ne: 1 } },
                'TaskName TaskKey status statusType ProjectID sprintId folderObjId deletedStatusKey',
            ],
        }, 'find');
        const taskById = new Map((tasks || []).map((task) => [String(task._id), task]));

        const data = visits
            .map((visit) => ({ visitedAt: visit.visitedAt, task: taskById.get(String(visit.entityId)) || null }))
            .filter((item) => item.task)
            .slice(0, LIST_LIMIT);

        return res.send({ status: true, statusText: 'Recent visits fetched.', data });
    } catch (error) {
        logger.error(`ERROR in list recent visits: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
