const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { chunkPage } = require('./chunker');

// Writes page chunks into the store. Callers check KNOWLEDGE_INDEXER first; nothing here
// reads the flag, so the backfill and the event handlers share one write path.

const SOURCE = 'page';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DUPLICATE_KEY = 11000;
const TRASHED = 1;
const PAGE_FIELDS = 'title content visibility createdBy ProjectID createdByAgent deletedStatusKey updatedAt createdAt';
const EXISTING_FIELDS = 'ordinal contentHash deleted companyId projectId visibility createdBy authorKind';
const COMPARED_FIELDS = ['companyId', 'projectId', 'visibility', 'createdBy', 'authorKind'];

const chunkStore = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data }, method);

const asText = (value) => (value === undefined || value === null ? '' : String(value));

const notNewerThan = (at) => ({ $or: [{ sourceUpdatedAt: { $lte: at } }, { sourceUpdatedAt: null }] });

const isDuplicateKey = (error) => Boolean(error) && (error.code === DUPLICATE_KEY || /E11000/.test(asText(error.message)));

const metadataOf = (companyId, page) => ({
    companyId: String(companyId),
    sourceType: SOURCE,
    sourceId: String(page._id),
    projectId: page.ProjectID || null,
    visibility: asText(page.visibility) || 'project',
    createdBy: asText(page.createdBy),
    authorKind: page.createdByAgent ? 'agent' : 'human',
    title: asText(page.title),
});

const unchanged = (existing, row) => Boolean(existing)
    && existing.deleted !== true
    && existing.contentHash === row.contentHash
    && COMPARED_FIELDS.every((field) => asText(existing[field]) === asText(row[field]));

/* Conditional on the stored version being no newer: when it is, the filter misses, the
 * upsert collides with the unique source key, and the older read is dropped. */
const upsertChunk = async (companyId, row) => {
    try {
        await chunkStore(companyId, [
            { sourceType: row.sourceType, sourceId: row.sourceId, ordinal: row.ordinal, ...notNewerThan(row.sourceUpdatedAt) },
            { $set: row },
            { upsert: true },
        ], 'updateOne');
        return true;
    } catch (error) {
        if (isDuplicateKey(error)) return false;
        throw error;
    }
};

const tombstone = async (companyId, where, set = {}) => {
    const result = await chunkStore(companyId, [{ ...where, deleted: { $ne: true } }, { $set: { deleted: true, deletedAt: new Date(), ...set } }], 'updateMany');
    return (result && result.modifiedCount) || 0;
};

const tombstonePages = async (companyId, pageIds, { sourceUpdatedAt } = {}) => {
    const ids = [...new Set((pageIds || []).map(asText).filter(Boolean))];
    if (!ids.length) return 0;
    return tombstone(companyId, { sourceType: SOURCE, sourceId: { $in: ids } }, sourceUpdatedAt ? { sourceUpdatedAt } : {});
};

const tombstoneProject = async (companyId, projectId) => {
    if (!OBJECT_ID.test(asText(projectId))) return 0;
    return tombstone(companyId, { projectId: String(projectId) });
};

const removeDepartedMember = async (companyId, userId) => {
    if (!OBJECT_ID.test(asText(userId))) return 0;
    return tombstone(companyId, { sourceType: SOURCE, createdBy: String(userId), visibility: 'private' });
};

const inTrashedProject = async (companyId, page, trashedProjectIds) => {
    if (!page.ProjectID) return false;
    if (trashedProjectIds) return trashedProjectIds.has(String(page.ProjectID));
    const project = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(String(page.ProjectID)), deletedStatusKey: TRASHED }, '_id'],
    }, 'findOne');
    return Boolean(project);
};

/* activeAuthors is passed only by the backfill: an event for a private page comes from its
 * author, who is by then still a member. */
const leftOut = async (companyId, page, { trashedProjectIds, activeAuthors } = {}) => Number(page.deletedStatusKey) === 1
    || (activeAuthors && asText(page.visibility) === 'private' && !activeAuthors.has(asText(page.createdBy)))
    || inTrashedProject(companyId, page, trashedProjectIds);

const ingestPage = async (companyId, page, context = {}) => {
    const result = { written: 0, unchanged: 0, tombstoned: 0, stale: 0, leftOut: false };
    if (!page || !page._id) return result;
    const sourceUpdatedAt = new Date(page.updatedAt || page.createdAt || 0);

    if (await leftOut(companyId, page, context)) {
        result.leftOut = true;
        result.tombstoned = await tombstonePages(companyId, [page._id], { sourceUpdatedAt });
        return result;
    }

    const metadata = metadataOf(companyId, page);
    const pieces = chunkPage(page);
    const existing = await chunkStore(companyId, [{ sourceType: SOURCE, sourceId: metadata.sourceId }, EXISTING_FIELDS, { lean: true }], 'find');
    const byOrdinal = new Map((existing || []).map((row) => [Number(row.ordinal), row]));

    for (const piece of pieces) {
        const row = { ...metadata, ...piece, embeddingModel: null, deleted: false, deletedAt: null, sourceUpdatedAt };
        if (unchanged(byOrdinal.get(piece.ordinal), row)) {
            result.unchanged += 1;
        } else if (await upsertChunk(companyId, row)) {
            result.written += 1;
        } else {
            result.stale += 1;
        }
    }

    const hasTrailing = [...byOrdinal.values()].some((row) => Number(row.ordinal) >= pieces.length && row.deleted !== true);
    if (hasTrailing) {
        result.tombstoned = await tombstone(companyId, { sourceType: SOURCE, sourceId: metadata.sourceId, ordinal: { $gte: pieces.length }, ...notNewerThan(sourceUpdatedAt) }, { sourceUpdatedAt });
    }
    return result;
};

const readPage = (companyId, pageId) => MongoDbCrudOpration(String(companyId), {
    type: SCHEMA_TYPE.PAGES,
    data: [{ _id: new mongoose.Types.ObjectId(String(pageId)) }, PAGE_FIELDS, { lean: true }],
}, 'findOne');

const inFlight = new Map();

/* One sync per page at a time in this process: a delete that lands while an edit is being
 * ingested runs again after it, against the page as it is by then. */
const serialised = (key, run) => {
    const running = inFlight.get(key);
    if (running) {
        running.again = true;
        return running.done;
    }
    const entry = { again: false };
    entry.done = (async () => {
        try {
            let result;
            do {
                entry.again = false;
                result = await run();
            } while (entry.again);
            return result;
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, entry);
    return entry.done;
};

const syncPage = (companyId, pageId) => {
    if (!OBJECT_ID.test(asText(pageId))) return Promise.resolve(null);
    return serialised(`${companyId}:${pageId}`, async () => {
        const page = await readPage(companyId, pageId);
        if (!page) return { tombstoned: await tombstonePages(companyId, [pageId]) };
        return module.exports.ingestPage(companyId, page);
    });
};

const reindexProject = async (companyId, projectId) => {
    if (!OBJECT_ID.test(asText(projectId))) return 0;
    const pages = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.PAGES,
        data: [{ ProjectID: new mongoose.Types.ObjectId(String(projectId)), deletedStatusKey: { $ne: 1 } }, '_id', { lean: true }],
    }, 'find');
    for (const page of pages || []) {
        await syncPage(companyId, String(page._id));
    }
    return (pages || []).length;
};

module.exports = {
    SOURCE,
    PAGE_FIELDS,
    ingestPage,
    syncPage,
    tombstonePages,
    tombstoneProject,
    reindexProject,
    removeDepartedMember,
};
