const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

// The vector side of retrieval, behind the same contract as the lexical adapter. Two
// implementations: one in memory, for tests and as the reference for the contract, and one
// over the chunk rows in the tenant database, which carry their own vectors. A hosted vector
// store is one more implementation of this file's contract, chosen in vectorStore.js.

/* The in-database adapter reads at most this many chunks per source type for a question, the
 * newest first, and scores them in process: a plain MongoDB server has no vector index. Around
 * 4 MB of vectors at 1536 dimensions. A corpus past the bound is searched by recency first,
 * which a hosted store lifts. */
const CANDIDATE_CHUNKS_PER_SOURCE = 300;
const EXCERPT_LENGTH = 300;
const TITLE_LENGTH = 160;
const CANDIDATE_FIELDS = { sourceId: 1, ordinal: 1, title: 1, text: 1, projectId: 1, authorKind: 1, sourceUpdatedAt: 1, updatedAt: 1, embedding: 1 };

const cosine = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const clip = (value, n) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, n);
const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

const toPassage = (sourceType, row, score) => ({
    id: `${sourceType}:${row.sourceId}`,
    sourceType,
    sourceId: String(row.sourceId),
    projectId: row.projectId ? String(row.projectId) : '',
    title: clip(row.title, TITLE_LENGTH),
    excerpt: clip(row.text, EXCERPT_LENGTH),
    score,
    authorKind: row.authorKind === 'agent' ? 'agent' : 'user',
    updatedAt: row.sourceUpdatedAt || row.updatedAt || null,
});

const byRank = (a, b) => (b.score - a.score)
    || ((a.row.authorKind === 'agent') - (b.row.authorKind === 'agent'))
    || (time(b.row.sourceUpdatedAt) - time(a.row.sourceUpdatedAt))
    || String(a.row.sourceId).localeCompare(String(b.row.sourceId));

/* One passage per source from its best chunk, by cosine, the most similar first. A chunk at or
 * below zero is no match. */
const rank = (sourceType, rows, queryEmbedding, limit) => {
    const best = new Map();
    rows.forEach((row) => {
        const score = cosine(queryEmbedding, row.embedding);
        if (score <= 0) return;
        const key = String(row.sourceId);
        const seen = best.get(key);
        if (!seen || score > seen.score || (score === seen.score && Number(row.ordinal) < Number(seen.row.ordinal))) best.set(key, { row, score });
    });
    return [...best.values()].sort(byRank).slice(0, limit).map(({ row, score }) => toPassage(sourceType, row, score));
};

const clampLimit = (limit) => {
    const n = Math.floor(Number(limit));
    return Number.isFinite(n) && n > 0 ? n : 12;
};

/* The sources a question may search by vector: those asked for whose chunk store is built. */
const searchableSources = (filter) => ((filter && filter.sourceTypes) || [])
    .filter((sourceType) => (filter.chunkSources || []).includes(sourceType) && filter.clauses && filter.clauses[sourceType]);

/* A source whose candidates cannot be read fails the whole search: an answer that quietly came
 * from the sources that happened to work would look complete and not be. */
const searchWith = (candidatesOf) => async ({ companyId, queryEmbedding, model, filter, limit }) => {
    const vector = Array.isArray(queryEmbedding) ? queryEmbedding : [];
    const wanted = clampLimit(limit);
    if (!vector.length || !model) return [];
    const results = await Promise.all(searchableSources(filter).map(async (sourceType) => {
        try {
            return rank(sourceType, await candidatesOf(String(companyId), sourceType, model, filter.clauses[sourceType]), vector, wanted);
        } catch (error) {
            throw new Error(`${sourceType} candidates unavailable for ${companyId}: ${error.message}`);
        }
    }));
    return results.flat();
};

const NOTHING_TO_DO = Object.freeze({ backend: 'vector-db', skipped: true });

/* Vectors ride on the chunk rows the indexer writes, so upsert, tombstone and erase have
 * nothing to add here: the row write, the tombstone and the deletion already covered them. */
