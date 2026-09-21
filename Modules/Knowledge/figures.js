const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../Config/config');
const flag = require('./flag');
const embeddings = require('./embeddings');
const { INDEXED_SOURCES } = require('./sources');
const { FEATURES } = require('../AICore/features');
const backfill = require('./ingest/backfill');
const indexer = require('./ingest/indexer');
const fileSweep = require('./ingest/fileSweep');

// What the instance console shows of one workspace's index: counts, sizes, times, states and
// reasons. Nothing here reads or returns a chunk's text, title or file key.

/* Markers the indexer writes for its own bookkeeping, not reasons a file was left out. */
const NOT_A_REASON = ['', 'task'];
const LIVE = { deleted: { $ne: true } };
const BACKFILL_STATUS = { running: 'running', 'catching-up': 'catching_up', complete: 'complete', failed: 'failed' };
const MAX_TIME_MS_DEFAULT = 10000;
const CACHE_SECONDS = 60;
const CACHE_PREFIX = 'knowledgeFigures:';
const TIMED_OUT = 'figures_timed_out';

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);
const asDate = (value) => (time(value) ? new Date(value) : null);

const maxTimeMS = () => {
    const ms = Number(process.env.KNOWLEDGE_FIGURES_MAX_TIME_MS);
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : MAX_TIME_MS_DEFAULT;
};

const timedOut = (error) => Boolean(error) && (error.code === 50 || error.codeName === 'MaxTimeMSExpired');

const chunkRows = (companyId, pipeline) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [pipeline, { maxTimeMS: maxTimeMS() }] }, 'aggregate');
const count = (companyId, type, where) => MongoDbCrudOpration(String(companyId), { type, data: [where, { maxTimeMS: maxTimeMS() }] }, 'countDocuments').then((n) => Number(n) || 0);
const chunkSourceTypes = (companyId) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: ['sourceType'] }, 'distinct');

/* The source types come from the distinct scan of the unique index, so the pass can start with a
 * match that index serves. Text size is estimated from the text alone: a chunk's vector never enters
 * the pipeline. */
