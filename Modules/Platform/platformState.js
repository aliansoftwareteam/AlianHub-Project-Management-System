const STATE_IDS = Object.freeze({ PROVISION: 'provision', ENTITLEMENTS: 'entitlements', LIFECYCLE: 'lifecycle', KEYS: 'keys', SUPPORT: 'support', MAIL: 'mail' });

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc) || null;

function mongoStore() {
    const run = (data, method) => {
        const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
        const { SCHEMA_TYPE } = require('../../Config/schemaType');
        return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.PLATFORM_STATE, data }, method);
    };
    return {
        read: async (id) => plain(await run([{ _id: id }], 'findOne')),
        write: async (id, fields) => plain(await run([{ _id: id }, { $set: { ...fields, updatedAt: new Date() } }, { upsert: true, returnDocument: 'after' }], 'findOneAndUpdate')),
        unset: (id, fields) => run([{ _id: id }, { $unset: Object.fromEntries(fields.map((field) => [field, 1])) }], 'updateOne'),
    };
}

let store = mongoStore();

const readState = (id) => store.read(id);
const writeState = (id, fields) => store.write(id, fields);
const unsetState = (id, fields) => store.unset(id, fields);

/* In-memory map store with the same three calls, for tests and scripts that run without a database. */
function memoryStore(seed = {}) {
    const docs = new Map(Object.entries(seed).map(([id, doc]) => [id, { _id: id, ...doc }]));
    return {
        docs,
        read: async (id) => (docs.has(id) ? JSON.parse(JSON.stringify(docs.get(id))) : null),
        write: async (id, fields) => {
            docs.set(id, { ...(docs.get(id) || { _id: id }), ...fields, updatedAt: new Date() });
            return docs.get(id);
        },
        unset: async (id, fields) => {
            const doc = docs.get(id);
            if (doc) fields.forEach((field) => delete doc[field]);
        },
    };
}

module.exports = {
    STATE_IDS, readState, writeState, unsetState, mongoStore, memoryStore,
    _useStoreForTests: (next) => { store = next || mongoStore(); },
};
