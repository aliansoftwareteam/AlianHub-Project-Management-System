const { canReadProject } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprintById } = require('../../Sprints/helpers/sprintVisibility');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { visibilityStage, toObjectIds } = require('./taskQueryGuard');

/* Deleted, archived, or in a deleted project. */
const NOT_LIVE = Object.freeze([1, 2, 7]);

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

/* Which of `ids` the person can open, read in one query under the rule the task query applies to every read. A chat row is
 * not a task anyone links to or votes on, so it is never among them. `live` leaves out what is deleted or archived. */
const openableTasks = async (companyId, uid, ids, { projection = {}, live = true } = {}) => {
    const wanted = toObjectIds([...new Set((ids || []).map(String))]);
    if (!wanted.length || !uid) return [];
    const scope = await visibilityStage(companyId, String(uid));
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [[
            scope,
            { $match: { _id: { $in: wanted }, mainChat: { $ne: true }, ...(live ? { deletedStatusKey: { $nin: NOT_LIVE } } : {}) } },
            { $project: { ...projection, _id: 1 } },
        ]],
    }, 'aggregate');
    return rows || [];
};

module.exports = { canReadTask, openableTasks };
