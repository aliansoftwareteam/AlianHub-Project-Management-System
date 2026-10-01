const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { taskListProjectIds } = require('../Tasks/helpers/taskListProjects');

/* The task, when it sits in a project whose tasks `uid` may list; null otherwise. Checked
 * before any cache read or model call, so a hidden task costs nothing and says
 * nothing about itself. */
async function visibleTask({ companyId, uid, taskId, projection }) {
    if (!uid || !mongoose.Types.ObjectId.isValid(String(taskId || ''))) return null;
    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: new mongoose.Types.ObjectId(String(taskId)), deletedStatusKey: { $ne: 1 } }, { ...projection, ProjectID: 1 }],
    }, 'findOne');
    if (!task || !task.ProjectID) return null;
    const listable = await taskListProjectIds(companyId, String(uid));
    return listable.map(String).includes(String(task.ProjectID)) ? task : null;
}

module.exports = { visibleTask, TASK_NOT_FOUND: 'task not found' };
