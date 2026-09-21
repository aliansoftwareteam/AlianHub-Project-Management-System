const { matches } = require('./fakeMongo');

// Atlas Vector Search over a fakeMongo tenant store: the search-index commands and a
// $vectorSearch stage, as far as the knowledge adapter uses them. Like the real service it
// refuses a filter on a path the index does not declare as a filter, and a limit above
// numCandidates; it ranks by exact cosine and hands the rest of the pipeline to fakeMongo.
//
// `lag()` freezes what the index holds, so a filter is judged on the indexed copy of a chunk
// while the stage returns the live document, the way mongot trails the collection. A deleted
// document is never returned. `mode('community')` answers as a plain MongoDB server does,
// `mode('down')` as an unreachable one, and `hang([...])` never answers the methods named.

const CHUNKS = 'knowledge_chunks';
const OPERATORS = ['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte'];
const SCRATCH = '__vectorSearch';
const SCORE_FIELD = '__vectorSearchScore';

/* Atlas scores cosine as (1 + cos) / 2; fakeMongo reads it as a plain field. */
const withScoreField = (node) => {
    if (Array.isArray(node)) return node.map(withScoreField);
    if (!node || typeof node !== 'object' || node instanceof Date || typeof node.toHexString === 'function') return node;
    if (node.$meta === 'vectorSearchScore') return `$${SCORE_FIELD}`;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, withScoreField(value)]));
};

