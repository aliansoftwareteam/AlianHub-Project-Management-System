const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { escapeRegex } = require('../../../utils/escapeRegex');
const logger = require('../../../Config/loggerConfig');
const { SOURCE_COLLECTIONS, SOURCE_TYPES } = require('../visibleSet');
const { INDEXED_SOURCES } = require('../sources');

// The lexical backend searches through the tenant's full-text indexes: the source rows
// themselves, or the chunk store for each source the filter says is built.
// The chunk store is written by Modules/Knowledge/ingest, so upsert, tombstone and erase
// stay no-ops here.

const MAX_TEXT_TERMS = 16;
const MAX_REGEX_TERMS = 8;
const MIN_REGEX_TERM = 3;
const EXCERPT_LENGTH = 300;
const TITLE_LENGTH = 160;
const TEXT_INDEX_MISSING = 27;

const SOURCES = {
    task: {
        textIndex: true,
        regexFields: ['TaskName', 'TaskKey', 'rawDescription'],
        fields: ['TaskName', 'TaskKey', 'rawDescription', 'ProjectID', 'updatedAt'],
        title: (row) => row.TaskName,
        body: (row) => row.rawDescription,
        projectId: (row) => row.ProjectID,
        authorKind: () => 'user',
    },
    page: {
        textIndex: true,
        regexFields: ['title', 'rawText'],
        fields: ['title', 'rawText', 'ProjectID', 'createdByAgent', 'updatedAt'],
        title: (row) => row.title,
        body: (row) => row.rawText,
        projectId: (row) => row.ProjectID,
        authorKind: (row) => (row.createdByAgent ? 'agent' : 'user'),
    },
    comment: {
        textIndex: true,
        regexFields: ['message'],
        fields: ['message', 'projectId', 'isAgent', 'actorType', 'updatedAt', 'createdAt'],
        title: (row) => row.message,
        body: (row) => row.message,
        projectId: (row) => row.projectId,
        authorKind: (row) => (row.isAgent || row.actorType === 'agent' ? 'agent' : 'user'),
    },
    transcript: {
        textIndex: false,
        regexFields: ['title', 'summary', 'transcript'],
        fields: ['title', 'summary', 'transcript', 'projectId', 'updatedAt', 'createdAt'],
        title: (row) => row.title || 'Call notes',
        body: (row) => [row.summary, row.transcript].filter(Boolean).join(' '),
        projectId: (row) => row.projectId,
        authorKind: () => 'user',
    },
};

const chunkSource = (sourceType) => ({
    sourceType,
    collection: SCHEMA_TYPE.KNOWLEDGE_CHUNKS,
    textIndex: true,
    regexFields: ['text'],
    fields: ['sourceId', 'title', 'text', 'projectId', 'authorKind', 'sourceUpdatedAt', 'updatedAt'],
    sourceId: (row) => row.sourceId,
    title: (row) => row.title,
    body: (row) => row.text,
    projectId: (row) => row.projectId,
    authorKind: (row) => (row.authorKind === 'agent' ? 'agent' : 'user'),
    updatedAt: (row) => row.sourceUpdatedAt || row.updatedAt || null,
    chunked: true,
});

INDEXED_SOURCES.forEach((sourceType) => { SOURCES[`${sourceType}Chunk`] = chunkSource(sourceType); });

