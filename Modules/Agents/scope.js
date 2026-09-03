const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { fetchRules } = require('../settings/securityPermissions/controller');

// Which projects a given person may open.
//
// Anything that reads on a user's behalf — Ask, the bulk router — has to start
// here, because the one rule those features must never break is that they widen
// nobody's permissions. This mirrors Modules/Project getProjectList: public
// spaces are visible to every member, private spaces only where the role's
// private_projects permission allows, and a personal list only to its owner.

const visibleProjects = async (companyId, uid) => {
    const [teams, membership, rules] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TEAMS_MANAGEMENT, data: [{ assigneeUsersArray: { $in: [String(uid)] } }, { _id: 1 }] }, 'find').catch(() => []),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: String(uid) }, { roleType: 1, _id: 0 }] }, 'findOne').catch(() => null),
        fetchRules(companyId).catch(() => []),
    ]);
    const roleType = membership && membership.roleType;
    const nonAdmin = roleType !== 1 && roleType !== 2;
    const privateRule = (rules || []).find((r) => r && r.key === 'private_projects') || {};
    const privatePermission = ((privateRule.roles || []).find((r) => r.key === roleType) || {}).permission;
    const teamIds = (teams || []).map((t) => `tId_${t._id}`);

    const or = [{ isPrivateSpace: false, deletedStatusKey: { $nin: [1] } }];
    if (!nonAdmin || privatePermission !== null) {
        or.push({
            isPrivateSpace: true,
            deletedStatusKey: { $nin: [1] },
            ...(nonAdmin && privatePermission === 1 ? { AssigneeUserId: { $in: [String(uid), ...teamIds] } } : {}),
        });
    }
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ $or: or, $and: [{ $or: [{ isPersonal: { $ne: true } }, { personalOwner: String(uid) }] }] }, { ProjectName: 1 }],
    }, 'find').catch(() => []);
    return projects || [];
};

const visibleProjectIds = async (companyId, uid) => (await visibleProjects(companyId, uid)).map((p) => String(p._id));

module.exports = { visibleProjects, visibleProjectIds };
