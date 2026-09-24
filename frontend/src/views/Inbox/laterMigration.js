// "Later" used to live in this browser only, with no return time. It now lives on the
// server; the old per-device list is handed over once and then dropped.
const SOURCES = ['notification', 'mention'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const laterStorageKey = (companyId, userId) => `alianhub.inbox.later.${companyId || ''}.${userId || ''}`;

const readRaw = (storage, key) => {
    try { return storage.getItem(key); } catch (e) { return null; }
};

export const readLegacyLater = (storage, key) => {
    const raw = readRaw(storage, key);
    if (!raw) return [];
    let saved;
    try { saved = JSON.parse(raw); } catch (e) { return []; }
    if (!saved || typeof saved !== 'object') return [];
    return Object.keys(saved)
        .map((k) => {
            const [sourceType, sourceId] = k.split(':');
            return { sourceType, sourceId };
        })
        .filter((i) => SOURCES.includes(i.sourceType) && OBJECT_ID.test(i.sourceId || ''));
};

/** Snoozes the old entries through `snooze(items)`; the key goes only once that succeeded. */
export const migrateLegacyLater = async ({ storage, key, snooze }) => {
    if (readRaw(storage, key) === null) return 0;
    const items = readLegacyLater(storage, key);
    const drop = () => { try { storage.removeItem(key); } catch (e) { /* the browser refused storage; nothing is left to drop */ } };
    if (!items.length) {
        drop();
        return 0;
    }
    if (!(await snooze(items))) return 0;
    drop();
    return items.length;
};
