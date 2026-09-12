const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../../Config/config');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TEAM_PREFIX = 'tId_';
const IDENTITY_TTL_SECONDS = 60;

const asObjectIds = (ids) => (ids || [])
    .filter((id) => OBJECT_ID.test(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

/* A sprint's AssigneeUserId holds user ids and `tId_<teamId>` entries, so membership is
 * decided against the caller's own identities rather than their user id alone. Expanding
 * the caller's teams once per company and user costs a single query instead of one per
 * sprint; the key carries "teams" so Modules/Teams' removeCache('teams', true) drops it
 * as soon as a membership changes. */
const sprintIdentities = async (companyId, uid) => {
    const key = `teams:sprintIdentities:${companyId}:${uid}`;
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

module.exports = {
    TEAM_PREFIX,
    asObjectIds,
    canSeeSprint,
    canSeeSprintById,
    hiddenSprintIds,
    identitySet,
    sprintIdentities,
    visibleSprintClause,
    visibleSprintExpr,
};