const words = (query) => [...new Set(String(query == null ? '' : query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];

/* Only plain words reach $search: a quote there is a phrase match and a leading
 * hyphen negates, neither of which a question typed into Ask means. */
const textSearch = (query) => words(query).slice(0, MAX_TEXT_TERMS).join(' ');

const regexTerms = (query) => words(query).filter((w) => w.length >= MIN_REGEX_TERM).slice(0, MAX_REGEX_TERMS);

const clip = (value, n) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, n);

const excerptOf = (text, terms) => {
    const flat = clip(text, 100000);
    const lower = flat.toLowerCase();
    const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (at === undefined || at < EXCERPT_LENGTH / 3) return flat.slice(0, EXCERPT_LENGTH);
    const start = Math.max(0, at - Math.floor(EXCERPT_LENGTH / 3));
    return `…${flat.slice(start, start + EXCERPT_LENGTH)}`;
};

const projectionOf = (source, withScore) => {
    const projection = Object.fromEntries(source.fields.map((f) => [f, 1]));
    if (withScore) projection.score = { $meta: 'textScore' };
    return projection;
};

const textQuery = (clause, query) => ({ ...clause, $text: { $search: textSearch(query) } });

const regexQuery = (sourceType, clause, query) => {
    const rx = { $regex: regexTerms(query).map(escapeRegex).join('|'), $options: 'i' };
    return { ...clause, $and: [...(clause.$and || []), { $or: SOURCES[sourceType].regexFields.map((f) => ({ [f]: rx })) }] };
};

const regexScore = (source, row, terms) => {
    const haystack = source.regexFields.map((f) => String(row[f] || '')).join(' ').toLowerCase();
    return terms.filter((t) => haystack.includes(t)).length / terms.length;
};

const toPassage = (key, row, score, terms) => {
    const source = SOURCES[key];
    const sourceType = source.sourceType || key;
    const sourceId = String(source.sourceId ? source.sourceId(row) : row._id);
    return {
        id: `${sourceType}:${sourceId}`,
        sourceType,
        sourceId,
        projectId: source.projectId(row) ? String(source.projectId(row)) : '',
        title: clip(source.title(row), TITLE_LENGTH),
        excerpt: excerptOf(source.body(row), terms),
        score,
        authorKind: source.authorKind(row),
        updatedAt: source.updatedAt ? source.updatedAt(row) : (row.updatedAt || row.createdAt || null),
    };
};

/* lean, because the text score is not a schema path: a hydrated document hides it. */
const find = (companyId, key, where, withScore, options) => MongoDbCrudOpration(companyId, {
    type: SOURCES[key].collection || SOURCE_COLLECTIONS[key],
    data: [where, projectionOf(SOURCES[key], withScore), options],
}, 'find');

const searchByRegex = async (companyId, sourceType, clause, query, limit) => {
    const terms = regexTerms(query);
    if (!terms.length) return [];
    const rows = await find(companyId, sourceType, regexQuery(sourceType, clause, query), false, { sort: { updatedAt: -1 }, limit, lean: true });
    return (rows || []).map((row) => toPassage(sourceType, row, regexScore(SOURCES[sourceType], row, terms), terms));
};

const isMissingTextIndex = (error) => Boolean(error) && (error.code === TEXT_INDEX_MISSING || /text index required/i.test(String(error.message || '')));

const searchRows = async (companyId, key, clause, query, limit) => {
    const source = SOURCES[key];
    if (!source.textIndex) return searchByRegex(companyId, key, clause, query, limit);
    try {
        const rows = await find(companyId, key, textQuery(clause, query), true, { sort: { score: { $meta: 'textScore' } }, limit, lean: true });
        return (rows || []).map((row) => toPassage(key, row, Number(row.score) || 0, words(query)));
    } catch (error) {
        if (!isMissingTextIndex(error)) throw error;
        logger.warn(`knowledge lexical: ${companyId} has no ${key} text index yet; searching by regular expression`);
        return searchByRegex(companyId, key, clause, query, limit);
    }
};

/* One row per source, from its best chunk, grouped before the limit: a long page or call has
 * hundreds of chunks, and limiting chunks first would let one of them fill every slot. */
const bestChunkPerSource = (source, match, withScore, limit) => {
    const order = withScore ? { score: -1, ordinal: 1 } : { sourceUpdatedAt: -1, ordinal: 1 };
    return [
        { $match: match },
        { $project: { ...projectionOf(source, withScore), ordinal: 1 } },
        { $sort: order },
        { $group: { _id: '$sourceId', chunk: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$chunk' } },
        { $sort: withScore ? { score: -1, sourceId: 1 } : { sourceUpdatedAt: -1, sourceId: 1 } },
        { $limit: limit },
    ];
};

const searchChunks = async (companyId, key, clause, query, limit) => {
    const source = SOURCES[key];
    const aggregate = (match, withScore) => MongoDbCrudOpration(companyId, { type: source.collection, data: [bestChunkPerSource(source, match, withScore, limit)] }, 'aggregate');
    try {
        const rows = await aggregate(textQuery(clause, query), true);
        return (rows || []).map((row) => toPassage(key, row, Number(row.score) || 0, words(query)));
    } catch (error) {
        if (!isMissingTextIndex(error)) throw error;
        logger.warn(`knowledge lexical: ${companyId} has no ${key} text index yet; searching by regular expression`);
        const terms = regexTerms(query);
        if (!terms.length) return [];
        const rows = await aggregate(regexQuery(key, clause, query), false);
        return (rows || []).map((row) => toPassage(key, row, regexScore(source, row, terms), terms));
    }
};

const searchSource = (companyId, key, clause, query, limit) => (SOURCES[key].chunked
    ? searchChunks(companyId, key, clause, query, limit)
    : searchRows(companyId, key, clause, query, limit));

const sourceKeyFor = (sourceType, filter) => ((filter.chunkSources || []).includes(sourceType) ? `${sourceType}Chunk` : sourceType);

const search = async ({ companyId, query, filter, limit }) => {
    if (!textSearch(query)) return [];
    const sourceTypes = (filter && filter.sourceTypes) || [];
    const results = await Promise.all(sourceTypes.filter((type) => SOURCES[type] && filter.clauses[type]).map(async (sourceType) => {
        try {
            return await searchSource(companyId, sourceKeyFor(sourceType, filter), filter.clauses[sourceType], query, limit);
        } catch (error) {
            logger.error(`knowledge lexical: ${sourceType} search failed for ${companyId}: ${error.message}`);
            return [];
        }
    }));
    return results.flat();
};

const NOTHING_TO_INDEX = Object.freeze({ backend: 'lexical', skipped: true });

module.exports = {
    name: 'lexical',
    search,
    upsert: async () => NOTHING_TO_INDEX,
    tombstone: async () => NOTHING_TO_INDEX,
    erase: async () => NOTHING_TO_INDEX,
    stats: async () => ({ backend: 'lexical', sources: SOURCE_TYPES, indexedSeparately: false }),
    textSearch,
    regexTerms,
    textQuery,
    regexQuery,
};
