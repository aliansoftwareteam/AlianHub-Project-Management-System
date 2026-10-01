// A tiny in-memory stand-in for MongoDbCrudOpration: enough of the query
// language for the agent modules (equality including null as missing, array-element equality, a word-match $text, $nor, $expr with $eq/$ne of two operands, $in/$nin (any element of a stored array)/$ne/$gt(e)/$lt(e)/$exists/$type/$size/$elemMatch, $set/$inc/$push/$addToSet/$pull,
// conditional findOneAndUpdate answering the old document unless asked for the new one (null after an upsert insert, as
// the driver does), updateOne and findOneAndUpdate with upsert and $setOnInsert and a unique _id, findOneAndDelete, deleteOne, deleteMany,
// bulkWrite of insertOne/updateOne/updateMany, sort/skip/limit on find, sort on findOneAndUpdate, $type 'date'/'string'/'objectId' on the stored value, $match/$unwind (a top-level array)/$project (inclusion or exclusion)/$addFields ($toString, $ifNull, $size, $strLenBytes)/$group/$replaceRoot/$count/$facet/$lookup aggregate with a word-count textScore, declared unique indexes that
// reject a duplicate save or upsert with E11000, declared text indexes that bound $text to their fields) so a test can assert on what was written.

let seq = 1;
const nextId = () => String(seq++).padStart(24, '0');

const hex = (v) => (v && typeof v.toHexString === 'function' ? v.toHexString() : v);

const read = (doc, key) => key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

const words = (s) => String(s == null ? '' : s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

/* No stemming, stop words or score: a row matches when any searched word is a word of one of its string fields.
 * With declared text fields only those are read, the way MongoDB searches the text index and nothing else. */
const textStrings = (doc, fields) => (Array.isArray(fields) && fields.length
    ? fields.map((field) => read(doc, field)).filter((v) => typeof v === 'string')
    : Object.values(doc).filter((v) => typeof v === 'string'));

const textMatches = (doc, search, fields) => {
    const have = new Set(textStrings(doc, fields).flatMap(words));
    return words(search).some((w) => have.has(w));
};

/* How often the searched words occur in a row's searched fields: enough to rank a row that repeats a word above one that says it once. */
const textScoreOf = (doc, search, fields) => {
    const wanted = new Set(words(search));
    return textStrings(doc, fields).flatMap(words).filter((w) => wanted.has(w)).length;
};

/* $type reads the stored value: an ObjectId is not a string, though the other operators compare its hex. */
const TYPE_CHECKS = {
    date: (raw) => raw instanceof Date,
    string: (raw) => typeof raw === 'string',
    objectId: (raw) => Boolean(raw) && raw._bsontype === 'ObjectId',
};

/* $expr comparing two operands with $eq or $ne; a "$field" operand reads the row, and a missing field compares as null. */
const exprOperand = (doc, operand) => {
    const value = typeof operand === 'string' && operand.startsWith('$') ? read(doc, operand.slice(1)) : operand;
    if (value === undefined || value === null) return null;
    return value instanceof Date ? value.getTime() : hex(value);
};
const exprHolds = (doc, expr) => {
    const [op, operands] = Object.entries(expr)[0];
    const [left, right] = operands.map((operand) => exprOperand(doc, operand));
    if (op === '$eq') return left === right;
    if (op === '$ne') return left !== right;
    throw new Error(`fakeMongo: unsupported $expr operator ${op}`);
};

const matches = (doc, filter = {}, textFields) => Object.entries(filter).every(([key, cond]) => {
    if (key === '$expr') return exprHolds(doc, cond);
    if (key === '$or') return cond.some((f) => matches(doc, f, textFields));
    if (key === '$and') return cond.every((f) => matches(doc, f, textFields));
    if (key === '$nor') return !cond.some((f) => matches(doc, f, textFields));
    if (key === '$text') return textMatches(doc, cond.$search, textFields);
    const raw = read(doc, key);
    const value = raw === undefined ? undefined : (raw instanceof Date ? raw.getTime() : (key === '_id' ? String(raw) : hex(raw)));
    if (cond instanceof RegExp) return cond.test(String(value));
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
        return Object.entries(cond).every(([op, arg]) => {
            const want = arg instanceof Date ? arg.getTime() : hex(arg);
            if (op === '$in') return (Array.isArray(value) ? value.map(hex) : [value]).some((v) => arg.map(String).includes(String(v)));
            if (op === '$nin') return !(Array.isArray(value) ? value.map(hex) : [value]).some((v) => arg.map(String).includes(String(v)));
            if (op === '$ne') return Array.isArray(value) ? !value.map(hex).includes(want) : value !== want;
            if (op === '$gte') return value >= want;
            if (op === '$gt') return value > want;
            if (op === '$lte') return value <= want;
            if (op === '$lt') return value < want;
            if (op === '$exists') return (value !== undefined) === arg;
            if (op === '$size') return Array.isArray(value) && value.length === arg;
            if (op === '$elemMatch') return Array.isArray(raw) && raw.some((item) => (isOperatorObject(arg) && !['$and', '$or', '$nor'].some((k) => k in arg) ? matches({ it: item }, { it: arg }) : matches(item, arg, textFields)));
            if (op === '$type') return TYPE_CHECKS[arg] ? TYPE_CHECKS[arg](raw) : typeof value === arg;
            if (op === '$regex') return new RegExp(arg, cond.$options || '').test(String(value));
            if (op === '$options') return true;
            throw new Error(`fakeMongo: unsupported operator ${op}`);
        });
    }
    const want = cond instanceof Date ? cond.getTime() : (key === '_id' ? String(cond) : hex(cond));
    if (want === null) return value === undefined || value === null;
    if (Array.isArray(value) && !Array.isArray(want)) return value.some((item) => hex(item) === want);
    return value === want;
});

