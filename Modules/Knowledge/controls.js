const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const flag = require('./flag');
const embeddings = require('./embeddings');
const { INDEXED_SOURCES } = require('./sources');
const indexer = require('./ingest/indexer');
const erase = require('./ingest/erase');

// The instance console's writes on a workspace's index. Each answers counts, never text, so the
// caller can audit what it did without holding anything it removed.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
/* A task is not a source of its own: erasing one erases the comments and files indexed under it. */
const TASK = 'task';
/* Rounds of the re-embed sweep one request runs; the recurring job carries on past them. */
const REEMBED_ROUNDS = 20;
const LOG_PREFIX = '[knowledge-console]';

const reembedding = new Set();
const retrying = new Set();
const pending = new Set();

const chunkStore = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data }, method);

const background = (key, set, run) => {
    set.add(key);
    const done = Promise.resolve()
        .then(run)
        .catch((error) => logger.error(`${LOG_PREFIX} ${key}: ${error.message}`))
        .finally(() => {
            set.delete(key);
            pending.delete(done);
        });
    pending.add(done);
    return done;
};

const settled = () => Promise.all([...pending]);

const documentTypes = () => [...INDEXED_SOURCES, TASK];

const validDocumentId = (sourceType, id) => {
    if (typeof id !== 'string' || !documentTypes().includes(sourceType)) return false;
    const rules = indexer.RULES[sourceType];
    return rules && rules.validId ? rules.validId(id) : OBJECT_ID.test(id);
};

const countsBySource = async (companyId, where) => {
    const rows = await chunkStore(companyId, [[{ $match: where }, { $group: { _id: '$sourceType', n: { $sum: 1 } } }]], 'aggregate');
    const removed = Object.fromEntries((rows || []).filter((row) => row.n > 0).map((row) => [row._id, row.n]));
    return { removed, total: Object.values(removed).reduce((sum, n) => sum + n, 0) };
};

const reembed = async (companyId) => {
    const company = String(companyId);
    if (!(await flag.hybridFor(company))) return { ok: false, code: 'not_hybrid' };
    const readiness = embeddings.readiness(company);
    if (readiness === 'unconfigured') return { ok: false, code: 'embedding_unconfigured' };
    if (readiness === 'paused') return { ok: false, code: 'embedding_paused' };
    if (reembedding.has(company)) return { ok: false, code: 'reembed_running' };
    const model = embeddings.model();
    const pendingChunks = Number(await chunkStore(company, [{ deleted: { $ne: true }, embeddingModel: { $ne: model } }], 'countDocuments')) || 0;
    /* Each round stops at the first refusal, and a spent budget or a tripped breaker ends the run. */
    background(company, reembedding, async () => {
        for (let round = 0; round < REEMBED_ROUNDS; round += 1) {
            const count = await indexer.reembedMissing(company);
            if (!count || embeddings.readiness(company) !== 'ready') break;
        }
    });
    return { ok: true, pendingChunks, model };
};

const retryFiles = async (companyId) => {
    const company = String(companyId);
    const where = { sourceType: 'file', ordinal: 0, deleted: true, tombstoneReason: { $in: indexer.RETRIED_FILE_REASONS } };
    const rows = await chunkStore(company, [[{ $match: where }, { $group: { _id: '$tombstoneReason', n: { $sum: 1 } } }]], 'aggregate');
    const byReason = Object.fromEntries((rows || []).map((row) => [row._id, row.n]));
    const result = await chunkStore(company, [where, { $set: { extractAttempts: 0, extractDueAt: new Date() } }], 'updateMany');
    const reset = (result && result.modifiedCount) || 0;
    if (reset && !retrying.has(company)) background(company, retrying, () => indexer.resumeFiles(company));
    return { ok: true, reset, byReason };
};

const eraseDocument = async (companyId, { sourceType, sourceId }) => {
    const company = String(companyId);
    if (sourceType !== TASK) {
        const counts = await countsBySource(company, { sourceType, sourceId });
        await erase.eraseDocument(company, { sourceType, sourceId });
        return { ok: true, ...counts };
    }
    const where = { taskId: sourceId };
    const counts = await countsBySource(company, where);
    const rows = await chunkStore(company, [where, 'sourceType sourceId', { lean: true }], 'find');
    const seen = new Map((rows || []).map((row) => [`${row.sourceType}:${row.sourceId}`, row]));
    for (const row of seen.values()) await erase.eraseDocument(company, { sourceType: row.sourceType, sourceId: String(row.sourceId) });
    return { ok: true, ...counts };
};

const erasePerson = async (companyId, userId) => {
    const company = String(companyId);
    const counts = await countsBySource(company, erase.personWhere(userId));
    await erase.erasePerson(company, userId);
    return { ok: true, ...counts };
};

module.exports = { documentTypes, validDocumentId, reembed, retryFiles, eraseDocument, erasePerson, settled };
