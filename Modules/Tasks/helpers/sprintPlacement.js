const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { taskIdMatch } = require('../../Comments/helpers/taskIdMatch');
const { scheduleReconciliation } = require('./reconcileTaskCount');

const asObjectId = (id) => (/^[0-9a-fA-F]{24}$/.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);

/* The fields a task carries of its sprint, as the app's move and create write them:
 * readers match `sprintArray.id` / `.folderId`, and folder views match `folderObjId`. */
const sprintPlacementOf = async (companyId, sprint) => {
    const sprintArray = { id: asObjectId(sprint._id), name: sprint.name || '' };
    const folderId = asObjectId(sprint.folderId);
    if (!folderId) return { set: { sprintId: sprintArray.id, sprintArray }, unset: { folderObjId: '' } };
    const folder = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.FOLDERS, data: [{ _id: folderId }, 'name'] }, 'findOne').catch(() => null);
    sprintArray.folderId = folderId;
    sprintArray.folderName = (folder && folder.name) || '';
    return { set: { sprintId: sprintArray.id, sprintArray, folderObjId: folderId } };
};

const changeSprintCount = (companyId, sprintId, by) => Promise.resolve(MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.SPRINTS, data: [{ _id: asObjectId(sprintId) }, { $inc: { tasks: by } }],
}, 'updateOne')).catch((error) => {
    logger.error(`error in update task count : ${error}`);
    scheduleReconciliation(companyId, sprintId);
});

const moveCommentThread = (companyId, { taskId, projectId, from, to }) => Promise.resolve(MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.COMMENTS,
    data: [
        { sprintId: asObjectId(from), taskId: taskIdMatch(taskId) },
        { $set: { sprintId: asObjectId(to), projectId: asObjectId(projectId), taskId: asObjectId(taskId) } },
        { timestamps: false },
    ],
}, 'updateMany')).catch((error) => { logger.error(`${error} ERROR IN UPDATE COMMENTS`); });

/* The rest of what the app's move (mongo_helper moveTaskFunction) does, for a writer that
 * updates the task itself: the sprint task counts and the task's comment thread follow it. */
const followSprintMove = async (companyId, { taskId, projectId, fromSprintId, toSprintId }) => {
    if (!asObjectId(fromSprintId) || String(fromSprintId) === String(toSprintId)) return;
    await Promise.all([
        changeSprintCount(companyId, toSprintId, 1),
        changeSprintCount(companyId, fromSprintId, -1),
        moveCommentThread(companyId, { taskId, projectId, from: fromSprintId, to: toSprintId }),
    ]);
};

module.exports = { sprintPlacementOf, followSprintMove };
