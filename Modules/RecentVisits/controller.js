const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { visibleProjectIds } = require("../Agents/scope");
const { hiddenSprintFilter } = require("../Sprints/helpers/sprintVisibility");
const { resolveVisits, parseListQuery, VISIT_TYPES } = require("./helpers/resolveVisits");

// One document per user+entity, upserted on every visit.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/* Visits belong to the signed-in user. A user id in the request is tolerated only when it is theirs. */
const ownerOf = (req, claimed) => {
    const uid = String(req.uid || '');
    if (!uid) return { refused: 401, statusText: 'Sign in to use recent visits.' };
    if (claimed && String(claimed) !== uid) return { refused: 403, statusText: 'You can only use your own recent visits.' };
    return { uid };
};

/**
 * POST /api/v2/recent-visits
 * body: { entityType: 'task' | 'project' | 'sprint' | 'doc', entityId }
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
        if (!VISIT_TYPES.includes(entityType) || !OBJECT_ID_PATTERN.test(String(entityId || ''))) {
            return res.send({ status: false, statusText: 'A valid task, project, list or doc is required.' });
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
 * GET /api/v2/recent-visits?types=task,project,sprint,doc|all&limit=15
 * The caller's newest visits, tasks only unless `types` asks for more. Anything deleted,
 * in a project the caller can no longer open, in a private sprint they are not on, or a
 * private doc of someone else's, drops out.
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
        const { types, limit } = parseListQuery(req.query);

        const visits = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.RECENTVISITS,
            data: [{ userId: owner.uid, entityType: { $in: types } }, null, { sort: { visitedAt: -1 }, limit: limit * 3 }],
        }, 'find');

        if (!visits || !visits.length) {
            return res.send({ status: true, statusText: 'No recent visits.', data: [] });
        }

        const visible = await visibleProjectIds(companyId, owner.uid);
        const sprintClause = await hiddenSprintFilter(companyId, owner.uid, visible);
        const data = (await resolveVisits(companyId, owner.uid, visits, { visible, sprintClause })).slice(0, limit);

        return res.send({ status: true, statusText: 'Recent visits fetched.', data });
    } catch (error) {
        logger.error(`ERROR in list recent visits: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