const chunkFacets = async (companyId, sourceTypes, retried, maxAttempts) => {
    const [facets] = (await chunkRows(companyId, [
        { $match: { sourceType: { $in: sourceTypes } } },
        {
            $project: {
                sourceType: 1, sourceId: 1, deleted: 1, embeddingModel: 1, updatedAt: 1, ordinal: 1, tombstoneReason: 1, extractAttempts: 1, extractDueAt: 1,
                textBytes: { $strLenBytes: { $ifNull: ['$text', ''] } },
            },
        },
        {
            $facet: {
                bySource: [{ $group: { _id: { sourceType: '$sourceType', deleted: '$deleted' }, chunks: { $sum: 1 }, textBytes: { $sum: '$textBytes' }, lastAt: { $max: '$updatedAt' } } }],
                sources: [{ $match: LIVE }, { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' } } }, { $group: { _id: '$_id.sourceType', sources: { $sum: 1 } } }],
                byModel: [{ $match: LIVE }, { $group: { _id: '$embeddingModel', chunks: { $sum: 1 } } }],
                fileReasons: [
                    { $match: { sourceType: 'file', ordinal: 0, deleted: true, tombstoneReason: { $nin: NOT_A_REASON, $type: 'string' } } },
                    { $group: { _id: '$tombstoneReason', count: { $sum: 1 } } },
                ],
                fileExhausted: [
                    { $match: { sourceType: 'file', ordinal: 0, deleted: true, tombstoneReason: { $in: retried }, extractAttempts: { $gte: maxAttempts } } },
                    { $group: { _id: '$tombstoneReason', count: { $sum: 1 } } },
                ],
                filesPending: [{ $match: fileSweep.pendingFilter() }, { $count: 'n' }],
            },
        },
    ])) || [];
    return facets || {};
};

const progressOf = async (companyId, sourceType, cursor) => {
    const candidate = backfill.CANDIDATES[sourceType];
    if (!candidate) return null;
    const [done, total] = await Promise.all([
        cursor ? count(companyId, candidate.type, { ...candidate.where, _id: { $lte: new mongoose.Types.ObjectId(cursor) } }) : 0,
        count(companyId, candidate.type, candidate.where),
    ]);
    return { done, total };
};

const freshnessOf = (state, now) => {
    const heartbeat = state ? asDate(state.lastSeenOnAt || state.lastRunAt || state.finishedAt || state.startedAt) : null;
    const catchUpFrom = state ? asDate(state.catchUpFrom) : null;
    const behindMs = heartbeat ? Math.max(0, now - heartbeat.getTime()) : null;
    return {
        heartbeatAt: heartbeat,
        behindMs,
        stale: behindMs !== null && behindMs > backfill.STALE_AFTER_MS,
        catchUpFrom,
        catchUpBehindMs: catchUpFrom ? Math.max(0, now - catchUpFrom.getTime()) : null,
    };
};

const backfillOf = async (companyId, sourceType, state) => {
    if (!state) return { status: 'not_started', progress: null, indexed: 0, skipped: 0, startedAt: null, finishedAt: null };
    const status = BACKFILL_STATUS[state.status] || 'running';
    return {
        status,
        progress: status === 'running' ? await progressOf(companyId, sourceType, state.cursor) : null,
        indexed: Number(state.indexed) || 0,
        skipped: Number(state.skipped) || 0,
        startedAt: asDate(state.startedAt),
        finishedAt: asDate(state.finishedAt),
    };
};

const reindexOf = async (companyId, sourceType, state) => {
    const status = (state && state.reindexStatus) || '';
    if (!status) return { status: '', progress: null, requestedAt: null, finishedAt: null, failing: false };
    return {
        status,
        progress: status === 'running' ? await progressOf(companyId, sourceType, state.reindexCursor) : null,
        synced: Number(state.reindexSynced) || 0,
        requestedAt: asDate(state.reindexRequestedAt),
        finishedAt: asDate(state.reindexFinishedAt),
        failing: Boolean(state.reindexError),
    };
};

const sourceTypesOf = (...lists) => [...new Set([...INDEXED_SOURCES, ...lists.flat().filter(Boolean)])];

const monthKey = (at = new Date()) => at.toISOString().slice(0, 7);

const spendOf = async (companyId) => {
    const month = monthKey();
    const [monthly, settings] = await Promise.all([
        require('../AICore/spend').monthly(String(companyId), month),
        require('../Agents/budget').settings(String(companyId)),
    ]);
    const embed = (monthly.features || []).find((f) => f.feature === FEATURES.KNOWLEDGE_EMBED) || { usd: 0, calls: 0, tokens: 0 };
    return {
        spend: { month, usd: embed.usd, calls: embed.calls, tokens: embed.tokens },
        budget: { usedUsd: monthly.usedUsd, budgetUsd: Number(settings && settings.monthlyBudgetUsd) || 0 },
    };
};

const embeddingsOf = async (companyId, byModel) => {
    const model = embeddings.model();
    const rows = (byModel || []).map((row) => ({ model: row._id || null, chunks: row.chunks, current: row._id === model }))
        .sort((a, b) => (b.current - a.current) || (b.chunks - a.chunks));
    const breaker = embeddings.breakerState(companyId);
    return {
        model,
        configured: embeddings.configured(),
        byModel: rows,
        pendingChunks: rows.filter((row) => !row.current).reduce((sum, row) => sum + row.chunks, 0),
        breaker: { open: breaker.open, reason: breaker.open ? breaker.reason : null, until: breaker.open ? new Date(breaker.until) : null },
        ...(await spendOf(companyId)),
    };
};

const filesOf = (facets) => {
    const exhausted = new Map((facets.fileExhausted || []).map((row) => [row._id, row.count]));
    const retried = indexer.RETRIED_FILE_REASONS;
    return {
        reasons: (facets.fileReasons || [])
            .map((row) => ({ reason: String(row._id), count: row.count, exhausted: exhausted.get(row._id) || 0, retryable: retried.includes(row._id) }))
            .sort((a, b) => a.reason.localeCompare(b.reason)),
        pending: ((facets.filesPending || [])[0] || {}).n || 0,
    };
};

const modesOf = async (companyId) => {
    const [indexerMode, retrievalMode] = await Promise.all([flag.indexer.modeFor(companyId), flag.modeFor(companyId)]);
    return { indexer: indexerMode, retrieval: retrievalMode };
};

const summaryRow = async (company) => {
    const companyId = String(company._id);
    const [modes, states] = await Promise.all([
        modesOf(companyId),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data: [{}, 'sourceType status reindexStatus lastSeenOnAt lastRunAt finishedAt startedAt', { lean: true }] }, 'find'),
    ]);
    const bySource = new Map((states || []).map((state) => [state.sourceType, state]));
    const now = Date.now();
    return {
        companyId,
        name: company.Cst_CompanyName || '',
        modes,
        sources: sourceTypesOf([...bySource.keys()]).map((sourceType) => {
            const state = bySource.get(sourceType);
            return {
                sourceType,
                backfill: state ? BACKFILL_STATUS[state.status] || 'running' : 'not_started',
                reindex: (state && state.reindexStatus) || '',
                stale: freshnessOf(state, now).stale,
            };
        }),
    };
};

