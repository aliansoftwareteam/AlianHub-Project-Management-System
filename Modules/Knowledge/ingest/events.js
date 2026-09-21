const domainEventBus = require('../../../event/domainEventBus');
const logger = require('../../../Config/loggerConfig');
const flag = require('../flag');
const indexer = require('./indexer');
const backfill = require('./backfill');

// The indexer's side of the domain event bus. With KNOWLEDGE_INDEXER off nothing subscribes
// and nothing is published, so no page, comment, call, task, project or member write does any extra work.

const LOG_PREFIX = '[knowledge-indexer]';
const SOURCE_EVENTS = [
    'page.created', 'page.updated', 'page.deleted',
    'comment.created', 'comment.updated', 'comment.deleted',
    'transcript.created', 'transcript.updated', 'transcript.deleted',
    'guide.saved',
];
/* Task envelopes are published once Automations init starts the bus; every kind but created can
 * carry a change to who sees the task's comments and files. */
const TASK_EVENTS = ['task.updated', 'task.sprint_changed', 'task.status_changed', 'task.assignee_changed', 'task.priority_changed', 'task.lead_changed', 'task.due_date_changed', 'task.renamed'];
/* A created task's envelope does not say whether it came with attachments (a form submission
 * and a duplicated task do), so each one costs a read of its attachments. */
const TASK_CREATED = 'task.created';
const TASK_VISIBILITY_FIELDS = ['deletedStatusKey', 'sprintId', 'ProjectID'];
const TASK_MOVE_FIELDS = ['sprintId', 'ProjectID'];
const TASK_FILES_FIELD = 'attachments';
const TASK_WATCHED_FIELDS = [...TASK_VISIBILITY_FIELDS, TASK_FILES_FIELD];
/* A bulk move of hundreds of tasks is hundreds of envelopes at once; each company handles only this
 * many at a time and queues the rest. */
const MAX_CONCURRENT_PER_COMPANY = 4;
/* Files wait in a lane of their own, one task at a time per company: reading and parsing a file
 * takes seconds, and the lane above is what keeps page and comment edits current. */
const FILES_PER_COMPANY = 1;
const HANDLED = [...SOURCE_EVENTS, ...TASK_EVENTS, TASK_CREATED, 'project.trashed', 'project.restored', 'member.departed', 'member.activated'];

const pending = new Set();
const lanes = new Map();
let started = false;

const track = (promise) => {
    if (!promise) return;
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
};

const deletedIds = (envelope) => {
    const ids = envelope.data && Array.isArray(envelope.data.ids) ? envelope.data.ids : [];
    return ids.length ? ids : [envelope.entity && envelope.entity.id];
};

const changedFieldsOf = (envelope) => (Array.isArray(envelope.changedFields) ? envelope.changedFields : []);

/* Checked before the company's switch is read, so a status or priority change costs nothing. */
const relevant = (envelope) => Boolean(envelope) && HANDLED.includes(envelope.type)
    && (!TASK_EVENTS.includes(envelope.type) || changedFieldsOf(envelope).some((field) => TASK_WATCHED_FIELDS.includes(field)));

const sourceOf = (type) => type.slice(0, type.indexOf('.'));

const inLane = (key, width, run) => new Promise((resolve, reject) => {
    const lane = lanes.get(key) || { active: 0, waiting: [] };
    lanes.set(key, lane);
    const begin = () => {
        lane.active += 1;
        Promise.resolve().then(run).then(resolve, reject).finally(() => {
            lane.active -= 1;
            const next = lane.waiting.shift();
            if (next) next();
            else if (!lane.active) lanes.delete(key);
        });
    };
    if (lane.active < width) begin();
    else lane.waiting.push(begin);
});

/* The files are marked owed before they are queued, so the queue can be lost with the process;
 * the event is then answered and each file read and parsed when its turn comes. */
const queueTaskFiles = async (companyId, taskId) => {
    await indexer.markFilesPending(companyId, taskId);
    track(inLane(`files:${companyId}`, FILES_PER_COMPANY, () => indexer.syncTaskFiles(companyId, taskId)).catch((error) => {
        logger.error(`${LOG_PREFIX} files of task ${taskId} in company ${companyId}: ${domainEventBus.failureText(error)}`);
        return null;
    }));
    return null;
};

const taskChanged = (envelope) => {
    const { companyId } = envelope;
    const id = envelope.entity && envelope.entity.id;
    const fields = changedFieldsOf(envelope);
    const files = fields.includes(TASK_FILES_FIELD) ? queueTaskFiles(companyId, id) : null;
    if (!fields.some((field) => TASK_VISIBILITY_FIELDS.includes(field))) return files;
    return Promise.all([files, indexer.reindexTask(companyId, id, { moved: fields.some((field) => TASK_MOVE_FIELDS.includes(field)) })]);
};

const apply = (envelope) => {
    const { companyId } = envelope;
    const id = envelope.entity && envelope.entity.id;
    switch (envelope.type) {
        case TASK_CREATED:
            return queueTaskFiles(companyId, id);
        case 'page.deleted':
            return Promise.all(deletedIds(envelope).map((pageId) => indexer.syncPage(companyId, pageId)));
        case 'project.trashed':
            return indexer.tombstoneProject(companyId, id);
        case 'project.restored':
            return indexer.reindexProject(companyId, id);
        case 'member.departed':
            return indexer.removeDepartedMember(companyId, id);
        case 'member.activated':
            return indexer.reindexAuthor(companyId, id);
        default:
            if (SOURCE_EVENTS.includes(envelope.type)) return indexer.sync(companyId, sourceOf(envelope.type), id);
            if (TASK_EVENTS.includes(envelope.type)) return taskChanged(envelope);
            return null;
    }
};

