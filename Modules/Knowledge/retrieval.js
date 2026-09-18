const logger = require('../../Config/loggerConfig');
const lexical = require('./adapters/lexical');
const { ADAPTER_METHODS, assertAdapter } = require('./adapters/contract');
const flag = require('./flag');
const embeddings = require('./embeddings');
const vectorStore = require('./vectorStore');
const backfill = require('./ingest/backfill');
const { INDEXED_SOURCES } = require('./sources');
const events = require('./ingest/events');
const { resolveVisibleSet, filterFor, recheck } = require('./visibleSet');

// One way in to what the workspace knows. The backend behind it is an adapter;
// whichever one answers, the caller's visible set is resolved first and handed
// to it as the filter, and its ranked results are rechecked against the live
// rows before they are returned, so an index that lags a permission change or a
// deletion cannot leak past it. A company in hybrid mode is also searched by
// vector under the same filter, and the two sides are fused by rank.

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const RECHECK_HEADROOM = 2;
const RECHECK_WINDOWS = 4;
const SCORE_FLOOR = 1;
const AGENT_WEIGHT = 0.5;
const RRF_K = 60;

const clampLimit = (limit) => {
    const n = Math.floor(Number(limit));
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
};

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

/* Machine-written passages rank below human-written ones at equal score, so the
 * corpus cannot amplify its own inferences. */
const byRank = (a, b) => (b.score - a.score)
    || ((a.authorKind === 'agent') - (b.authorKind === 'agent'))
    || (time(b.updatedAt) - time(a.updatedAt));

/* A full-text score grows with how often the words occur and has no ceiling, while the
 * regular-expression fallback scores at most 1, so raw scores cannot be compared across
 * sources. Each source is scaled by its own best score, but never by less than a floor, so a
 * source whose only match is weak stays weak instead of rising to the top of the scale. */
const scaleScores = (candidates) => {
    const best = {};
    candidates.forEach((p) => { best[p.sourceType] = Math.max(best[p.sourceType] || 0, Number(p.score) || 0); });
    return candidates.map((p) => ({ ...p, score: (Number(p.score) || 0) / Math.max(best[p.sourceType], SCORE_FLOOR) }));
};

/* A machine-written passage is weighed down after scaling: its source's best could be itself. */
const weighAgents = (candidates) => candidates.map((p) => (p.authorKind === 'agent' ? { ...p, score: p.score * AGENT_WEIGHT } : p));

const normaliseScores = (candidates) => weighAgents(scaleScores(candidates));

/* Reciprocal rank fusion: each list adds 1/(k + rank) for a passage it holds, so a passage both
 * sides found rises above one only one side found, and neither side's scores need to be on the
 * other's scale. The passage kept is the one from the list that ranked it higher, so a lexical
 * excerpt, cut around the words asked for, wins a tie. */
const fuseByRank = (lists) => {
    const fused = new Map();
    lists.forEach((list) => (list || []).forEach((p, at) => {
        const rank = at + 1;
        const seen = fused.get(p.id);
        if (!seen) {
            fused.set(p.id, { passage: p, score: 1 / (RRF_K + rank), bestRank: rank });
            return;
        }
        seen.score += 1 / (RRF_K + rank);
        if (rank < seen.bestRank) {
            seen.passage = p;
            seen.bestRank = rank;
        }
    }));
    return [...fused.values()].sort((a, b) => b.score - a.score).map(({ passage, score }) => ({ ...passage, score }));
};

/* Rechecked a window at a time, so a list whose top candidates were deleted still fills, while
 * the usual case costs one window of reads. */
const rechecked = async ({ set, ranked, wanted, onStale }) => {
    const size = wanted * RECHECK_HEADROOM;
    const kept = [];
    for (let start = 0, round = 0; start < ranked.length && kept.length < wanted && round < RECHECK_WINDOWS; start += size, round += 1) {
        kept.push(...await recheck({ set, passages: ranked.slice(start, start + size), onStale }));
    }
    return kept.slice(0, wanted);
};

/* Until a company's backfill of a source completes, or while its heartbeat says events may have been
 * missed and its catch-up has not finished, the chunk store may lack what that source holds, so
 * that source's rows are searched as before. */
const chunkSourcesFor = async (set) => {
    const wanted = set.sourceTypes.filter((sourceType) => INDEXED_SOURCES.includes(sourceType));
    if (!wanted.length || !(await flag.indexer.enabledFor(set.companyId))) return [];
    const states = await backfill.readStates(set.companyId, wanted).catch(() => null);
    if (!states) return [];
    events.keepAlive(set.companyId, states);
    return backfill.indexedOf(states, wanted);
};

/* The question is embedded once, booked to the asker, and only for a company in hybrid mode.
 * Whatever fails on this side, the lexical side still answers. */
const vectorSide = async (set, query, filter, limit) => {
    if (!(await flag.hybridFor(set.companyId)) || !embeddings.configured()) return null;
    let question;
    try {
        question = await embeddings.embedQuery(set.companyId, query, { userId: set.caller.userId });
    } catch (error) {
        logger.warn(`knowledge retrieval: the question was not embedded for ${set.companyId}; answering from the lexical side: ${error.message}`);
        return null;
    }
    const store = vectorStore.current();
    try {
        const passages = await store.search({ companyId: set.companyId, queryEmbedding: question.vector, model: question.model, filter, limit });
        return { backend: store.name, passages: [...(passages || [])].sort(byRank) };
    } catch (error) {
        logger.error(`knowledge retrieval: vector search failed for ${set.companyId}; answering from the lexical side: ${error.message}`);
        return null;
    }
};

const createRetrieve = (adapter) => {
    assertAdapter(adapter);
    return async ({ companyId, caller, query, scope, limit } = {}) => {
        const set = await resolveVisibleSet({ companyId, caller, scope });
        const wanted = clampLimit(limit);
        const summary = {
            projectId: set.projectId,
            projects: set.projectIds.length,
            sourceTypes: set.sourceTypes,
            privileged: set.privileged,
        };
        if (!set.sourceTypes.length || !String(query || '').trim()) return { passages: [], backend: adapter.name, scope: summary };

        const chunkSources = await chunkSourcesFor(set);
        const filter = filterFor(set, { chunkSources });
        const headroom = wanted * RECHECK_HEADROOM;
        const [found, vector] = await Promise.all([
            adapter.search({ companyId: set.companyId, query: String(query), filter, limit: headroom }),
            chunkSources.length ? vectorSide(set, String(query), filter, headroom) : null,
        ]);
        const lexicalRanked = scaleScores(found || []).sort(byRank);
        const ranked = vector
            ? normaliseScores(fuseByRank([lexicalRanked, vector.passages])).sort(byRank)
            : weighAgents(lexicalRanked).sort(byRank);
        const onStale = chunkSources.length ? (p) => chunkSources.includes(p.sourceType) && events.requestSync(set.companyId, p.sourceId, p.sourceType) : null;
        const passages = await rechecked({ set, ranked, wanted, onStale });
        return { passages, backend: vector ? `${adapter.name}+${vector.backend}` : adapter.name, scope: summary };
    };
};

const retrieve = createRetrieve(lexical);

module.exports = { ADAPTER_METHODS, DEFAULT_LIMIT, RRF_K, assertAdapter, normaliseScores, fuseByRank, createRetrieve, retrieve };
