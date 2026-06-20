// SEC-06 — pure offline-mode rules (no window / navigator / IndexedDB / Vue).
// Decides which GETs are cached for offline reads and which writes are safe to
// queue + replay on reconnect. CommonJS so it is shared verbatim by the webpack
// frontend AND the Node test suite (tests/offline-rules.test.js).

// GET endpoints whose responses we cache for offline viewing. Kept to the
// high-value read surfaces (projects + tasks); everything else is untouched.
const READ_CACHE_PATTERNS = [
    /\/api\/v1\/project(\?|$)/,                  // project list
    /\/api\/v1\/project\/[a-f0-9]{24}(\?|$)/i,   // a single project
    /\/api\/v1\/projectdata\/taskData/,          // per-project task data
    /\/api\/v2\/tasks(\?|$)/,                     // task list
    /\/api\/v1\/task\/[a-f0-9]{24}(\?|$)/i,      // a single task
];

// Writes we queue when offline and replay (FIFO) on reconnect. Replay simply
// re-issues the exact request the user already made, so it is semantically the
// same as if they had been online. Limited to the common "editing offline" ops.
const WRITE_QUEUE_RULES = [
    { method: 'put', pattern: /\/api\/v1\/task(\?|$)/ },      // task update
    { method: 'patch', pattern: /\/api\/v2\/tasks(\?|$)/ },   // task field actions
    { method: 'post', pattern: /\/api\/v1\/comments(\?|$)/ }, // add comment
    { method: 'post', pattern: /\/api\/v2\/manualLogtime/ },  // log time
];

const asPath = (endPoint) => String(endPoint || '');

const isCacheableGet = (type, endPoint) => {
    if (String(type).toLowerCase() !== 'get') return false;
    const e = asPath(endPoint);
    return READ_CACHE_PATTERNS.some((re) => re.test(e));
};

const isQueueableWrite = (type, endPoint) => {
    const m = String(type).toLowerCase();
    const e = asPath(endPoint);
    return WRITE_QUEUE_RULES.some((r) => r.method === m && r.pattern.test(e));
};

// Cache key = the endpoint (path + query). The offline store is cleared on
// logout, so it never bleeds across accounts/tenants on a shared browser.
const cacheKeyFor = (endPoint) => asPath(endPoint);

// A request that failed WITHOUT any server response → offline / unreachable
// (network down, server down, or a timeout). Canceled requests are excluded so
// abort()ed calls never get cached/queued.
const isOfflineError = (err) => !!err && !err.response && err.code !== 'ERR_CANCELED';

// axios-shaped responses so callers reading `.data` keep working when we serve
// cache or accept a queued write.
const makeCachedResponse = (data) => ({ data, status: 200, statusText: 'OK (offline cache)', _offline: 'cache' });
const makeQueuedResponse = (extra = {}) => ({
    data: { status: true, queuedOffline: true, statusText: 'Saved offline — will sync when you reconnect.', ...extra },
    status: 202,
    statusText: 'Accepted (queued offline)',
    _offline: 'queued',
});

module.exports = {
    READ_CACHE_PATTERNS,
    WRITE_QUEUE_RULES,
    isCacheableGet,
    isQueueableWrite,
    cacheKeyFor,
    isOfflineError,
    makeCachedResponse,
    makeQueuedResponse,
};
