const os = require('os');
const crypto = require('crypto');
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
//
// One server walks at a time, under a lease on the state row that it renews as it goes, between
// rows and, for files, after each attachment of a task, since one task can carry many slow
// extractions. Another server's job passes a leased walk over and takes up one whose lease ran out;
// renewing only on progress means a walker stuck on one file still loses the walk.

const RUNNING = 'running';
const COMPLETE = 'complete';
const FAILED = 'failed';
const CANCELLED = 'cancelled';
const UNSETTLED = ['running', 'catching-up'];
const LEASE_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const LOG_PREFIX = '[knowledge-reindex]';
const SERVER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

const pending = new Set();

const indexState = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data }, method);

const reindexable = () => Object.keys(backfill.CANDIDATES);

const released = { reindexOwner: '', reindexLeaseUntil: null };

const request = async (companyId, sourceType, { requestedBy = '' } = {}) => {
    const started = await indexState(companyId, [
        { sourceType, status: { $nin: UNSETTLED }, reindexStatus: { $ne: RUNNING } },
        {
            $set: {
                reindexStatus: RUNNING,
                reindexCursor: '',
                reindexSynced: 0,
                reindexRequestedAt: new Date(),
                reindexRequestedBy: String(requestedBy),
                reindexFinishedAt: null,
                reindexError: '',
                reindexFailures: 0,
                ...released,
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

const cancel = async (companyId, sourceType) => {
    const result = await indexState(companyId, [
        { sourceType, reindexStatus: RUNNING },
        { $set: { reindexStatus: CANCELLED, reindexFinishedAt: new Date(), ...released } },
    ], 'updateOne');
    return result && result.matchedCount ? { ok: true } : { ok: false, code: 'reindex_not_running' };
};

const afterCursor = (cursor) => (cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {});

const batchOf = (companyId, candidate, cursor, batchSize) => MongoDbCrudOpration(String(companyId), {
    type: candidate.type,
    data: [{ ...candidate.where, ...afterCursor(cursor) }, '_id', { sort: { _id: 1 }, limit: batchSize, lean: true }],
}, 'find');

const leaseFree = (now) => ({ $or: [{ reindexLeaseUntil: { $exists: false } }, { reindexLeaseUntil: null }, { reindexLeaseUntil: { $lte: new Date(now) } }] });

const claim = (companyId, sourceType, owner) => {
    const now = Date.now();
    return indexState(companyId, [
        { sourceType, reindexStatus: RUNNING, ...leaseFree(now) },
        { $set: { reindexOwner: owner, reindexLeaseUntil: new Date(now + LEASE_MS) } },
        { returnDocument: 'after', lean: true },
    ], 'findOneAndUpdate');
};

/* A failure frees the lease so the next run can retry, and after MAX_FAILURES the walk is given
 * up, so a source that keeps failing does not refuse every later request with a 409. */
const recordFailure = async (companyId, sourceType, mine, message) => {
    const failed = await indexState(companyId, [mine, { $set: { reindexError: message, ...released }, $inc: { reindexFailures: 1 } }, { returnDocument: 'after', lean: true }], 'findOneAndUpdate');
    if (failed && Number(failed.reindexFailures) >= MAX_FAILURES) {
        await indexState(companyId, [
            { sourceType, reindexStatus: RUNNING, reindexRequestedAt: failed.reindexRequestedAt },
            { $set: { reindexStatus: FAILED, reindexFinishedAt: new Date() } },
        ], 'updateOne');
    }
};

/* Every save is conditional on this server still holding this request's lease, so a cancel, a newer
 * request, or another server that took over an expired lease stops this walk at its next save. */
const runSource = async (companyId, sourceType, { batchSize = backfill.BATCH_SIZE, maxBatches = Infinity, owner = SERVER } = {}) => {
    const company = String(companyId);
    const candidate = backfill.CANDIDATES[sourceType];
    if (!candidate) return null;
    const state = await claim(company, sourceType, owner);
    if (!state) return null;
    const mine = { sourceType, reindexStatus: RUNNING, reindexRequestedAt: state.reindexRequestedAt, reindexOwner: owner };
    let cursor = state.reindexCursor || '';
    let synced = Number(state.reindexSynced) || 0;
    let renewedAt = Date.now();
    let lost = false;
    const hold = async () => {
        if (lost) return false;
        const at = Date.now();
        const held = await indexState(company, [mine, { $set: { reindexLeaseUntil: new Date(at + LEASE_MS) } }], 'updateOne');
        if (held && held.matchedCount) renewedAt = at;
        else lost = true;
        return !lost;
    };
    const renew = async () => {
        if (lost) return false;
        return Date.now() - renewedAt < LEASE_MS / 3 ? true : hold();
    };
    try {
        for (let batch = 0; batch < maxBatches; batch += 1) {
            if (batch > 0 && !(await hold())) return null;
            const rows = (await batchOf(company, candidate, cursor, batchSize)) || [];
            for (const row of rows) {
                await candidate.apply(company, String(row._id), { onProgress: renew });
                synced += 1;
                if (!(await renew())) return null;
            }
            if (rows.length) cursor = String(rows[rows.length - 1]._id);
            const done = rows.length < batchSize;
            const saved = await indexState(company, [mine, {
                $set: done
                    ? { reindexStatus: COMPLETE, reindexCursor: '', reindexSynced: synced, reindexFinishedAt: new Date(), reindexError: '', ...released }
                    : { reindexCursor: cursor, reindexSynced: synced, reindexError: '', reindexLeaseUntil: new Date(Date.now() + LEASE_MS) },
            }, { returnDocument: 'after', lean: true }], 'findOneAndUpdate');
            renewedAt = Date.now();
            if (!saved || done) return saved;
        }
        return indexState(company, [mine, { $set: released }, { returnDocument: 'after', lean: true }], 'findOneAndUpdate');
    } catch (error) {
        const message = (error && error.message) || String(error);
        logger.error(`${LOG_PREFIX} ${company} ${sourceType}: ${message}`);
        await recordFailure(company, sourceType, mine, message)
            .catch((saveError) => logger.error(`${LOG_PREFIX} ${company} ${sourceType}: could not record the failure: ${saveError.message}`));
        return null;
    }
};

const runCompany = async (companyId) => {
    const states = (await indexState(companyId, [{ reindexStatus: RUNNING }, 'sourceType', { lean: true }], 'find')) || [];
    for (const state of states) await runSource(companyId, state.sourceType);
    return states.length;
};

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

module.exports = { RUNNING, COMPLETE, FAILED, CANCELLED, LEASE_MS, MAX_FAILURES, reindexable, request, cancel, runSource, runCompany, runAll, kick, settled };
