/* Shared plumbing for anything that turns a raw mutation emit into a described
 * change: the webhook dispatcher and the automation event bus. Both need the same
 * two things, and two implementations of "what changed" would drift.
 *
 * Pure except for the snapshot store, which is deliberately per-consumer state. */

const MONGO_FIELD_OPS = ['$set', '$addToSet', '$pull', '$push', '$pullAll', '$inc', '$unset'];

/* Reduce a raw updatedFields payload to the SET of top-level field names it
 * touched — flattening Mongo operators and stripping dotted suffixes
 * (customField.x → customField). */
const normalizeChangedFields = (updatedFields) => {
    const touched = new Set();
    const add = (k) => { if (k) touched.add(String(k).split('.')[0]); };
    const fields = updatedFields || {};
    Object.keys(fields).forEach((key) => {
        if (MONGO_FIELD_OPS.includes(key) && fields[key] && typeof fields[key] === 'object') {
            Object.keys(fields[key]).forEach(add);
        } else if (!key.startsWith('$')) {
            add(key);
        }
    });
    return touched;
};

/* Bounded FIFO of the last-seen state per entity, so a change can be described as
 * from → to. Each consumer gets its own store: the webhook dispatcher remembers
 * what it last *delivered*, the event bus what it last *observed*, and those are
 * not the same thing — sharing one map would corrupt both diffs. */
const createSnapshotStore = ({ max = 5000 } = {}) => {
    const snapshots = new Map();
    return {
        get: (id) => snapshots.get(String(id)) || null,
        remember(id, data) {
            const key = String(id);
            snapshots.delete(key); // re-insert to move it to the newest position
            snapshots.set(key, data);
            if (snapshots.size > max) {
                snapshots.delete(snapshots.keys().next().value);
            }
        },
        get size() { return snapshots.size; },
    };
};

module.exports = { MONGO_FIELD_OPS, normalizeChangedFields, createSnapshotStore };
