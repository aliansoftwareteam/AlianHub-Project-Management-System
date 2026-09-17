const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { chunkPage } = require('./chunker');

// Writes page chunks into the store. Callers check KNOWLEDGE_INDEXER first; nothing here
// reads the flag, so the backfill, the event handlers and a re-index share one write path.

const SOURCE = 'page';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DUPLICATE_KEY = 11000;
const TRASHED = 1;
const MAX_SYNC_ROUNDS = 3;
const PAGE_FIELDS = 'title content rawText visibility createdBy ProjectID createdByAgent deletedStatusKey updatedAt createdAt';
const EXISTING_FIELDS = 'ordinal contentHash deleted companyId projectId visibility createdBy authorKind sourceUpdatedAt';
const COMPARED_FIELDS = ['companyId', 'projectId', 'visibility', 'createdBy', 'authorKind'];

const store = (companyId, type, data, method) => MongoDbCrudOpration(String(companyId), { type, data }, method);
const chunkStore = (companyId, data, method) => store(companyId, SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data, method);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const asText = (value) => (value === undefined || value === null ? '' : String(value));
const time = (value) => (value ? new Date(value).getTime() || 0 : 0);
const versionOf = (page) => new Date(page.updatedAt || page.createdAt || 0);
const isPrivate = (page) => asText(page.visibility) === 'private';
const modified = (result) => (result && result.modifiedCount) || 0;

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

const tombstone = async (companyId, where, set = {}) => modified(await chunkStore(companyId, [
    { ...where, deleted: { $ne: true } },
    { $set: { deleted: true, deletedAt: new Date(), ...set } },
], 'updateMany'));

const tombstonePages = async (companyId, pageIds, { sourceUpdatedAt } = {}) => {
    const ids = [...new Set((pageIds || []).map(asText).filter(Boolean))];
    if (!ids.length) return 0;
    if (!sourceUpdatedAt) return tombstone(companyId, { sourceType: SOURCE, sourceId: { $in: ids } });
    return tombstone(companyId, { sourceType: SOURCE, sourceId: { $in: ids }, ...notNewerThan(sourceUpdatedAt) }, { sourceUpdatedAt });
};

const tombstoneProject = async (companyId, projectId) => {
    if (!OBJECT_ID.test(asText(projectId))) return 0;
    return tombstone(companyId, { projectId: String(projectId) });
};

const removeDepartedMember = async (companyId, userId) => {
    if (!OBJECT_ID.test(asText(userId))) return 0;
    return tombstone(companyId, { sourceType: SOURCE, createdBy: String(userId), visibility: 'private' });
};

/* Chunks a page's current version. Chunks whose text is unchanged are not rewritten, but their
 * version still moves forward: a chunk left at an older version would let a late read of a
 * version between the two overwrite it. */
const ingestPage = async (companyId, page) => {
    const result = { written: 0, unchanged: 0, stamped: 0, tombstoned: 0, stale: 0 };
    if (!page || !page._id) return result;
    const sourceUpdatedAt = versionOf(page);
    const metadata = metadataOf(companyId, page);
    const pieces = chunkPage(page);
    const existing = await chunkStore(companyId, [{ sourceType: SOURCE, sourceId: metadata.sourceId }, EXISTING_FIELDS, { lean: true }], 'find');
    const byOrdinal = new Map((existing || []).map((row) => [Number(row.ordinal), row]));

    let behind = false;
    for (const piece of pieces) {
        const row = { ...metadata, ...piece, embeddingModel: null, deleted: false, deletedAt: null, sourceUpdatedAt };
        const stored = byOrdinal.get(piece.ordinal);
        if (unchanged(stored, row)) {
            result.unchanged += 1;
            behind = behind || time(stored.sourceUpdatedAt) < time(sourceUpdatedAt);
        } else if (await upsertChunk(companyId, row)) {
            result.written += 1;
        } else {
            result.stale += 1;
        }
    }

    if (behind) {
        result.stamped = modified(await chunkStore(companyId, [
            { sourceType: SOURCE, sourceId: metadata.sourceId, ordinal: { $lt: pieces.length }, deleted: { $ne: true }, sourceUpdatedAt: { $lt: sourceUpdatedAt } },
            { $set: { sourceUpdatedAt } },
        ], 'updateMany'));
    }
    if ([...byOrdinal.values()].some((row) => Number(row.ordinal) >= pieces.length && row.deleted !== true)) {
        result.tombstoned = await tombstone(companyId, { sourceType: SOURCE, sourceId: metadata.sourceId, ordinal: { $gte: pieces.length }, ...notNewerThan(sourceUpdatedAt) }, { sourceUpdatedAt });
    }
    return result;
};

const readPage = (companyId, pageId) => store(companyId, SCHEMA_TYPE.PAGES, [{ _id: oid(pageId) }, PAGE_FIELDS, { lean: true }], 'findOne');

