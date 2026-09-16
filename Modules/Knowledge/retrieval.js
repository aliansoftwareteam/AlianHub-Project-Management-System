const lexical = require('./adapters/lexical');
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

        const candidates = await adapter.search({ companyId: set.companyId, query: String(query), filter: filterFor(set), limit: wanted * RECHECK_HEADROOM });
        const ranked = [...(candidates || [])].sort(byRank).slice(0, wanted * RECHECK_HEADROOM);
        const passages = (await recheck({ set, passages: ranked })).slice(0, wanted);
        return { passages, backend: adapter.name, scope: summary };
    };
};

const retrieve = createRetrieve(lexical);

module.exports = { ADAPTER_METHODS, DEFAULT_LIMIT, assertAdapter, createRetrieve, retrieve };
