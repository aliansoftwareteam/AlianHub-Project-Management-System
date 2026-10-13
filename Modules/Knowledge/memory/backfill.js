const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { serviceStamp } = require('../../Agents/serviceIdentity');
const agentMemory = require('../../Agents/memory');
const memoryFlag = require('./flag');
const embeddings = require('../embeddings');
const indexer = require('./indexer');

// The notes a company's agents already had when the switch came on, indexed in memory-id order
// with the cursor saved after every batch in knowledge_index_state, so a restart resumes where it
// stopped. Retrieval reads memory only while this state is complete and its heartbeat fresh, the
// rule every other source follows. A heartbeat gone stale means memory events may have been
// missed, and nothing but a pass over every note says which, so the whole pass runs again: notes
// are few and an unchanged note is not rewritten.

const JOB_NAME = 'knowledge.memory.backfill';
const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const HEARTBEAT_MS = 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
const STATE_KEY = indexer.SOURCE_TYPE;
const REEMBED_BATCH = 50;
const LOG_PREFIX = '[knowledge-memory-backfill]';

const running = new Set();
const beats = new Map();

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

const indexState = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data }, method);

const readState = (companyId) => indexState(companyId, [{ sourceType: STATE_KEY }, null, { lean: true }], 'findOne');

const saveState = (companyId, set) => indexState(companyId, [
    { sourceType: STATE_KEY },
    { $set: { companyId: String(companyId), sourceType: STATE_KEY, lastSeenOnAt: new Date(), ...serviceStamp('indexer', 'lastRunBy'), ...set } },
    { upsert: true, returnDocument: 'after', lean: true },
], 'findOneAndUpdate');

const seenAt = (state) => time(state.lastSeenOnAt || state.lastRunAt);

const isReady = (state, now = Date.now()) => Boolean(state) && state.status === 'complete' && now - seenAt(state) <= STALE_AFTER_MS;

const ready = async (companyId) => isReady(await readState(companyId).catch(() => null));

/* Moves a fresh heartbeat forward at most once a minute; a stale one sends the pass round again. */
const keepAlive = async (companyId) => {
    const company = String(companyId);
    const now = Date.now();
    if (now - (beats.get(company) || 0) < HEARTBEAT_MS) return false;
    beats.set(company, now);
    const state = await readState(company);
    if (!state) return false;
    if (now - seenAt(state) > STALE_AFTER_MS) {
        await saveState(company, { status: 'running', cursor: '', finishedAt: null });
        return true;
    }
    await indexState(company, [{ sourceType: STATE_KEY }, { $set: { lastSeenOnAt: new Date(now) } }], 'updateOne');
    return false;
};

const resetHeartbeats = () => beats.clear();

const summaryOf = (state) => ({
    status: (state && state.status) || 'running',
    cursor: (state && state.cursor) || '',
    indexed: Number(state && state.indexed) || 0,
    skipped: Number(state && state.skipped) || 0,
});

/* Chunks whose note is gone from the store, found once the pass reaches the end. */
const orphans = async (companyId, known) => {
    const rows = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS,
        data: [{ sourceType: indexer.SOURCE_TYPE, deleted: { $ne: true } }, 'sourceId', { lean: true }],
    }, 'find');
    return [...new Set((rows || []).map((row) => String(row.sourceId)))].filter((id) => !known.has(id));
};

const backfill = async (companyId, { batchSize = BATCH_SIZE, maxBatches = Infinity } = {}) => {
    const company = String(companyId);
    let state = await readState(company);
    if (isReady(state)) return summaryOf(state);
    if (state && state.status === 'complete') state = await saveState(company, { status: 'running', cursor: '', finishedAt: null });

    let { cursor, indexed, skipped } = summaryOf(state);
    const startedAt = (state && state.startedAt) || new Date();
    try {
        const notes = (await agentMemory.listAgentNotes({ companyId: company })).sort((a, b) => a.memoryId.localeCompare(b.memoryId));
        const pending = notes.filter((note) => note.memoryId > cursor);
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const rows = pending.splice(0, batchSize);
            for (const note of rows) {
                const result = await indexer.sync(company, note.memoryId);
                if (result && result.leftOut) skipped += 1;
                else indexed += 1;
            }
            if (rows.length) cursor = rows[rows.length - 1].memoryId;
            const done = !pending.length;
            if (done) {
                const known = new Set(notes.map((note) => note.memoryId));
                for (const id of await orphans(company, known)) await indexer.sync(company, id);
            }
            state = await saveState(company, {
                status: done ? 'complete' : 'running', cursor: done ? '' : cursor, indexed, skipped, startedAt, lastRunAt: new Date(), finishedAt: done ? new Date() : null, error: '',
            });
            if (done) break;
        }
        return summaryOf(state);
    } catch (error) {
        const message = (error && error.message) || String(error);
        await saveState(company, { status: 'failed', cursor, startedAt, lastRunAt: new Date(), error: message })
            .catch((saveError) => logger.error(`${LOG_PREFIX} ${company}: could not record the failure: ${saveError.message}`));
        throw error;
    }
};

const runOnce = async (companyId, options) => {
    const company = String(companyId);
    if (running.has(company)) return null;
    running.add(company);
    try {
        return await backfill(company, options);
    } catch (error) {
        logger.error(`${LOG_PREFIX} ${company}: ${error.message}`);
        return null;
    } finally {
        running.delete(company);
    }
};

/* A hybrid company's notes whose chunk has no vector for the current model: an embed that failed,
 * or everything indexed before the company went hybrid. Stops at the first note still without one. */
const reembedMissing = async (companyId) => {
    const plan = await embeddings.planFor(companyId);
    if (!plan) return null;
    const rows = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS,
        data: [{ sourceType: indexer.SOURCE_TYPE, deleted: { $ne: true }, embeddingModel: { $ne: plan.model } }, 'sourceId', { limit: REEMBED_BATCH, lean: true }],
    }, 'find');
    let count = 0;
    for (const row of rows || []) {
        const result = await indexer.sync(companyId, String(row.sourceId));
        if (result && result.embedded === false) break;
        count += 1;
    }
    return count;
};

const ensureBackfill = (companyId) => (memoryFlag.installed() ? runOnce(companyId) : null);

const backfillAll = async (options) => {
    if (!memoryFlag.installed()) return { companies: 0 };
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let ran = 0;
    for (const company of companies || []) {
        const companyId = String(company._id);
        if (!(await memoryFlag.enabledFor(companyId))) continue;
        await keepAlive(companyId).catch((error) => logger.error(`${LOG_PREFIX} ${companyId}: heartbeat: ${error.message}`));
        if (await runOnce(companyId, options)) ran += 1;
        await reembedMissing(companyId).catch((error) => logger.error(`${LOG_PREFIX} ${companyId}: re-embedding sweep: ${error.message}`));
    }
    return { companies: ran };
};

module.exports = { JOB_NAME, INTERVAL_MS, BATCH_SIZE, HEARTBEAT_MS, STALE_AFTER_MS, STATE_KEY, readState, isReady, ready, keepAlive, resetHeartbeats, backfill, reembedMissing, ensureBackfill, backfillAll };
