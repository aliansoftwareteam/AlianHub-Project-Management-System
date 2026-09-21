const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const vectorStore = require('../vectorStore');

// Erasure removes chunk rows outright, where a tombstone only hides them, and records an
// exclusion first so no later sync, re-index or backfill writes them back. Audit rows are not
// touched here: redacting their personal fields belongs to the audit chain. The vector store is
// told the exact sources that left, so it never has to know the rule.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const exclusions = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, data }, method);

const exclude = async (companyId, rule, { by = '', onExcluded } = {}) => {
    await exclusions(companyId, [rule, { $set: { companyId: String(companyId), ...rule, reason: 'erased', erasedAt: new Date(), erasedBy: String(by) } }, { upsert: true }], 'updateOne');
    if (onExcluded) onExcluded(rule);
    return rule;
};

const recordErased = (companyId, rule, count) => (count ? exclusions(companyId, [rule, { $inc: { erasedChunks: count } }], 'updateOne') : null);

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

/* The document's own chunks and any agent note formed from it. */
const documentWhere = (sourceType, sourceId) => ({ $or: [{ sourceType, sourceId }, { sourceType: 'memory', derivedFrom: `${sourceType}:${sourceId}` }] });

const eraseDocument = async (companyId, { sourceType, sourceId } = {}, options = {}) => {
    const type = String(sourceType || '').trim();
    const id = String(sourceId || '').trim();
    if (!type) throw new Error('eraseDocument needs a sourceType.');
    if (!id) throw new Error('eraseDocument needs a sourceId.');
    const where = documentWhere(type, id);
    const rule = await exclude(companyId, { kind: 'document', sourceType: type, sourceId: id, userId: '' }, options);
    const notes = await sourcesOf(companyId, where.$or[1]);
    const result = await eraseChunks(companyId, where);
    await eraseVectors(companyId, [{ sourceType: type, sourceId: id }, ...notes]);
    await recordErased(companyId, rule, result.erased);
    return result;
};

/* A task is no source of its own: its exclusion keeps out every comment and file indexed under it,
 * including ones written after the erasure. */
const excludeTask = (companyId, taskId, options) => exclude(companyId, { kind: 'task', sourceType: '', sourceId: String(taskId).toLowerCase(), userId: '' }, options);

const personWhere = (userId) => ({ $or: [{ createdBy: String(userId), sourceType: 'page', visibility: 'private' }, { createdBy: String(userId), sourceType: 'comment' }, { sourceType: 'memory', derivedAuthors: String(userId) }] });

/* A person's private pages and the comments they wrote (owner, 2026-09-17), and an agent's notes
 * formed from either. Their shared pages stay, and so do the calls they were on, which hold other
 * participants' words. */
const erasePerson = async (companyId, userId, options = {}) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('erasePerson needs a valid user id.');
    const rule = await exclude(companyId, { kind: 'author', sourceType: '', sourceId: '', userId: id }, options);
    const where = personWhere(id);
    const sources = await sourcesOf(companyId, where);
    const result = await eraseChunks(companyId, where);
    await eraseVectors(companyId, sources);
    await recordErased(companyId, rule, result.erased);
    return result;
};

module.exports = { eraseDocument, erasePerson, excludeTask, recordErased, documentWhere, personWhere };
