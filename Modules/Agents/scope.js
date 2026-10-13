const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { fetchRules } = require('../settings/securityPermissions/controller');
const { isPrivileged } = require('../../Config/roleTypes');
const { allowsProject } = require('../../Config/tokenNarrowing');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { arrangeRules, rolePermission, PRIVATE_PROJECTS, seesEveryPrivateProject } = require('../../Config/rulePermissions');

// Which projects a given person may open.
//
// Anything that reads on a user's behalf — Ask, the bulk router — has to start
// here, because the one rule those features must never break is that they widen
// nobody's permissions. The rule is decideProjectAccess's in Config/projectAccess.js:
// public spaces are visible to every member, a private space to its assignees and to
// a role that lists every private space, and a personal list only to its owner.

const NOT_DELETED = { deletedStatusKey: { $nin: [1] } };

const visibleProjects = async (companyId, uid) => {
    const [teams, membership, rules] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TEAMS_MANAGEMENT, data: [{ assigneeUsersArray: { $in: [String(uid)] } }, { _id: 1 }] }, 'find').catch(() => []),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(uid), ...ACTIVE_SEAT }, { roleType: 1, _id: 0 }] }, 'findOne').catch(() => null),
        fetchRules(companyId).catch(() => []),
    ]);
    if (!membership) return [];
    const { roleType } = membership;
    const everyPrivateProject = isPrivileged(roleType)
        || seesEveryPrivateProject(rolePermission(arrangeRules(rules), roleType, PRIVATE_PROJECTS));
    const assignedTo = { AssigneeUserId: { $in: [String(uid), ...(teams || []).map((t) => `tId_${t._id}`)] } };

    const or = [
        { isPrivateSpace: false, ...NOT_DELETED },
        { isPrivateSpace: true, ...NOT_DELETED, ...(everyPrivateProject ? {} : assignedTo) },
    ];
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ $or: or, $and: [{ $or: [{ isPersonal: { $ne: true } }, { personalOwner: String(uid) }] }] }, { ProjectName: 1 }],
    }, 'find').catch(() => []);
    return (projects || []).filter((project) => allowsProject(uid, project._id));
};

const visibleProjectIds = async (companyId, uid) => (await visibleProjects(companyId, uid)).map((p) => String(p._id));

module.exports = { visibleProjects, visibleProjectIds };
