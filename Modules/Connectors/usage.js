const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

const FIELD = Object.freeze({ READS: 'reads', WRITE_PROPOSALS: 'writeProposals' });

const dayOf = (at = new Date()) => new Date(at).toISOString().slice(0, 10);

const nextReset = (at = new Date()) => {
    const d = new Date(at);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
};

/* The filter's dotted fields build `actor` on the insert, so $setOnInsert must not name it: MongoDB refuses both. */
const add = (companyId, { connectionId, userId, actor, day }, field, by) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CONNECTOR_USAGE,
    data: [
        { connectionId: String(connectionId), 'actor.type': actor.type, 'actor.id': String(actor.id), day },
        { $inc: { [field]: by }, $setOnInsert: { companyId: String(companyId), userId: String(userId) } },
        { upsert: true },
    ],
}, 'updateOne');

const sumOf = async (companyId, filter, field) => {
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CONNECTOR_USAGE, data: [filter, { [field]: 1 }] }, 'find');
    return (rows || []).reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
};

const usedByPerson = (companyId, userId, day, field) => sumOf(companyId, { userId: String(userId), day }, field);

const usedByAgent = (companyId, agentId, day, field) => sumOf(companyId, { 'actor.type': 'agent', 'actor.id': String(agentId), day }, field);

module.exports = { FIELD, dayOf, nextReset, add, usedByPerson, usedByAgent };
