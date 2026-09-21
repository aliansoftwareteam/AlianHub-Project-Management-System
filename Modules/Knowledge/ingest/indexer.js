const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { COMMENT_TYPES } = require('../sources');
const embeddings = require('../embeddings');
const vectorStore = require('../vectorStore');
const { chunkPage, chunkComment, chunkTranscript, contentHashOf } = require('./chunker');

// Writes source chunks into the store. Callers check KNOWLEDGE_INDEXER first; nothing here
// reads that flag, so the backfill, the event handlers and a re-index share one write path.
// The retrieval switch's hybrid mode is read here, since it decides whether a chunk is
// embedded as it is written.

const SOURCE = 'page';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DUPLICATE_KEY = 11000;
const TRASHED = 1;
const MAX_SYNC_ROUNDS = 3;
const TITLE_LENGTH = 160;
const TASK_DELETED = 'task';
const LOG_PREFIX = '[knowledge-indexer]';
const EXISTING_FIELDS = 'ordinal contentHash deleted companyId projectId sprintId taskId participants visibility createdBy authorKind embeddingModel sourceUpdatedAt';
const COMPARED_FIELDS = ['companyId', 'projectId', 'sprintId', 'taskId', 'participants', 'visibility', 'createdBy', 'authorKind'];
const EMBED_RETRY_ATTEMPTS = 3;
const EMBED_RETRY_BASE_MS = 30 * 1000;
/* Sources the recurring job re-embeds per run, so a run stays short and a bad key cannot pay
 * for a whole corpus of refusals. */
const REEMBED_BATCH = 50;

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
            const erasure = [documentRule('comment', comment), ...(comment.userId ? [{ kind: 'author', userId: String(comment.userId) }] : [])];
            if (await excluded(companyId, erasure)) return leaveOut('erase', 'erased', comment);
            if (comment.isDeleted === true) return { ...leaveOut('tombstone', 'deleted', comment), deletesWin: true };
            if (!COMMENT_TYPES.includes(comment.type)) return leaveOut('tombstone', 'no text', comment);
            const task = comment.taskId ? await readTask(companyId, comment.taskId) : null;
            const context = { task };
            const fingerprint = [time(comment.updatedAt), task && time(task.updatedAt), task && task.ProjectID, task && task.sprintId, task && task.deletedStatusKey].map(asText).join('|');
            if (comment.taskId && !task) return { ...leaveOut('tombstone', 'no task', comment, {}, fingerprint), unconditional: true };
            if (task && Number(task.deletedStatusKey) === 1) return { ...leaveOut('tombstone', 'task deleted', comment, context, fingerprint), marker: TASK_DELETED };
            if (!comment.projectId && !(task && task.ProjectID)) return leaveOut('tombstone', 'no project', comment, context, fingerprint);
            if (await anyTrashed(companyId, [comment.projectId, task && task.ProjectID])) return leaveOut('tombstone', 'trashed', comment, context, fingerprint);
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
            if (Number(call.deletedStatusKey) === 1) return { ...leaveOut('tombstone', 'deleted', call, {}, fingerprint), deletesWin: true };
            if (await excluded(companyId, [documentRule('transcript', call)])) return leaveOut('erase', 'erased', call, {}, fingerprint);
            return ingestDecision(call, {}, fingerprint);
        },
    },
};

const SOURCES = Object.keys(RULES);

const sameValue = (a, b) => (Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify((a || []).map(asText)) === JSON.stringify((b || []).map(asText))
    : asText(a) === asText(b));

const unchanged = (existing, row, wantedModel = null) => Boolean(existing)
    && existing.deleted !== true
    && existing.contentHash === row.contentHash
    && (!wantedModel || existing.embeddingModel === wantedModel)
    && COMPARED_FIELDS.every((field) => sameValue(existing[field], row[field]));

/* A stored vector still describes the chunk while its text and the model are the ones wanted. */
const reusable = (stored, piece, wantedModel) => Boolean(stored)
    && stored.deleted !== true
    && stored.contentHash === piece.contentHash
    && stored.embeddingModel === wantedModel;

/* One provider call for every chunk of the source that needs a vector. A failure leaves the
 * text write to go ahead without vectors; the caller queues the retry. A budget refusal is
 * not a failure of the provider: nothing was tried, and nothing is retried until the cap allows. */
