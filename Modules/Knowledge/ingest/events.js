const domainEventBus = require('../../../event/domainEventBus');
const logger = require('../../../Config/loggerConfig');
const flag = require('../flag');
const indexer = require('./indexer');
const backfill = require('./backfill');

// The indexer's side of the domain event bus. With KNOWLEDGE_INDEXER off nothing subscribes
// and nothing is published, so no page, project or member write does any extra work.

const LOG_PREFIX = '[knowledge-indexer]';
const HANDLED = ['page.created', 'page.updated', 'page.deleted', 'project.trashed', 'project.restored', 'member.departed'];

const pending = new Set();
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

const apply = (envelope) => {
    const { companyId } = envelope;
    const id = envelope.entity && envelope.entity.id;
    switch (envelope.type) {
        case 'page.created':
        case 'page.updated':
            return indexer.syncPage(companyId, id);
        case 'page.deleted':
            return Promise.all(deletedIds(envelope).map((pageId) => indexer.syncPage(companyId, pageId)));
        case 'project.trashed':
            return indexer.tombstoneProject(companyId, id);
        case 'project.restored':
            return indexer.reindexProject(companyId, id);
        case 'member.departed':
            return indexer.removeDepartedMember(companyId, id);
        default:
            return null;
    }
};

const handle = async (envelope) => {
    try {
        if (!envelope || !HANDLED.includes(envelope.type)) return null;
        if (!(await flag.indexer.enabledFor(envelope.companyId))) return null;
        const result = await apply(envelope);
        track(backfill.ensureBackfill(envelope.companyId));
        return result;
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

module.exports = {
    HANDLED,
    start,
    stop,
    handle,
    drain,
    publishProjectTrashed,
    publishProjectRestored,
    publishMemberDeparted,
};
