const domainEventBus = require('../../../event/domainEventBus');
const logger = require('../../../Config/loggerConfig');
const memoryFlag = require('./flag');
const indexer = require('./indexer');
const backfill = require('./backfill');

// Memory's own listener on the domain event bus, beside the page and comment indexer's: note
// writes, an agent's deletion, and the member departures and returns the indexer already publishes.
// With KNOWLEDGE_AGENT_MEMORY off nothing subscribes and the memory store publishes nothing.

const LOG_PREFIX = '[knowledge-memory]';
const HANDLED = ['memory.created', 'memory.updated', 'memory.deleted', 'agent.deleted', 'member.departed', 'member.activated'];

const pending = new Set();
let started = false;

const track = (promise) => {
    if (!promise) return;
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
};

const apply = (envelope) => {
    const { companyId } = envelope;
    const id = envelope.entity && envelope.entity.id;
    switch (envelope.type) {
        case 'agent.deleted':
            return indexer.tombstoneAgent(companyId, id);
        case 'member.departed':
            return indexer.removeDepartedMember(companyId, id);
        case 'member.activated':
            return indexer.reindexAuthor(companyId, id);
        default:
            return indexer.sync(companyId, id);
    }
};

const handle = async (envelope) => {
    try {
        if (!envelope || !HANDLED.includes(envelope.type)) return null;
        if (!(await memoryFlag.enabledFor(envelope.companyId))) return null;
        track(backfill.keepAlive(envelope.companyId).catch((error) => logger.error(`${LOG_PREFIX} heartbeat for ${envelope.companyId}: ${error.message}`)));
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
    if (!memoryFlag.installed()) return false;
    HANDLED.forEach((type) => domainEventBus.bus.on(type, onEnvelope));
    started = true;
    logger.info(`${LOG_PREFIX} listening for ${HANDLED.join(', ')}`);
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

module.exports = { HANDLED, start, stop, handle, drain };
