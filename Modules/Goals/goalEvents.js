const domainEventBus = require('../../event/domainEventBus');
const logger = require('../../Config/loggerConfig');
const { TASKS } = require('./helpers/goalRules');
const { LIVE, crud, writeAtRevision } = require('./goalStore');

const FOLD_MS = 5000;
const WRITE_PASSES = 3;
const CREATED = 'task.created';

/* The task fields a count reads. An envelope is named after one field only (a status change that also
 * archived the task is a task.status_changed), so the changed fields decide, not the event's name.
 * Two writers announce a counted change under another field: a card dragged to another status group
 * writes the status through the index route, which names only groupByStatusIndex, and the automation
 * engine announces a task it made as an update naming `created`. */
const COUNTED_FIELDS = Object.freeze(['statusType', 'status', 'statusKey', 'sprintId', 'deletedStatusKey', 'isParentTask', 'ParentTaskId', 'groupByStatusIndex', 'created']);

const touches = (envelope) => Boolean(envelope) && Boolean(envelope.entity) && envelope.entity.kind === 'task'
    && (envelope.type === CREATED || (envelope.changedFields || []).some((field) => COUNTED_FIELDS.includes(field)));

/* A move is counted in the list the task left as well, which the envelope knows only when it saw the task before. */
const listsOf = (envelope) => [envelope.scope && envelope.scope.sprintId, envelope.data && envelope.data.sprintId, envelope.previous && envelope.previous.sprintId]
    .filter(Boolean).map(String);

const naming = (sprintIds, taskIds) => ({
    kind: TASKS,
    dirty: { $ne: true },
    $or: [{ 'sources.sprintIds': { $in: sprintIds } }, { 'sources.taskIds': { $in: taskIds } }],
});

const names = (target, sprintIds, taskIds) => target.kind === TASKS && target.dirty !== true
    && (((target.sources || {}).sprintIds || []).some((id) => sprintIds.includes(String(id)))
        || ((target.sources || {}).taskIds || []).some((id) => taskIds.includes(String(id))));

/* Only the mark is written here; the count is made again by the next read. A goal already marked is not written again. */
const markDirty = async (companyId, sprintIds, taskIds) => {
    let marked = 0;
    for (let pass = 0; pass < WRITE_PASSES; pass += 1) {
        const goals = (await crud(companyId, [{ deletedStatusKey: LIVE, targets: { $elemMatch: naming(sprintIds, taskIds) } }, null, { lean: true }], 'find')) || [];
        let missed = false;
        for (const goal of goals) {
            const targets = goal.targets.map((target) => (names(target, sprintIds, taskIds) ? { ...target, dirty: true } : target));
            if (await writeAtRevision(companyId, goal, { targets })) marked += 1;
            else missed = true;
        }
        if (!missed) return marked;
    }
    return marked;
};

// companyId -> { sprintIds, taskIds, timer }
const pending = new Map();
const writing = new Set();

const flush = (companyId) => {
    const entry = pending.get(companyId);
    if (!entry) return Promise.resolve(0);
    pending.delete(companyId);
    clearTimeout(entry.timer);
    const write = markDirty(companyId, [...entry.sprintIds], [...entry.taskIds])
        .catch((error) => {
            logger.error(`goals: marking counts of company ${companyId} for a recount failed: ${error.message || error}`);
            return 0;
        })
        .finally(() => writing.delete(write));
    writing.add(write);
    return write;
};

/* Everything that happens in a company within the window is folded into one read of its goals. */
const onEnvelope = (envelope) => {
    try {
        if (!touches(envelope) || !envelope.companyId) return;
        const companyId = String(envelope.companyId);
        let entry = pending.get(companyId);
        if (!entry) {
            entry = { sprintIds: new Set(), taskIds: new Set(), timer: setTimeout(() => flush(companyId), FOLD_MS) };
            if (typeof entry.timer.unref === 'function') entry.timer.unref();
            pending.set(companyId, entry);
        }
        listsOf(envelope).forEach((id) => entry.sprintIds.add(id));
        entry.taskIds.add(String(envelope.entity.id));
    } catch (error) {
        logger.error(`goals: task event handling failed: ${error.message || error}`);
    }
};

const flushAll = async () => {
    await Promise.all([...pending.keys()].map(flush));
    await Promise.all([...writing]);
};

let started = false;

const start = () => {
    if (started) return;
    started = true;
    domainEventBus.start();
    domainEventBus.bus.on('domain.event', onEnvelope);
};

module.exports = { FOLD_MS, COUNTED_FIELDS, touches, listsOf, markDirty, onEnvelope, flushAll, start };
