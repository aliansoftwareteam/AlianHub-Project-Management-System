const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { taskIdMatch } = require('../../Comments/helpers/taskIdMatch');
const { scheduleReconciliation } = require('./reconcileTaskCount');
const { placeDescendants } = require('./taskTree');
const socketEmitter = require('../../../event/socketEventEmitter');

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

/* A task's subtasks, at every level, live where it lives: they take the placement it was given,
 * and each one's sprint count and comment thread follow as the task's own did. */
const moveDescendants = async (companyId, topId, placement, toSprintId) => {
    const rows = await placeDescendants(companyId, topId, placement);
    for (const row of rows) {
        socketEmitter.emit('update', { type: 'update', data: { ...row, ...placement.set }, updatedFields: placement.set, module: 'task', companyId });
        await followSprintMove(companyId, { taskId: row._id, projectId: row.ProjectID, fromSprintId: row.sprintId, toSprintId });
    }
    return rows.length;
};

module.exports = { sprintPlacementOf, followSprintMove, moveDescendants };
