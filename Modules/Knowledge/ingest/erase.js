const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const vectorStore = require('../vectorStore');

// Erasure removes chunk rows outright, where a tombstone only hides them, and records an
// exclusion first so no later sync, re-index or backfill writes them back. Audit rows are not
// touched here: redacting their personal fields belongs to the audit chain. The vector store is
// told the exact sources that left, so it never has to know the rule.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const exclude = (companyId, rule) => MongoDbCrudOpration(String(companyId), {
    type: SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS,
    data: [rule, { $set: { companyId: String(companyId), ...rule, reason: 'erased' } }, { upsert: true }],
}, 'updateOne');

const sourcesOf = async (companyId, where) => {
    const rows = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [where, 'sourceType sourceId', { lean: true }] }, 'find');
    const seen = new Map();
    (rows || []).forEach((row) => seen.set(`${row.sourceType}:${row.sourceId}`, { sourceType: row.sourceType, sourceId: String(row.sourceId) }));
    return [...seen.values()];
};

const eraseChunks = async (companyId, where) => {
    const result = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [where] }, 'deleteMany');
    return { erased: (result && result.deletedCount) || 0 };
};

const eraseVectors = async (companyId, sources) => {
    try {
        await vectorStore.current().erase({ companyId: String(companyId), sources });
    } catch (error) {
        logger.error(`[knowledge-erase] vector store erase failed for ${companyId}: ${error.message}`);
    }
};

const eraseDocument = async (companyId, { sourceType, sourceId } = {}) => {
    const type = String(sourceType || '').trim();
    const id = String(sourceId || '').trim();
    if (!type) throw new Error('eraseDocument needs a sourceType.');
    if (!id) throw new Error('eraseDocument needs a sourceId.');
    await exclude(companyId, { kind: 'document', sourceType: type, sourceId: id, userId: '' });
    const result = await eraseChunks(companyId, { sourceType: type, sourceId: id });
    await eraseVectors(companyId, [{ sourceType: type, sourceId: id }]);
    return result;
};

/* A person's private pages and the comments they wrote (owner, 2026-09-17). Their shared pages stay,
 * and so do the calls they were on, which hold other participants' words. */
const erasePerson = async (companyId, userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('erasePerson needs a valid user id.');
    await exclude(companyId, { kind: 'author', sourceType: '', sourceId: '', userId: id });
    const where = { createdBy: id, $or: [{ sourceType: 'page', visibility: 'private' }, { sourceType: 'comment' }] };
    const sources = await sourcesOf(companyId, where);
    const result = await eraseChunks(companyId, where);
    await eraseVectors(companyId, sources);
    return result;
};

module.exports = { eraseDocument, erasePerson };
