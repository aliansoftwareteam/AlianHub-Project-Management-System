const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const asObjectIds = (ids) => (ids || [])
    .filter((id) => OBJECT_ID.test(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

/* A private sprint belongs to the people it is shared with; owners and admins read past
 * it. The sidebar's sprint list (Project/controller/getSprintFolder.js), global search and
 * the advanced filter all state this rule, so the task reads state it from here. */
const canSeeSprint = (sprint, uid) => !sprint
    || sprint.private !== true
    || (sprint.AssigneeUserId || []).map(String).includes(String(uid));

/* The sprints in `projectIds` the caller is not on, as _ids to exclude a task by sprintId. */
const hiddenSprintIds = async (companyId, uid, projectIds) => {
    const projects = asObjectIds(projectIds);
    if (!projects.length) return [];
    const sprints = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ projectId: { $in: projects }, private: true }, 'private AssigneeUserId'],
    }, 'find');
    return (sprints || []).filter((sprint) => !canSeeSprint(sprint, uid)).map((sprint) => sprint._id);
};

const canSeeSprintById = async (companyId, uid, sprintId) => {
    if (!OBJECT_ID.test(String(sprintId || ''))) return true;
    const sprint = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ _id: new mongoose.Types.ObjectId(String(sprintId)) }, 'private AssigneeUserId'],
    }, 'findOne');
    return canSeeSprint(sprint, uid);
};

module.exports = {
    asObjectIds,
    canSeeSprint,
    canSeeSprintById,
    hiddenSprintIds,
};
