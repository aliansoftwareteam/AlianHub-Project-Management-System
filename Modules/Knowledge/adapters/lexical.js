const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { escapeRegex } = require('../../../utils/escapeRegex');
const logger = require('../../../Config/loggerConfig');
const { SOURCE_COLLECTIONS } = require('../visibleSet');

// The lexical backend searches the source rows themselves through the tenant's
// full-text indexes, so there is nothing to upsert, tombstone or erase: a
// deleted row stops matching the moment it is deleted.

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

const toPassage = (sourceType, row, score, terms) => {
    const source = SOURCES[sourceType];
    const sourceId = String(row._id);
    return {
        id: `${sourceType}:${sourceId}`,
        sourceType,
        sourceId,
        projectId: source.projectId(row) ? String(source.projectId(row)) : '',
        title: clip(source.title(row), TITLE_LENGTH),
        excerpt: excerptOf(source.body(row), terms),
        score,
        authorKind: source.authorKind(row),
        updatedAt: row.updatedAt || row.createdAt || null,
    };
};

/* lean, because the text score is not a schema path: a hydrated document hides it. */
const find = (companyId, sourceType, where, withScore, options) => MongoDbCrudOpration(companyId, {
    type: SOURCE_COLLECTIONS[sourceType],
    data: [where, projectionOf(SOURCES[sourceType], withScore), options],
}, 'find');

const searchByRegex = async (companyId, sourceType, clause, query, limit) => {
    const terms = regexTerms(query);
    if (!terms.length) return [];
    const rows = await find(companyId, sourceType, regexQuery(sourceType, clause, query), false, { sort: { updatedAt: -1 }, limit, lean: true });
    return (rows || []).map((row) => toPassage(sourceType, row, regexScore(SOURCES[sourceType], row, terms), terms));
};

const isMissingTextIndex = (error) => Boolean(error) && (error.code === TEXT_INDEX_MISSING || /text index required/i.test(String(error.message || '')));

const searchSource = async (companyId, sourceType, clause, query, limit) => {
    const source = SOURCES[sourceType];
    if (!source.textIndex) return searchByRegex(companyId, sourceType, clause, query, limit);
    try {
        const rows = await find(companyId, sourceType, textQuery(clause, query), true, { sort: { score: { $meta: 'textScore' } }, limit, lean: true });
        return (rows || []).map((row) => toPassage(sourceType, row, Number(row.score) || 0, words(query)));
    } catch (error) {
        if (!isMissingTextIndex(error)) throw error;
        logger.warn(`knowledge lexical: ${companyId} has no ${sourceType} text index yet; searching by regular expression`);
        return searchByRegex(companyId, sourceType, clause, query, limit);
    }
};

const search = async ({ companyId, query, filter, limit }) => {
    if (!textSearch(query)) return [];
    const sourceTypes = (filter && filter.sourceTypes) || [];
    const results = await Promise.all(sourceTypes.filter((type) => SOURCES[type] && filter.clauses[type]).map(async (sourceType) => {
        try {
            return await searchSource(companyId, sourceType, filter.clauses[sourceType], query, limit);
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
    stats: async () => ({ backend: 'lexical', sources: Object.keys(SOURCES), indexedSeparately: false }),
    textSearch,
    regexTerms,
    textQuery,
    regexQuery,
};