const readFigures = async (company, now) => {
    const known = sourceTypesOf((await chunkSourceTypes(company)) || []);
    const [facets, states, modes] = await Promise.all([
        chunkFacets(company, known, indexer.RETRIED_FILE_REASONS, indexer.FILE_EXTRACT_ATTEMPTS),
        MongoDbCrudOpration(company, { type: SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, data: [{}, null, { lean: true }] }, 'find'),
        modesOf(company),
    ]);
    const stateOf = new Map((states || []).map((state) => [state.sourceType, state]));
    const figuresOf = new Map();
    const entry = (sourceType) => {
        if (!figuresOf.has(sourceType)) figuresOf.set(sourceType, { chunks: 0, tombstones: 0, sources: 0, textBytes: 0, lastIndexedAt: null });
        return figuresOf.get(sourceType);
    };
    (facets.bySource || []).forEach((row) => {
        const figures = entry(row._id.sourceType);
        if (row._id.deleted === true) figures.tombstones += row.chunks;
        else {
            figures.chunks += row.chunks;
            if (time(row.lastAt) > time(figures.lastIndexedAt)) figures.lastIndexedAt = new Date(row.lastAt);
        }
        figures.textBytes += Number(row.textBytes) || 0;
    });
    (facets.sources || []).forEach((row) => { entry(row._id).sources = row.sources; });

    const sources = await Promise.all(sourceTypesOf([...figuresOf.keys()], [...stateOf.keys()]).map(async (sourceType) => {
        const state = stateOf.get(sourceType) || null;
        const [backfillState, reindexState] = await Promise.all([backfillOf(company, sourceType, state), reindexOf(company, sourceType, state)]);
        return {
            sourceType,
            ...entry(sourceType),
            backfill: backfillState,
            reindex: reindexState,
            freshness: freshnessOf(state, now),
        };
    }));
    return {
        companyId: company,
        modes,
        staleAfterMs: backfill.STALE_AFTER_MS,
        sources,
        totals: sources.reduce((sum, s) => ({ chunks: sum.chunks + s.chunks, sources: sum.sources + s.sources, textBytes: sum.textBytes + s.textBytes }), { chunks: 0, sources: 0, textBytes: 0 }),
        embeddings: await embeddingsOf(company, facets.byModel),
        files: filesOf(facets),
        cachedAt: new Date(now),
    };
};

const forget = (companyId) => { myCache.del(`${CACHE_PREFIX}${String(companyId)}`); };

/* Held for a minute per workspace, since one read walks every chunk; `refresh` reads again. */
const workspaceFigures = async (companyId, { now = Date.now(), refresh = false } = {}) => {
    const company = String(companyId);
    const key = `${CACHE_PREFIX}${company}`;
    const cached = refresh ? undefined : myCache.get(key);
    if (cached) return cached;
    try {
        const figures = await readFigures(company, now);
        myCache.set(key, figures, CACHE_SECONDS);
        return figures;
    } catch (error) {
        if (timedOut(error)) throw Object.assign(new Error(`The figures of ${company} took longer than ${maxTimeMS()} ms.`), { code: TIMED_OUT });
        throw error;
    }
};

module.exports = { TIMED_OUT, summaryRow, workspaceFigures, forget };