const inTrashedProject = async (companyId, page) => Boolean(page.ProjectID) && Boolean(await store(companyId, SCHEMA_TYPE.PROJECTS, [
    { _id: oid(page.ProjectID), deletedStatusKey: TRASHED }, '_id', { lean: true },
], 'findOne'));

const erased = async (companyId, page) => {
    const rules = [{ kind: 'document', sourceType: SOURCE, sourceId: String(page._id) }];
    if (isPrivate(page) && page.createdBy) rules.push({ kind: 'author', userId: String(page.createdBy) });
    return Boolean(await store(companyId, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, [{ $or: rules }, '_id', { lean: true }], 'findOne'));
};

/* The seat row is what records a departure, and what a rejoin clears, so a private page follows
 * its author's seat rather than a copy of it kept here. */
const authorHoldsSeat = async (companyId, page) => {
    if (!isPrivate(page)) return true;
    if (!page.createdBy) return false;
    return Boolean(await store(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ userId: String(page.createdBy), ...ACTIVE_SEAT }, '_id', { lean: true }], 'findOne'));
};

const decide = async (companyId, pageId) => {
    const page = await readPage(companyId, pageId);
    if (!page) return { action: 'tombstone', reason: 'missing', page: null };
    if (Number(page.deletedStatusKey) === 1) return { action: 'tombstone', reason: 'deleted', page };
    const [isErased, trashed, seated] = await Promise.all([erased(companyId, page), inTrashedProject(companyId, page), authorHoldsSeat(companyId, page)]);
    if (isErased) return { action: 'erase', reason: 'erased', page };
    if (trashed) return { action: 'tombstone', reason: 'trashed', page };
    if (!seated) return { action: 'tombstone', reason: 'departed', page };
    return { action: 'ingest', reason: '', page };
};

const applyDecision = async (companyId, pageId, decision) => {
    if (decision.action === 'ingest') {
        const result = await module.exports.ingestPage(companyId, decision.page);
        return { ...result, changed: result.written + result.stamped + result.tombstoned > 0 };
    }
    if (decision.action === 'erase') {
        const removed = await chunkStore(companyId, [{ sourceType: SOURCE, sourceId: String(pageId) }], 'deleteMany');
        const count = (removed && removed.deletedCount) || 0;
        return { erased: count, changed: count > 0 };
    }
    const tombstoned = await tombstonePages(companyId, [pageId], decision.page ? { sourceUpdatedAt: versionOf(decision.page) } : {});
    return { tombstoned, changed: tombstoned > 0 };
};

const sameDecision = (a, b) => a.action === b.action && time(a.page && a.page.updatedAt) === time(b.page && b.page.updatedAt);

const inFlight = new Map();

/* One sync per page at a time in this process. A sync requested while one runs is queued, and
 * runs after it whether that one succeeded or threw, so a delete is never lost behind a failure. */
const serialised = (key, run) => {
    const running = inFlight.get(key);
    if (running) {
        running.again = true;
        return running.done;
    }
    const entry = { again: false };
    entry.done = (async () => {
        let outcome;
        try {
            do {
                entry.again = false;
                try {
                    outcome = { value: await run() };
                } catch (error) {
                    outcome = { error };
                }
            } while (entry.again);
        } finally {
            inFlight.delete(key);
        }
        if (outcome.error) throw outcome.error;
        return outcome.value;
    })();
    inFlight.set(key, entry);
    return entry.done;
};

/* Decides from the page, its project, any erasure and its author's seat as they are now, writes,
 * then decides again: a trash, delete, departure or restore that landed between the read and the
 * write (in this process or another) is caught and applied before the sync returns. */
const syncPage = (companyId, pageId) => {
    if (!OBJECT_ID.test(asText(pageId))) return Promise.resolve(null);
    return serialised(`${companyId}:${pageId}`, async () => {
        let decision = await decide(companyId, pageId);
        let result = null;
        for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
            result = { action: decision.action, reason: decision.reason, leftOut: decision.action !== 'ingest', ...(await applyDecision(companyId, pageId, decision)) };
            if (!result.changed) break;
            const fresh = await decide(companyId, pageId);
            if (sameDecision(fresh, decision)) break;
            decision = fresh;
        }
        return result;
    });
};

const syncEach = async (companyId, where) => {
    const pages = await store(companyId, SCHEMA_TYPE.PAGES, [{ ...where, deletedStatusKey: { $ne: 1 } }, '_id', { lean: true }], 'find');
    for (const page of pages || []) {
        await syncPage(companyId, String(page._id));
    }
    return (pages || []).length;
};

const reindexProject = async (companyId, projectId) => (OBJECT_ID.test(asText(projectId)) ? syncEach(companyId, { ProjectID: oid(projectId) }) : 0);

const reindexAuthor = async (companyId, userId) => (OBJECT_ID.test(asText(userId)) ? syncEach(companyId, { createdBy: String(userId), visibility: 'private' }) : 0);

module.exports = {
    SOURCE,
    ingestPage,
    syncPage,
    tombstonePages,
    tombstoneProject,
    reindexProject,
    reindexAuthor,
    removeDepartedMember,
};
