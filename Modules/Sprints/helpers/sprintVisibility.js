const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../../Config/config');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');
const { teamIdentitiesKey } = require('../../Teams/cacheKeys');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TEAM_PREFIX = 'tId_';
const IDENTITY_TTL_SECONDS = 60;

const asObjectIds = (ids) => (ids || [])
    .filter((id) => OBJECT_ID.test(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

/* A sprint's AssigneeUserId holds user ids and `tId_<teamId>` entries, so membership is
 * decided against the caller's own identities rather than their user id alone. Expanding
 * the caller's teams once per company and user costs a single query instead of one per
 * sprint; the key sits under Modules/Teams' own `teams:<companyId>:` prefix so a team
 * write drops it as soon as a membership changes, and never reaches another company. */
const sprintIdentities = async (companyId, uid) => {
    const key = teamIdentitiesKey(companyId, uid);
    const cached = myCache.get(key);
    if (cached !== undefined) return cached;
    const teams = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
        data: [{ assigneeUsersArray: { $in: [String(uid)] } }, { _id: 1 }],
    }, 'find').catch(() => []);
    const identities = [String(uid), ...(teams || []).map((team) => `${TEAM_PREFIX}${team._id}`)];
    myCache.set(key, identities, IDENTITY_TTL_SECONDS);
    return identities;
};

const identitySet = (identities) => (identities instanceof Set
    ? identities
    : new Set((Array.isArray(identities) ? identities : [identities]).filter(Boolean).map(String)));

/* A private sprint belongs to the people it is shared with; owners and admins read past it. */
const canSeeSprint = (sprint, identities) => {
    if (!sprint || sprint.private !== true) return true;
    const mine = identitySet(identities);
    return (sprint.AssigneeUserId || []).map(String).some((id) => mine.has(id));
};

/* The same rule as a find/match clause, for queries that already read the sprint rows.
 * `prefix` names the embedded sprint when a pipeline has joined it, e.g. 'sprintArray.'. */
const visibleSprintClause = (identities, prefix = '') => ({
    $or: [
        { [`${prefix}private`]: { $ne: true } },
        { [`${prefix}AssigneeUserId`]: { $in: [...identitySet(identities)] } },
    ],
});

/* The same rule as an aggregation expression, for $lookup sub-pipelines and $cond. */
const visibleSprintExpr = (identities, assigneeField = '$AssigneeUserId', privateField = '$private') => ({
    $or: [
        { $ne: [privateField, true] },
        { $gt: [{ $size: { $setIntersection: [{ $ifNull: [assigneeField, []] }, [...identitySet(identities)]] } }, 0] },
    ],
});

/* The sprints in `projectIds` the caller is not on, as _ids to exclude a task by sprintId. */
const hiddenSprintIds = async (companyId, uid, projectIds) => {
    const projects = asObjectIds(projectIds);
    if (!projects.length) return [];
    const [sprints, identities] = await Promise.all([
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ projectId: { $in: projects }, private: true }, 'private AssigneeUserId'],
        }, 'find'),
        sprintIdentities(companyId, uid),
    ]);
    const mine = identitySet(identities);
    return (sprints || []).filter((sprint) => !canSeeSprint(sprint, mine)).map((sprint) => sprint._id);
};

const canSeeSprintById = async (companyId, uid, sprintId) => {
    if (!OBJECT_ID.test(String(sprintId || ''))) return true;
    const [sprint, identities] = await Promise.all([
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ _id: new mongoose.Types.ObjectId(String(sprintId)) }, 'private AssigneeUserId'],
        }, 'findOne'),
        sprintIdentities(companyId, uid),
    ]);
    return canSeeSprint(sprint, identities);
};

/* Owners and admins read past sprint privacy, so every caller-facing entry point starts here. */
const privileged = async (companyId, uid) => isPrivileged(await getRoleType(String(companyId || ''), String(uid || '')));

/* `{ sprintId: { $nin: [...] } }` for a task read already scoped to `projectIds`, or `{}`
 * when the caller may see every sprint in them. Spread into an existing find filter. */
const hiddenSprintFilter = async (companyId, uid, projectIds) => {
    if (await privileged(companyId, uid)) return {};
    const hidden = await hiddenSprintIds(companyId, uid, projectIds);
    return hidden.length ? { sprintId: { $nin: hidden } } : {};
};

/* Express middleware for the routes addressed by sprint id — the scrum board, the agile
 * reports, the hour and burndown charts. A private sprint the caller is not on answers 404
 * rather than 403, so the refusal says nothing the sprint list would not already say. */
const requireSprintAccess = (pick) => async (req, res, next) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const ids = [...new Set([].concat(pick(req) || []).map(String).filter((id) => OBJECT_ID.test(id)))];
        if (!ids.length || await privileged(companyId, req.uid)) return next();
        for (const id of ids) {
            if (!(await canSeeSprintById(companyId, req.uid, id))) {
                return res.status(404).json({ status: false, statusText: 'Sprint not found.', error: 'Not Found' });
            }
        }
        return next();
    } catch (error) {
        logger.error(`requireSprintAccess error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

module.exports = {
    TEAM_PREFIX,
    hiddenSprintFilter,
    requireSprintAccess,
    asObjectIds,
    canSeeSprint,
    canSeeSprintById,
    hiddenSprintIds,
    identitySet,
    sprintIdentities,
    visibleSprintClause,
    visibleSprintExpr,
};
