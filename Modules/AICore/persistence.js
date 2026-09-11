const { MongoClient } = require('mongodb');
const { InMemoryStore, MemorySaver } = require('@langchain/langgraph');
const { MongoDBStore, MongoDBSaver } = require('@langchain/langgraph-checkpoint-mongodb');
const logger = require('../../Config/loggerConfig');
const { mongoTimeoutOptions } = require('../Agents/engine/timeouts');

// One LangGraph store and checkpointer per company. The company id is the
// database name everywhere else in the app, so tenancy holds here by
// construction: a store opened for one company cannot read another's rows.

const COLLECTIONS = Object.freeze({
    STORE: 'agent_memory',
    CHECKPOINTS: 'agent_checkpoints',
    CHECKPOINT_WRITES: 'agent_checkpoint_writes',
});

const CHECKPOINT_TTL_SECONDS = 15552000;

const stores = new Map();
const savers = new Map();
const readiness = new Map();
let client = null;
let override = null;

const dbName = (companyId) => {
    const id = String(companyId || '').trim();
    if (!id) throw new Error('companyId is required to open agent persistence');
    return id;
};

/* Under jest a suite that forgot useInMemory() fails at once instead of
 * hanging on a driver connect for thirty seconds per test. */
const mongoClient = () => {
    if (client) return client;
    if (process.env.NODE_ENV === 'test' && !override) throw new Error('agent persistence reached Mongo inside a test; call persistence.useInMemory() first');
    const url = process.env.MONGODB_URL;
    if (!url) throw new Error('No database configured. Set MONGODB_URL.');
    const base = url.replace(/\/+$/, '');
    client = new MongoClient(base.startsWith('mongodb+srv') ? base : `${base}/?authSource=admin`, mongoTimeoutOptions());
    return client;
};

const storeFor = (companyId) => {
    const db = dbName(companyId);
    if (override && override.storeFor) return override.storeFor(db);
    if (!stores.has(db)) {
        stores.set(db, new MongoDBStore({ client: mongoClient(), dbName: db, collectionName: COLLECTIONS.STORE, enableTimestamps: true }));
    }
    return stores.get(db);
};

const saverFor = (companyId) => {
    const db = dbName(companyId);
    if (override && override.saverFor) return override.saverFor(db);
    if (!savers.has(db)) {
        savers.set(db, new MongoDBSaver({
            client: mongoClient(), dbName: db,
            checkpointCollectionName: COLLECTIONS.CHECKPOINTS, checkpointWritesCollectionName: COLLECTIONS.CHECKPOINT_WRITES,
            enableTimestamps: true, ttl: CHECKPOINT_TTL_SECONDS,
        }));
    }
    return savers.get(db);
};

/* Index creation once per company database, cached; never rejects, so a failed
 * index build degrades to unindexed reads instead of blocking agents. */
const ready = (companyId) => {
    const db = dbName(companyId);
    if (override) return Promise.resolve();
    if (!readiness.has(db)) {
        const store = storeFor(db);
        const saver = saverFor(db);
        const build = Promise.all([
            store.start().catch((e) => logger.error(`[agent-persistence] ${db} store indexes: ${e.message}`)),
            saver.setup().then((errors) => (errors || []).forEach((e) => logger.error(`[agent-persistence] ${db} checkpoint indexes: ${e && e.message}`))).catch((e) => logger.error(`[agent-persistence] ${db} checkpoint setup: ${e.message}`)),
        ]).then(() => undefined);
        readiness.set(db, build);
    }
    return readiness.get(db);
};

/* Tests and the fake-DB path swap the Mongo-backed instances for in-memory
 * ones. Each company still gets its own instance, so isolation tests hold. */
const useInMemory = () => {
    const memStores = new Map();
    const memSavers = new Map();
    override = {
        storeFor: (db) => { if (!memStores.has(db)) memStores.set(db, new InMemoryStore()); return memStores.get(db); },
        saverFor: (db) => { if (!memSavers.has(db)) memSavers.set(db, new MemorySaver()); return memSavers.get(db); },
        reset: () => { memStores.clear(); memSavers.clear(); },
    };
    return override;
};

const useMongo = () => { override = null; };

const close = async () => {
    stores.clear();
    savers.clear();
    readiness.clear();
    if (client) { await client.close().catch((e) => logger.error(`[agent-persistence] close: ${e.message}`)); client = null; }
};

module.exports = { COLLECTIONS, CHECKPOINT_TTL_SECONDS, storeFor, saverFor, ready, useInMemory, useMongo, close };
