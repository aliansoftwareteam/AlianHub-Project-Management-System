const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { COMMENT_TYPES } = require('../sources');
const { chunkPage, chunkComment, chunkTranscript } = require('./chunker');

// Writes source chunks into the store. Callers check KNOWLEDGE_INDEXER first; nothing here
// reads the flag, so the backfill, the event handlers and a re-index share one write path.

const SOURCE = 'page';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DUPLICATE_KEY = 11000;
const TRASHED = 1;
const MAX_SYNC_ROUNDS = 3;
const TITLE_LENGTH = 160;
const EXISTING_FIELDS = 'ordinal contentHash deleted companyId projectId sprintId taskId participants visibility createdBy authorKind sourceUpdatedAt';
const COMPARED_FIELDS = ['companyId', 'projectId', 'sprintId', 'taskId', 'participants', 'visibility', 'createdBy', 'authorKind'];

const store = (companyId, type, data, method) => MongoDbCrudOpration(String(companyId), { type, data }, method);
const chunkStore = (companyId, data, method) => store(companyId, SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data, method);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const asText = (value) => (value === undefined || value === null ? '' : String(value));
const isObjectId = (value) => OBJECT_ID.test(asText(value));
const time = (value) => (value ? new Date(value).getTime() || 0 : 0);
const rowVersion = (row) => new Date(row.updatedAt || row.createdAt || 0);
const isPrivate = (page) => asText(page.visibility) === 'private';
const modified = (result) => (result && result.modifiedCount) || 0;

const notNewerThan = (at) => ({ $or: [{ sourceUpdatedAt: { $lte: at } }, { sourceUpdatedAt: null }] });

const isDuplicateKey = (error) => Boolean(error) && (error.code === DUPLICATE_KEY || /E11000/.test(asText(error.message)));

const byId = (companyId, type, id, fields) => (isObjectId(id)
    ? store(companyId, type, [{ _id: oid(id) }, fields, { lean: true }], 'findOne')
    : Promise.resolve(null));

const excluded = (companyId, rules) => store(companyId, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, [{ $or: rules }, '_id', { lean: true }], 'findOne').then(Boolean);

const documentRule = (sourceType, row) => ({ kind: 'document', sourceType, sourceId: String(row._id) });

const anyTrashed = async (companyId, projectIds) => {
    const ids = [...new Set(projectIds.filter(isObjectId).map(String))];
    if (!ids.length) return false;
    return Boolean(await store(companyId, SCHEMA_TYPE.PROJECTS, [{ _id: { $in: ids.map(oid) }, deletedStatusKey: TRASHED }, '_id', { lean: true }], 'findOne'));
};

const base = (companyId, sourceType, row) => ({
    companyId: String(companyId),
    sourceType,
    sourceId: String(row._id),
    projectId: null,
    sprintId: null,
    taskId: '',
    participants: [],
    visibility: 'project',
    createdBy: '',
    authorKind: 'human',
    title: '',
});

const ingestDecision = (row, context = {}, fingerprint = '') => ({ action: 'ingest', reason: '', row, context, fingerprint });
const leaveOut = (action, reason, row, context = {}, fingerprint = '') => ({ action, reason, row, context, fingerprint });

/* The seat row is what records a departure, and what a rejoin clears, so a private page follows
 * its author's seat rather than a copy of it kept here. */
const authorHoldsSeat = async (companyId, page) => {
    if (!isPrivate(page)) return true;
    if (!page.createdBy) return false;
    return Boolean(await store(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ userId: String(page.createdBy), ...ACTIVE_SEAT }, '_id', { lean: true }], 'findOne'));
};

const readTask = (companyId, taskId) => byId(companyId, SCHEMA_TYPE.TASKS, taskId, 'ProjectID sprintId deletedStatusKey updatedAt');

/* A comment's chunks carry its task's project and sprint, so the search narrows by the task, which
 * is what decides who sees the comment. Its version is the later of the comment and the task: a
 * task moved to another sprint is a newer version of every comment on it. */
const commentVersion = (comment, { task } = {}) => new Date(Math.max(time(rowVersion(comment)), task ? time(rowVersion(task)) : 0));

