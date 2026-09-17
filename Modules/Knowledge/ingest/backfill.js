const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const flag = require('../flag');
const { INDEXED_SOURCES, COMMENT_TYPES } = require('../sources');
const indexer = require('./indexer');

// Indexes what a company already had before its indexer was switched on, one source at a time.
// Each source saves its own progress after every batch in knowledge_index_state, so a restart or
// a failure resumes that source from its last saved row instead of starting over, and a source
// that fails holds none of the others back. Retrieval keeps reading a source's rows until its
// state says complete. Every row goes through the same serialised sync as an event, so the
// backfill never writes beside an event for the same row, and every decision about trash,
// erasure, departure or a deleted task is read at write time rather than when the run started.

const JOB_NAME = 'knowledge.backfill';
const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const LOG_PREFIX = '[knowledge-backfill]';

const CANDIDATES = {
    page: { type: SCHEMA_TYPE.PAGES, where: { deletedStatusKey: { $ne: 1 } } },
    comment: { type: SCHEMA_TYPE.COMMENTS, where: { isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES } } },
    transcript: { type: SCHEMA_TYPE.CALLS, where: { deletedStatusKey: { $ne: 1 } } },
};

const running = new Set();

const indexState = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data }, method);

const readState = (companyId, sourceType = indexer.SOURCE) => indexState(companyId, [{ sourceType }, null, { lean: true }], 'findOne');

const saveState = (companyId, sourceType, set) => indexState(companyId, [
    { sourceType },
    { $set: { companyId: String(companyId), sourceType, ...set } },
    { upsert: true, returnDocument: 'after', lean: true },
], 'findOneAndUpdate');

const indexedSources = async (companyId, sourceTypes = INDEXED_SOURCES) => {
    const wanted = INDEXED_SOURCES.filter((sourceType) => sourceTypes.includes(sourceType));
    if (!wanted.length) return [];
    const states = await indexState(companyId, [{ sourceType: { $in: wanted } }, 'sourceType status', { lean: true }], 'find');
    const complete = new Set((states || []).filter((state) => state.status === 'complete').map((state) => state.sourceType));
    return wanted.filter((sourceType) => complete.has(sourceType));
};

const pagesIndexed = async (companyId) => (await indexedSources(companyId, [indexer.SOURCE])).length > 0;

const summaryOf = (state) => ({
    status: (state && state.status) || 'running',
    cursor: (state && state.cursor) || '',
    indexed: Number(state && state.indexed) || 0,
    skipped: Number(state && state.skipped) || 0,
});

const nextBatch = (companyId, sourceType, cursor, batchSize) => MongoDbCrudOpration(String(companyId), {
    type: CANDIDATES[sourceType].type,
    data: [
        { ...CANDIDATES[sourceType].where, ...(cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {}) },
        '_id',
        { sort: { _id: 1 }, limit: batchSize, lean: true },
    ],
}, 'find');

const backfillSource = async (companyId, sourceType, { batchSize = BATCH_SIZE, maxBatches = Infinity } = {}) => {
    const company = String(companyId);
    let state = await readState(company, sourceType);
    if (state && state.status === 'complete') return summaryOf(state);

    let { cursor, indexed, skipped } = summaryOf(state);
    const startedAt = (state && state.startedAt) || new Date();
    try {
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const rows = (await nextBatch(company, sourceType, cursor, batchSize)) || [];
            for (const row of rows) {
                const result = await indexer.sync(company, sourceType, String(row._id));
                if (result && result.leftOut) skipped += 1;
                else indexed += 1;
            }
            if (rows.length) cursor = String(rows[rows.length - 1]._id);
            const done = rows.length < batchSize;
            state = await saveState(company, sourceType, {
                status: done ? 'complete' : 'running', cursor, indexed, skipped, startedAt, lastRunAt: new Date(), finishedAt: done ? new Date() : null, error: '',
            });
            if (done) break;
        }
        return summaryOf(state);
    } catch (error) {
        const message = (error && error.message) || String(error);
        await saveState(company, sourceType, { status: 'failed', cursor, startedAt, lastRunAt: new Date(), error: message })
            .catch((saveError) => logger.error(`${LOG_PREFIX} ${company} ${sourceType}: could not record the failure: ${saveError.message}`));
        throw error;
    }
};

/* Every source is attempted; the first failure is rethrown once the others have run. */
const backfillCompany = async (companyId, options = {}) => {
    const sourceTypes = INDEXED_SOURCES.filter((sourceType) => !options.sourceTypes || options.sourceTypes.includes(sourceType));
    const sources = {};
    let failure = null;
    for (const sourceType of sourceTypes) {
        try {
            sources[sourceType] = await backfillSource(companyId, sourceType, options);
        } catch (error) {
            failure = failure || error;
        }
    }
    if (failure) throw failure;
    const all = Object.values(sources);
    return {
        status: all.every((summary) => summary.status === 'complete') ? 'complete' : 'running',
        indexed: all.reduce((sum, summary) => sum + summary.indexed, 0),
        skipped: all.reduce((sum, summary) => sum + summary.skipped, 0),
        sources,
    };
};

const runOnce = async (companyId, options) => {
    if (running.has(companyId)) return null;
    running.add(companyId);
    try {
        return await backfillCompany(companyId, options);
    } catch (error) {
        logger.error(`${LOG_PREFIX} ${companyId}: ${error.message}`);
        return null;
    } finally {
        running.delete(companyId);
    }
};

const backfillAll = async (options) => {
    if (flag.indexer.mode() === 'off') return { companies: 0 };
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let ran = 0;
    for (const company of companies || []) {
        const companyId = String(company._id);
        if (!(await flag.indexer.enabledFor(companyId))) continue;
        if (await runOnce(companyId, options)) ran += 1;
    }
    return { companies: ran };
};

/* Started by the first event a switched-on company sends, so its index is built without
 * waiting for the recurring job. */
const ensureBackfill = (companyId) => {
    if (flag.indexer.mode() === 'off' || running.has(String(companyId))) return null;
    return runOnce(String(companyId));
};

module.exports = { JOB_NAME, INTERVAL_MS, BATCH_SIZE, readState, indexedSources, pagesIndexed, backfillSource, backfillCompany, backfillAll, ensureBackfill };
