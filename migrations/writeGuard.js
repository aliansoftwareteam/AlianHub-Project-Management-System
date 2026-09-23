/* Patched on the driver's Collection and Db prototypes, below Mongoose and MongoDbCrudOpration
 * alike, so no path a migration takes can write while the guard is on (the same seam as
 * scripts/knowledge-compare.js). In "record" mode a write is summarised and answered with a
 * plausible result so the migration runs on; in "refuse" mode it is rejected. Summaries keep
 * field names and counts only: filter values and documents can hold personal data. */

const COLLECTION_WRITES = [
    'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
    'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite',
    'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'drop', 'rename',
    'createSearchIndex', 'createSearchIndexes', 'dropSearchIndex', 'updateSearchIndex',
];
const COLLECTION_READS = [
    'find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'count', 'distinct',
    'listIndexes', 'indexes', 'indexExists', 'indexInformation', 'listSearchIndexes', 'watch',
];
const BULK_BUILDERS = ['initializeOrderedBulkOp', 'initializeUnorderedBulkOp'];
const DB_WRITES = ['createCollection', 'dropCollection', 'dropDatabase', 'renameCollection', 'createIndex'];
const READ_COMMANDS = new Set([
    'ping', 'hello', 'ismaster', 'isMaster', 'buildInfo', 'buildinfo', 'serverStatus', 'dbStats', 'collStats',
    'listCollections', 'listIndexes', 'count', 'find', 'distinct', 'connectionStatus', 'getParameter', 'hostInfo',
]);
const WRITE_STAGES = ['$out', '$merge'];
const LOOKUP_STAGES = { $lookup: 'from', $graphLookup: 'from', $unionWith: 'coll' };
const LOGICAL = new Set(['$and', '$or', '$nor']);
const SINGLE = new Set(['updateOne', 'replaceOne', 'deleteOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete']);

function fieldsOf(filter, out = new Set()) {
    if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
        for (const [key, value] of Object.entries(filter)) {
            if (LOGICAL.has(key) && Array.isArray(value)) value.forEach((part) => fieldsOf(part, out));
            else out.add(key);
        }
    }
    return [...out].sort();
}

function updateShapeOf(update) {
    if (Array.isArray(update)) return 'pipeline';
    if (!update || typeof update !== 'object') return null;
    const entries = Object.entries(update);
    if (!entries.length || !entries.every(([key]) => key.startsWith('$'))) return 'replacement';
    return entries.map(([op, fields]) => `${op} {${Object.keys(fields || {}).join(', ')}}`).join(' ');
}

const indexNameOf = (spec) => Object.entries(spec || {}).map(([field, dir]) => `${field}_${dir}`).join('_');

const namespaceOf = (collection) => ({ db: String(collection.dbName), collection: String(collection.collectionName) });