const SWEEP_EVERY_MS = 60 * 1000;
const sweeps = new Map();

/* Owed files are taken up on the heartbeat whether or not the heartbeat is stale, at most once a
 * minute per company. */
const sweepFiles = (companyId) => {
    const key = String(companyId);
    const now = Date.now();
    if (now - (sweeps.get(key) || 0) < SWEEP_EVERY_MS) return;
    sweeps.set(key, now);
    track(indexer.resumeFiles(key).catch((error) => {
        logger.error(`${LOG_PREFIX} file sweep for company ${key} failed: ${domainEventBus.failureText(error)}`);
        return 0;
    }));
};

const resetFileSweeps = () => sweeps.clear();

/* Heartbeats while the indexer is on, and starts the catch-up of any source found stale. */
const keepAlive = (companyId, states) => {
    if (flag.indexer.mode() === 'off') return;
    sweepFiles(companyId);
    track(backfill.keepAlive(companyId, { states })
        .then((stale) => { if (stale.length) track(backfill.ensureBackfill(companyId)); })
        .catch((error) => logger.error(`${LOG_PREFIX} heartbeat for company ${companyId} failed: ${domainEventBus.failureText(error)}`)));
};

const handle = async (envelope) => {
    try {
        if (!relevant(envelope)) return null;
        return await inLane(String(envelope.companyId), MAX_CONCURRENT_PER_COMPANY, async () => {
            if (!(await flag.indexer.enabledFor(envelope.companyId))) return null;
            keepAlive(envelope.companyId);
            const result = await apply(envelope);
            track(backfill.ensureBackfill(envelope.companyId));
            return result;
        });
    } catch (error) {
        logger.error(`${LOG_PREFIX} ${domainEventBus.eventLabel(envelope)}: ${domainEventBus.failureText(error)}`);
        return null;
    }
};

const onEnvelope = (envelope) => track(handle(envelope));

const start = () => {
    if (started) return true;
    if (flag.indexer.mode() === 'off') return false;
    domainEventBus.listenForPages();
    domainEventBus.listenForComments();
    domainEventBus.listenForCalls();
    HANDLED.forEach((type) => domainEventBus.bus.on(type, onEnvelope));
    started = true;
    logger.info(`${LOG_PREFIX} listening for ${HANDLED.join(', ')} (${flag.indexer.mode()})`);
    track(backfill.resumeAll().catch((error) => {
        logger.error(`${LOG_PREFIX} resuming owed files at start failed: ${domainEventBus.failureText(error)}`);
        return 0;
    }));
    return true;
};

const stop = () => {
    if (!started) return;
    HANDLED.forEach((type) => domainEventBus.bus.removeListener(type, onEnvelope));
    started = false;
};

const drain = async () => {
    while (pending.size) {
        await Promise.all([...pending]);
    }
};

const publish = (companyId, type, entity, data) => {
    if (flag.indexer.mode() === 'off') return null;
    try {
        return domainEventBus.publishEntityEvent({ companyId, type, entity, data });
    } catch (error) {
        logger.error(`${LOG_PREFIX} could not publish ${type} for ${entity.kind} ${entity.id} in company ${companyId}: ${domainEventBus.failureText(error)}`);
        return null;
    }
};

const publishProjectTrashed = (companyId, projectId) => publish(companyId, 'project.trashed', { kind: 'project', id: String(projectId) }, { ProjectID: String(projectId) });
const publishProjectRestored = (companyId, projectId) => publish(companyId, 'project.restored', { kind: 'project', id: String(projectId) }, { ProjectID: String(projectId) });
const publishMemberDeparted = (companyId, userId) => publish(companyId, 'member.departed', { kind: 'member', id: String(userId) }, { userId: String(userId) });
const publishMemberActivated = (companyId, userId) => publish(companyId, 'member.activated', { kind: 'member', id: String(userId) }, { userId: String(userId) });

/* For comment writes that send no socket emit: an automation's or agent's comment, and its undo. */
const publishCommentChanged = (companyId, commentId, change) => publish(companyId, `comment.${change}`, { kind: 'comment', id: String(commentId) }, { _id: String(commentId) });

/* A guide is a field of its project and no project write names the fields it changed, so the two
 * places that write one say so. The envelope carries the project id and never the guide. */
const publishGuideSaved = (companyId, projectId) => publish(companyId, 'guide.saved', { kind: 'project', id: String(projectId) }, { ProjectID: String(projectId) });

const guideTouched = (updateObject) => Object.keys(updateObject || {}).some((field) => field === 'aiGuide' || field.startsWith('aiGuide.'));

/* Asked for by retrieval when a source changed after its chunks were written. */
const requestSync = (companyId, sourceId, sourceType = indexer.SOURCE) => {
    if (flag.indexer.mode() === 'off') return;
    track(indexer.sync(companyId, sourceType, sourceId).catch((error) => {
        logger.error(`${LOG_PREFIX} sync of ${sourceType} ${sourceId} in company ${companyId} failed: ${domainEventBus.failureText(error)}`);
        return null;
    }));
};

module.exports = {
    HANDLED,
    MAX_CONCURRENT_PER_COMPANY,
    keepAlive,
    resetFileSweeps,
    start,
    stop,
    handle,
    drain,
    publishProjectTrashed,
    publishProjectRestored,
    publishMemberDeparted,
    publishMemberActivated,
    publishCommentChanged,
    publishGuideSaved,
    guideTouched,
    requestSync,
};