const createDatabaseVectorAdapter = () => ({
    name: 'vector-db',
    search: searchWith((companyId, sourceType, model, clause) => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS,
        data: [[
            { $match: { ...clause, embeddingModel: model } },
            { $sort: { sourceUpdatedAt: -1, ordinal: 1 } },
            { $limit: CANDIDATE_CHUNKS_PER_SOURCE },
            { $project: CANDIDATE_FIELDS },
        ]],
    }, 'aggregate')),
    upsert: async () => NOTHING_TO_DO,
    tombstone: async () => NOTHING_TO_DO,
    erase: async () => NOTHING_TO_DO,
    async stats({ companyId }) {
        const rows = await MongoDbCrudOpration(String(companyId), {
            type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS,
            data: [[{ $match: { deleted: { $ne: true } } }, { $group: { _id: '$embeddingModel', n: { $sum: 1 } } }]],
        }, 'aggregate');
        const embedded = {};
        let unembedded = 0;
        (rows || []).forEach((row) => {
            if (row._id) embedded[row._id] = Number(row.n) || 0;
            else unembedded += Number(row.n) || 0;
        });
        return { backend: 'vector-db', candidateBound: CANDIDATE_CHUNKS_PER_SOURCE, embedded, unembedded };
    },
});

const plain = (value) => {
    if (value && typeof value.toHexString === 'function') return value.toHexString();
    if (value instanceof Date) return value.getTime();
    return value;
};
const same = (a, b) => String(plain(a)) === String(plain(b));
const holds = (value, wanted) => (Array.isArray(value) ? value.some((item) => same(item, wanted)) : same(value, wanted));
const isOperator = (cond) => cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date) && Object.keys(cond).some((k) => k.startsWith('$'));

/* The operators visibleSet's chunk clauses use, and no more: an operator this cannot read
 * throws rather than letting a row through. */
const matchesClause = (row, clause = {}) => Object.entries(clause).every(([key, cond]) => {
    if (key === '$or') return cond.some((c) => matchesClause(row, c));
    if (key === '$and') return cond.every((c) => matchesClause(row, c));
    const value = key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), row);
    if (!isOperator(cond)) return holds(value, cond);
    return Object.entries(cond).every(([op, arg]) => {
        if (op === '$in') return arg.some((wanted) => holds(value, wanted));
        if (op === '$nin') return !arg.some((wanted) => holds(value, wanted));
        if (op === '$ne') return !holds(value, arg);
        if (op === '$eq') return holds(value, arg);
        throw new Error(`vector-memory: unsupported operator ${op} in the access clause`);
    });
});

const createInMemoryVectorAdapter = ({ matches = matchesClause } = {}) => {
    const rows = new Map();
    const keyOf = (companyId, chunk) => `${companyId}:${chunk.sourceType}:${chunk.sourceId}:${chunk.ordinal}`;
    const ofCompany = (companyId) => [...rows.values()].filter((row) => row.companyId === String(companyId));
    return {
        name: 'vector-memory',
        search: searchWith(async (companyId, sourceType, model, clause) => ofCompany(companyId)
            .filter((row) => row.sourceType === sourceType && row.embeddingModel === model && row.deleted !== true && matches(row, clause))),
        async upsert({ companyId, chunks }) {
            (chunks || []).forEach((chunk) => rows.set(keyOf(String(companyId), chunk), { ...chunk, companyId: String(companyId), sourceId: String(chunk.sourceId), deleted: chunk.deleted === true }));
            return { backend: 'vector-memory', upserted: (chunks || []).length };
        },
        async tombstone({ companyId, sourceType, sourceIds }) {
            const wanted = new Set((sourceIds || []).map(String));
            let tombstoned = 0;
            ofCompany(companyId).forEach((row) => {
                if (row.sourceType === sourceType && wanted.has(row.sourceId) && !row.deleted) { row.deleted = true; tombstoned += 1; }
            });
            return { backend: 'vector-memory', tombstoned };
        },
        /* Exactly the sources the erasure names: which of a person's sources leave is the indexer's
         * rule (private pages and comments, not shared pages or calls), decided there and handed here. */
        async erase({ companyId, sources }) {
            const wanted = new Set((sources || []).map((s) => `${s.sourceType}:${s.sourceId}`));
            let erased = 0;
            [...rows.entries()].forEach(([key, row]) => {
                if (row.companyId === String(companyId) && wanted.has(`${row.sourceType}:${row.sourceId}`)) { rows.delete(key); erased += 1; }
            });
            return { backend: 'vector-memory', erased };
        },
        async stats({ companyId }) {
            const embedded = {};
            let unembedded = 0;
            ofCompany(companyId).filter((row) => !row.deleted).forEach((row) => {
                if (row.embeddingModel) embedded[row.embeddingModel] = (embedded[row.embeddingModel] || 0) + 1;
                else unembedded += 1;
            });
            return { backend: 'vector-memory', embedded, unembedded };
        },
    };
};

module.exports = { CANDIDATE_CHUNKS_PER_SOURCE, cosine, rank, matchesClause, createDatabaseVectorAdapter, createInMemoryVectorAdapter };