const embedPieces = async (companyId, sourceType, sourceId, pieces, byOrdinal, wantedModel) => {
    const vectors = { byOrdinal: new Map(), failed: false, refused: false };
    if (!wantedModel) return vectors;
    const todo = pieces.filter((piece) => !reusable(byOrdinal.get(piece.ordinal), piece, wantedModel));
    if (!todo.length) return vectors;
    try {
        const { vectors: found } = await embeddings.embedTexts(companyId, todo.map((piece) => piece.text));
        todo.forEach((piece, i) => { if (Array.isArray(found[i]) && found[i].length) vectors.byOrdinal.set(piece.ordinal, found[i]); });
    } catch (error) {
        vectors.failed = true;
        vectors.refused = embeddings.isBudgetRefusal(error);
        if (!vectors.refused) logger.error(`${LOG_PREFIX} ${companyId}: ${sourceType} ${sourceId} stored without vectors: ${error.message}`);
    }
    return vectors;
};

/* A fresh vector is written with the text; a reusable one is left where it is by leaving the
 * fields out of the $set; anything else is cleared, so a stale vector never describes new text. */
const vectorFields = (stored, piece, vectors, wantedModel) => {
    if (vectors.byOrdinal.has(piece.ordinal)) return { embedding: vectors.byOrdinal.get(piece.ordinal), embeddingModel: wantedModel };
    if (wantedModel && reusable(stored, piece, wantedModel)) return {};
    return { embedding: [], embeddingModel: null };
};

const tellStore = async (method, args) => {
    try {
        await vectorStore.current()[method](args);
    } catch (error) {
        logger.error(`${LOG_PREFIX} vector store ${method} failed for ${args.companyId}: ${error.message}`);
    }
};

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

/* Moves chunks' version up to `at`, never down, so a read older than a delete or a task move cannot
 * write its chunks back afterwards. */
const stampForward = async (companyId, where, at) => modified(await chunkStore(companyId, [
    { ...where, $or: [{ sourceUpdatedAt: { $lt: at } }, { sourceUpdatedAt: null }] },
    { $set: { sourceUpdatedAt: at } },
], 'updateMany'));

