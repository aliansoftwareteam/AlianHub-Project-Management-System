const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const flag = require('./flag');
const backfill = require('./ingest/backfill');

// A re-index walks every row of one source again through the same sync as the backfill, but it is
// recorded beside the backfill's own state and never changes `status`: retrieval reads a source's
// chunks only while that status is complete, so resetting it would leave guides and files with
// nothing to answer from until the walk finished. Each chunk is rewritten in place instead.

const RUNNING = 'running';
const COMPLETE = 'complete';
const UNSETTLED = ['running', 'catching-up'];
const LOG_PREFIX = '[knowledge-reindex]';

const inHand = new Set();
const pending = new Set();

const indexState = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data }, method);

const reindexable = () => Object.keys(backfill.CANDIDATES);

const request = async (companyId, sourceType, { requestedBy = '' } = {}) => {
    const started = await indexState(companyId, [
        { sourceType, status: { $nin: UNSETTLED }, reindexStatus: { $ne: RUNNING } },
        {
            $set: {
                reindexStatus: RUNNING, reindexCursor: '', reindexSynced: 0, reindexRequestedAt: new Date(), reindexRequestedBy: String(requestedBy), reindexFinishedAt: null, reindexError: '',
            },
        },
        { returnDocument: 'after', lean: true },
    ], 'findOneAndUpdate');
    if (started) return { ok: true, state: started };
    const state = await backfill.readState(companyId, sourceType);
    if (!state) return { ok: false, code: 'backfill_pending' };
    if (state.reindexStatus === RUNNING) return { ok: false, code: 'reindex_running' };
    return { ok: false, code: 'backfill_running' };
};

const afterCursor = (cursor) => (cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {});

const batchOf = (companyId, candidate, cursor, batchSize) => MongoDbCrudOpration(String(companyId), {
    type: candidate.type,
    data: [{ ...candidate.where, ...afterCursor(cursor) }, '_id', { sort: { _id: 1 }, limit: batchSize, lean: true }],
}, 'find');

/* Progress is saved only while the request this run started from is still the one recorded, so a
 * newer request made meanwhile starts from the first row rather than from this run's place. */
const runSource = async (companyId, sourceType, { batchSize = backfill.BATCH_SIZE, maxBatches = Infinity } = {}) => {
    const company = String(companyId);
    const key = `${company}:${sourceType}`;
    const candidate = backfill.CANDIDATES[sourceType];
    if (!candidate || inHand.has(key)) return null;
    inHand.add(key);
    try {
        const state = await backfill.readState(company, sourceType);
        if (!state || state.reindexStatus !== RUNNING) return null;
        const mine = { sourceType, reindexStatus: RUNNING, reindexRequestedAt: state.reindexRequestedAt };
        let cursor = state.reindexCursor || '';
        let synced = Number(state.reindexSynced) || 0;
        try {
            for (let batch = 0; batch < maxBatches; batch += 1) {
                const rows = (await batchOf(company, candidate, cursor, batchSize)) || [];
                for (const row of rows) {
                    await candidate.apply(company, String(row._id));
                    synced += 1;
                }
                if (rows.length) cursor = String(rows[rows.length - 1]._id);
                const done = rows.length < batchSize;
                const saved = await indexState(company, [mine, {
                    $set: done
                        ? { reindexStatus: COMPLETE, reindexCursor: '', reindexSynced: synced, reindexFinishedAt: new Date(), reindexError: '' }
                        : { reindexCursor: cursor, reindexSynced: synced, reindexError: '' },
                }, { returnDocument: 'after', lean: true }], 'findOneAndUpdate');
                if (!saved || done) return saved;
            }
            return backfill.readState(company, sourceType);
        } catch (error) {
            const message = (error && error.message) || String(error);
            logger.error(`${LOG_PREFIX} ${company} ${sourceType}: ${message}`);
            await indexState(company, [mine, { $set: { reindexError: message } }], 'updateOne')
                .catch((saveError) => logger.error(`${LOG_PREFIX} ${company} ${sourceType}: could not record the failure: ${saveError.message}`));
            return null;
        }
    } finally {
        inHand.delete(key);
    }
};

const runCompany = async (companyId) => {
    const states = (await indexState(companyId, [{ reindexStatus: RUNNING }, 'sourceType', { lean: true }], 'find')) || [];
    for (const state of states) await runSource(companyId, state.sourceType);
    return states.length;
};

/* Taken up by the recurring job, so a restart or a failed batch carries on from the saved row. */
const runAll = async () => {
    if (flag.indexer.mode() === 'off') return 0;
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.COMPANIES, data: [{}, '_id'] }, 'find');
    let count = 0;
    for (const row of companies || []) {
        const companyId = String(row._id);
        if (!(await flag.indexer.enabledFor(companyId))) continue;
        count += await runCompany(companyId).catch((error) => {
            logger.error(`${LOG_PREFIX} ${companyId}: ${error.message}`);
            return 0;
        });
    }
    return count;
};

const kick = (companyId, sourceType) => {
    const run = runSource(companyId, sourceType).catch((error) => logger.error(`${LOG_PREFIX} ${companyId} ${sourceType}: ${error.message}`));
    pending.add(run);
    run.finally(() => pending.delete(run));
    return run;
};

const settled = () => Promise.all([...pending]);

module.exports = { RUNNING, COMPLETE, reindexable, request, runSource, runCompany, runAll, kick, settled };
