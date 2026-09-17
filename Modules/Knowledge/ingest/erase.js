const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

// Erasure removes chunk rows outright, where a tombstone only hides them. Audit rows are
// not touched here: redacting their personal fields belongs to the audit chain.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const eraseChunks = async (companyId, where) => {
    const result = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [where] }, 'deleteMany');
    return { erased: (result && result.deletedCount) || 0 };
};

const eraseDocument = async (companyId, { sourceType, sourceId } = {}) => {
    const type = String(sourceType || '').trim();
    const id = String(sourceId || '').trim();
    if (!type) throw new Error('eraseDocument needs a sourceType.');
    if (!id) throw new Error('eraseDocument needs a sourceId.');
    return eraseChunks(companyId, { sourceType: type, sourceId: id });
};

const erasePerson = async (companyId, userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('erasePerson needs a valid user id.');
    return eraseChunks(companyId, { createdBy: id, visibility: 'private' });
};

module.exports = { eraseDocument, erasePerson };