function installWriteGuard({ Collection, Db }) {
    let mode = 'off';
    let owner = null;
    let internal = 0;
    let journal;
    const touched = new Map();
    const originals = [];
    const fresh = () => ({ writes: [], readsAfterWrite: [], unsupported: [] });
    journal = fresh();

    const quietly = (fn) => {
        internal += 1;
        try { return fn(); } finally { internal -= 1; }
    };
    const markWritten = (db, collection, op) => {
        const key = `${db}.${collection}`;
        if (!touched.has(key)) touched.set(key, { writtenBy: owner, writeOp: op });
    };
    const noteRead = (db, collection, op) => {
        if (mode !== 'record' || internal) return;
        const wrote = touched.get(`${db}.${collection}`);
        if (!wrote || journal.readsAfterWrite.some((r) => r.db === db && r.collection === collection)) return;
        journal.readsAfterWrite.push({ db, collection, op, ...wrote });
    };
    const refusal = (op, collection) => new Error(`read-only: ${op} on ${collection} refused`);

    async function matchedBy(collection, method, filter, options = {}) {
        let count = null;
        try {
            count = await quietly(() => original(Collection, 'countDocuments').call(collection, filter || {}));
        } catch {
            return { documents: null, upserts: 0 };
        }
        const documents = SINGLE.has(method) ? Math.min(count, 1) : count;
        return { documents, upserts: options.upsert && count === 0 ? 1 : 0 };
    }

    async function planCollectionWrite(collection, method, args) {
        const { db, collection: name } = namespaceOf(collection);
        const entry = { db, collection: name, op: method, documents: null, upserts: 0, filter: [], update: null };
        let result;
        if (method === 'insertOne') {
            entry.documents = 1;
            result = { acknowledged: true, insertedId: args[0] && args[0]._id };
        } else if (method === 'insertMany') {
            const docs = Array.isArray(args[0]) ? args[0] : [];
            entry.documents = docs.length;
            result = { acknowledged: true, insertedCount: docs.length, insertedIds: Object.fromEntries(docs.map((d, i) => [i, d && d._id])) };
        } else if (['updateOne', 'updateMany', 'replaceOne'].includes(method)) {
            const [filter, update, options] = args;
            Object.assign(entry, { filter: fieldsOf(filter), update: updateShapeOf(update) }, await matchedBy(collection, method, filter, options));
            const matched = entry.documents || 0;
            result = { acknowledged: true, matchedCount: matched, modifiedCount: matched, upsertedCount: entry.upserts, upsertedId: null };
        } else if (['deleteOne', 'deleteMany'].includes(method)) {
            Object.assign(entry, { filter: fieldsOf(args[0]) }, await matchedBy(collection, method, args[0]));
            result = { acknowledged: true, deletedCount: entry.documents || 0 };
        } else if (method.startsWith('findOneAnd')) {
            const deleting = method === 'findOneAndDelete';
            const [filter, update] = args;
            const options = (deleting ? args[1] : args[2]) || {};
            Object.assign(entry, { filter: fieldsOf(filter), update: deleting ? null : updateShapeOf(update) }, await matchedBy(collection, method, filter, options));
            const before = await quietly(() => original(Collection, 'findOne').call(collection, filter || {}, { sort: options.sort, projection: options.projection }));
            if (!deleting && (options.returnDocument === 'after' || options.returnOriginal === false || options.new === true)) {
                journal.readsAfterWrite.push({ db, collection: name, op: `${method} returning the written document`, writtenBy: owner, writeOp: method });
            }
            result = options.includeResultMetadata
                ? { ok: 1, value: before, lastErrorObject: { n: entry.documents || 0, updatedExisting: Boolean(before) } }
                : before;
        } else if (method === 'bulkWrite') {
            const ops = Array.isArray(args[0]) ? args[0] : [];
            const kinds = {};
            ops.forEach((op) => { const kind = Object.keys(op || {})[0]; kinds[kind] = (kinds[kind] || 0) + 1; });
            entry.documents = ops.length;
            entry.update = Object.entries(kinds).map(([kind, n]) => `${kind} x${n}`).join(', ');
            result = { ok: 1, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {}, upsertedIds: {} };
        } else if (method === 'createIndex') {
            entry.update = `index {${Object.keys(args[0] || {}).join(', ')}}`;
            result = (args[1] && args[1].name) || indexNameOf(args[0]);
        } else if (method === 'createIndexes') {
            const specs = Array.isArray(args[0]) ? args[0] : [];
            entry.update = `${specs.length} indexes`;
            result = specs.map((s) => s.name || indexNameOf(s.key));
        } else if (method === 'rename') {
            markWritten(db, String(args[0]), method);
            result = collection;
        } else if (method === 'drop') {
            result = true;
        } else {
            result = method === 'createSearchIndexes' ? [] : { ok: 1 };
        }
        journal.writes.push(entry);
        markWritten(db, name, method);
        return result;
    }

    function planDbWrite(dbObject, method, args) {
        const db = String(dbObject.databaseName);
        const name = method === 'dropDatabase' ? '*' : String(args[0]);
        journal.writes.push({ db, collection: name, op: method, documents: null, upserts: 0, filter: [], update: null });
        markWritten(db, name, method);
        markWritten(db, '#collections', method);
        if (method === 'createCollection') return dbObject.collection(name);
        if (method === 'renameCollection') { markWritten(db, String(args[1]), method); return dbObject.collection(String(args[1])); }
        if (method === 'createIndex') return (args[2] && args[2].name) || indexNameOf(args[1]);
        return true;
    }

    function original(Class, method) {
        const saved = originals.find((o) => o.proto === Class.prototype && o.method === method);
        return saved ? saved.fn : Class.prototype[method];
    }

    function patch(proto, method, guarded) {
        if (!proto || typeof proto[method] !== 'function') return;
        const fn = proto[method];
        originals.push({ proto, method, fn });
        proto[method] = function guardedMethod(...args) {
            if (mode === 'off') return fn.apply(this, args);
            return guarded.call(this, fn, args);
        };
    }

    const CollectionProto = Collection && Collection.prototype;
    const DbProto = Db && Db.prototype;

    COLLECTION_WRITES.forEach((method) => patch(CollectionProto, method, async function write(fn, args) {
        const { db, collection } = namespaceOf(this);
        if (mode === 'refuse') {
            journal.writes.push({ db, collection, op: method });
            throw refusal(method, collection);
        }
        return planCollectionWrite(this, method, args);
    }));

    COLLECTION_READS.forEach((method) => patch(CollectionProto, method, function read(fn, args) {
        const { db, collection } = namespaceOf(this);
        noteRead(db, collection, method);
        return fn.apply(this, args);
    }));

    patch(CollectionProto, 'aggregate', function aggregate(fn, args) {
        const { db, collection } = namespaceOf(this);
        const pipeline = Array.isArray(args[0]) ? args[0] : [];
        noteRead(db, collection, 'aggregate');
        pipeline.forEach((stage) => Object.entries(LOOKUP_STAGES).forEach(([op, key]) => {
            const from = stage && stage[op] && (typeof stage[op] === 'string' ? stage[op] : stage[op][key]);
            if (from) noteRead(db, String(from), `aggregate ${op}`);
        }));
        const writing = pipeline.find((stage) => stage && WRITE_STAGES.some((op) => op in stage));
        if (!writing) return fn.apply(this, args);
        const op = WRITE_STAGES.find((o) => o in writing);
        const spec = writing[op];
        const target = typeof spec === 'string' ? spec : (spec && (spec.into || spec.coll));
        const targetName = typeof target === 'string' ? target : String((target && target.coll) || '?');
        journal.writes.push({ db, collection: targetName, op: `aggregate ${op}`, documents: null, upserts: 0, filter: [], update: null });
        if (mode === 'refuse') throw refusal(`aggregate ${op}`, targetName);
        markWritten(db, targetName, `aggregate ${op}`);
        return quietly(() => fn.call(this, [{ $match: { $expr: false } }]));
    });

    BULK_BUILDERS.forEach((method) => patch(CollectionProto, method, function builder(fn, args) {
        const { db, collection } = namespaceOf(this);
        if (mode === 'record') journal.unsupported.push({ db, collection, op: method });
        else journal.writes.push({ db, collection, op: method });
        throw refusal(method, collection);
    }));

    DB_WRITES.forEach((method) => patch(DbProto, method, async function dbWrite(fn, args) {
        const name = method === 'dropDatabase' ? '*' : String(args[0]);
        if (mode === 'refuse') {
            journal.writes.push({ db: String(this.databaseName), collection: name, op: method });
            throw refusal(method, name);
        }
        return planDbWrite(this, method, args);
    }));

    patch(DbProto, 'listCollections', function listCollections(fn, args) {
        noteRead(String(this.databaseName), '#collections', 'listCollections');
        return fn.apply(this, args);
    });

    patch(DbProto, 'command', async function command(fn, args) {
        const name = Object.keys(args[0] || {})[0] || '?';
        if (READ_COMMANDS.has(name)) return fn.apply(this, args);
        journal.writes.push({ db: String(this.databaseName), collection: '*', op: `command ${name}`, documents: null, upserts: 0, filter: [], update: null });
        if (mode === 'refuse') throw refusal(`command ${name}`, String(this.databaseName));
        return { ok: 1 };
    });

    return {
        record(nextOwner) { mode = 'record'; owner = nextOwner; journal = fresh(); },
        refuse() { mode = 'refuse'; owner = null; journal = fresh(); },
        off() { mode = 'off'; owner = null; },
        forget() { touched.clear(); },
        take() { const taken = journal; journal = fresh(); return taken; },
        uninstall() {
            originals.splice(0).forEach(({ proto, method, fn }) => { proto[method] = fn; });
            mode = 'off';
        },
    };
}

module.exports = { installWriteGuard, fieldsOf, updateShapeOf, COLLECTION_WRITES, DB_WRITES };
