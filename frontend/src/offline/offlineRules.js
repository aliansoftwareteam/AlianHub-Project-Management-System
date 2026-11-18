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

// How often a queued write is retried while the server is away, and the ceiling
// on attempts before a row is left for the user to retry by hand.
const RETRY_EVERY_MS = 8000;
const MAX_AUTO_ATTEMPTS = 50;

const setFieldsOf = (data) => {
    const d = data || {};
    if (d.secondParameter && d.secondParameter.$set && typeof d.secondParameter.$set === 'object') return d.secondParameter.$set;
    if (d.updates && typeof d.updates === 'object') return d.updates;
    if (d.fields && typeof d.fields === 'object') return d.fields;
    return null;
};

// A queued task write, reduced to "which task, which single-value fields". Time
// logs and comments are additive — they never come back from here — so only the
// task update paths can produce a conflict.
const taskWriteOf = (item) => {
    if (!item) return null;
    const m = String(item.type || '').toLowerCase();
    const e = asPath(item.endPoint);
    const d = item.data || {};
    const isTask = (m === 'put' && /\/api\/v1\/task(\?|$)/.test(e)) || (m === 'patch' && /\/api\/v2\/tasks(\?|$)/.test(e));
    if (!isTask) return null;
    const first = d.firstParameter || {};
    const taskId = (first.objId && first.objId._id) || first._id || d.taskId || d._id || '';
    const fields = setFieldsOf(d);
    if (!taskId || !fields || !Object.keys(fields).length) return null;
    return { taskId: String(taskId), fields };
};

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const clipText = (s, n = 60) => { const t = stripHtml(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

const minutesLabel = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return h ? `${h}h ${m}m` : `${m}m`;
};

// The one-line description of a queued write the review sheet shows: a mono
// tag plus what the user actually did, from the request they already made.
const describeQueuedWrite = (item) => {
    const m = String((item && item.type) || '').toLowerCase();
    const e = asPath(item && item.endPoint);
    const d = (item && item.data) || {};
    if (m === 'post' && /\/api\/v1\/comments(\?|$)/.test(e)) {
        const msg = clipText((d.data && d.data.message) || d.message);
        return { tag: 'COMMENT', text: msg ? `"${msg}"` : '', taskId: String((d.data && d.data.objId && d.data.objId.taskId) || '') };
    }
    if (m === 'post' && /\/api\/v2\/manualLogtime/.test(e)) {
        const dur = d.timeDuration;
        const label = typeof dur === 'string' && /^\d{1,2}:\d{2}/.test(dur) ? dur : minutesLabel(dur);
        return { tag: 'TIME', text: [label, d.taskName ? `on ${clipText(d.taskName, 40)}` : ''].filter(Boolean).join(' '), taskId: String(d.ticketId || '') };
    }
    const tw = taskWriteOf(item);
    if (tw) {
        const keys = Object.keys(tw.fields);
        const status = keys.find((k) => /status/i.test(k));
        if (status) {
            const v = tw.fields[status];
            const name = v && typeof v === 'object' ? (v.text || v.name || v.key || '') : String(v == null ? '' : v);
            return { tag: 'STATUS', text: name ? `→ ${clipText(name, 30)}` : '', taskId: tw.taskId };
        }
        return { tag: 'FIELD', text: keys.map((k) => k.replace(/^Task_?/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).join(', '), taskId: tw.taskId };
    }
    return { tag: m.toUpperCase().slice(0, 7) || 'WRITE', text: clipText(e, 40), taskId: '' };
};

// Compare what was queued with what the server holds now. A field where the
// server moved away from what the user last saw AND away from what they set is
// a real clash; a field the server still has at the user's value is already done.
const findConflicts = (write, serverTask, queuedAt) => {
    if (!write || !serverTask) return [];
    const serverAt = new Date(serverTask.updatedAt || 0).getTime();
    if (!serverAt || !queuedAt || serverAt <= queuedAt) return [];
    const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    return Object.keys(write.fields)
        .filter((k) => !same(write.fields[k], serverTask[k]))
        .map((k) => ({ field: k, mine: write.fields[k], theirs: serverTask[k] }));
};

module.exports = {
    RETRY_EVERY_MS,
    MAX_AUTO_ATTEMPTS,
    taskWriteOf,
    describeQueuedWrite,
    findConflicts,
    READ_CACHE_PATTERNS,
    WRITE_QUEUE_RULES,
    isCacheableGet,
    isQueueableWrite,
    cacheKeyFor,
    isOfflineError,
    makeCachedResponse,
    makeQueuedResponse,
};
