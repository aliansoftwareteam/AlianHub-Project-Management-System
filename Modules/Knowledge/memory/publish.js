const domainEventBus = require('../../../event/domainEventBus');
const logger = require('../../../Config/loggerConfig');
const memoryFlag = require('./flag');

// The memory store and the agent controller announce their writes here. An envelope names the
// memory or the agent and nothing else: the text stays in the store, and the indexer reads it
// from there when it syncs.

const CHANGES = ['created', 'updated', 'deleted'];

const publish = (companyId, type, entity) => {
    if (!memoryFlag.installed()) return null;
    try {
        return domainEventBus.publishEntityEvent({ companyId: String(companyId), type, entity, data: { id: entity.id } });
    } catch (error) {
        logger.error(`[knowledge-memory] could not publish ${type} for ${entity.kind} ${entity.id} in company ${companyId}: ${domainEventBus.failureText(error)}`);
        return null;
    }
};

const memoryChanged = (companyId, memoryId, change) => (CHANGES.includes(change)
    ? publish(companyId, `memory.${change}`, { kind: 'memory', id: String(memoryId) })
    : null);

const agentDeleted = (companyId, agentId) => publish(companyId, 'agent.deleted', { kind: 'agent', id: String(agentId) });

module.exports = { CHANGES, memoryChanged, agentDeleted };
