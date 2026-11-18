const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { contentHashOf } = require('./chunker');
const { INDEX_KEY, INDEX_OPTIONS, KEPT_REASONS, removableFilter, blankableFilter } = require('./purgeFilter');

// A tombstone hides a chunk at once; this removes it for good once it has been out longer than
// the retention period, so deleted text and its vector do not stay in the store. A tombstone the
// indexer reads back keeps its row with the text and vector emptied, and a file still owed an
// extraction is left alone. Past the period a tombstone's version no longer guards against a
// slower, older read writing the chunk back, which no read takes that long to do.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const RUN_EVERY_MS = DAY_MS;

const BLANK = Object.freeze({
    text: '', textBytes: 0, title: '', headingPath: [], embedding: [], embeddingModel: null, contentHash: contentHashOf([], ''),
});

/* 0 turns the purge off; anything that is not a whole number of days keeps the default. */
const retentionDays = () => {
    const raw = process.env.KNOWLEDGE_TOMBSTONE_RETENTION_DAYS;
    if (raw === undefined || String(raw).trim() === '') return DEFAULT_RETENTION_DAYS;
    const days = Number(raw);
    return Number.isInteger(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
};

const chunkStore = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data }, method);

const purgeTombstones = async (companyId, { now = Date.now() } = {}) => {
    const days = retentionDays();
    if (!days) return { purged: 0, blanked: 0 };
    const cutoff = now - days * DAY_MS;
    const removed = await chunkStore(companyId, [removableFilter(cutoff)], 'deleteMany');
    const blanked = await chunkStore(companyId, [blankableFilter(cutoff), { $set: { ...BLANK } }], 'updateMany');
    return { purged: (removed && removed.deletedCount) || 0, blanked: (blanked && blanked.modifiedCount) || 0 };
};

const lastRun = new Map();

const purgeDue = async (companyId, { now = Date.now() } = {}) => {
    const key = String(companyId);
    if (lastRun.has(key) && now - lastRun.get(key) < RUN_EVERY_MS) return null;
    lastRun.set(key, now);
    return purgeTombstones(key, { now });
};

const resetSchedule = () => lastRun.clear();

module.exports = {
    INDEX_KEY, INDEX_OPTIONS, KEPT_REASONS, BLANK, DEFAULT_RETENTION_DAYS,
    retentionDays, removableFilter, blankableFilter, purgeTombstones, purgeDue, resetSchedule,
};
