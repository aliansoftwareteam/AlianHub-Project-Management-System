const domainEventBus = require('../../../event/domainEventBus');
const logger = require('../../../Config/loggerConfig');
const flag = require('../flag');
const indexer = require('./indexer');
const backfill = require('./backfill');

// The indexer's side of the domain event bus. With KNOWLEDGE_INDEXER off nothing subscribes
// and nothing is published, so no page, comment, call, project or member write does any extra work.

const LOG_PREFIX = '[knowledge-indexer]';
const SOURCE_EVENTS = [
    'page.created', 'page.updated', 'page.deleted',
    'comment.created', 'comment.updated', 'comment.deleted',
    'transcript.created', 'transcript.updated', 'transcript.deleted',
];
/* Task envelopes are published once Automations init starts the bus; every kind but created can
 * carry a change to who sees the task's comments. */
const TASK_EVENTS = ['task.updated', 'task.sprint_changed', 'task.status_changed', 'task.assignee_changed', 'task.priority_changed', 'task.lead_changed', 'task.due_date_changed', 'task.renamed'];
const TASK_VISIBILITY_FIELDS = ['deletedStatusKey', 'sprintId', 'ProjectID'];
const TASK_MOVE_FIELDS = ['sprintId', 'ProjectID'];
/* A bulk move of hundreds of tasks is hundreds of envelopes at once; each company handles only this
 * many at a time and queues the rest. */
const MAX_CONCURRENT_PER_COMPANY = 4;
const HANDLED = [...SOURCE_EVENTS, ...TASK_EVENTS, 'project.trashed', 'project.restored', 'member.departed', 'member.activated'];

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
    && (!TASK_EVENTS.includes(envelope.type) || changedFieldsOf(envelope).some((field) => TASK_VISIBILITY_FIELDS.includes(field)));

const sourceOf = (type) => type.slice(0, type.indexOf('.'));

const apply = (envelope) => {
    const { companyId } = envelope;
    const id = envelope.entity && envelope.entity.id;
    switch (envelope.type) {
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
            if (TASK_EVENTS.includes(envelope.type)) return indexer.reindexTask(companyId, id, { moved: changedFieldsOf(envelope).some((field) => TASK_MOVE_FIELDS.includes(field)) });
            return null;
    }
};

const inLane = (companyId, run) => new Promise((resolve, reject) => {
    const key = String(companyId);
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
    if (lane.active < MAX_CONCURRENT_PER_COMPANY) begin();
    else lane.waiting.push(begin);
});

/* Heartbeats while the indexer is on, and starts the catch-up of any source found stale. */
const keepAlive = (companyId, states) => {
    if (flag.indexer.mode() === 'off') return;
    track(backfill.keepAlive(companyId, { states })
        .then((stale) => { if (stale.length) track(backfill.ensureBackfill(companyId)); })
        .catch((error) => logger.error(`${LOG_PREFIX} heartbeat for company ${companyId} failed: ${domainEventBus.failureText(error)}`)));
};

const handle = async (envelope) => {
    try {
        if (!relevant(envelope)) return null;
        return await inLane(envelope.companyId, async () => {
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
    start,
    stop,
    handle,
    drain,
    publishProjectTrashed,
    publishProjectRestored,
    publishMemberDeparted,
    publishMemberActivated,
    publishCommentChanged,
    requestSync,
};
