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
//
// While the indexer is off nothing is written, so events dropped then leave no trace. What is
// kept instead is a heartbeat written while it is on: a source whose heartbeat has gone stale may
// have missed events, so it is served from its rows again until a catch-up has re-synced every
// row changed since the heartbeat.

const JOB_NAME = 'knowledge.backfill';
const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const HEARTBEAT_MS = 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
const LOG_PREFIX = '[knowledge-backfill]';

const CANDIDATES = {
    page: { type: SCHEMA_TYPE.PAGES, where: { deletedStatusKey: { $ne: 1 } } },
    comment: { type: SCHEMA_TYPE.COMMENTS, where: { isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES } } },
    transcript: { type: SCHEMA_TYPE.CALLS, where: { deletedStatusKey: { $ne: 1 } } },
};

/* Deleted rows are walked too, so a delete missed while off still tombstones. A comment also follows
 * its task, so the tasks changed in the gap are walked after the comments. */
const CATCH_UP_PASSES = {
    page: [{ type: SCHEMA_TYPE.PAGES, apply: (companyId, id) => indexer.sync(companyId, 'page', id) }],
    comment: [
        { type: SCHEMA_TYPE.COMMENTS, apply: (companyId, id) => indexer.sync(companyId, 'comment', id) },
        { type: SCHEMA_TYPE.TASKS, apply: (companyId, id) => indexer.reindexTask(companyId, id, { moved: true }) },
    ],
    transcript: [{ type: SCHEMA_TYPE.CALLS, apply: (companyId, id) => indexer.sync(companyId, 'transcript', id) }],
};

const running = new Set();
const beats = new Map();

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

const indexState = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data }, method);

const readState = (companyId, sourceType = indexer.SOURCE) => indexState(companyId, [{ sourceType }, null, { lean: true }], 'findOne');

const readStates = async (companyId, sourceTypes = INDEXED_SOURCES) => {
    const wanted = INDEXED_SOURCES.filter((sourceType) => sourceTypes.includes(sourceType));
    if (!wanted.length) return [];
    return (await indexState(companyId, [{ sourceType: { $in: wanted } }, null, { lean: true }], 'find')) || [];
};

const saveState = (companyId, sourceType, set) => indexState(companyId, [
    { sourceType },
    { $set: { companyId: String(companyId), sourceType, lastSeenOnAt: new Date(), ...set } },
    { upsert: true, returnDocument: 'after', lean: true },
], 'findOneAndUpdate');

/* A state written before heartbeats existed is judged by its last run. */
const seenAt = (state) => time(state.lastSeenOnAt || state.lastRunAt || state.finishedAt || state.startedAt);

const isFresh = (state, now = Date.now()) => now - seenAt(state) <= STALE_AFTER_MS;

const isIndexed = (state, now = Date.now()) => Boolean(state) && state.status === 'complete' && !state.catchUpFrom && isFresh(state, now);

const indexedOf = (states, sourceTypes = INDEXED_SOURCES) => {
    const now = Date.now();
    const ready = new Set((states || []).filter((state) => isIndexed(state, now)).map((state) => state.sourceType));
    return INDEXED_SOURCES.filter((sourceType) => sourceTypes.includes(sourceType) && ready.has(sourceType));
};

const indexedSources = async (companyId, sourceTypes = INDEXED_SOURCES) => indexedOf(await readStates(companyId, sourceTypes), sourceTypes);

const pagesIndexed = async (companyId) => (await indexedSources(companyId, [indexer.SOURCE])).length > 0;

const earliest = (a, b) => new Date(Math.min(...[a, b].map(time).filter((at) => at > 0).concat([Date.now()])));

/* Called while the indexer is on. A stale source is marked for catch-up from its last heartbeat; a
 * fresh one has its heartbeat moved forward at most once a minute. `states` are ones the caller
 * has just read; without them the states are read, also at most once a minute. Returns the
 * sources marked stale. */
const keepAlive = async (companyId, { states } = {}) => {
    const company = String(companyId);
    const now = Date.now();
    const due = (sourceType) => now - (beats.get(`${company}:${sourceType}`) || 0) >= HEARTBEAT_MS;
    if (!states && !INDEXED_SOURCES.some(due)) return [];
    const rows = states || await readStates(company);
    const stale = rows.filter((state) => !isFresh(state, now));
    for (const state of stale) {
        beats.set(`${company}:${state.sourceType}`, now);
        const settled = state.status === 'complete' || state.status === 'catching-up';
        await saveState(company, state.sourceType, {
            catchUpFrom: state.catchUpFrom ? earliest(state.catchUpFrom, seenAt(state)) : new Date(seenAt(state)),
            ...(settled ? { status: 'catching-up', cursor: '', catchUpPass: 0 } : {}),
        });
    }
    const beating = rows.filter((state) => isFresh(state, now) && due(state.sourceType)).map((state) => state.sourceType);
    if (beating.length) {
        beating.forEach((sourceType) => beats.set(`${company}:${sourceType}`, now));
        await indexState(company, [{ sourceType: { $in: beating } }, { $set: { lastSeenOnAt: new Date(now) } }], 'updateMany');
    }
    return stale.map((state) => state.sourceType);
};

const resetHeartbeats = () => beats.clear();