const FILTERED = /^\$\[(\w+)\]$/;

/* An arrayFilters segment ($[name]) walks every element its filter matches, as MongoDB does. */
const conditionFor = (name, arrayFilters) => Object.fromEntries((arrayFilters || [])
    .flatMap((filter) => Object.entries(filter))
    .filter(([path]) => path.startsWith(`${name}.`))
    .map(([path, value]) => [path.slice(name.length + 1), value]));

const write = (doc, key, fn, arrayFilters) => {
    const path = key.split('.');
    const walk = (target, at) => {
        const segment = path[at];
        const last = at === path.length - 1;
        const filtered = FILTERED.exec(segment);
        if (filtered) {
            const condition = conditionFor(filtered[1], arrayFilters);
            (Array.isArray(target) ? target : []).forEach((item, index) => {
                if (!matches(item, condition)) return;
                if (last) fn(target, index);
                else walk(item, at + 1);
            });
            return;
        }
        if (last) { fn(target, segment); return; }
        if (target[segment] == null || typeof target[segment] !== 'object') target[segment] = {};
        walk(target[segment], at + 1);
    };
    walk(doc, 0);
};

const apply = (doc, update = {}, arrayFilters) => {
    Object.entries(update.$set || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = v; }, arrayFilters));
    Object.entries(update.$inc || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = Number(t[l] || 0) + v; }, arrayFilters));
    Object.entries(update.$push || {}).forEach(([k, v]) => write(doc, k, (t, l) => { t[l] = [...(t[l] || []), ...(v && Array.isArray(v.$each) ? v.$each : [v])]; }, arrayFilters));
    Object.entries(update.$unset || {}).forEach(([k]) => write(doc, k, (t, l) => { delete t[l]; }));
    Object.entries(update.$addToSet || {}).forEach(([k, v]) => write(doc, k, (t, l) => {
        const list = Array.isArray(t[l]) ? t[l] : [];
        (v && Array.isArray(v.$each) ? v.$each : [v]).forEach((item) => { if (!list.some((have) => hex(have) === hex(item))) list.push(item); });
        t[l] = list;
    }));
    Object.entries(update.$pull || {}).forEach(([k, v]) => write(doc, k, (t, l) => {
        const gone = (item) => (isOperatorObject(v) ? matches({ it: item }, { it: v }) : (v && typeof v === 'object' && !Array.isArray(v) ? matches(item, v) : hex(item) === hex(v)));
        t[l] = (Array.isArray(t[l]) ? t[l] : []).filter((item) => !gone(item));
    }));
    return doc;
};

const isOperatorObject = (v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).some((k) => k.startsWith('$'));