const RULES = {
    page: {
        collection: SCHEMA_TYPE.PAGES,
        fields: 'title content rawText visibility createdBy ProjectID createdByAgent deletedStatusKey updatedAt createdAt',
        ingestName: 'ingestPage',
        versionOf: rowVersion,
        chunk: chunkPage,
        metadata: (companyId, page) => ({
            ...base(companyId, 'page', page),
            projectId: page.ProjectID || null,
            visibility: asText(page.visibility) || 'project',
            createdBy: asText(page.createdBy),
            authorKind: page.createdByAgent ? 'agent' : 'human',
            title: asText(page.title),
        }),
        async decide(companyId, page) {
            const fingerprint = String(time(page.updatedAt));
            if (Number(page.deletedStatusKey) === 1) return leaveOut('tombstone', 'deleted', page, {}, fingerprint);
            const rules = [documentRule('page', page)];
            if (isPrivate(page) && page.createdBy) rules.push({ kind: 'author', userId: String(page.createdBy) });
            const [isErased, trashed, seated] = await Promise.all([excluded(companyId, rules), anyTrashed(companyId, [page.ProjectID]), authorHoldsSeat(companyId, page)]);
            if (isErased) return leaveOut('erase', 'erased', page, {}, fingerprint);
            if (trashed) return leaveOut('tombstone', 'trashed', page, {}, fingerprint);
            if (!seated) return leaveOut('tombstone', 'departed', page, {}, fingerprint);
            return ingestDecision(page, {}, fingerprint);
        },
    },
    comment: {
        collection: SCHEMA_TYPE.COMMENTS,
        fields: 'message type project projectId sprintId taskId userId isAgent actorType isDeleted updatedAt createdAt',
        ingestName: 'ingestComment',
        versionOf: commentVersion,
        chunk: chunkComment,
        metadata: (companyId, comment, { task } = {}) => ({
            ...base(companyId, 'comment', comment),
            projectId: (task ? task.ProjectID : comment.projectId) || null,
            sprintId: (task ? task.sprintId : comment.sprintId) || null,
            taskId: task ? String(task._id) : '',
            createdBy: asText(comment.userId),
            authorKind: comment.isAgent || comment.actorType === 'agent' ? 'agent' : 'human',
            title: asText(comment.message).replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH),
        }),
        async decide(companyId, comment) {
            if (comment.isDeleted === true) return leaveOut('tombstone', 'deleted', comment);
            if (!COMMENT_TYPES.includes(comment.type)) return leaveOut('tombstone', 'no text', comment);
            const task = comment.taskId ? await readTask(companyId, comment.taskId) : null;
            const context = { task };
            const fingerprint = [time(comment.updatedAt), task && time(task.updatedAt), task && task.ProjectID, task && task.sprintId, task && task.deletedStatusKey].map(asText).join('|');
            if (comment.taskId && !task) return { ...leaveOut('tombstone', 'no task', comment, {}, fingerprint), unconditional: true };
            if (task && Number(task.deletedStatusKey) === 1) return leaveOut('tombstone', 'task deleted', comment, context, fingerprint);
            if (!comment.projectId && !(task && task.ProjectID)) return leaveOut('tombstone', 'no project', comment, context, fingerprint);
            const [isErased, trashed] = await Promise.all([excluded(companyId, [documentRule('comment', comment)]), anyTrashed(companyId, [comment.projectId, task && task.ProjectID])]);
            if (isErased) return leaveOut('erase', 'erased', comment, context, fingerprint);
            if (trashed) return leaveOut('tombstone', 'trashed', comment, context, fingerprint);
            return ingestDecision(comment, context, fingerprint);
        },
    },
    transcript: {
        collection: SCHEMA_TYPE.CALLS,
        fields: 'title summary transcript actionItems participants projectId createdBy deletedStatusKey updatedAt createdAt',
        ingestName: 'ingestTranscript',
        versionOf: rowVersion,
        chunk: chunkTranscript,
        /* A transcript belongs to the people on the call, not to its project: it is not tombstoned
         * with a trashed project, and its project only narrows a search scoped to one. */
        metadata: (companyId, call) => ({
            ...base(companyId, 'transcript', call),
            projectId: isObjectId(call.projectId) ? String(call.projectId) : null,
            participants: [...new Set((Array.isArray(call.participants) ? call.participants : []).map(asText).filter(Boolean))],
            visibility: 'participants',
            createdBy: asText(call.createdBy),
            title: asText(call.title).trim() || 'Call notes',
        }),
        async decide(companyId, call) {
            const fingerprint = String(time(call.updatedAt));
            if (Number(call.deletedStatusKey) === 1) return leaveOut('tombstone', 'deleted', call, {}, fingerprint);
            if (await excluded(companyId, [documentRule('transcript', call)])) return leaveOut('erase', 'erased', call, {}, fingerprint);
            return ingestDecision(call, {}, fingerprint);
        },
    },
};