const summaryOf = (state) => ({
    status: (state && state.status) || 'running',
    cursor: (state && state.cursor) || '',
    indexed: Number(state && state.indexed) || 0,
    skipped: Number(state && state.skipped) || 0,
});

const afterCursor = (cursor) => (cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {});

const batchOf = (companyId, type, where, cursor, batchSize) => MongoDbCrudOpration(String(companyId), {
    type,
    data: [{ ...where, ...afterCursor(cursor) }, '_id', { sort: { _id: 1 }, limit: batchSize, lean: true }],
}, 'find');

/* Saves only while the catch-up this run started is still the one recorded: a heartbeat that finds
 * a new gap resets it, and this run then stops so the next one starts over from that reset. */
const catchUp = async (company, sourceType, started, { batchSize = BATCH_SIZE, maxBatches = Infinity } = {}) => {
    const passes = CATCH_UP_PASSES[sourceType];
    const from = new Date(started.catchUpFrom || 0);
    let state = started;
    let pass = Number(state.catchUpPass) || 0;
    let cursor = state.cursor || '';
    const recorded = () => ({ sourceType, catchUpFrom: from, catchUpPass: pass, cursor });
    try {
        for (let batch = 0; batch < maxBatches && pass < passes.length; batch += 1) {
            const expected = recorded();
            const rows = (await batchOf(company, passes[pass].type, { updatedAt: { $gt: from } }, cursor, batchSize)) || [];
            for (const row of rows) {
                await passes[pass].apply(company, String(row._id));
            }
            if (rows.length) cursor = String(rows[rows.length - 1]._id);
            if (rows.length < batchSize) {
                pass += 1;
                cursor = '';
            }
            const done = pass >= passes.length;
            const saved = await indexState(company, [expected, {
                $set: done
                    ? { status: 'complete', cursor: '', catchUpPass: 0, catchUpFrom: null, lastRunAt: new Date(), finishedAt: new Date(), lastSeenOnAt: new Date(), error: '' }
                    : { status: 'catching-up', cursor, catchUpPass: pass, lastRunAt: new Date(), lastSeenOnAt: new Date(), error: '' },
            }, { returnDocument: 'after', lean: true }], 'findOneAndUpdate');
            if (!saved) return summaryOf(await readState(company, sourceType));
            state = saved;
        }
        return summaryOf(state);
    } catch (error) {
        const message = (error && error.message) || String(error);
        await indexState(company, [recorded(), { $set: { lastRunAt: new Date(), error: message } }], 'updateOne')
            .catch((saveError) => logger.error(`${LOG_PREFIX} ${company} ${sourceType}: could not record the failure: ${saveError.message}`));
        throw error;
    }
};

const backfillSource = async (companyId, sourceType, options = {}) => {
    const { batchSize = BATCH_SIZE, maxBatches = Infinity } = options;
    const company = String(companyId);
    let state = await readState(company, sourceType);
    if (state && state.status === 'complete' && !state.catchUpFrom) return summaryOf(state);
    if (state && state.status === 'complete') state = await saveState(company, sourceType, { status: 'catching-up', cursor: '', catchUpPass: 0 });
    if (state && state.status === 'catching-up') return catchUp(company, sourceType, state, options);

    let { cursor, indexed, skipped } = summaryOf(state);
    const startedAt = (state && state.startedAt) || new Date();
    try {
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const rows = (await batchOf(company, CANDIDATES[sourceType].type, CANDIDATES[sourceType].where, cursor, batchSize)) || [];
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
            if (done && state && state.catchUpFrom) {
                state = await saveState(company, sourceType, { status: 'catching-up', cursor: '', catchUpPass: 0 });
                return catchUp(company, sourceType, state, options);
            }
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

/* Each run also re-embeds a batch of what a hybrid company's chunks still lack, so a failed
 * embed or a model change is caught up without anyone touching the source. */
const backfillAll = async (options) => {
    if (flag.indexer.mode() === 'off') return { companies: 0, reembedded: {} };
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let ran = 0;
    const reembedded = {};
    for (const company of companies || []) {
        const companyId = String(company._id);
        if (!(await flag.indexer.enabledFor(companyId))) continue;
        await keepAlive(companyId).catch((error) => logger.error(`${LOG_PREFIX} ${companyId}: heartbeat: ${error.message}`));
        if (await runOnce(companyId, options)) ran += 1;
        const count = await indexer.reembedMissing(companyId).catch((error) => {
            logger.error(`${LOG_PREFIX} ${companyId}: re-embedding sweep: ${error.message}`);
            return null;
        });
        if (count !== null) reembedded[companyId] = count;
    }
    return { companies: ran, reembedded };
};

/* Started by the first event a switched-on company sends, so its index is built without
 * waiting for the recurring job. */
const ensureBackfill = (companyId) => {
    if (flag.indexer.mode() === 'off' || running.has(String(companyId))) return null;
    return runOnce(String(companyId));
};

module.exports = {
    JOB_NAME,
    INTERVAL_MS,
    BATCH_SIZE,
    HEARTBEAT_MS,
    STALE_AFTER_MS,
    readState,
    readStates,
    indexedOf,
    indexedSources,
    pagesIndexed,
    keepAlive,
    resetHeartbeats,
    backfillSource,
    backfillCompany,
    backfillAll,
    ensureBackfill,
};
