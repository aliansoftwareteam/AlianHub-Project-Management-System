// SEC-06 — minimal IndexedDB wrapper for the offline read-cache + write-queue.
// Dependency-free and FAIL-SOFT: every call resolves to a safe empty/no-op
// value on any error or where IndexedDB is unavailable, so a storage problem
// can never break the app.

const DB_NAME = 'alianhub-offline';
const DB_VERSION = 1;
const STORE_CACHE = 'cache';
const STORE_QUEUE = 'queue';

let dbPromise = null;

const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') { resolve(null); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
    });
    return dbPromise;
};

const reqToPromise = (request) => new Promise((resolve) => {
    try {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
    } catch (e) { resolve(undefined); }
});

export const cachePut = async (key, data) => {
    const db = await open(); if (!db) return;
    try {
        const t = db.transaction(STORE_CACHE, 'readwrite');
        t.objectStore(STORE_CACHE).put({ key, data, at: Date.now() });
    } catch (e) { /* best-effort */ }
};

export const cacheGet = async (key) => {
    const db = await open(); if (!db) return undefined;
    try {
        const rec = await reqToPromise(db.transaction(STORE_CACHE, 'readonly').objectStore(STORE_CACHE).get(key));
        return rec ? rec.data : undefined;
    } catch (e) { return undefined; }
};

export const queueAdd = async (item) => {
    const db = await open(); if (!db) return;
    try {
        const t = db.transaction(STORE_QUEUE, 'readwrite');
        t.objectStore(STORE_QUEUE).add({ ...item, at: Date.now() });
    } catch (e) { /* best-effort */ }
};

export const queueAll = async () => {
    const db = await open(); if (!db) return [];
    try {
        const all = await reqToPromise(db.transaction(STORE_QUEUE, 'readonly').objectStore(STORE_QUEUE).getAll());
        return Array.isArray(all) ? all : [];
    } catch (e) { return []; }
};

export const queueDelete = async (id) => {
    const db = await open(); if (!db) return;
    try {
        const t = db.transaction(STORE_QUEUE, 'readwrite');
        t.objectStore(STORE_QUEUE).delete(id);
    } catch (e) { /* best-effort */ }
};

export const queueCount = async () => (await queueAll()).length;

export const clearAll = async () => {
    const db = await open(); if (!db) return;
    try {
        const t = db.transaction([STORE_CACHE, STORE_QUEUE], 'readwrite');
        t.objectStore(STORE_CACHE).clear();
        t.objectStore(STORE_QUEUE).clear();
    } catch (e) { /* best-effort */ }
};
