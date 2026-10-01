const logger = require('../../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../../event/socketEventEmitter');
const { HandleHistory } = require('../mongo_helper');
const { TaskWriteRefusal, taskNotFound, plainIdOf, escapeText } = require('../taskWriteFields');
const extraLists = require('../taskExtraLists');

const { TASK_NOT_FOUND, TASK_CHANGED, HISTORY_KEY } = extraLists;

const MAX_TASKS_PER_REQUEST = 500;

const refusalOf = (verdict) => (verdict === TASK_NOT_FOUND ? taskNotFound() : new TaskWriteRefusal(verdict.statusCode, verdict.reason, verdict.code));

const passed = (verdict) => {
    if (!verdict.ok) throw refusalOf(verdict);
    return verdict;
};

const requiredId = (value, name) => {
    const { id } = plainIdOf(value);
    if (!id) throw new TaskWriteRefusal(400, `${name} must be an id.`, 'INVALID_ID');
    return id.toLowerCase();
};

const callerOf = (userData) => {
    const uid = userData && userData.id ? String(userData.id) : '';
    if (!uid) throw new TaskWriteRefusal(401, 'A signed-in user is required for this request.');
    return uid;
};

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

module.exports = {

    async addToList({ companyId, taskId, sprintId, userData }) {
        const uid = callerOf(userData);
        const task = await extraLists.storedTask(companyId, requiredId(taskId, 'taskId'));
        const listId = requiredId(sprintId, 'sprintId');
        passed(await extraLists.homeJudge(companyId, uid).hold(task));
        const destination = passed(await extraLists.destinationFor(companyId, uid, listId));
        const placed = passed(await place(companyId, task, destination, userData));
        return { taskId: String(task._id), extraLists: await extraLists.listsForViewer(companyId, uid, placed.task) };
    },

    async removeFromList({ companyId, taskId, sprintId, userData }) {
        const uid = callerOf(userData);
        const task = await extraLists.storedTask(companyId, requiredId(taskId, 'taskId'));
        const { entry, list } = passed(await extraLists.removalFor(companyId, uid, task, requiredId(sprintId, 'sprintId')));
        const updated = await writeTask(companyId, extraLists.removalOf(task, entry.sprintId));
        if (!updated) throw taskNotFound();
        announce(updated);
        const where = extraLists.listPhrase(task, entry, list, escapeText);
        record(companyId, task, `<b>${userData.Employee_Name}</b> has removed <b>${escapeText(task.TaskName)}</b> from ${where}.`, userData);
        return { taskId: String(task._id), extraLists: await extraLists.listsForViewer(companyId, uid, updated) };
    },

    /* The list is judged once and refuses the whole request; each task is then judged alone, and one that cannot be added is reported, a hidden one exactly as a missing one. */
    async bulkAddToList({ companyId, taskIds, sprintId, userData }) {
        const uid = callerOf(userData);
        if (!Array.isArray(taskIds) || !taskIds.length) throw new TaskWriteRefusal(400, 'taskIds must list at least one task.', 'INVALID_ID');
        const ids = [...new Set(taskIds.map((id) => requiredId(id, 'taskIds')))];
        if (ids.length > MAX_TASKS_PER_REQUEST) throw new TaskWriteRefusal(400, `taskIds may name at most ${MAX_TASKS_PER_REQUEST} tasks.`, 'TOO_MANY_TASKS');
        const destination = passed(await extraLists.destinationFor(companyId, uid, requiredId(sprintId, 'sprintId')));

        const tasks = await extraLists.storedTasks(companyId, ids);
        const judge = extraLists.homeJudge(companyId, uid);
        const added = [];
        const skipped = [];
        for (const id of ids) {
            const task = tasks.get(id);
            const held = await judge.hold(task);
            const placed = held.ok ? await place(companyId, task, destination, userData) : held;
            if (placed.ok) added.push(id);
            else skipped.push({ taskId: id, code: placed.code, reason: placed.reason });
        }
        return { projectId: String(destination.project._id), sprintId: String(destination.list._id), added, skipped };
    },
};
