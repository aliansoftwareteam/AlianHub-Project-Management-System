const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const flag = require('../flag');
const indexer = require('./indexer');

// Indexes the pages a company already had before its indexer was switched on. Progress is
// saved after every batch in knowledge_index_state, so a restart or a failure resumes from
// the last saved page instead of starting over. Retrieval keeps reading page rows until the
// state says complete.

const JOB_NAME = 'knowledge.backfill';
const INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const LOG_PREFIX = '[knowledge-backfill]';

const running = new Set();

const indexState = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data }, method);

const readState = (companyId) => indexState(companyId, [{ sourceType: indexer.SOURCE }, null, { lean: true }], 'findOne');

const saveState = (companyId, set) => indexState(companyId, [
    { sourceType: indexer.SOURCE },
    { $set: { companyId: String(companyId), sourceType: indexer.SOURCE, ...set } },
    { upsert: true, returnDocument: 'after', lean: true },
], 'findOneAndUpdate');

const pagesIndexed = async (companyId) => {
    const state = await readState(companyId);
    return Boolean(state) && state.status === 'complete';
};

const summaryOf = (state) => ({
    status: (state && state.status) || 'running',
    cursor: (state && state.cursor) || '',
    indexed: Number(state && state.indexed) || 0,
    skipped: Number(state && state.skipped) || 0,
});

const trashedProjectIds = async (companyId) => {
    const projects = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.PROJECTS, data: [{ deletedStatusKey: 1 }, '_id', { lean: true }] }, 'find');
    return new Set((projects || []).map((project) => String(project._id)));
};

const activeAuthorsOf = async (companyId, pages) => {
    const authors = [...new Set(pages.filter((page) => page.visibility === 'private' && page.createdBy).map((page) => String(page.createdBy)))];
    if (!authors.length) return new Set();
    const seats = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ userId: { $in: authors }, ...ACTIVE_SEAT }, 'userId', { lean: true }] }, 'find');
    return new Set((seats || []).map((seat) => String(seat.userId)));
};

const nextBatch = (companyId, cursor, batchSize) => MongoDbCrudOpration(String(companyId), {
    type: SCHEMA_TYPE.PAGES,
    data: [
        { deletedStatusKey: { $ne: 1 }, ...(cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {}) },
        indexer.PAGE_FIELDS,
        { sort: { _id: 1 }, limit: batchSize, lean: true },
    ],
}, 'find');

const backfillCompany = async (companyId, { batchSize = BATCH_SIZE, maxBatches = Infinity } = {}) => {
    const company = String(companyId);
    let state = await readState(company);
    if (state && state.status === 'complete') return summaryOf(state);

    let { cursor, indexed, skipped } = summaryOf(state);
    const startedAt = (state && state.startedAt) || new Date();
    try {
        const trashed = await trashedProjectIds(company);
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const pages = (await nextBatch(company, cursor, batchSize)) || [];
            const activeAuthors = await activeAuthorsOf(company, pages);
            for (const page of pages) {
                const result = await indexer.ingestPage(company, page, { trashedProjectIds: trashed, activeAuthors });
                if (result && result.leftOut) skipped += 1;
                else indexed += 1;
            }
            if (pages.length) cursor = String(pages[pages.length - 1]._id);
            const done = pages.length < batchSize;
            state = await saveState(company, {
                status: done ? 'complete' : 'running', cursor, indexed, skipped, startedAt, lastRunAt: new Date(), finishedAt: done ? new Date() : null, error: '',
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

module.exports = { JOB_NAME, INTERVAL_MS, BATCH_SIZE, readState, pagesIndexed, backfillCompany, backfillAll, ensureBackfill };
