/* Bytes and objects each workspace keeps in storage, so a limit can be checked (064) and reported (062)
 * without listing the bucket. Every put and delete in common-storage/s3Store.js and the server driver
 * adds its delta here; the nightly reconciliation (storageReconcile.js) sets the true figure.
 *   storageUsage(companyId)  -> { companyId, bytes, objects, updatedAt, reconciledAt, drift }
 *   instanceStorageUsage()   -> { bytes, objects, byWorkspace: [...], public: {...} }
 *   add(owner, bytes, objects) */

const PUBLIC_USAGE_ID = 'public';

function mongoStore() {
    const run = (data, method) => {
        const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
        const { SCHEMA_TYPE } = require('../Config/schemaType');
        return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.STORAGE_USAGE, data }, method);
    };
    return {
        inc: (id, bytes, objects, at) => run([{ _id: id }, { $inc: { bytes, objects }, $set: { updatedAt: at } }, { upsert: true }], 'updateOne'),
        get: (id) => run([{ _id: id }], 'findOne'),
        all: () => run([{}], 'find'),
        set: (id, fields) => run([{ _id: id }, { $set: fields }, { upsert: true }], 'updateOne'),
        remove: (id) => run([{ _id: id }], 'deleteOne'),
    };
}

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const shapeOf = (id, row) => {
    const doc = plain(row) || {};
    return {
        companyId: id,
        bytes: Math.max(0, count(doc.bytes)),
        objects: Math.max(0, count(doc.objects)),
        updatedAt: doc.updatedAt || null,
        reconciledAt: doc.reconciledAt || null,
        drift: doc.drift === undefined || doc.drift === null ? null : Number(doc.drift),
        ...(doc.removalPending ? { removalPending: true } : {}),
    };
};

const driftOf = (counted, actual) => (actual > 0 ? Math.abs(counted - actual) / actual : (counted > 0 ? 1 : 0));

function usageOf(store = mongoStore(), { now = () => new Date(), logger = null } = {}) {
    const log = () => logger || require('../Config/loggerConfig');

    /* Never rejects and never delays the caller: a missed delta is corrected the next night. */
    const add = (owner, bytes, objects = Math.sign(Number(bytes) || 0)) => {
        const id = String(owner || '');
        const deltaBytes = Math.round(count(bytes));
        const deltaObjects = Math.round(count(objects));
        if (!id || (!deltaBytes && !deltaObjects)) return Promise.resolve(false);
        return Promise.resolve()
            .then(() => store.inc(id, deltaBytes, deltaObjects, now()))
            .then(() => true)
            .catch((error) => {
                log().error(`[storage-usage] ${id}: could not add ${deltaBytes} bytes: ${error && error.message ? error.message : error}`);
                return false;
            });
    };

    const storageUsage = async (companyId) => shapeOf(String(companyId), await store.get(String(companyId)));

    const instanceStorageUsage = async () => {
        const rows = ((await store.all()) || []).map(plain).filter(Boolean);
        const shaped = rows.map((row) => shapeOf(String(row._id), row));
        const workspaces = shaped.filter((row) => row.companyId !== PUBLIC_USAGE_ID);
        const shared = shaped.find((row) => row.companyId === PUBLIC_USAGE_ID) || shapeOf(PUBLIC_USAGE_ID, null);
        return {
            bytes: shaped.reduce((sum, row) => sum + row.bytes, 0),
            objects: shaped.reduce((sum, row) => sum + row.objects, 0),
            byWorkspace: workspaces.map(({ companyId, bytes, objects, reconciledAt, removalPending }) => ({ companyId, bytes, objects, reconciledAt, ...(removalPending ? { removalPending } : {}) })),
            public: { bytes: shared.bytes, objects: shared.objects },
        };
    };

    /* Sets the counted figure to what a full listing found; returns the drift that was corrected. */
    const correct = async (owner, { bytes, objects }) => {
        const id = String(owner);
        const before = shapeOf(id, await store.get(id));
        const drift = driftOf(before.bytes, count(bytes));
        const at = now();
        await store.set(id, { bytes: count(bytes), objects: count(objects), reconciledAt: at, updatedAt: at, drift });
        return { before, drift };
    };

    const markForRemoval = (owner) => store.set(String(owner), { removalPending: true, updatedAt: now() });
    const pendingRemovals = async () => ((await store.all()) || []).map(plain).filter((row) => row && row.removalPending).map((row) => String(row._id));
    const forget = (owner) => store.remove(String(owner));

    return { add, storageUsage, instanceStorageUsage, correct, markForRemoval, pendingRemovals, forget };
}

const usage = usageOf();

module.exports = { ...usage, usageOf, mongoStore, driftOf, PUBLIC_USAGE_ID };
