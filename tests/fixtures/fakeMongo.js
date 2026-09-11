// A tiny in-memory stand-in for MongoDbCrudOpration: enough of the query
// language for the agent modules (equality, $in/$nin/$ne/$gt(e)/$lt(e)/$exists/$type, $set/$inc/$push,
// conditional findOneAndUpdate, findOneAndDelete, deleteOne, deleteMany, sort/limit on find, $match/$group aggregate, declared unique indexes that
// reject a duplicate save with E11000) so a test can assert on what was written.

let seq = 1;
const nextId = () => String(seq++).padStart(24, '0');

const hex = (v) => (v && typeof v.toHexString === 'function' ? v.toHexString() : v);

const read = (doc, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

const matches = (doc, filter = {}) => Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matches(doc, f));
    if (key === '$and') return cond.every((f) => matches(doc, f));
    const raw = read(doc, key);
    const value = raw === undefined ? undefined : (raw instanceof Date ? raw.getTime() : (key === '_id' ? String(raw) : hex(raw)));
    if (cond instanceof RegExp) return cond.test(String(value));
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
        return Object.entries(cond).every(([op, arg]) => {
            const want = arg instanceof Date ? arg.getTime() : hex(arg);
            if (op === '$in') return arg.map(String).includes(String(value));
            if (op === '$nin') return !arg.map(String).includes(String(value));
            if (op === '$ne') return value !== want;
            if (op === '$gte') return value >= want;
            if (op === '$gt') return value > want;
            if (op === '$lte') return value <= want;
            if (op === '$lt') return value < want;
            if (op === '$exists') return (value !== undefined) === arg;
            if (op === '$type') return arg === 'string' ? typeof value === 'string' : typeof value === arg;
            if (op === '$regex') return new RegExp(arg, cond.$options || '').test(String(value));
            if (op === '$options') return true;
            throw new Error(`fakeMongo: unsupported operator ${op}`);
        });
    }
    const want = cond instanceof Date ? cond.getTime() : (key === '_id' ? String(cond) : hex(cond));
    return value === want;
});

const write = (doc, key, fn) => {
    const path = key.split('.');
    const last = path.pop();
    const target = path.reduce((v, k) => { if (v[k] == null || typeof v[k] !== 'object') v[k] = {}; return v[k]; }, doc);
    fn(target, last);
};

const apply = (doc, update = {}) => {
    Object.entries(update.$set || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = v; }));
    Object.entries(update.$inc || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = Number(t[l] || 0) + v; }));
    Object.entries(update.$push || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = [...(t[l] || []), ...(v && Array.isArray(v.$each) ? v.$each : [v])]; }));
    Object.entries(update.$unset || {}).forEach(([k]) => write(doc, k, (t, l) => { delete t[l]; }));
    return doc;
};

const sortable = (v) => (v instanceof Date ? v.getTime() : (v == null ? '' : v));
const ordered = (list, options = {}) => {
    let out = list;
    if (options.sort) {
        const entries = Object.entries(options.sort);
        out = [...list].sort((a, b) => {
            for (const [key, dir] of entries) {
                const x = sortable(read(a, key));
                const y = sortable(read(b, key));
                if (x < y) return -dir;
                if (x > y) return dir;
            }
            return 0;
        });
    }
    return options.limit ? out.slice(0, options.limit) : out;
};

const fieldOf = (doc, ref) => (typeof ref === 'string' && ref.startsWith('$') ? read(doc, ref.slice(1)) : ref);
const groupKeyOf = (doc, id) => (id && typeof id === 'object' ? Object.fromEntries(Object.entries(id).map(([k, ref]) => [k, fieldOf(doc, ref)])) : fieldOf(doc, id));
const ACCUMULATORS = {
    $sum: (prev, v) => (prev || 0) + (typeof v === 'number' ? v : 0),
    $max: (prev, v) => (v == null || (prev != null && sortable(prev) >= sortable(v)) ? prev : v),
};

