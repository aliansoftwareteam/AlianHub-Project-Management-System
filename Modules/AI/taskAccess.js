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

/* The same rule for many tasks at once: those of `taskIds` that sit, outside the trash, in a project `uid` can open. */
async function visibleTasks({ companyId, uid, taskIds, projection }) {
    const ids = [...new Set((taskIds || []).map(String).filter((id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24))];
    if (!uid || !ids.length) return [];
    const [tasks, visible] = await Promise.all([
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) }, deletedStatusKey: { $ne: 1 } }, { ...projection, ProjectID: 1 }],
        }, 'find'),
        scope.visibleProjectIds(companyId, String(uid)),
    ]);
    const open = new Set((visible || []).map(String));
    return (tasks || []).filter((task) => task.ProjectID && open.has(String(task.ProjectID)));
}

module.exports = { visibleTask, visibleTasks, TASK_NOT_FOUND: 'task not found' };
