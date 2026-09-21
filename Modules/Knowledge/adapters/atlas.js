const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const embeddings = require('../embeddings');
const { searchWith, createDatabaseVectorAdapter } = require('./vector');

// The vector store for hosted deployments: MongoDB Atlas Vector Search over the chunk rows in each
// tenant's own database (owner, 2026-09-18). The vector stays on the chunk, so there is one write
// path: a chunk written, tombstoned or deleted is what the index sees, and an erasure that deletes
// the rows takes the vectors with it. $vectorSearch returns the live documents, so the access
// clause is applied to them again after the pre-filter, and retrieval's recheck() reads the source
// rows after that: the pre-filter only narrows what Atlas ranks.

const NAME = 'vector-atlas';
const INDEX_NAME = 'knowledge_chunks_vector';
const VECTOR_PATH = 'embedding';
/* Every chunk field an access clause reads, so the pre-filter can narrow by it. */
const FILTER_PATHS = ['companyId', 'sourceType', 'deleted', 'embeddingModel', 'projectId', 'sprintId', 'participants', 'visibility', 'createdBy', 'agentId', 'scope'];
const MODEL_DIMENSIONS = { 'text-embedding-3-small': 1536, 'text-embedding-3-large': 3072, 'text-embedding-ada-002': 1536 };
const DEFAULT_LIMIT = 100;
const DEFAULT_NUM_CANDIDATES = 1000;
/* Atlas advises ten to twenty candidates per result for good recall. */
const DEFAULT_CANDIDATE_RATIO = 10;
const DEFAULT_THIN_RESULTS = 3;
const DEFAULT_INDEX_TIMEOUT_MS = 5000;
/* Atlas refuses a numCandidates above this. */
const MAX_NUM_CANDIDATES = 10000;
const DEFAULT_MAX_TIME_MS = 3000;
const STATUS_TTL_MS = 60 * 1000;
const BREAKER_FAILURES = 5;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
const INDEX_EXISTS = 68;
const NAMESPACE_EXISTS = 48;
const MAX_TIME_EXPIRED = 50;
const TIMED_OUT = 'index_check_timed_out';
/* The candidate vectors stay on the server: Atlas returns its own score. */
const CANDIDATE_FIELDS = { sourceId: 1, ordinal: 1, title: 1, text: 1, projectId: 1, taskId: 1, authorKind: 1, origin: 1, contentHash: 1, sourceUpdatedAt: 1, updatedAt: 1, score: 1 };

const STATUS = Object.freeze({
    MISSING: 'missing', BUILDING: 'building', READY: 'ready', FAILED: 'failed', UNSUPPORTED: 'unsupported', UNREACHABLE: 'unreachable',
    MISMATCH: 'mismatch', TIMEOUT: 'timeout', UNKNOWN: 'unknown',
});

/* What the console is told about a state; never the server's error text. */
const REASON = {
    [STATUS.MISSING]: 'index_missing',
    [STATUS.BUILDING]: 'index_building',
    [STATUS.READY]: '',
    [STATUS.FAILED]: 'index_failed',
    [STATUS.UNSUPPORTED]: 'unsupported',
    [STATUS.UNREACHABLE]: 'unreachable',
    [STATUS.MISMATCH]: 'mismatch',
    [STATUS.TIMEOUT]: 'timeout',
    [STATUS.UNKNOWN]: 'check_failed',
};

const CHECK_STATUS = { unsupported: STATUS.UNSUPPORTED, unreachable: STATUS.UNREACHABLE, timeout: STATUS.TIMEOUT };

/* What a plain MongoDB server answers to $vectorSearch and the search-index commands. */
const UNSUPPORTED_CODES = [6047401, 40324, 59, 31082, 115];
const UNSUPPORTED_MESSAGE = /only allowed on MongoDB Atlas|Unrecognized pipeline stage name|no such command|requires additional configuration|SearchNotEnabled/i;
const UNREACHABLE_NAMES = /MongoNetwork|MongoServerSelection|MongoNotConnected|PoolCleared|MongoTopologyClosed/;
const UNREACHABLE_MESSAGE = /mongot|search index management|error connecting to search/i;