const SOURCES = Object.keys(RULES);

const sameValue = (a, b) => (Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify((a || []).map(asText)) === JSON.stringify((b || []).map(asText))
    : asText(a) === asText(b));

const unchanged = (existing, row) => Boolean(existing)
    && existing.deleted !== true
    && existing.contentHash === row.contentHash
    && COMPARED_FIELDS.every((field) => sameValue(existing[field], row[field]));

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

const tombstoneSource = async (companyId, sourceType, ids, { sourceUpdatedAt } = {}) => {
    const unique = [...new Set((ids || []).map(asText).filter(Boolean))];
    if (!unique.length) return 0;
    if (!sourceUpdatedAt) return tombstone(companyId, { sourceType, sourceId: { $in: unique } });
    return tombstone(companyId, { sourceType, sourceId: { $in: unique }, ...notNewerThan(sourceUpdatedAt) }, { sourceUpdatedAt });
};

const tombstonePages = (companyId, pageIds, options) => tombstoneSource(companyId, SOURCE, pageIds, options);

const tombstoneProject = async (companyId, projectId) => {
    if (!isObjectId(projectId)) return 0;
    return tombstone(companyId, { projectId: String(projectId), sourceType: { $in: ['page', 'comment'] } });
};

const removeDepartedMember = async (companyId, userId) => {
    if (!isObjectId(userId)) return 0;
    return tombstone(companyId, { sourceType: SOURCE, createdBy: String(userId), visibility: 'private' });
};

/* Chunks a source's current version. Chunks whose text is unchanged are not rewritten, but their
 * version still moves forward: a chunk left at an older version would let a late read of a
 * version between the two overwrite it. */
const ingest = async (companyId, sourceType, row, context = {}) => {
    const result = { written: 0, unchanged: 0, stamped: 0, tombstoned: 0, stale: 0 };
    if (!row || !row._id) return result;
    const rules = RULES[sourceType];
    const sourceUpdatedAt = rules.versionOf(row, context);
    const metadata = rules.metadata(companyId, row, context);
    const pieces = rules.chunk(row);
    const existing = await chunkStore(companyId, [{ sourceType, sourceId: metadata.sourceId }, EXISTING_FIELDS, { lean: true }], 'find');
    const byOrdinal = new Map((existing || []).map((chunk) => [Number(chunk.ordinal), chunk]));

    let behind = false;
    for (const piece of pieces) {
        const chunk = { ...metadata, ...piece, embeddingModel: null, deleted: false, deletedAt: null, sourceUpdatedAt };
        const stored = byOrdinal.get(piece.ordinal);
        if (unchanged(stored, chunk)) {
            result.unchanged += 1;
            behind = behind || time(stored.sourceUpdatedAt) < time(sourceUpdatedAt);
        } else if (await upsertChunk(companyId, chunk)) {
            result.written += 1;
        } else {
            result.stale += 1;
        }
    }

    if (behind) {
        result.stamped = modified(await chunkStore(companyId, [
            { sourceType, sourceId: metadata.sourceId, ordinal: { $lt: pieces.length }, deleted: { $ne: true }, sourceUpdatedAt: { $lt: sourceUpdatedAt } },
            { $set: { sourceUpdatedAt } },
        ], 'updateMany'));
    }
    if ([...byOrdinal.values()].some((chunk) => Number(chunk.ordinal) >= pieces.length && chunk.deleted !== true)) {
        result.tombstoned = await tombstone(companyId, { sourceType, sourceId: metadata.sourceId, ordinal: { $gte: pieces.length }, ...notNewerThan(sourceUpdatedAt) }, { sourceUpdatedAt });
    }
    return result;
};

const ingestPage = (companyId, page) => ingest(companyId, 'page', page);
const ingestComment = (companyId, comment, context) => ingest(companyId, 'comment', comment, context);
const ingestTranscript = (companyId, call) => ingest(companyId, 'transcript', call);

const decide = async (companyId, sourceType, id) => {
    const rules = RULES[sourceType];
    const row = await byId(companyId, rules.collection, id, rules.fields);
    if (!row) return { ...leaveOut('tombstone', 'missing', null), unconditional: true };
    return rules.decide(companyId, row);
};

