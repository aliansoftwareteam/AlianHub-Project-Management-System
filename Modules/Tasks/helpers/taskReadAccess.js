const { canReadProject } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprintById } = require('../../Sprints/helpers/sprintVisibility');

/* A record with no project behind it has no project rule to inherit. The only such records the
 * app writes are main-chat conversations, which belong to the people in them, owners included;
 * anything else (a task whose project is gone) is refused. */
const isChatParticipant = (task, uid) => task.mainChat === true
    && (task.AssigneeUserId || []).map(String).includes(String(uid));

const canReadTask = async (companyId, uid, task) => {
    if (!task) return false;
    const project = await canReadProject(companyId, uid, task.ProjectID);
    if (project.missing) return isChatParticipant(task, uid);
    if (!project.allowed) return false;
    if (isPrivileged(await getRoleType(companyId, uid))) return true;
    return canSeeSprintById(companyId, uid, task.sprintId);
};

module.exports = { canReadTask };
