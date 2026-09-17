const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

// Erasure removes chunk rows outright, where a tombstone only hides them, and records an
// exclusion first so no later sync, re-index or backfill writes them back. Audit rows are not
// touched here: redacting their personal fields belongs to the audit chain.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const exclude = (companyId, rule) => MongoDbCrudOpration(String(companyId), {
    type: SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS,
    data: [rule, { $set: { companyId: String(companyId), ...rule, reason: 'erased' } }, { upsert: true }],
}, 'updateOne');

const eraseChunks = async (companyId, where) => {
    const result = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [where] }, 'deleteMany');
    return { erased: (result && result.deletedCount) || 0 };
};

const eraseDocument = async (companyId, { sourceType, sourceId } = {}) => {
    const type = String(sourceType || '').trim();
    const id = String(sourceId || '').trim();
    if (!type) throw new Error('eraseDocument needs a sourceType.');
    if (!id) throw new Error('eraseDocument needs a sourceId.');
    await exclude(companyId, { kind: 'document', sourceType: type, sourceId: id, userId: '' });
    return eraseChunks(companyId, { sourceType: type, sourceId: id });
};

/* A person's private pages only: what they shared stays, as it does when they leave. */
const erasePerson = async (companyId, userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('erasePerson needs a valid user id.');
    await exclude(companyId, { kind: 'author', sourceType: '', sourceId: '', userId: id });
    return eraseChunks(companyId, { createdBy: id, visibility: 'private' });
};

module.exports = { eraseDocument, erasePerson };
