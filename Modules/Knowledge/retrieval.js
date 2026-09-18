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
// vector under the same filter, and the two sides are fused.

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const RECHECK_HEADROOM = 2;
const RECHECK_WINDOWS = 4;
const SCORE_FLOOR = 1;
const AGENT_WEIGHT = 0.5;
const LEXICAL_WEIGHT = 0.5;
const VECTOR_WEIGHT = 0.5;
const RRF_K = 60;
const TIE = 1e-6;

const clampLimit = (limit) => {
    const n = Math.floor(Number(limit));
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
};

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

/* Machine-written passages rank below human-written ones at equal score, so the
 * corpus cannot amplify its own inferences. */
const agentLast = (a, b) => (a.authorKind === 'agent') - (b.authorKind === 'agent');

const byRank = (a, b) => (b.score - a.score) || agentLast(a, b) || (time(b.updatedAt) - time(a.updatedAt));

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

/* The two sides on one scale: the lexical side scaled against its floor, the vector side by
 * cosine, each at most 1, added with their weights. So a lone weak lexical hit keeps its weak
 * score beside a strong vector hit, and a passage both sides found gets both. Reciprocal rank
 * over both lists breaks an equal sum. The passage kept is the one from the list that ranked
 * it higher, so a lexical excerpt, cut around the words asked for, wins a tie. */
const fuse = (lists, weights = [LEXICAL_WEIGHT, VECTOR_WEIGHT]) => {
    const fused = new Map();
    lists.forEach((list, side) => (list || []).forEach((p, at) => {
        const rank = at + 1;
        const entry = fused.get(p.id) || { passage: p, score: 0, rrf: 0, bestRank: Infinity };
        entry.score += (weights[side] || 0) * (Number(p.score) || 0);
        entry.rrf += 1 / (RRF_K + rank);
        if (rank < entry.bestRank) {
            entry.passage = p;
            entry.bestRank = rank;
        }
        fused.set(p.id, entry);
    }));
    return [...fused.values()].sort((a, b) => (b.score - a.score) || (b.rrf - a.rrf)).map(({ passage, score, rrf }) => ({ ...passage, score, rrf }));
};

/* The agent rule on fused scores is a rank rule, not a weight: an agent passage loses a tie
 * (within float noise) to a human passage and wins a clear margin, so a draft is neither halved
 * out of every answer nor able to edge a person out by rounding. */
const byFusedRank = (a, b) => {
    if (Math.abs(a.score - b.score) > TIE) return b.score - a.score;
    return agentLast(a, b) || ((b.rrf || 0) - (a.rrf || 0)) || (time(b.updatedAt) - time(a.updatedAt));
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

const fallbackReason = (error) => {
    if (embeddings.isBudgetRefusal(error)) return 'budget exhausted';
    if (error && error.code === embeddings.EMBED_TIMED_OUT) return 'embed timed out';
    return 'embed failed';
};

/* The question is embedded once, booked to the asker, and only for a company in hybrid mode.
 * Whatever fails on this side, the lexical side still answers, and the reason travels back
 * on the backend name. A vector side that fails for any one source is dropped whole, so an
 * answer never quietly comes from the sources that happened to work. */
const vectorSide = async (set, query, filter, limit) => {
    if (!(await flag.hybridFor(set.companyId))) return null;
    const readiness = embeddings.readiness(set.companyId);
    if (readiness === 'unconfigured') return null;
    if (readiness === 'paused') return { fallback: 'embedding paused' };
    let question;
    try {
        question = await embeddings.embedQuery(set.companyId, query, { userId: set.caller.userId });
    } catch (error) {
        const reason = fallbackReason(error);
        logger.warn(`knowledge retrieval: ${reason} for ${set.companyId}; answering from the lexical side: ${error.message}`);
        return { fallback: reason };
    }
    const store = vectorStore.current();
    try {
        const passages = await store.search({ companyId: set.companyId, queryEmbedding: question.vector, model: question.model, filter, limit });
        return { backend: store.name, passages: [...(passages || [])].sort(byRank) };
    } catch (error) {
        logger.error(`knowledge retrieval: vector search failed for ${set.companyId}; answering from the lexical side: ${error.message}`);
        return { fallback: 'vector failed' };
    }
};

const backendName = (adapter, vector) => {
    if (vector && vector.passages) return `${adapter.name}+${vector.backend}`;
    if (vector && vector.fallback) return `${adapter.name} (${vector.fallback})`;
    return adapter.name;
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
        const ranked = vector && vector.passages
            ? fuse([lexicalRanked, vector.passages]).sort(byFusedRank)
            : weighAgents(lexicalRanked).sort(byRank);
        const onStale = chunkSources.length ? (p) => chunkSources.includes(p.sourceType) && events.requestSync(set.companyId, p.sourceId, p.sourceType) : null;
        const passages = await rechecked({ set, ranked, wanted, onStale });
        return { passages, backend: backendName(adapter, vector), scope: summary };
    };
};

const retrieve = createRetrieve(lexical);

module.exports = { ADAPTER_METHODS, DEFAULT_LIMIT, RRF_K, LEXICAL_WEIGHT, VECTOR_WEIGHT, assertAdapter, normaliseScores, fuse, createRetrieve, retrieve };