const applyDecision = async (companyId, sourceType, id, decision) => {
    const rules = RULES[sourceType];
    if (decision.action === 'ingest') {
        const result = await module.exports[rules.ingestName](companyId, decision.row, decision.context);
        return { ...result, changed: result.written + result.stamped + result.tombstoned > 0 };
    }
    if (decision.action === 'erase') {
        const removed = await chunkStore(companyId, [{ sourceType, sourceId: String(id) }], 'deleteMany');
        const count = (removed && removed.deletedCount) || 0;
        return { erased: count, changed: count > 0 };
    }
    const version = decision.unconditional || !decision.row ? {} : { sourceUpdatedAt: rules.versionOf(decision.row, decision.context) };
    const tombstoned = await tombstoneSource(companyId, sourceType, [id], version);
    return { tombstoned, changed: tombstoned > 0 };
};

const sameDecision = (a, b) => a.action === b.action && a.fingerprint === b.fingerprint;

const inFlight = new Map();

/* One sync per source at a time in this process. A sync requested while one runs is queued, and
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

/* Decides from the source row and everything its visibility rests on as they are now, writes,
 * then decides again: a trash, delete, departure, move or restore that landed between the read
 * and the write (in this process or another) is caught and applied before the sync returns. */
const sync = (companyId, sourceType, id) => {
    if (!RULES[sourceType] || !isObjectId(id)) return Promise.resolve(null);
    return serialised(`${companyId}:${sourceType}:${id}`, async () => {
        let decision = await decide(companyId, sourceType, id);
        let result = null;
        for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
            result = { action: decision.action, reason: decision.reason, leftOut: decision.action !== 'ingest', ...(await applyDecision(companyId, sourceType, id, decision)) };
            if (!result.changed) break;
            const fresh = await decide(companyId, sourceType, id);
            if (sameDecision(fresh, decision)) break;
            decision = fresh;
        }
        return result;
    });
};

const syncPage = (companyId, pageId) => sync(companyId, 'page', pageId);
const syncComment = (companyId, commentId) => sync(companyId, 'comment', commentId);
const syncTranscript = (companyId, callId) => sync(companyId, 'transcript', callId);

const syncEach = async (companyId, sourceType, where) => {
    const rows = await store(companyId, RULES[sourceType].collection, [where, '_id', { lean: true }], 'find');
    for (const row of rows || []) {
        await sync(companyId, sourceType, String(row._id));
    }
    return (rows || []).length;
};

const reindexProject = async (companyId, projectId) => {
    if (!isObjectId(projectId)) return 0;
    const pages = await syncEach(companyId, 'page', { ProjectID: oid(projectId), deletedStatusKey: { $ne: 1 } });
    const comments = await syncEach(companyId, 'comment', { projectId: oid(projectId), isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES } });
    return pages + comments;
};

const reindexAuthor = async (companyId, userId) => (isObjectId(userId)
    ? syncEach(companyId, 'page', { createdBy: String(userId), visibility: 'private', deletedStatusKey: { $ne: 1 } })
    : 0);

/* Re-syncs the comments already indexed under a task. Comment rows are only read when the task was
 * restored, for comments left out while it was deleted: comments have no index on their task. */
const reindexTaskComments = async (companyId, taskId, { restored = false } = {}) => {
    if (!isObjectId(taskId)) return 0;
    const ids = new Set();
    const chunks = await chunkStore(companyId, [{ sourceType: 'comment', taskId: String(taskId) }, 'sourceId', { lean: true }], 'find');
    (chunks || []).forEach((chunk) => ids.add(String(chunk.sourceId)));
    const task = restored ? await readTask(companyId, taskId) : null;
    if (task && Number(task.deletedStatusKey) !== 1) {
        const rows = await store(companyId, SCHEMA_TYPE.COMMENTS, [
            { taskId: { $in: [oid(taskId), String(taskId)] }, isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES } }, '_id', { lean: true },
        ], 'find');
        (rows || []).forEach((row) => ids.add(String(row._id)));
    }
    for (const id of ids) {
        await sync(companyId, 'comment', id);
    }
    return ids.size;
};

module.exports = {
    SOURCE,
    SOURCES,
    RULES,
    ingestPage,
    ingestComment,
    ingestTranscript,
    sync,
    syncPage,
    syncComment,
    syncTranscript,
    tombstonePages,
    tombstoneProject,
    reindexProject,
    reindexAuthor,
    reindexTaskComments,
    removeDepartedMember,
};
