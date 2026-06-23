// SEC-06 — offline mode service. App-level (NO service worker) so it behaves
// identically on localhost, staging, and production and cannot cause the kind
// of asset-caching reload loop the SEC-03 worker did.
//
// Online behaviour is UNCHANGED: the request layer only calls in here on the
// success path (to opportunistically cache a GET) and on the FAILURE path
// (which today already rejects). When a request fails because we're offline:
//   - whitelisted GETs are served from the IndexedDB cache (viewable offline);
//   - whitelisted writes are queued and replayed FIFO on reconnect.

import { ref } from 'vue';
import * as rules from './offlineRules';
import * as db from './db';

export const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
export const pendingCount = ref(0);
export const syncing = ref(false);
export const lastSyncAt = ref(0);

// The request fn (apiRequest) is injected by the service layer to avoid an
// import cycle (services → offline, never the reverse).
let replayer = null;
let started = false;

export const registerReplayer = (fn) => { replayer = fn; };

const refreshPending = async () => {
    try { pendingCount.value = await db.queueCount(); } catch (e) { /* noop */ }
};

// Cache a successful GET (fire-and-forget). NEVER throws and NEVER alters the
// caller's response. Also opportunistically drains the queue, because a success
// proves connectivity is back even if no `online` event fired (server was down).
export const maybeCacheResponse = (type, endPoint, resData) => {
    try {
        if (rules.isCacheableGet(type, endPoint) && resData && resData.data !== undefined) {
            db.cachePut(rules.cacheKeyFor(endPoint), resData.data);
        }
        if (pendingCount.value > 0 && !syncing.value) flushQueue();
    } catch (e) { /* offline cache is best-effort */ }
};

// Called ONLY on the request-failure path. Returns a synthetic response to
// resolve with, or null to let the caller reject exactly as it does today.
export const handleOfflineFailure = async (type, endPoint, data, dataType, err) => {
    try {
        if (!rules.isOfflineError(err)) return null;
        if (typeof navigator !== 'undefined') isOnline.value = navigator.onLine !== false ? isOnline.value : false;
        if (rules.isCacheableGet(type, endPoint)) {
            const cached = await db.cacheGet(rules.cacheKeyFor(endPoint));
            return cached !== undefined ? rules.makeCachedResponse(cached) : null;
        }
        if (rules.isQueueableWrite(type, endPoint)) {
            await db.queueAdd({ type, endPoint, data, dataType });
            await refreshPending();
            return rules.makeQueuedResponse({ endPoint });
        }
        return null;
    } catch (e) {
        return null; // never make a failure worse
    }
};

// Replay queued writes FIFO. Guarded by `syncing` so it can't re-enter (replayed
// writes resolve through the same request layer).
export const flushQueue = async () => {
    if (syncing.value || !replayer) return;
    syncing.value = true;
    try {
        const items = await db.queueAll();
        for (const item of items) {
            try {
                await replayer(item.type, item.endPoint, item.data, item.dataType);
                await db.queueDelete(item.id);            // delivered → drop
            } catch (e) {
                if (e && e.response) {
                    await db.queueDelete(item.id);        // server rejected (4xx/5xx) → won't succeed on retry; drop
                } else {
                    break;                                // still offline → keep the rest for next reconnect
                }
            }
        }
        lastSyncAt.value = Date.now();
    } catch (e) { /* noop */ } finally {
        await refreshPending();
        syncing.value = false;
    }
};

export const initOffline = () => {
    if (started || typeof window === 'undefined') return;
    started = true;
    window.addEventListener('online', () => { isOnline.value = true; flushQueue(); });
    window.addEventListener('offline', () => { isOnline.value = false; });
    refreshPending();
    if (isOnline.value) flushQueue(); // drain anything left over from a previous session
};

// Clear all offline data — call on logout so cached data / queued writes never
// bleed across accounts on a shared browser.
export const clearOffline = async () => {
    try { await db.clearAll(); pendingCount.value = 0; } catch (e) { /* noop */ }
};