const FALLBACK = {
    [STATUS.MISSING]: 'vector index missing',
    [STATUS.BUILDING]: 'vector index building',
    [STATUS.FAILED]: 'vector index failed',
    [STATUS.UNSUPPORTED]: 'vector store unsupported',
    [STATUS.UNREACHABLE]: 'vector store unreachable',
    [STATUS.MISMATCH]: 'vector index mismatch',
    [STATUS.UNKNOWN]: 'vector failed',
    [STATUS.TIMEOUT]: 'vector store timed out',
    checking: 'vector index checking',
    error: 'vector failed',
    paused: 'vector store paused',
};

const positiveInt = (raw, fallback) => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const candidatesFor = (limit) => Math.min(Math.max(
    positiveInt(process.env.KNOWLEDGE_ATLAS_NUM_CANDIDATES, DEFAULT_NUM_CANDIDATES),
    limit * positiveInt(process.env.KNOWLEDGE_ATLAS_CANDIDATE_RATIO, DEFAULT_CANDIDATE_RATIO),
), MAX_NUM_CANDIDATES);

const searchTuning = () => {
    const limit = Math.min(positiveInt(process.env.KNOWLEDGE_ATLAS_VECTOR_LIMIT, DEFAULT_LIMIT), MAX_NUM_CANDIDATES);
    return { numCandidates: candidatesFor(limit), limit };
};

/* A source has many chunks, so a question never asks for fewer chunks than passages. */
const tuningFor = (wanted) => {
    const limit = Math.min(Math.max(searchTuning().limit, positiveInt(wanted, 1)), MAX_NUM_CANDIDATES);
    return { limit, numCandidates: candidatesFor(limit) };
};

const thinResults = () => positiveInt(process.env.KNOWLEDGE_ATLAS_THIN_RESULTS, DEFAULT_THIN_RESULTS);

const indexTimeoutMs = () => positiveInt(process.env.KNOWLEDGE_ATLAS_INDEX_TIMEOUT_MS, DEFAULT_INDEX_TIMEOUT_MS);

/* The search-index commands take no maxTimeMS through Mongoose, so each is raced with a timer; a
 * late answer or failure of the losing call is dropped. */
