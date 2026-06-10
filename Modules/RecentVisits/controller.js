const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");

// Per-user "recently visited" tracking. One document per user+entity,
// upserted on every visit — the list endpoint returns the newest first,
// enriched with task summaries so the dropdown renders without extra calls.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const LIST_LIMIT = 15;

/**
 * POST /api/v2/recent-visits
 * body: { entityType: 'task', entityId, userData }
 */
exports.recordVisit = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { entityType, entityId, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';

        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }
        if (entityType !== 'task' || !OBJECT_ID_PATTERN.test(String(entityId || ''))) {
            return res.send({ status: false, statusText: 'A valid task entity is required.' });
        }

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECENTVISITS,
            data: [
                { userId, entityType, entityId: new mongoose.Types.ObjectId(entityId) },
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
 * GET /api/v2/recent-visits?uid=<userId>
 * Returns the user's most recent task visits with task summaries; visits
 * whose task was deleted in the meantime are filtered out.
 */
exports.listVisits = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = String(req.query?.uid || '');
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and uid are required.' });
        }

        const visits = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECENTVISITS,
            data: [{ userId, entityType: 'task' }, null, { sort: { visitedAt: -1 }, limit: LIST_LIMIT * 2 }],
        }, 'find');

        if (!visits || !visits.length) {
            return res.send({ status: true, statusText: 'No recent visits.', data: [] });
        }

        const taskIds = visits.map((visit) => visit.entityId);
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { _id: { $in: taskIds }, deletedStatusKey: { $ne: 1 } },
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