/* An upsert inserts the filter's plain equality fields, then $setOnInsert, then the update. */
const upserted = (filter = {}, update = {}) => {
    const equalities = Object.entries(filter).filter(([key, value]) => !key.startsWith('$') && !key.includes('.') && !isOperatorObject(value));
    const doc = { _id: nextId(), ...Object.fromEntries(equalities) };
    return apply(apply(doc, { $set: update.$setOnInsert || {} }), update);
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
    if (options.skip) out = out.slice(options.skip);
    return options.limit ? out.slice(0, options.limit) : out;
};

const fieldOf = (doc, ref) => {
    if (ref === '$$ROOT') return doc;
    return typeof ref === 'string' && ref.startsWith('$') ? read(doc, ref.slice(1)) : ref;
};
const groupKeyOf = (doc, id) => (id && typeof id === 'object' ? Object.fromEntries(Object.entries(id).map(([k, ref]) => [k, fieldOf(doc, ref)])) : fieldOf(doc, id));
const ACCUMULATORS = {
    $sum: (prev, v) => (prev || 0) + (typeof v === 'number' ? v : 0),
    $max: (prev, v) => (v == null || (prev != null && sortable(prev) >= sortable(v)) ? prev : v),
    $min: (prev, v) => (v == null || (prev != null && sortable(prev) <= sortable(v)) ? prev : v),
    $first: (prev, v, seen) => (seen ? prev : v),
    $push: (prev, v) => [...(prev || []), v],
};

/* $group with a field or compound _id and $sum / $max / $min / $first / $push; a group naming no accumulator counts into `n`. */
const group = (docs, spec) => {
    const fields = Object.entries(spec).filter(([name]) => name !== '_id');
    const out = new Map();
    docs.forEach((d) => {
        const id = groupKeyOf(d, spec._id);
        const key = JSON.stringify(id);
        const seen = out.has(key);
        const acc = out.get(key) || { _id: id };
        if (!fields.length) acc.n = (acc.n || 0) + 1;
        fields.forEach(([name, op]) => {
            const [kind, ref] = Object.entries(op)[0];
            if (!ACCUMULATORS[kind]) throw new Error(`fakeMongo: unsupported accumulator ${kind}`);
            acc[name] = ACCUMULATORS[kind](acc[name], fieldOf(d, ref), seen);
        });
        out.set(key, acc);
    });
    return [...out.values()];
};

const computed = (doc, value, search, textFields) => {
    if (value && typeof value === 'object' && value.$meta === 'textScore') return textScoreOf(doc, search, textFields);
    if (value && typeof value === 'object' && value.$toString !== undefined) return String(hex(fieldOf(doc, value.$toString)));
    if (value && typeof value === 'object' && Array.isArray(value.$ifNull)) {
        const found = computed(doc, value.$ifNull[0], search, textFields);
        return found == null ? computed(doc, value.$ifNull[1], search, textFields) : found;
    }
    if (value && typeof value === 'object' && value.$size !== undefined) { const list = computed(doc, value.$size, search, textFields); return Array.isArray(list) ? list.length : 0; }
    if (value && typeof value === 'object' && value.$strLenBytes !== undefined) return Buffer.byteLength(String(computed(doc, value.$strLenBytes, search, textFields)));
    return fieldOf(doc, value);
};

const project = (doc, spec, search, textFields) => {
    const fields = Object.entries(spec).filter(([key]) => key !== '_id');
    if (fields.length && fields.every(([, value]) => value === 0 || value === false)) {
        const out = { ...doc };
        fields.forEach(([key]) => { delete out[key]; });
        if (spec._id === 0) delete out._id;
        return out;
    }
    const out = spec._id === 0 ? {} : { _id: doc._id };
    Object.entries(spec).filter(([key]) => key !== '_id').forEach(([key, value]) => {
        const kept = value === 1 || value === true ? read(doc, key) : computed(doc, value, search, textFields);
        if (kept !== undefined) write(out, key, (target, last) => { target[last] = kept; });
    });
    return out;
};

const duplicateKey = (fields) => Object.assign(new Error(`E11000 duplicate key error collection: fake index: ${fields.join('_1_')}_1`), { code: 11000 });

