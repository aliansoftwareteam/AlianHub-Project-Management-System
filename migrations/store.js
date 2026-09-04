/* The runner's record of what ran, kept in global.schema_versions. Every
 * function here is the only place that collection is touched. */
function createMongoStore({ MongoDbCrudOpration, SCHEMA_TYPE, lockId }) {
    const run = (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.SCHEMA_VERSIONS, data }, method);
    const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
    return {
        async all() {
            const rows = await run([{ _id: { $ne: lockId } }], 'find');
            return (rows || []).map(plain);
        },
        async put(doc) {
            await run([{ _id: doc._id }, { $set: doc }, { upsert: true, new: true }], 'findOneAndUpdate');
        },
        /* One process migrates at a time. A stale lock (a crashed run) is taken over
         * once it expires; a live one makes the upsert collide on _id, which is the
         * "someone else has it" answer. */
        async tryLock(owner, ttlMs) {
            const now = new Date();
            try {
                await run([
                    { _id: lockId, $or: [{ expiresAt: { $lt: now } }, { expiresAt: null }, { expiresAt: { $exists: false } }] },
                    { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs) } },
                    { upsert: true, new: true },
                ], 'findOneAndUpdate');
                return true;
            } catch (error) {
                if (error && error.code === 11000) return false;
                throw error;
            }
        },
        async unlock(owner) {
            await run([{ _id: lockId, owner }], 'deleteOne');
        },
    };
}

/* In-memory twin of the Mongo store, for tests and dry runs. */
function createMemoryStore({ lockId = '__lock' } = {}) {
    const docs = new Map();
    return {
        docs,
        async all() { return [...docs.values()].filter((d) => d._id !== lockId).map((d) => ({ ...d })); },
        async put(doc) { docs.set(doc._id, { ...(docs.get(doc._id) || {}), ...doc }); },
        async tryLock(owner, ttlMs) {
            const lock = docs.get(lockId);
            if (lock && lock.expiresAt > new Date()) return false;
            docs.set(lockId, { _id: lockId, owner, expiresAt: new Date(Date.now() + ttlMs) });
            return true;
        },
        async unlock(owner) { if (docs.get(lockId)?.owner === owner) docs.delete(lockId); },
    };
}

module.exports = { createMongoStore, createMemoryStore };
