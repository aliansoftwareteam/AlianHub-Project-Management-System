const lexical = require('./adapters/lexical');
const flag = require('./flag');
const { indexedSources } = require('./ingest/backfill');
const { INDEXED_SOURCES } = require('./sources');
const events = require('./ingest/events');
const { resolveVisibleSet, filterFor, recheck } = require('./visibleSet');

// One way in to what the workspace knows. The backend behind it is an adapter;
// whichever one answers, the caller's visible set is resolved first and handed
// to it as the filter, and its ranked results are rechecked against the live
// rows before they are returned, so an index that lags a permission change or a
// deletion cannot leak past it.

const ADAPTER_METHODS = ['search', 'upsert', 'tombstone', 'erase', 'stats'];
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const RECHECK_HEADROOM = 2;
const RECHECK_WINDOWS = 4;
const SCORE_FLOOR = 1;
const AGENT_WEIGHT = 0.5;

const assertAdapter = (adapter) => {
    const missing = ADAPTER_METHODS.filter((method) => !adapter || typeof adapter[method] !== 'function');
    if (missing.length) throw new Error(`knowledge adapter ${adapter && adapter.name ? adapter.name : '(unnamed)'} is missing ${missing.join(', ')}`);
    return adapter;
};

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
 * source whose only match is weak stays weak instead of rising to the top of the scale. A
 * machine-written passage is weighed down after scaling: its source's best could be itself. */
const normaliseScores = (candidates) => {
    const best = {};
    candidates.forEach((p) => { best[p.sourceType] = Math.max(best[p.sourceType] || 0, Number(p.score) || 0); });
    return candidates.map((p) => {
        const scaled = (Number(p.score) || 0) / Math.max(best[p.sourceType], SCORE_FLOOR);
        return { ...p, score: p.authorKind === 'agent' ? scaled * AGENT_WEIGHT : scaled };
    });
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

/* Until a company's backfill of a source completes, the chunk store is missing what that source
 * held before the indexer was switched on, so that source's rows are searched as before. */
const chunkSourcesFor = async (set) => {
    const wanted = set.sourceTypes.filter((sourceType) => INDEXED_SOURCES.includes(sourceType));
    if (!wanted.length || !(await flag.indexer.enabledFor(set.companyId))) return [];
    return indexedSources(set.companyId, wanted).catch(() => []);
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
        const candidates = await adapter.search({ companyId: set.companyId, query: String(query), filter: filterFor(set, { chunkSources }), limit: wanted * RECHECK_HEADROOM });
        const ranked = normaliseScores(candidates || []).sort(byRank);
        const onStale = chunkSources.length ? (p) => chunkSources.includes(p.sourceType) && events.requestSync(set.companyId, p.sourceId, p.sourceType) : null;
        const passages = await rechecked({ set, ranked, wanted, onStale });
        return { passages, backend: adapter.name, scope: summary };
    };
};

const retrieve = createRetrieve(lexical);

module.exports = { ADAPTER_METHODS, DEFAULT_LIMIT, assertAdapter, normaliseScores, createRetrieve, retrieve };
