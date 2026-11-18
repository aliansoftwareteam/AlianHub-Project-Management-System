const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const domainEventBus = require('../../event/domainEventBus');

/* The summary and the area an AI column shows for a task: one kept value per task and kind, with what it was made
 * from, when, and who asked. The text is derived from the task and its thread, so it goes when they go (the trash,
 * a deleted comment, an erasure), it is read only through a task read's own access (taskValues.js), and it is not a
 * knowledge source. */

const SUMMARY = 'summary';
const CATEGORY = 'category';
const KINDS = [SUMMARY, CATEGORY];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const BEHIND = 'changed';
const TRASHED = 1;
const LOG_PREFIX = '[ai-task-values]';

const store = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.TASK_AI_VALUES, data }, method);

const kept = (companyId, taskId, kind) => store(companyId, [{ taskId: String(taskId), kind }, null, { lean: true }], 'findOne');

const keptMany = async (companyId, taskIds, kinds = KINDS) => (taskIds.length
    ? (await store(companyId, [{ taskId: { $in: taskIds.map(String) }, kind: { $in: kinds } }, null, { lean: true }], 'find')) || []
    : []);

const keep = async (companyId, { taskId, kind, value, basis, madeBy }) => {
    const row = { value, basis: String(basis), madeAt: new Date(), madeBy: String(madeBy || '') };
    await store(companyId, [{ taskId: String(taskId), kind }, { $set: row }, { upsert: true }], 'updateOne');
    return row;
};

const removed = (result) => (result && result.deletedCount) || 0;

const forgetTask = async (companyId, taskId, kinds = KINDS) => removed(await store(companyId, [{ taskId: String(taskId), kind: { $in: kinds } }], 'deleteMany'));

const forgetSummary = (companyId, taskId) => forgetTask(companyId, taskId, [SUMMARY]);

/* An edited comment leaves the count as it was, so the summary is marked instead: it stays readable and says it is behind. */
const markSummaryBehind = (companyId, taskId) => store(companyId, [{ taskId: String(taskId), kind: SUMMARY }, { $set: { basis: BEHIND } }], 'updateOne');

const forgetSummaryOfComment = async (companyId, commentId) => {
    if (!OBJECT_ID.test(String(commentId || ''))) return 0;
    const comment = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.COMMENTS, data: [{ _id: new mongoose.Types.ObjectId(String(commentId)) }, { taskId: 1 }],
    }, 'findOne');
    return comment && OBJECT_ID.test(String(comment.taskId || '')) ? forgetSummary(companyId, comment.taskId) : 0;
};

const validPerson = (userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('Erasing kept AI values needs a valid user id.');
    return id;
};

/* A summary names the people in its thread, so a person's erasure takes the summary of every thread they wrote in
 * as well as the values they asked for. */
const erasePerson = async (companyId, userId) => {
    const id = validPerson(userId);
    const wroteIn = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.COMMENTS, data: ['taskId', { userId: { $in: [id, new mongoose.Types.ObjectId(id)] } }],
    }, 'distinct');
    const threads = [...new Set((wroteIn || []).map(String).filter((taskId) => OBJECT_ID.test(taskId)))];
    const theirs = removed(await store(companyId, [{ madeBy: id }], 'deleteMany'));
    const about = threads.length ? removed(await store(companyId, [{ taskId: { $in: threads }, kind: SUMMARY }], 'deleteMany')) : 0;
    return theirs + about;
};

const hasValues = async (companyId, userId) => Boolean(await store(companyId, [{ madeBy: validPerson(userId) }, '_id', { lean: true }], 'findOne'));

const taskIdOf = (envelope) => String((envelope && envelope.entity && envelope.entity.id) || '');

/* The envelope says the deletion state changed, not what it is now: an archive or a restore keeps the values. */
const onTaskEnvelope = async (envelope) => {
    try {
        const isTask = envelope && envelope.entity && envelope.entity.kind === 'task';
        if (!isTask || !(envelope.changedFields || []).includes('deletedStatusKey') || !OBJECT_ID.test(taskIdOf(envelope))) return 0;
        const task = await MongoDbCrudOpration(String(envelope.companyId), {
            type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(taskIdOf(envelope)) }, { deletedStatusKey: 1 }],
        }, 'findOne');
        return task && Number(task.deletedStatusKey) !== TRASHED ? 0 : await forgetTask(envelope.companyId, taskIdOf(envelope));
    } catch (error) {
        logger.error(`${LOG_PREFIX} ${domainEventBus.eventLabel(envelope)}: ${domainEventBus.failureText(error)}`);
        return 0;
    }
};

let started = false;
const start = () => {
    if (started) return;
    started = true;
    domainEventBus.bus.on('domain.event', onTaskEnvelope);
};

module.exports = {
    SUMMARY, CATEGORY, KINDS,
    kept, keptMany, keep, forgetTask, forgetSummary, markSummaryBehind, forgetSummaryOfComment, erasePerson, hasValues, onTaskEnvelope, start,
};
