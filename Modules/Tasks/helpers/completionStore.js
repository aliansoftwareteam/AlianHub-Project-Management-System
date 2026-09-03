const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const rules = require('./completion');

// The I/O side of provenance. Reads the task and its time logs, applies the pure
// rules, and returns the `completion` object to $set. Never throws into a status
// update: a provenance failure must not block someone finishing their work.

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const loadTask = (companyId, taskId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ _id: oid(taskId) }, 'completion status statusType statusKey TaskName ProjectID sprintId'],
}, 'findOne');

const loadTimeLogs = (companyId, taskId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TIMESHEET,
    data: [{ TicketID: String(taskId) }, 'Loggeduser LogTimeDuration actorType agentId viaAccount'],
}, 'find');

/* Current record with hours refreshed from the time logs. */
const current = async (companyId, taskId) => {
    const [task, logs] = await Promise.all([loadTask(companyId, taskId), loadTimeLogs(companyId, taskId).catch(() => [])]);
    if (!task) return { task: null, completion: rules.empty() };
    return { task, completion: rules.mergeLoggedHours(task.completion, rules.workFromTimeLogs(logs)) };
};

/* Completion to write alongside a status change. Returns null when nothing
 * should be written (task missing) or { completion } / { error }. */
const forStatusChange = async (companyId, taskId, { toStatus, actor, fromStatus }) => {
    try {
        const { task, completion } = await current(companyId, taskId);
        if (!task) return null;
        const from = fromStatus || { statusType: task.statusType, name: task.status && task.status.text };
        return rules.applyStatusChange({ completion, fromStatus: from, toStatus, actor });
    } catch (e) {
        logger.error(`completion.forStatusChange ${taskId}: ${e.message}`);
        return null;
    }
};

const save = async (companyId, taskId, completion) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ _id: oid(taskId) }, { $set: { completion } }, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

/* An agent (or person) touched the task through an action. Hours 0 unless given. */
const recordWork = async (companyId, taskId, entry) => {
    try {
        const { task, completion } = await current(companyId, taskId);
        if (!task) return null;
        const next = rules.addWork(completion, entry);
        await save(companyId, taskId, next);
        return next;
    } catch (e) {
        logger.error(`completion.recordWork ${taskId}: ${e.message}`);
        return null;
    }
};

const markChecked = async (companyId, taskId, actor) => {
    const { task, completion } = await current(companyId, taskId);
    if (!task) return { error: 'Task not found.' };
    const result = rules.markChecked(completion, actor);
    if (result.error) return { error: result.error };
    const saved = await save(companyId, taskId, result.completion);
    return { task: saved, completion: result.completion };
};

module.exports = { current, forStatusChange, recordWork, markChecked, save, loadTimeLogs };