const tombstoneSource = async (companyId, sourceType, ids, { sourceUpdatedAt } = {}) => {
    const unique = [...new Set((ids || []).map(asText).filter(Boolean))];
    if (!unique.length) return 0;
    const count = sourceUpdatedAt
        ? await tombstone(companyId, { sourceType, sourceId: { $in: unique }, ...notNewerThan(sourceUpdatedAt) }, { sourceUpdatedAt })
        : await tombstone(companyId, { sourceType, sourceId: { $in: unique } });
    await tellStore('tombstone', { companyId: String(companyId), sourceType, sourceIds: unique });
    return count;
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
    const result = { written: 0, unchanged: 0, stamped: 0, tombstoned: 0, stale: 0, embedded: 0, embedFailed: false, embedRefused: false };
    if (!row || !row._id) return result;
    const rules = RULES[sourceType];
    const sourceUpdatedAt = rules.versionOf(row, context);
    const metadata = rules.metadata(companyId, row, context);
    const pieces = rules.chunk(row);
    const plan = await embeddings.planFor(companyId);
    const wantedModel = plan ? plan.model : null;
    const existing = await chunkStore(companyId, [{ sourceType, sourceId: metadata.sourceId }, EXISTING_FIELDS, { lean: true }], 'find');
    const byOrdinal = new Map((existing || []).map((chunk) => [Number(chunk.ordinal), chunk]));
    const vectors = await embedPieces(companyId, sourceType, metadata.sourceId, pieces, byOrdinal, wantedModel);
    result.embedFailed = vectors.failed;
    result.embedRefused = vectors.refused;

    const embeddedChunks = [];
    let behind = false;
    for (const piece of pieces) {
        const stored = byOrdinal.get(piece.ordinal);
        const chunk = { ...metadata, ...piece, ...vectorFields(stored, piece, vectors, wantedModel), deleted: false, deletedAt: null, tombstoneReason: '', sourceUpdatedAt };
        if (unchanged(stored, chunk, wantedModel)) {
            result.unchanged += 1;
            behind = behind || time(stored.sourceUpdatedAt) < time(sourceUpdatedAt);
        } else if (await upsertChunk(companyId, chunk)) {
            result.written += 1;
            if (vectors.byOrdinal.has(piece.ordinal)) {
                result.embedded += 1;
                embeddedChunks.push(chunk);
            }
        } else {
            result.stale += 1;
        }
    }
    if (embeddedChunks.length) await tellStore('upsert', { companyId: String(companyId), chunks: embeddedChunks });
    if (vectors.failed && !vectors.refused) queueEmbedRetry(companyId, sourceType, metadata.sourceId);

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

/* Records why a source is out, on its tombstoned chunks or, when it was never indexed, on an empty
 * tombstone: a task restore finds the comments to bring back by it without reading comments. */
const markLeftOut = async (companyId, sourceType, decision) => {
    const rules = RULES[sourceType];
    const where = { sourceType, sourceId: String(decision.row._id) };
    const relabelled = modified(await chunkStore(companyId, [
        { ...where, deleted: true, tombstoneReason: { $ne: decision.marker } },
        { $set: { tombstoneReason: decision.marker } },
    ], 'updateMany'));
    if (await chunkStore(companyId, [where, '_id', { lean: true }], 'findOne')) return relabelled;
    const written = await upsertChunk(companyId, {
        ...rules.metadata(companyId, decision.row, decision.context),
        title: '',
        ordinal: 0,
        headingPath: [],
        text: '',
        contentHash: contentHashOf([], ''),
        embedding: [],
        embeddingModel: null,
        deleted: true,
        deletedAt: new Date(),
        tombstoneReason: decision.marker,
        sourceUpdatedAt: rules.versionOf(decision.row, decision.context),
    });
    return relabelled + (written ? 1 : 0);
};
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
    const where = { sourceType, sourceId: String(id) };
    if (decision.deletesWin) {
        const stamped = await stampForward(companyId, where, rules.versionOf(decision.row, decision.context));
        const tombstoned = await tombstone(companyId, where);
        return { tombstoned, changed: stamped + tombstoned > 0 };
    }
    const version = decision.unconditional || !decision.row ? {} : { sourceUpdatedAt: rules.versionOf(decision.row, decision.context) };
    const tombstoned = await tombstoneSource(companyId, sourceType, [id], version);
    const marked = decision.marker ? await markLeftOut(companyId, sourceType, decision) : 0;
    return { tombstoned, changed: tombstoned + marked > 0 };
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

/* Carries on past a sync that throws, then runs each failed one once more through the same
 * per-source queue, and reports what still failed only after every other one has run. */
const syncMany = async (companyId, sourceType, ids) => {
    const failed = [];
    for (const id of ids) {
        try {
            await sync(companyId, sourceType, id);
        } catch (error) {
            failed.push(id);
        }
    }
    const stillFailing = [];
    let lastError = null;
    for (const id of failed) {
        try {
            await sync(companyId, sourceType, id);
        } catch (error) {
            stillFailing.push(id);
            lastError = error;
        }
    }
    if (stillFailing.length) throw new Error(`${sourceType} sync failed for ${stillFailing.length} of ${ids.length} (${stillFailing.join(', ')}): ${lastError.message}`);
    return ids.length;
};

const syncEach = async (companyId, sourceType, where) => {
    const rows = await store(companyId, RULES[sourceType].collection, [where, '_id', { lean: true }], 'find');
    return syncMany(companyId, sourceType, (rows || []).map((row) => String(row._id)));
};

const reindexProject = async (companyId, projectId) => {
    if (!isObjectId(projectId)) return 0;
    let failure = null;
    let count = 0;
    for (const [sourceType, where] of [
        ['page', { ProjectID: oid(projectId), deletedStatusKey: { $ne: 1 } }],
        ['comment', { projectId: oid(projectId), isDeleted: { $ne: true }, type: { $in: COMMENT_TYPES } }],
    ]) {
        try {
            count += await syncEach(companyId, sourceType, where);
        } catch (error) {
            failure = failure || error;
        }
    }
    if (failure) throw failure;
    return count;
};

const reindexAuthor = async (companyId, userId) => (isObjectId(userId)
    ? syncEach(companyId, 'page', { createdBy: String(userId), visibility: 'private', deletedStatusKey: { $ne: 1 } })
    : 0);

/* A task change reaches its comments through the chunks recorded under it. A deleted task tombstones
 * them in one write; a restore, known by the chunks it marked, re-syncs those comments and any
 * others under the task; a move re-tags the chunks' project and sprint. Only a restore reads
 * comments. Serialised per task, so a restore queued behind a delete reads the task again. */
const reindexTask = (companyId, taskId, { moved = false } = {}) => {
    if (!isObjectId(taskId)) return Promise.resolve(0);
    return serialised(`${companyId}:task:${taskId}`, async () => {
        const where = { sourceType: 'comment', taskId: String(taskId) };
        const task = await readTask(companyId, taskId);
        if (!task || Number(task.deletedStatusKey) === 1) {
            if (task) await stampForward(companyId, where, rowVersion(task));
            return tombstone(companyId, where, { tombstoneReason: TASK_DELETED });
        }
        let count = 0;
        const marked = await chunkStore(companyId, [{ ...where, deleted: true, tombstoneReason: TASK_DELETED }, 'sourceId', { lean: true }], 'find');
        if (marked && marked.length) {
            const rows = await store(companyId, SCHEMA_TYPE.COMMENTS, [{ taskId: { $in: [oid(taskId), String(taskId)] } }, '_id', { lean: true }], 'find');
            const ids = [...new Set([...marked.map((chunk) => String(chunk.sourceId)), ...(rows || []).map((row) => String(row._id))])];
            count += await syncMany(companyId, 'comment', ids);
        }
        if (moved) {
            const projectId = task.ProjectID || null;
            const sprintId = task.sprintId || null;
            await stampForward(companyId, where, rowVersion(task));
            count += modified(await chunkStore(companyId, [
                { ...where, $or: [{ projectId: { $ne: projectId } }, { sprintId: { $ne: sprintId } }] },
                { $set: { projectId, sprintId } },
            ], 'updateMany'));
        }
        return count;
    });
};

const embedRetryQueue = new Map();

const runEmbedRetry = async (key) => {
    const entry = embedRetryQueue.get(key);
    if (!entry) return null;
    entry.timer = null;
    try {
        const result = await sync(entry.companyId, entry.sourceType, entry.id);
        if (!(result && result.embedFailed)) embedRetryQueue.delete(key);
        return result;
    } catch (error) {
        logger.error(`${LOG_PREFIX} embedding retry of ${entry.sourceType} ${entry.id} in company ${entry.companyId} failed: ${error.message}`);
        embedRetryQueue.delete(key);
        return null;
    }
};

/* One waiting retry per source, each wait twice the last; after the last attempt the recurring
 * job's sweep is what brings the vectors back, so a process restart loses nothing for good. */
const queueEmbedRetry = (companyId, sourceType, id) => {
    const key = `${companyId}:${sourceType}:${id}`;
    const entry = embedRetryQueue.get(key) || { companyId: String(companyId), sourceType, id: String(id), attempt: 0, timer: null };
    if (entry.timer) return;
    if (entry.attempt >= EMBED_RETRY_ATTEMPTS) {
        embedRetryQueue.delete(key);
        return;
    }
    entry.attempt += 1;
    entry.timer = setTimeout(() => { runEmbedRetry(key); }, EMBED_RETRY_BASE_MS * (2 ** (entry.attempt - 1)));
    if (entry.timer.unref) entry.timer.unref();
    embedRetryQueue.set(key, entry);
};

const embedRetries = () => [...embedRetryQueue.keys()].sort();

const flushEmbedRetries = async () => {
    for (const [key, entry] of [...embedRetryQueue.entries()]) {
        if (entry.timer) clearTimeout(entry.timer);
        await runEmbedRetry(key);
    }
};

const clearEmbedRetries = () => {
    embedRetryQueue.forEach((entry) => { if (entry.timer) clearTimeout(entry.timer); });
    embedRetryQueue.clear();
};

/* Sources of a hybrid company whose live chunks carry no vector for the current model: what a
 * failed embed left behind, and everything indexed before the model changed. Stops at the first
 * failure, since the next source would fail the same way. */
const reembedMissing = async (companyId) => {
    const plan = await embeddings.planFor(companyId);
    if (!plan) return null;
    const rows = await chunkStore(companyId, [[
        { $match: { companyId: String(companyId), sourceType: { $in: SOURCES }, deleted: { $ne: true }, embeddingModel: { $ne: plan.model } } },
        { $group: { _id: { sourceType: '$sourceType', sourceId: '$sourceId' } } },
        { $limit: REEMBED_BATCH },
    ]], 'aggregate');
    let count = 0;
    for (const row of rows || []) {
        const { sourceType, sourceId } = row._id || {};
        const result = await sync(companyId, sourceType, sourceId).catch((error) => {
            logger.error(`${LOG_PREFIX} ${companyId}: re-embedding ${sourceType} ${sourceId} failed: ${error.message}`);
            return null;
        });
        if (result && result.embedFailed) break;
        count += 1;
    }
    return count;
};

module.exports = {
    SOURCE,
    SOURCES,
    RULES,
    EMBED_RETRY_ATTEMPTS,
    REEMBED_BATCH,
    embedRetries,
    flushEmbedRetries,
    clearEmbedRetries,
    reembedMissing,
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
    reindexTask,
    removeDepartedMember,
};
