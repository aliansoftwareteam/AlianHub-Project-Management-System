// Offline mode service. App-level (no service worker) so it behaves the same on
// localhost, staging and production.
//
// Online behaviour is unchanged: the request layer calls in here on the success
// path (to cache a GET) and on the failure path. When a request fails because
// the server is away, whitelisted GETs are served from IndexedDB and whitelisted
// writes are queued there and replayed in order, every RETRY_EVERY_MS, with the
// attempt count kept on the row so it survives a reload.

import { ref, computed } from 'vue';
import * as rules from './offlineRules';
import * as db from './db';

export const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
// The browser says online but the server is not answering.
export const unreachable = ref(false);
export const pendingCount = ref(0);
export const syncing = ref(false);
export const lastSyncAt = ref(0);
export const attempt = ref(0);
export const retryIn = ref(0);
export const queue = ref([]);
export const conflicts = ref([]);
export const away = computed(() => !isOnline.value || unreachable.value);

let replayer = null;
let started = false;
let ticker = null;

export const registerReplayer = (fn) => { replayer = fn; };

const describe = (item) => ({ ...item, ...rules.describeQueuedWrite(item), attempts: item.attempts || 0 });

const refreshQueue = async () => {
    try {
        const items = await db.queueAll();
        queue.value = items.map(describe);
        pendingCount.value = items.filter((i) => !i.held).length;
    } catch (e) { /* noop */ }
};

export const maybeCacheResponse = (type, endPoint, resData) => {
    try {
        if (rules.isCacheableGet(type, endPoint) && resData && resData.data !== undefined) {
            db.cachePut(rules.cacheKeyFor(endPoint), resData.data);
        }
        if (unreachable.value) { unreachable.value = false; attempt.value = 0; }
        if (pendingCount.value > 0 && !syncing.value) flushQueue();
    } catch (e) { /* offline cache is best-effort */ }
};

export const handleOfflineFailure = async (type, endPoint, data, dataType, err) => {
    try {
        if (!rules.isOfflineError(err)) return null;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) isOnline.value = false;
        else unreachable.value = true;
        startTicker();
        if (rules.isCacheableGet(type, endPoint)) {
            const cached = await db.cacheGet(rules.cacheKeyFor(endPoint));
            return cached !== undefined ? rules.makeCachedResponse(cached) : null;
        }
        if (rules.isQueueableWrite(type, endPoint)) {
            await db.queueAdd({ type, endPoint, data, dataType, attempts: 0 });
            await refreshQueue();
            return rules.makeQueuedResponse({ endPoint });
        }
        return null;
    } catch (e) {
        return null;
    }
};

// A task write is checked against the server copy before it is replayed. The
// row is held, not dropped, until the user decides.
const checkConflict = async (item) => {
    const write = rules.taskWriteOf(item);
    if (!write || !replayer) return false;
    const res = await replayer('get', `/api/v1/task/${write.taskId}`);
    let server = res && res.data && (res.data.data || res.data);
    if (Array.isArray(server)) server = server[0];
    const clashes = rules.findConflicts(write, server, item.at);
    if (!clashes.length) return false;
    await db.queueUpdate(item.id, { held: true });
    const existing = conflicts.value.find((c) => c.id === item.id);
    if (!existing) {
        conflicts.value = [...conflicts.value, {
            id: item.id,
            taskId: write.taskId,
            taskKey: (server && (server.TaskKey || server.TaskName)) || '',
            projectId: server && server.ProjectID ? String(server.ProjectID) : '',
            sprintId: server && server.sprintId ? String(server.sprintId) : '',
            folderId: server && server.folderObjId ? String(server.folderObjId) : '',
            fields: clashes,
            mineAt: item.at,
            theirsAt: server && server.updatedAt,
            theirsBy: (server && (server.updatedBy || server.lastUpdatedBy)) || '',
        }];
    }
    return true;
};

export const flushQueue = async () => {
    if (syncing.value || !replayer) return;
    syncing.value = true;
    let delivered = 0;
    let stalled = false;
    try {
        const items = await db.queueAll();
        for (const item of items) {
            if (item.held) continue;
            try {
                if (await checkConflict(item)) continue;
                await replayer(item.type, item.endPoint, item.data, item.dataType);
                await db.queueDelete(item.id);
                delivered++;
            } catch (e) {
                if (e && e.response) {
                    await db.queueDelete(item.id);
                } else {
                    await db.queueUpdate(item.id, { attempts: (item.attempts || 0) + 1, lastTriedAt: Date.now() });
                    stalled = true;
                    break;
                }
            }
        }
        if (stalled) {
            attempt.value += 1;
            unreachable.value = isOnline.value;
        } else {
            attempt.value = 0;
            unreachable.value = false;
            lastSyncAt.value = Date.now();
        }
        if (delivered) lastSyncAt.value = Date.now();
    } catch (e) { /* noop */ } finally {
        await refreshQueue();
        syncing.value = false;
        if (!queue.value.some((i) => !i.held) && !away.value) stopTicker();
    }
};

export const retryNow = () => {
    retryIn.value = rules.RETRY_EVERY_MS / 1000;
    if (typeof navigator !== 'undefined' && navigator.onLine !== false) isOnline.value = true;
    return flushQueue();
};

export const resolveConflict = async (id, choice) => {
    const c = conflicts.value.find((x) => x.id === id);
    if (!c) return null;
    if (choice === 'theirs') {
        await db.queueDelete(id);
    } else if (choice === 'mine') {
        const items = await db.queueAll();
        const item = items.find((x) => x.id === id);
        if (item && replayer) {
            try {
                await replayer(item.type, item.endPoint, item.data, item.dataType);
                await db.queueDelete(id);
            } catch (e) {
                await db.queueUpdate(id, { held: false });
            }
        }
    } else {
        return c;
    }
    conflicts.value = conflicts.value.filter((x) => x.id !== id);
    await refreshQueue();
    return c;
};

const tick = () => {
    if (!away.value && !queue.value.some((i) => !i.held)) { stopTicker(); return; }
    if (retryIn.value <= 1) {
        retryIn.value = rules.RETRY_EVERY_MS / 1000;
        if (attempt.value < rules.MAX_AUTO_ATTEMPTS) flushQueue();
        return;
    }
    retryIn.value -= 1;
};

const startTicker = () => {
    if (ticker || typeof window === 'undefined') return;
    retryIn.value = rules.RETRY_EVERY_MS / 1000;
    ticker = window.setInterval(tick, 1000);
};
const stopTicker = () => {
    if (!ticker) return;
    window.clearInterval(ticker);
    ticker = null;
    retryIn.value = 0;
};

export const initOffline = () => {
    if (started || typeof window === 'undefined') return;
    started = true;
    window.addEventListener('online', () => { isOnline.value = true; retryNow(); });
    window.addEventListener('offline', () => { isOnline.value = false; startTicker(); });
    refreshQueue().then(() => {
        if (queue.value.length) startTicker();
        if (isOnline.value) flushQueue();
    });
};

// Called on logout so cached data and queued writes never bleed across accounts.
export const clearOffline = async () => {
    try {
        await db.clearAll();
        pendingCount.value = 0;
        queue.value = [];
        conflicts.value = [];
        stopTicker();
    } catch (e) { /* noop */ }
};
