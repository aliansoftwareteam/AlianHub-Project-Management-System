const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { escapeRegex } = require('../../../utils/escapeRegex');
const logger = require('../../../Config/loggerConfig');
const agentMemory = require('../../Agents/memory');
const lexical = require('../adapters/lexical');
const memoryFlag = require('./flag');
const backfill = require('./backfill');
const { SOURCE_TYPE, TITLE } = require('./indexer');

// The memory side of a retrieval. Only an agent's own run reads its notes: a person asking, an MCP
// token and every other agent get nothing from here. A note is admitted when every project it was
// formed in is in the run's visible set; a note formed outside any project only by a run of the
// person who started the note's run. The chunk search narrows by agent; recheck() reads the live
// note and decides, as the other sources' recheck does.

const EXCERPT_LENGTH = 300;
const TEXT_INDEX_MISSING = 27;
const FIELDS = { sourceId: 1, text: 1, agentId: 1, projectIds: 1, startedBy: 1, tainted: 1, authorKind: 1, sourceUpdatedAt: 1, updatedAt: 1 };
const ORIGIN = Object.freeze({ AGENT: 'agent', EXTERNAL: 'external' });
const PERMISSION = Object.freeze({ visibility: 'agent', via: 'agent' });

const clip = (value, n) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, n);

const admissible = (set, { projectIds, startedBy }) => {
    const projects = (projectIds || []).map(String);
    if (!projects.length) return String(startedBy || '') === set.caller.userId;
    return projects.every((id) => set.projectIds.includes(id));
};

const wants = (scope) => !(scope && Array.isArray(scope.sourceTypes)) || scope.sourceTypes.includes(SOURCE_TYPE);

/* The chunk clause for this run, or null when memory is not read for it. */
const sideFor = async (set, scope) => {
    if (set.caller.kind !== 'agent' || !set.caller.agentId || !wants(scope)) return null;
    if (!(await memoryFlag.enabledFor(set.companyId))) return null;
    if (!(await backfill.ready(set.companyId))) return null;
    backfill.keepAlive(set.companyId).catch((error) => logger.error(`[knowledge-memory] heartbeat for ${set.companyId}: ${error.message}`));
    return { clause: { companyId: set.companyId, sourceType: SOURCE_TYPE, deleted: { $ne: true }, agentId: String(set.caller.agentId) } };
};

/* For the vector side, which searches whatever the filter names. */
const withMemory = (filter, side) => (side ? {
    ...filter,
    sourceTypes: [...filter.sourceTypes, SOURCE_TYPE],
    chunkSources: [...(filter.chunkSources || []), SOURCE_TYPE],
    clauses: { ...filter.clauses, [SOURCE_TYPE]: side.clause },
} : filter);

const toPassage = (row, score) => ({
    id: `${SOURCE_TYPE}:${row.sourceId}`,
    sourceType: SOURCE_TYPE,
    sourceId: String(row.sourceId),
    projectId: '',
    title: TITLE,
    excerpt: clip(row.text, EXCERPT_LENGTH),
    score,
    authorKind: 'agent',
    origin: row.tainted === true ? ORIGIN.EXTERNAL : ORIGIN.AGENT,
    updatedAt: row.sourceUpdatedAt || row.updatedAt || null,
});

const aggregate = (companyId, match, withScore, limit) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS,
    data: [[
        { $match: match },
        { $project: { ...FIELDS, ...(withScore ? { score: { $meta: 'textScore' } } : {}) } },
        { $sort: withScore ? { score: -1, sourceId: 1 } : { sourceUpdatedAt: -1, sourceId: 1 } },
        { $limit: limit },
    ]],
}, 'aggregate');

const isMissingTextIndex = (error) => Boolean(error) && (error.code === TEXT_INDEX_MISSING || /text index required/i.test(String(error.message || '')));

const search = async ({ set, side, query, limit }) => {
    if (!side || !lexical.textSearch(query)) return [];
    try {
        let rows;
        let scored = true;
        try {
            rows = await aggregate(set.companyId, lexical.textQuery(side.clause, query), true, limit);
        } catch (error) {
            if (!isMissingTextIndex(error)) throw error;
            const terms = lexical.regexTerms(query);
            if (!terms.length) return [];
            scored = false;
            rows = await aggregate(set.companyId, { ...side.clause, text: { $regex: terms.map(escapeRegex).join('|'), $options: 'i' } }, false, limit);
        }
        return (rows || [])
            .filter((row) => admissible(set, row))
            .map((row) => toPassage(row, scored ? Number(row.score) || 0 : 1));
    } catch (error) {
        logger.error(`knowledge memory: search failed for ${set.companyId}: ${error.message}`);
        return [];
    }
};

/* The live note decides: its agent, its status, its projects against the set, and its taint. */
const recheck = async ({ set, passages }) => {
    if (set.caller.kind !== 'agent' || !set.caller.agentId || !passages.length) return [];
    const notes = await agentMemory.listAgentNotes({ companyId: set.companyId, agentId: set.caller.agentId });
    const live = new Map(notes.map((note) => [note.memoryId, note]));
    return passages.flatMap((p) => {
        const note = live.get(String(p.sourceId));
        if (!note || note.agentId !== String(set.caller.agentId) || note.status !== agentMemory.STATUS.ACTIVE) return [];
        if (!admissible(set, { projectIds: note.projectIds, startedBy: note.source && note.source.userId })) return [];
        return [{
            ...p,
            title: TITLE,
            excerpt: clip(note.text, EXCERPT_LENGTH),
            authorKind: 'agent',
            origin: note.tainted ? ORIGIN.EXTERNAL : ORIGIN.AGENT,
            updatedAt: note.updatedAt || p.updatedAt,
            permission: PERMISSION,
        }];
    });
};

module.exports = { ORIGIN, PERMISSION, admissible, sideFor, withMemory, search, recheck };
