const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { projectAccess } = require('../../Config/contentAccess');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canSeeSprint, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');
const { OBJECT_ID } = require('./boardRules');

const NONE = Object.freeze({ visible: false, canEdit: false });

const listOf = async (companyId, projectId, sprintId) => {
    const sprint = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ _id: new mongoose.Types.ObjectId(String(sprintId)) }, { projectId: 1, private: 1, AssigneeUserId: 1, deletedStatusKey: 1 }],
    }, 'findOne');
    return sprint && String(sprint.projectId) === String(projectId) && sprint.deletedStatusKey !== 1 ? sprint : null;
};

/* A board is read by whoever can open its list: the project (Config/contentAccess, which leaves someone else's
 * personal list out for every role) and, for a private list, the people it is shared with plus owners and admins.
 * It is written under the rule a project's docs, forms and links are: no role key, so no existing company is
 * locked out, and a private space only by the people assigned to it. */
const boardAccess = async (companyId, uid, projectId, sprintId) => {
    if (![projectId, sprintId].every((id) => OBJECT_ID.test(String(id || '')))) return NONE;
    const project = await projectAccess(companyId, uid, projectId);
    if (!project.visible) return NONE;
    const sprint = await listOf(companyId, projectId, sprintId);
    if (!sprint) return NONE;
    if (sprint.private === true && !isPrivileged(await getRoleType(companyId, uid)) && !canSeeSprint(sprint, await sprintIdentities(companyId, uid))) return NONE;
    return { visible: true, canEdit: project.canEdit };
};

module.exports = { boardAccess };
