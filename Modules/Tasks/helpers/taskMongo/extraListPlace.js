const logger = require('../../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../../event/socketEventEmitter');
const { HandleHistory } = require('../mongo_helper');
const { escapeText } = require('../taskWriteFields');
const extraLists = require('../taskExtraLists');

const { TASK_CHANGED, HISTORY_KEY } = extraLists;

const writeTask = (companyId, { filter, update }) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [filter, update, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

/* Sent as every task update is, to the room of the task's home; the list's own room hears nothing yet. */
const announce = (task) => socketEmitter.emit('update', { type: 'update', data: task, updatedFields: { extraLists: task.extraLists || [] }, module: 'task' });

const record = (companyId, task, message, userData) => HandleHistory('task', companyId, task.ProjectID, task._id, { key: HISTORY_KEY, message }, userData)
    .catch((error) => { logger.error(`ERROR in task extra list history: ${error && error.message}`); });

const place = async (companyId, task, destination, userData) => {
    const fit = extraLists.canAddToList(task, destination.list._id);
    if (!fit.ok) return { ...fit, statusCode: 400 };
    const addition = extraLists.additionOf(task, destination, userData.id);
    const updated = await writeTask(companyId, addition);
    if (!updated) return TASK_CHANGED;
    announce(updated);
    const where = extraLists.listPhrase(task, addition.update.$push.extraLists, destination.list, escapeText);
    record(companyId, task, `<b>${userData.Employee_Name}</b> has added <b>${escapeText(task.TaskName)}</b> to ${where}.`, userData);
    return { ok: true, task: updated };
};

/* The welcome project's second list: the home and the list are judged by the rules alone, because
 * the seeder has no caller whose access could be judged. */
const placeForSample = async ({ companyId, taskId, list, project, userData }) => {
    const task = await extraLists.storedTask(companyId, taskId);
    const home = { statusType: project.statusType, deletedStatusKey: 0, isPersonal: false };
    const fit = [extraLists.canHoldExtraLists(task, home), extraLists.canBeExtraList(list, home)].find((verdict) => !verdict.ok);
    if (fit) throw new Error(fit.reason);
    const placed = await place(companyId, task, { list, project: { ...home, _id: project._id } }, userData);
    if (!placed.ok) throw new Error(placed.reason);
    return placed.task;
};

module.exports = { writeTask, announce, record, place, placeForSample };