const cosine = (a, b) => {
    let dot = 0; let na = 0; let nb = 0;
    for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/* fakeMongo reads plain equality, not $eq. */
const asQuery = (node) => Object.fromEntries(Object.entries(node || {}).map(([key, cond]) => {
    if (key === '$and' || key === '$or') return [key, cond.map(asQuery)];
    const ops = Object.entries(cond);
    if (ops.length === 1 && ops[0][0] === '$eq') return [key, ops[0][1]];
    return [key, Object.fromEntries(ops.filter(([op]) => op !== '$eq'))];
}));

/* Mongoose answers find and aggregate with a query that runs once per `then`, and refuses a second
 * run; so does this, for the calls an index check makes. */
const runsOnce = (work) => {
    let ran = false;
    return {
        then(resolve, reject) {
            if (ran) return Promise.reject(new Error('Query was already executed')).then(resolve, reject);
            ran = true;
            return Promise.resolve().then(work).then(resolve, reject);
        },
    };
};

const serverError = (code, codeName, message) => Object.assign(new Error(message), { name: 'MongoServerError', code, codeName });

const create = (dbFor) => {
    const indexes = new Map();
    const frozen = new Map();
    const calls = [];
    let current = 'atlas';
    let initialStatus = 'READY';
    let hanging = new Set();

    const db = (companyId) => dbFor(String(companyId));
    const liveRows = (companyId) => db(companyId).store[CHUNKS] || [];
    const indexOf = (companyId) => indexes.get(String(companyId)) || null;

    const filterPaths = (index) => index.latestDefinition.fields.filter((f) => f.type === 'filter').map((f) => f.path);
    const vectorField = (index) => index.latestDefinition.fields.find((f) => f.type === 'vector');

    const checkFilter = (index, filter) => {
        const allowed = filterPaths(index);
        const walk = (node) => Object.entries(node || {}).forEach(([key, cond]) => {
            if (key === '$and' || key === '$or') { cond.forEach(walk); return; }
            if (key.startsWith('$')) throw serverError(8, 'UnknownError', `"${key}" is not supported in a $vectorSearch filter`);
            if (!allowed.includes(key)) throw serverError(8, 'UnknownError', `Path '${key}' needs to be indexed as filter`);
            if (!cond || typeof cond !== 'object' || Array.isArray(cond)) throw serverError(8, 'UnknownError', `"${key}" needs an operator`);
            Object.entries(cond).forEach(([op, arg]) => {
                if (!OPERATORS.includes(op)) throw serverError(8, 'UnknownError', `"${op}" is not supported in a $vectorSearch filter`);
                if (Array.isArray(arg) && !arg.length) throw serverError(8, 'UnknownError', `"${key}.${op}" cannot be empty`);
                const values = Array.isArray(arg) ? arg : [arg];
                if (values.some((v) => v === null || v === undefined)) throw serverError(8, 'UnknownError', `"${key}" compares with null`);
            });
        });
        walk(filter);
    };

    const indexedCopy = (companyId, row) => (frozen.has(String(companyId)) ? frozen.get(String(companyId)).get(String(row._id)) : row);

    const vectorSearch = (companyId, stage) => {
        const index = indexOf(companyId);
        if (!index || index.name !== stage.index || !index.queryable) return [];
        const field = vectorField(index);
        if (stage.path !== field.path) throw serverError(8, 'UnknownError', `Path '${stage.path}' is not indexed as a vector`);
        if (!Array.isArray(stage.queryVector) || stage.queryVector.length !== field.numDimensions) {
            throw serverError(8, 'UnknownError', `queryVector must have ${field.numDimensions} dimensions`);
        }
        if (!(stage.numCandidates >= stage.limit) || stage.numCandidates > 10000) throw serverError(8, 'UnknownError', 'numCandidates must be between limit and 10000');
        if (stage.filter) checkFilter(index, stage.filter);
        const query = asQuery(stage.filter);
        const scored = [];
        liveRows(companyId).forEach((live) => {
            const seen = indexedCopy(companyId, live);
            if (!seen || !Array.isArray(seen[field.path]) || seen[field.path].length !== field.numDimensions) return;
            if (stage.filter && !matches(seen, query)) return;
            scored.push({ live, score: cosine(stage.queryVector, seen[field.path]) });
        });
        return scored.sort((a, b) => b.score - a.score).slice(0, stage.numCandidates).slice(0, stage.limit)
            .map((s) => ({ ...s.live, [SCORE_FIELD]: (1 + s.score) / 2 }));
    };

    const refuse = (method) => {
        if (current === 'down') throw Object.assign(new Error('Server selection timed out after 30000 ms'), { name: 'MongoServerSelectionError' });
        if (current !== 'community') return;
        if (method === 'aggregate') throw serverError(6047401, 'Location6047401', '$vectorSearch stage is only allowed on MongoDB Atlas');
        if (method === 'listSearchIndexes') throw serverError(6047401, 'Location6047401', '$listSearchIndexes stage is only allowed on MongoDB Atlas');
        throw serverError(59, 'CommandNotFound', "no such command: 'createSearchIndexes'");
    };

    const answer = async (companyId, query, method) => {
        const { type, data } = query;
        const searching = type === CHUNKS && method === 'aggregate' && Array.isArray(data[0]) && data[0][0] && data[0][0].$vectorSearch;
        const indexCommand = ['listSearchIndexes', 'createSearchIndex', 'updateSearchIndex'].includes(method);
        if (searching || indexCommand) calls.push({ companyId: String(companyId), method, data });
        if (indexCommand && hanging.has(method)) return new Promise(() => {});
        if (type === CHUNKS && method === 'findOne' && hanging.has('findOne')) return new Promise(() => {});
        if (searching || indexCommand) refuse(searching ? 'aggregate' : method);
        if (method === 'listSearchIndexes') {
            const index = indexOf(companyId);
            return index && (!data[0] || data[0] === index.name) ? [JSON.parse(JSON.stringify(index))] : [];
        }
        if (method === 'createSearchIndex') {
            const [description] = data;
            if (indexOf(companyId)) throw serverError(68, 'IndexAlreadyExists', `Index ${description.name} already exists`);
            indexes.set(String(companyId), { name: description.name, type: description.type, status: initialStatus, queryable: initialStatus === 'READY', latestDefinition: description.definition });
            return description.name;
        }
        if (method === 'updateSearchIndex') {
            const index = indexOf(companyId);
            if (!index) throw serverError(27, 'IndexNotFound', 'Index not found');
            index.latestDefinition = data[1];
            index.status = initialStatus;
            return undefined;
        }
        if (method === 'createCollection') return undefined;
        if (!searching) return db(companyId).crud(companyId, query, method);
        const [pipeline, ...rest] = data;
        const found = vectorSearch(companyId, pipeline[0].$vectorSearch);
        const scratch = db(companyId);
        scratch.store[SCRATCH] = found;
        try {
            return await scratch.crud(companyId, { type: SCRATCH, data: [withScoreField(pipeline.slice(1)), ...rest] }, 'aggregate');
        } finally {
            delete scratch.store[SCRATCH];
        }
    };

    const crud = jest.fn((companyId, query, method) => {
        const once = ['listSearchIndexes', 'createSearchIndex', 'updateSearchIndex'].includes(method) || (query.type === CHUNKS && method === 'findOne');
        return once ? runsOnce(() => answer(companyId, query, method)) : answer(companyId, query, method);
    });

    return {
        crud,
        calls,
        indexOf,
        mode: (next) => { current = next; },
        startAs: (status) => { initialStatus = status; },
        hang: (methods) => { hanging = new Set(methods); },
        setStatus: (companyId, status, queryable = status === 'READY') => Object.assign(indexOf(companyId), { status, queryable }),
        lag: (companyId) => frozen.set(String(companyId), new Map(liveRows(companyId).map((row) => [String(row._id), JSON.parse(JSON.stringify(row))]))),
        catchUp: (companyId) => frozen.delete(String(companyId)),
        reset: () => { indexes.clear(); frozen.clear(); calls.length = 0; current = 'atlas'; initialStatus = 'READY'; hanging = new Set(); crud.mockClear(); },
    };
};

/* Whether a row passes a $vectorSearch filter, judged as the fake judges it. */
const filterMatches = (row, filter) => !filter || matches(row, asQuery(filter));

module.exports = { create, filterMatches, CHUNKS };