/* $group with a field or compound _id and $sum / $max; a group naming no accumulator counts into `n`. */
const group = (docs, spec) => {
    const fields = Object.entries(spec).filter(([name]) => name !== '_id');
    const out = new Map();
    docs.forEach((d) => {
        const id = groupKeyOf(d, spec._id);
        const key = JSON.stringify(id);
        const acc = out.get(key) || { _id: id };
        if (!fields.length) acc.n = (acc.n || 0) + 1;
        fields.forEach(([name, op]) => {
            const [kind, ref] = Object.entries(op)[0];
            if (!ACCUMULATORS[kind]) throw new Error(`fakeMongo: unsupported accumulator ${kind}`);
            acc[name] = ACCUMULATORS[kind](acc[name], fieldOf(d, ref));
        });
        out.set(key, acc);
    });
    return [...out.values()];
};

const duplicateKey = (fields) => Object.assign(new Error(`E11000 duplicate key error collection: fake index: ${fields.join('_1_')}_1`), { code: 11000 });

const create = () => {
    const store = {};
    const calls = [];
    const uniques = {};
    const rows = (type) => { store[type] = store[type] || []; return store[type]; };
    const clone = (d) => (d ? { ...d } : d);
    const covered = (index, doc) => (index.partial ? matches(doc, index.partial) : true);
    const collides = (type, doc) => (uniques[type] || []).find((index) => covered(index, doc)
        && rows(type).some((other) => covered(index, other) && index.fields.every((f) => String(read(other, f)) === String(read(doc, f)))));

    const crud = jest.fn(async (companyId, { type, data }, method) => {
        calls.push({ companyId, type, method, data });
        const list = rows(type);
        if (method === 'save') {
            const doc = { _id: data._id ? String(data._id) : nextId(), createdAt: new Date(), ...data };
            const hit = collides(type, doc);
            if (hit) throw duplicateKey(hit.fields);
            list.push(doc);
            return clone(doc);
        }
        if (method === 'find') return ordered(list.filter((d) => matches(d, data[0])), data[2]).map(clone);
        if (method === 'findOne') return clone(list.find((d) => matches(d, data[0])) || null);
        if (method === 'countDocuments') return list.filter((d) => matches(d, data[0])).length;
        if (method === 'deleteOne') { const index = list.findIndex((d) => matches(d, data[0])); if (index !== -1) list.splice(index, 1); return { deletedCount: index === -1 ? 0 : 1 }; }
        if (method === 'deleteMany') { const kept = list.filter((d) => !matches(d, data[0])); store[type] = kept; return { deletedCount: list.length - kept.length }; }
        if (method === 'findOneAndUpdate') { const doc = list.find((d) => matches(d, data[0])); if (!doc) return null; apply(doc, data[1]); return clone(doc); }
        if (method === 'updateOne') { const doc = list.find((d) => matches(d, data[0])); if (doc) apply(doc, data[1]); return { modifiedCount: doc ? 1 : 0 }; }
        if (method === 'updateMany') { const hit = list.filter((d) => matches(d, data[0])); hit.forEach((d) => apply(d, data[1])); return { modifiedCount: hit.length }; }
        if (method === 'findOneAndDelete') { const at = list.findIndex((d) => matches(d, data[0])); return at === -1 ? null : clone(list.splice(at, 1)[0]); }
        if (method === 'deleteOne') { const at = list.findIndex((d) => matches(d, data[0])); if (at !== -1) list.splice(at, 1); return { deletedCount: at === -1 ? 0 : 1 }; }
        if (method === 'aggregate') {
            const [pipeline] = data;
            return pipeline.reduce((docs, stage) => {
                if (stage.$match) return docs.filter((d) => matches(d, stage.$match));
                if (stage.$group) return group(docs, stage.$group);
                return docs;
            }, list).map(clone);
        }
        throw new Error(`fakeMongo: unsupported method ${method}`);
    });

    const unique = (type, fields, partial) => { (uniques[type] = uniques[type] || []).push({ fields, partial }); };
    /* Mirror a collection's unique indexes from its Mongoose schema so a test inserts against the declared ones. */
    const uniqueFromSchema = (type, schema) => {
        schema.indexes().forEach(([fields, options]) => { if (options && options.unique) unique(type, Object.keys(fields), options.partialFilterExpression); });
    };

    return { crud, store, calls, unique, uniqueFromSchema, seed: (type, doc) => { const d = { _id: nextId(), ...doc }; rows(type).push(d); return d; } };
};

module.exports = { create, matches };
