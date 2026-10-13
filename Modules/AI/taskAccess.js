const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../../Config/projectAccess');
const { readableTasks, TASK_READ_FIELDS } = require('../Tasks/helpers/taskReadAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NOT_TRASHED = { deletedStatusKey: { $ne: 1 } };

/* A direct message sits in no project, and no assistant feature reads one. */
const inAProject = async (companyId, uid, tasks) => {
    const kept = [];
    for (const task of tasks) {
        if (task.mainChat !== true || (await canReadProject(companyId, uid, task.ProjectID)).allowed) kept.push(task);
    }
    return kept;
};

const opened = async (companyId, uid, tasks) => inAProject(companyId, uid, await readableTasks(companyId, uid, tasks));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/* The task, when it is outside the trash and `uid` can open it by the rule the task routes read by; null otherwise.
 * Checked before any cache read or model call, so a hidden task costs nothing and says nothing about itself. */
async function visibleTask({ companyId, uid, taskId, projection }) {
    if (!uid || !OBJECT_ID.test(String(taskId || ''))) return null;
    const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId), ...NOT_TRASHED }, { ...projection, ...TASK_READ_FIELDS }] }, 'findOne');
    const [open] = task ? await opened(companyId, String(uid), [task]) : [];
    return open || null;
}

/* The same rule for many tasks at once. */
async function visibleTasks({ companyId, uid, taskIds, projection }) {
    const ids = [...new Set((taskIds || []).map(String).filter((id) => OBJECT_ID.test(id)))];
    if (!uid || !ids.length) return [];
    const tasks = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: ids.map(oid) }, ...NOT_TRASHED }, { ...projection, ...TASK_READ_FIELDS }] }, 'find');
    return opened(companyId, String(uid), tasks || []);
}

module.exports = { visibleTask, visibleTasks, TASK_NOT_FOUND: 'task not found' };
