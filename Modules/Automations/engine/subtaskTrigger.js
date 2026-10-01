const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const domainEventBus = require('../../../event/domainEventBus');
const { isClosedTask } = require('../../Tasks/helpers/taskSignals');

// Publishes task.subtasks_all_done on a parent when its last open subtask closes.
//
// Every status change reaches the bus as an envelope, whoever wrote it, so this
// listens there. The parent holds `subtasksAllDone` while it has fired and no
// subtask has been open since: claiming that flag with a conditional write is
// what makes two subtasks closed together fire once, and clearing it whenever a
// subtask is seen open is what lets a reopened or added subtask fire again.

const EVENT = 'task.subtasks_all_done';
const LOG_PREFIX = '[automation-subtasks]';
const STATUS_FIELDS = ['status', 'statusType', 'statusKey'];
const MEMBERSHIP_FIELDS = ['ParentTaskId', 'deletedStatusKey'];

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const changed = (envelope, fields) => (envelope.changedFields || []).some((field) => fields.includes(field));

const parentOf = (envelope) => {
    const data = envelope && envelope.entity && envelope.entity.kind === 'task' ? envelope.data : null;
    return data && data.isParentTask === false && data.ParentTaskId ? String(data.ParentTaskId) : '';
};

const touchesSubtaskState = (envelope) => envelope.type === 'task.created' || changed(envelope, STATUS_FIELDS) || changed(envelope, MEMBERSHIP_FIELDS);

/* A subtask the bus has not seen before has no earlier state, and is read as having been open. */
const closedJustNow = (envelope) => changed(envelope, STATUS_FIELDS)
    && isClosedTask(envelope.data)
    && !(envelope.previous && isClosedTask(envelope.previous));

const liveSubtasks = (companyId, parentId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ ParentTaskId: parentId, isParentTask: false, deletedStatusKey: 0 }, { statusType: 1, status: 1 }],
}, 'find');

/* The flag is bookkeeping, not an edit: no socket emit, which would publish task.updated for a field
 * no person changed, and no updatedAt, which auto-archive and the digests read as someone's work. */
const setFlag = (companyId, parentId, from, to) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ _id: oid(parentId), subtasksAllDone: from, deletedStatusKey: 0 }, { $set: { subtasksAllDone: to } }, { returnDocument: 'after', timestamps: false }],
}, 'findOneAndUpdate');

const sync = async (envelope) => {
    const parentId = parentOf(envelope);
    if (!parentId || !oid(parentId) || !touchesSubtaskState(envelope)) return null;
    const companyId = envelope.companyId;

    const subtasks = (await liveSubtasks(companyId, parentId)) || [];
    if (subtasks.some((subtask) => !isClosedTask(subtask))) {
        await setFlag(companyId, parentId, true, false);
        return null;
    }
    if (!subtasks.length) return null;

    const parent = await setFlag(companyId, parentId, { $ne: true }, true);
    if (!parent || !closedJustNow(envelope)) return null;
    return domainEventBus.publishTaskEvent({ companyId, type: EVENT, doc: parent, actor: envelope.actor, depth: envelope.depth });
};

/* The bus drops what a listener returns, so a failure is logged here rather than left unhandled. */
const onEnvelope = (envelope) => sync(envelope).catch((error) => {
    logger.error(`${LOG_PREFIX} ${domainEventBus.eventLabel(envelope)}: ${domainEventBus.failureText(error)}`);
    return null;
});

module.exports = { EVENT, onEnvelope, closedJustNow };
