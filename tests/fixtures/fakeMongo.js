// A tiny in-memory stand-in for MongoDbCrudOpration: enough of the query
// language for the agent modules (equality, $in/$nin/$ne/$gte, $set/$inc/$push,
// conditional findOneAndUpdate) so a test can assert on what was written.

let seq = 1;
const nextId = () => String(seq++).padStart(24, '0');

const read = (doc, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

const matches = (doc, filter = {}) => Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((f) => matches(doc, f));
    const raw = read(doc, key);
    const value = raw === undefined ? undefined : (raw instanceof Date ? raw.getTime() : (key === '_id' ? String(raw) : raw));
    if (cond instanceof RegExp) return cond.test(String(value));
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
        return Object.entries(cond).every(([op, arg]) => {
            const want = arg instanceof Date ? arg.getTime() : arg;
            if (op === '$in') return arg.map(String).includes(String(value));
            if (op === '$nin') return !arg.map(String).includes(String(value));
            if (op === '$ne') return value !== want;
            if (op === '$gte') return value >= want;
            if (op === '$exists') return (value !== undefined) === arg;
            throw new Error(`fakeMongo: unsupported operator ${op}`);
        });
    }
    const want = cond instanceof Date ? cond.getTime() : (key === '_id' ? String(cond) : cond);
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
    Object.entries(update.$push || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = [...(t[l] || []), v]; }));
    Object.entries(update.$unset || {}).forEach(([k]) => write(doc, k, (t, l) => { delete t[l]; }));
    return doc;
};

const create = () => {
    const store = {};
    const calls = [];
    const rows = (type) => { store[type] = store[type] || []; return store[type]; };
    const clone = (d) => (d ? { ...d } : d);

    const crud = jest.fn(async (companyId, { type, data }, method) => {
        calls.push({ companyId, type, method, data });
        const list = rows(type);
        if (method === 'save') { const doc = { _id: data._id ? String(data._id) : nextId(), createdAt: new Date(), ...data }; list.push(doc); return clone(doc); }
        if (method === 'find') return list.filter((d) => matches(d, data[0])).map(clone);
        if (method === 'findOne') return clone(list.find((d) => matches(d, data[0])) || null);
        if (method === 'countDocuments') return list.filter((d) => matches(d, data[0])).length;
        if (method === 'findOneAndUpdate') { const doc = list.find((d) => matches(d, data[0])); if (!doc) return null; apply(doc, data[1]); return clone(doc); }
        if (method === 'updateOne') { const doc = list.find((d) => matches(d, data[0])); if (doc) apply(doc, data[1]); return { modifiedCount: doc ? 1 : 0 }; }
        if (method === 'updateMany') { const hit = list.filter((d) => matches(d, data[0])); hit.forEach((d) => apply(d, data[1])); return { modifiedCount: hit.length }; }
        if (method === 'aggregate') {
            const [pipeline] = data;
            const match = pipeline.find((s) => s.$match);
            const group = pipeline.find((s) => s.$group);
            const subset = list.filter((d) => matches(d, (match && match.$match) || {}));
            if (!group) return subset.map(clone);
            const key = String(group.$group._id).replace(/^\$/, '');
            const out = new Map();
            subset.forEach((d) => { const k = d[key]; out.set(k, { _id: k, n: (out.get(k) ? out.get(k).n : 0) + 1 }); });
            return [...out.values()];
        }
        throw new Error(`fakeMongo: unsupported method ${method}`);
    });

    return { crud, store, calls, seed: (type, doc) => { const d = { _id: nextId(), ...doc }; rows(type).push(d); return d; } };
};

module.exports = { create, matches };
