const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');

const TEAM_PREFIX = 'tId_';
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// Starring and watching write the caller's own entry on the project document, and the
// web app offers both on every project a member can see, assigned or not.
const isOwnPreferenceUpdate = (uid, updateObject, key) => {
    const fields = Object.keys(updateObject || {});
    return fields.length > 0 && fields.every((field) => {
        const value = updateObject[field];
        if (field === 'favouriteTasks') {
            return (key === '$addToSet' || key === '$pull')
                && Boolean(value) && typeof value === 'object'
                && Object.keys(value).length === 1 && String(value.userId) === uid;
        }
        return field === `watchers.${uid}` && (!key || key === '$set' || key === '$unset');
    });
};

const isAssigned = async (companyId, uid, assigneeUserId) => {
    const assignees = (Array.isArray(assigneeUserId) ? assigneeUserId : []).map(String);
    if (assignees.includes(uid)) return true;
    const teamIds = assignees
        .filter((id) => id.startsWith(TEAM_PREFIX))
        .map((id) => id.slice(TEAM_PREFIX.length))
        .filter((id) => OBJECT_ID_PATTERN.test(id));
    if (!teamIds.length) return false;
    const team = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TEAMS_MANAGEMENT,
        data: [{ _id: { $in: teamIds }, assigneeUsersArray: { $in: [uid] } }, { _id: 1 }],
    }, 'findOne');
    return Boolean(team);
};

const canUpdateProject = async ({ companyId, uid, projectId, updateObject, key }) => {
    if (!uid) return false;
    const caller = String(uid);
    const roleType = await getRoleType(companyId, caller);
    if (roleType === null) return false;
    if (isPrivileged(roleType)) return true;
    if (isOwnPreferenceUpdate(caller, updateObject, key)) return true;
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: projectId }, { AssigneeUserId: 1 }],
    }, 'findOne');
    if (!project) return false;
    return isAssigned(companyId, caller, project.AssigneeUserId);
};

module.exports = { canUpdateProject, isOwnPreferenceUpdate };
