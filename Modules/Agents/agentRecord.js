// One place that knows what a new agent row looks like. controller.createAgent
// writes the same defaults; anything else that creates an agent goes through here.
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('./registry');
const runs = require('./runs');

const DEFAULTS = Object.freeze({ autonomy: 0, spendCapUsd: 30, paused: false, account: 'workspace', deletedStatusKey: 0 });

const createAgentRecord = async (companyId, fields, { ownerId } = {}) => {
    const name = String((fields && fields.name) || '').trim().slice(0, 80);
    if (!name) throw new Error('name is required.');
    const allowedActions = Array.isArray(fields.allowedActions) ? fields.allowedActions.filter((a) => registry.has(a)) : [];
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: { ...DEFAULTS, ...fields, name, allowedActions, ownerId: ownerId ? String(ownerId) : undefined },
    }, 'save');
    runs.emitAgent(companyId, { agent: saved });
    return saved;
};

module.exports = { createAgentRecord, DEFAULTS };