const within = (work, ms, what) => {
    let timer;
    Promise.resolve(work).catch(() => {});
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${what} took longer than ${ms} ms`), { code: TIMED_OUT })), ms);
        if (timer.unref) timer.unref();
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

/* Atlas scores cosine similarity as (1 + cos) / 2; retrieval fuses on the cosine itself. */
const cosineOf = (row) => 2 * (Number(row.score) || 0) - 1;

const maxTimeMs = () => positiveInt(process.env.KNOWLEDGE_ATLAS_MAX_TIME_MS, DEFAULT_MAX_TIME_MS);

const indexDefinition = (dimensions) => ({
    fields: [
        { type: 'vector', path: VECTOR_PATH, numDimensions: dimensions, similarity: 'cosine' },
        ...FILTER_PATHS.map((path) => ({ type: 'filter', path })),
    ],
});

const isObjectId = (value) => Boolean(value) && typeof value === 'object' && typeof value.toHexString === 'function';
const filterable = (value) => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value instanceof Date || isObjectId(value);
const isOperator = (cond) => cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date) && !isObjectId(cond)
    && Object.keys(cond).some((key) => key.startsWith('$'));

/* The pre-filter keeps what Atlas can evaluate and drops the rest. Dropping a condition only
 * widens it (a branch of an $or that cannot be expressed drops the whole $or), so the pre-filter
 * never keeps out a chunk the access clause admits; the clause itself runs after it. Null is
 * dropped too, since a projectless page or call is matched by the clause, not by the index, and
 * so is an empty $in, which Atlas refuses. */
const fieldParts = (key, cond) => {
    if (!FILTER_PATHS.includes(key)) return [];
    if (!isOperator(cond)) return filterable(cond) ? [{ [key]: { $eq: cond } }] : [];
    return Object.entries(cond).flatMap(([op, arg]) => {
        if ((op === '$eq' || op === '$ne') && filterable(arg)) return [{ [key]: { [op]: arg } }];
        if (op === '$in' && Array.isArray(arg) && arg.length && arg.every(filterable)) return [{ [key]: { $in: arg } }];
        if (op === '$nin' && Array.isArray(arg)) {
            const kept = arg.filter(filterable);
            return kept.length ? [{ [key]: { $nin: kept } }] : [];
        }
        return [];
    });
};

const joined = (parts) => (parts.length === 1 ? parts[0] : { $and: parts });

const partsOf = (clause) => Object.entries(clause || {}).flatMap(([key, cond]) => {
    if (key === '$and') return (cond || []).flatMap(partsOf);
    if (key === '$or') {
        const branches = (cond || []).map(partsOf);
        return branches.length && branches.every((parts) => parts.length) ? [{ $or: branches.map(joined) }] : [];
    }
    if (key.startsWith('$')) return [];
    return fieldParts(key, cond);
});

const prefilterOf = (clause) => {
    const parts = partsOf(clause);
    return parts.length ? joined(parts) : null;
};

const statusOf = (index) => {
    if (!index) return STATUS.MISSING;
    const status = String(index.status || '').toUpperCase();
    if (status === 'READY') return STATUS.READY;
    if (status === 'FAILED') return STATUS.FAILED;
    if (status === 'STALE') return index.queryable ? STATUS.READY : STATUS.BUILDING;
    if (status === 'DOES_NOT_EXIST' || status === 'DELETING') return STATUS.MISSING;
    return STATUS.BUILDING;
};

const definitionOf = (index) => (index && (index.latestDefinition || index.definition)) || { fields: [] };
const vectorFieldOf = (index) => (definitionOf(index).fields || []).find((field) => field.type === 'vector') || null;
const dimensionsOf = (index) => (vectorFieldOf(index) ? Number(vectorFieldOf(index).numDimensions) || null : null);

const sameDefinition = (index, wanted) => {
    const vector = vectorFieldOf(index);
    const filters = new Set((definitionOf(index).fields || []).filter((field) => field.type === 'filter').map((field) => field.path));
    const wantedVector = wanted.fields[0];
    return Boolean(vector) && vector.path === wantedVector.path && Number(vector.numDimensions) === wantedVector.numDimensions
        && vector.similarity === wantedVector.similarity && FILTER_PATHS.every((path) => filters.has(path));
};

const chainOf = (error) => {
    const chain = [];
    for (let at = error; at && chain.length < 5; at = at.cause) chain.push(at);
    return chain;
};

const kindOf = (error) => {
    const chain = chainOf(error);
    if (chain.some((e) => UNSUPPORTED_CODES.includes(Number(e.code)) || UNSUPPORTED_MESSAGE.test(String(e.message || '')))) return STATUS.UNSUPPORTED;
    if (chain.some((e) => e.code === TIMED_OUT || Number(e.code) === MAX_TIME_EXPIRED || e.codeName === 'MaxTimeMSExpired')) return 'timeout';
    if (chain.some((e) => UNREACHABLE_NAMES.test(String(e.name || '')) || UNREACHABLE_MESSAGE.test(String(e.message || '')) || (e.status === false && e.statusText))) return STATUS.UNREACHABLE;
    return 'error';
};

const messageOf = (error) => String((error && (error.message || error.statusText)) || error);

const fallbackError = (message, reason, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { fallback: reason });

const createAtlasVectorAdapter = ({ crud = MongoDbCrudOpration, now = Date.now } = {}) => {
    const chunks = (companyId, data, method) => crud(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data }, method);
    const counts = createDatabaseVectorAdapter({ crud });
    const states = new Map();
    const building = new Map();
    const refreshing = new Map();
    const breakers = new Map();

    const remember = (companyId, state) => {
        const kept = {
            status: state.status,
            dimensions: state.dimensions || null,
            reason: state.reason !== undefined ? state.reason : REASON[state.status] || '',
            checkedAt: now(),
        };
        states.set(companyId, kept);
        return kept;
    };

    const breakerOf = (companyId) => {
        const breaker = breakers.get(companyId) || { failures: 0, until: 0, reason: null };
        const open = breaker.until > now();
        return { open, reason: open ? breaker.reason : null, until: open ? new Date(breaker.until) : null, failures: breaker.failures };
    };

    /* Unsupported opens the breaker at once: a server without Atlas Search will not gain it in a
     * minute. Anything else opens it after a run of failures. Logged once per opening. */
    const failed = (companyId, kind, error) => {
        const breaker = breakers.get(companyId) || { failures: 0, until: 0, reason: null };
        breaker.failures += 1;
        if (kind === STATUS.UNSUPPORTED || breaker.failures >= BREAKER_FAILURES) {
            breaker.until = now() + BREAKER_COOLDOWN_MS;
            breaker.reason = kind;
            breaker.failures = 0;
            logger.warn(`knowledge atlas: vector search paused for ${companyId} for ${Math.round(BREAKER_COOLDOWN_MS / 1000)}s (${kind}): ${messageOf(error)}`);
        }
        breakers.set(companyId, breaker);
    };

    const succeeded = (companyId) => { breakers.delete(companyId); };

    /* The configured size must agree with a stored vector of the model, or with the model's own
     * size when nothing is stored yet: an index of the wrong size answers nothing. */
    const dimensionsFor = async (companyId, model) => {
        const ms = indexTimeoutMs();
        const sample = await within(chunks(companyId, [{ embeddingModel: model, 'embedding.0': { $exists: true } }, { embedding: 1 }, { lean: true, maxTimeMS: ms }], 'findOne'), ms, 'reading a stored vector');
        const stored = sample && Array.isArray(sample.embedding) ? sample.embedding.length : 0;
        const known = MODEL_DIMENSIONS[model] || 0;
        const configured = positiveInt(process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS, 0);
        if (!configured) return { dimensions: stored || known };
        const expected = stored || known;
        return expected && expected !== configured ? { mismatch: true, configured, expected } : { dimensions: configured };
    };

    const listed = async (companyId) => {
        const indexes = await within(chunks(companyId, [INDEX_NAME], 'listSearchIndexes'), indexTimeoutMs(), 'listing search indexes');
        return (indexes || []).find((index) => index && index.name === INDEX_NAME) || null;
    };

    const ensureCollection = async (companyId) => {
        try {
            await within(chunks(companyId, [], 'createCollection'), indexTimeoutMs(), 'creating the chunk collection');
        } catch (error) {
            if (Number(error && error.code) !== NAMESPACE_EXISTS) throw error;
        }
    };

    const create = async (companyId, definition) => {
        await ensureCollection(companyId);
        try {
            await within(chunks(companyId, [{ name: INDEX_NAME, type: 'vectorSearch', definition }], 'createSearchIndex'), indexTimeoutMs(), 'creating the search index');
        } catch (error) {
            if (Number(error && error.code) !== INDEX_EXISTS && !/already exists/i.test(messageOf(error))) throw error;
        }
    };

    const check = async (companyId, { build }) => {
        try {
            const existing = await listed(companyId);
            if (!build) return remember(companyId, { status: statusOf(existing), dimensions: dimensionsOf(existing) });
            const size = await dimensionsFor(companyId, embeddings.model());
            if (size.mismatch) {
                logger.warn(`knowledge atlas: KNOWLEDGE_EMBEDDING_DIMENSIONS is ${size.configured} but ${embeddings.model()} vectors have ${size.expected}; ${companyId} keeps answering from the lexical side`);
                return remember(companyId, { status: STATUS.MISMATCH, dimensions: dimensionsOf(existing) });
            }
            if (!size.dimensions) {
                return remember(companyId, existing
                    ? { status: statusOf(existing), dimensions: dimensionsOf(existing) }
                    : { status: STATUS.MISSING, reason: 'dimensions_unknown' });
            }
            const definition = indexDefinition(size.dimensions);
            if (!existing) {
                await create(companyId, definition);
                const created = await listed(companyId);
                return remember(companyId, { status: created ? statusOf(created) : STATUS.BUILDING, dimensions: size.dimensions });
            }
            if (!sameDefinition(existing, definition)) {
                await within(chunks(companyId, [INDEX_NAME, definition], 'updateSearchIndex'), indexTimeoutMs(), 'updating the search index');
                return remember(companyId, { status: STATUS.BUILDING, dimensions: size.dimensions });
            }
            return remember(companyId, { status: statusOf(existing), dimensions: size.dimensions });
        } catch (error) {
            const kind = kindOf(error);
            logger.error(`knowledge atlas: index check for ${companyId} failed (${kind}): ${messageOf(error)}`);
            return remember(companyId, { status: CHECK_STATUS[kind] || STATUS.UNKNOWN });
        }
    };

    const once = (running, companyId, run) => {
        if (!running.has(companyId)) running.set(companyId, run().finally(() => running.delete(companyId)));
        return running.get(companyId);
    };

    const refresh = (companyId) => once(refreshing, companyId, () => check(companyId, { build: false }));

    const candidatesFor = (tally) => async (companyId, sourceType, model, clause, { vector, wanted }) => {
        const { numCandidates, limit } = tuningFor(wanted);
        const filter = prefilterOf({ ...clause, embeddingModel: model });
        const [result] = (await chunks(companyId, [[
            { $vectorSearch: { index: INDEX_NAME, path: VECTOR_PATH, queryVector: vector, numCandidates, limit, ...(filter ? { filter } : {}) } },
            { $addFields: { score: { $meta: 'vectorSearchScore' } } },
            {
                $facet: {
                    seen: [{ $count: 'n' }],
                    kept: [
                        { $match: { ...clause, embeddingModel: model } },
                        { $project: CANDIDATE_FIELDS },
                        { $sort: { score: -1, ordinal: 1 } },
                        { $group: { _id: '$sourceId', chunk: { $first: '$$ROOT' } } },
                        { $replaceRoot: { newRoot: '$chunk' } },
                        { $sort: { score: -1, sourceId: 1 } },
                        { $limit: wanted },
                    ],
                },
            },
        ], { maxTimeMS: maxTimeMs() }], 'aggregate')) || [];
        const seen = Number(((result && result.seen) || [])[0] && result.seen[0].n) || 0;
        if (seen >= limit) tally.filled = true;
        return (result && result.kept) || [];
    };

    const adapter = {
        name: NAME,
        tracksSources: false,

        /* Creates the tenant's index or checks it, and never throws. One check per tenant at a time. */
        prepare({ companyId }) {
            const company = String(companyId);
            return once(building, company, () => check(company, { build: true })).then((state) => ({ name: INDEX_NAME, ...state }));
        },

        /* A question reads the state as last checked and never waits on a check: an unknown tenant
         * is checked in the background and answered from the lexical side meanwhile. */
        async search(args) {
            const { companyId, queryEmbedding, model, limit } = args;
            if (!Array.isArray(queryEmbedding) || !queryEmbedding.length || !model) return [];
            const company = String(companyId);
            if (breakerOf(company).open) throw fallbackError(`vector search is paused for ${company}`, FALLBACK.paused);
            const state = states.get(company);
            if (!state) {
                adapter.prepare({ companyId: company });
                throw fallbackError(`vector index for ${company} is being checked`, FALLBACK.checking);
            }
            if (now() - state.checkedAt > STATUS_TTL_MS) refresh(company);
            if (state.status === STATUS.MISSING) adapter.prepare({ companyId: company });
            if (state.status !== STATUS.READY) {
                if (state.status === STATUS.UNSUPPORTED || state.status === STATUS.UNREACHABLE) failed(company, state.status, state.reason);
                throw fallbackError(`vector index for ${company} is ${state.status}`, FALLBACK[state.status] || FALLBACK.error);
            }
            const tally = { filled: false };
            try {
                const passages = await searchWith(candidatesFor(tally), { scoreOf: cosineOf })(args);
                succeeded(company);
                if (tally.filled && passages.length < Math.min(thinResults(), positiveInt(limit, 1))) passages.degraded = 'thin';
                return passages;
            } catch (error) {
                const kind = kindOf(error);
                failed(company, kind, error);
                /* An unreachable store is left to the breaker, so the first question after its cooldown
                 * tries again; a server without Atlas Search stays unsupported until a check says not. */
                if (kind === STATUS.UNSUPPORTED) remember(company, { status: kind });
                throw fallbackError(messageOf(error), FALLBACK[kind] || FALLBACK.error, error);
            }
        },

        /* The vector was written with the chunk; a tenant seen for the first time gets its index. */
        async upsert({ companyId, chunks: written }) {
            const company = String(companyId);
            const state = states.get(company);
            if (!state || state.status === STATUS.MISSING) adapter.prepare({ companyId: company });
            return { backend: NAME, upserted: (written || []).length };
        },

        /* The tombstone is the chunk's own `deleted`, which the pre-filter and the post-check read
         * from the same document; there is nothing else to mark. */
        async tombstone() {
            return { backend: NAME, tombstoned: 0 };
        },

        /* Deletes exactly the sources named, whatever the caller already removed: the vectors live
         * on these rows, so this is what takes them out of the index. */
        async erase({ companyId, sources }) {
            const bySourceType = new Map();
            (sources || []).forEach(({ sourceType, sourceId }) => {
                if (!sourceType || sourceId === undefined || sourceId === null || sourceId === '') return;
                bySourceType.set(sourceType, [...(bySourceType.get(sourceType) || []), String(sourceId)]);
            });
            if (!bySourceType.size) return { backend: NAME, erased: 0 };
            const where = { $or: [...bySourceType.entries()].map(([sourceType, ids]) => ({ sourceType, sourceId: { $in: ids } })) };
            const result = await chunks(companyId, [where], 'deleteMany');
            return { backend: NAME, erased: (result && result.deletedCount) || 0 };
        },

        /* The console gets codes; the server's own error text stays in the log. */
        async health({ companyId, refresh: reread = false }) {
            const company = String(companyId);
            const state = reread || !states.has(company) ? await refresh(company) : states.get(company);
            return {
                backend: 'atlas',
                index: { name: INDEX_NAME, status: state.status, dimensions: state.dimensions, reason: state.reason, checkedAt: new Date(state.checkedAt) },
                breaker: breakerOf(company),
            };
        },

        async stats({ companyId }) {
            const { embedded, unembedded } = await counts.stats({ companyId });
            const { index, breaker } = await adapter.health({ companyId });
            return { backend: NAME, embedded, unembedded, index, breaker };
        },
    };
    return adapter;
};

module.exports = {
    NAME,
    INDEX_NAME,
    VECTOR_PATH,
    FILTER_PATHS,
    MODEL_DIMENSIONS,
    STATUS,
    DEFAULT_LIMIT,
    DEFAULT_NUM_CANDIDATES,
    DEFAULT_CANDIDATE_RATIO,
    DEFAULT_THIN_RESULTS,
    MAX_NUM_CANDIDATES,
    BREAKER_FAILURES,
    BREAKER_COOLDOWN_MS,
    STATUS_TTL_MS,
    indexDefinition,
    prefilterOf,
    searchTuning,
    kindOf,
    createAtlasVectorAdapter,
};