/* With `mongooseCasting`, an undefined value is dropped from a filter the way the driver drops it, so { _id: undefined } matches every row. */
const create = ({ mongooseCasting = false } = {}) => {
    const store = {};
    const calls = [];
    const uniques = {};
    const texts = {};
    const rows = (type) => { store[type] = store[type] || []; return store[type]; };
    const clone = (d) => (d ? { ...d } : d);
    const covered = (index, doc) => (index.partial ? matches(doc, index.partial) : true);
    const collides = (type, doc) => (uniques[type] || []).find((index) => covered(index, doc)
        && rows(type).some((other) => covered(index, other) && index.fields.every((f) => String(read(other, f)) === String(read(doc, f)))));

    const insertUpserted = (type, filter, update) => {
        const inserted = upserted(filter, update);
        if (rows(type).some((other) => String(other._id) === String(inserted._id))) throw duplicateKey(['_id']);
        const hit = collides(type, inserted);
        if (hit) throw duplicateKey(hit.fields);
        rows(type).push(inserted);
        return inserted;
    };

    const castFilter = (filter) => (mongooseCasting && filter && typeof filter === 'object' && !Array.isArray(filter)
        ? Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined))
        : filter);

    const crud = jest.fn(async (companyId, { type, data: sent }, method) => {
        calls.push({ companyId, type, method, data: sent });
        const data = Array.isArray(sent) && method !== 'aggregate' ? [castFilter(sent[0]), ...sent.slice(1)] : sent;
        const textFields = texts[type];
        const list = rows(type);
        if (method === 'save') {
            const doc = { _id: data._id ? String(data._id) : nextId(), createdAt: new Date(), ...data };
            const hit = collides(type, doc);
            if (hit) throw duplicateKey(hit.fields);
            list.push(doc);
            return clone(doc);
        }
        if (method === 'find') return ordered(list.filter((d) => matches(d, data[0], textFields)), data[2]).map(clone);
        if (method === 'findOne') return clone(list.find((d) => matches(d, data[0], textFields)) || null);
        if (method === 'countDocuments') return list.filter((d) => matches(d, data[0], textFields)).length;
        if (method === 'distinct') return [...new Set(list.filter((d) => matches(d, data[1] || {}, textFields)).map((d) => read(d, data[0])).filter((v) => v !== undefined))];
        if (method === 'deleteOne') { const index = list.findIndex((d) => matches(d, data[0], textFields)); if (index !== -1) list.splice(index, 1); return { deletedCount: index === -1 ? 0 : 1 }; }
        if (method === 'deleteMany') { const kept = list.filter((d) => !matches(d, data[0], textFields)); store[type] = kept; return { deletedCount: list.length - kept.length }; }
        if (method === 'findOneAndUpdate') {
            const options = data[2] || {};
            const wantsNew = options.new === true || options.returnDocument === 'after' || options.returnOriginal === false;
            const doc = (options.sort ? ordered(list, { sort: options.sort }) : list).find((d) => matches(d, data[0], textFields));
            if (doc) {
                const before = clone(doc);
                apply(doc, data[1], options.arrayFilters);
                return wantsNew ? clone(doc) : before;
            }
            if (!options.upsert) return null;
            const inserted = insertUpserted(type, data[0], data[1]);
            return wantsNew ? clone(inserted) : null;
        }
        if (method === 'updateOne') {
            const doc = list.find((d) => matches(d, data[0], textFields));
            if (doc) { apply(doc, data[1], data[2] && data[2].arrayFilters); return { matchedCount: 1, modifiedCount: 1 }; }
            if (!(data[2] && data[2].upsert)) return { matchedCount: 0, modifiedCount: 0 };
            const inserted = insertUpserted(type, data[0], data[1]);
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: inserted._id };
        }
        if (method === 'updateMany') { const hit = list.filter((d) => matches(d, data[0], textFields)); hit.forEach((d) => apply(d, data[1])); return { modifiedCount: hit.length }; }
        if (method === 'bulkWrite') {
            const counts = { insertedCount: 0, matchedCount: 0, modifiedCount: 0 };
            (data[0] || []).forEach((operation) => {
                const [kind, spec] = Object.entries(operation)[0];
                if (kind === 'insertOne') { list.push({ _id: nextId(), ...spec.document }); counts.insertedCount += 1; return; }
                if (kind !== 'updateOne' && kind !== 'updateMany') throw new Error(`fakeMongo: unsupported bulkWrite ${kind}`);
                const hit = list.filter((d) => matches(d, spec.filter, textFields)).slice(0, kind === 'updateOne' ? 1 : undefined);
                hit.forEach((d) => apply(d, spec.update));
                counts.matchedCount += hit.length;
                counts.modifiedCount += hit.length;
            });
            return counts;
        }
        if (method === 'findOneAndDelete') { const at = list.findIndex((d) => matches(d, data[0], textFields)); return at === -1 ? null : clone(list.splice(at, 1)[0]); }
        if (method === 'deleteOne') { const at = list.findIndex((d) => matches(d, data[0], textFields)); if (at !== -1) list.splice(at, 1); return { deletedCount: at === -1 ? 0 : 1 }; }
        if (method === 'aggregate') {
            const [pipeline] = data;
            let search = '';
            const run = (input, stages) => stages.reduce((docs, stage) => {
                if (stage.$match) {
                    if (stage.$match.$text) search = stage.$match.$text.$search;
                    return docs.filter((d) => matches(d, stage.$match, textFields));
                }
                if (stage.$unwind) {
                    const path = String(stage.$unwind.path || stage.$unwind).replace(/^\$/, '');
                    const keep = !!stage.$unwind.preserveNullAndEmptyArrays;
                    return docs.flatMap((d) => {
                        const v = d[path];
                        if (Array.isArray(v) && v.length) return v.map((item) => ({ ...d, [path]: item }));
                        return v == null || Array.isArray(v) ? (keep ? [d] : []) : [d];
                    });
                }
                if (stage.$project) return docs.map((d) => project(d, stage.$project, search, textFields));
                if (stage.$addFields) return docs.map((d) => ({ ...d, ...Object.fromEntries(Object.entries(stage.$addFields).map(([k, v]) => [k, computed(d, v, search, textFields)])) }));
                if (stage.$replaceRoot) return docs.map((d) => ({ ...fieldOf(d, stage.$replaceRoot.newRoot) }));
                if (stage.$group) return group(docs, stage.$group);
                if (stage.$sort) return ordered(docs, { sort: stage.$sort });
                if (stage.$skip) return docs.slice(stage.$skip);
                if (stage.$limit) return docs.slice(0, stage.$limit);
                if (stage.$count) return docs.length ? [{ [stage.$count]: docs.length }] : [];
                if (stage.$facet) return [Object.fromEntries(Object.entries(stage.$facet).map(([name, sub]) => [name, run(docs, sub)]))];
                if (stage.$lookup) {
                    const { from, localField, foreignField, as, pipeline: inner = [] } = stage.$lookup;
                    return docs.map((d) => ({ ...d, [as]: run(rows(from).filter((f) => String(hex(read(f, foreignField))) === String(hex(read(d, localField)))), inner) }));
                }
                return docs;
            }, input);
            return run(list, pipeline).map(clone);
        }
        if (method === 'createIndexes') return undefined;
        if (method === 'createIndex') return data[1] && data[1].name;
        throw new Error(`fakeMongo: unsupported method ${method}`);
    });

    const unique = (type, fields, partial) => { (uniques[type] = uniques[type] || []).push({ fields, partial }); };
    /* Mirror a collection's unique indexes from its Mongoose schema so a test inserts against the declared ones. */
    const uniqueFromSchema = (type, schema) => {
        schema.indexes().forEach(([fields, options]) => { if (options && options.unique) unique(type, Object.keys(fields), options.partialFilterExpression); });
    };

    /* Mirror a collection's text index so $text searches its fields and no others, as MongoDB does. */
    const textFromSchema = (type, schema) => {
        schema.indexes().forEach(([fields]) => {
            const text = Object.keys(fields || {}).filter((field) => fields[field] === 'text');
            if (text.length) texts[type] = [...new Set([...(texts[type] || []), ...text])];
        });
    };

    return { crud, store, calls, unique, uniqueFromSchema, textFromSchema, seed: (type, doc) => { const d = { _id: nextId(), ...doc }; rows(type).push(d); return d; } };
};

module.exports = { create, matches };
