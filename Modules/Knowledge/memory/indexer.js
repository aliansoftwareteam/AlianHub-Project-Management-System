const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const agentMemory = require('../../Agents/memory');
const embeddings = require('../embeddings');
const vectorStore = require('../vectorStore');
const { contentHashOf, textBytesOf } = require('../ingest/chunker');

// An agent's notes in the chunk store, one chunk per note under scope "agent". Callers check the
// switch first, as for the other sources. Each chunk copies what retrieval filters on: the agent,
// the projects the note was formed in, the person whose run wrote it, the run's taint, and who
// wrote the documents it was formed from, which is what erasure and a departure act on.

const SOURCE_TYPE = 'memory';
const SCOPE = 'agent';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DUPLICATE_KEY = 11000;
const TITLE = 'Agent memory';
const LOG_PREFIX = '[knowledge-memory]';
const COMPARED_FIELDS = ['agentId', 'projectIds', 'startedBy', 'starterOnly', 'runId', 'tainted', 'taintRefs', 'derivedFrom', 'derivedAuthors', 'derivedOnlyPrivateOf'];

const asText = (value) => (value === undefined || value === null ? '' : String(value));
const isObjectId = (value) => OBJECT_ID.test(asText(value));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const store = (companyId, type, data, method) => MongoDbCrudOpration(String(companyId), { type, data }, method);
const chunkStore = (companyId, data, method) => store(companyId, SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data, method);
const modified = (result) => (result && result.modifiedCount) || 0;
const versionOf = (note) => new Date(note.updatedAt || note.lastSeenAt || 0);
const isDuplicateKey = (error) => Boolean(error) && (error.code === DUPLICATE_KEY || /E11000/.test(asText(error.message)));
const sameValue = (a, b) => (Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify((a || []).map(asText)) === JSON.stringify((b || []).map(asText))
    : asText(a) === asText(b));

const refOf = (ref) => {
    const at = asText(ref).indexOf(':');
    return at < 0 ? null : { sourceType: ref.slice(0, at), sourceId: ref.slice(at + 1) };
};

/* Who wrote each document the note came from, as erasure counts them: a private page is its
 * author's, a comment its writer's. A shared page, a task or a call makes nobody the owner. */
const derivedOf = async (companyId, note) => {
    const refs = note.derivedFrom.map(refOf).filter((ref) => ref && isObjectId(ref.sourceId));
    const pageIds = refs.filter((ref) => ref.sourceType === 'page').map((ref) => oid(ref.sourceId));
    const commentIds = refs.filter((ref) => ref.sourceType === 'comment').map((ref) => oid(ref.sourceId));
    const [pages, comments] = await Promise.all([
        pageIds.length ? store(companyId, SCHEMA_TYPE.PAGES, [{ _id: { $in: pageIds } }, 'createdBy visibility', { lean: true }], 'find') : [],
        commentIds.length ? store(companyId, SCHEMA_TYPE.COMMENTS, [{ _id: { $in: commentIds } }, 'userId', { lean: true }], 'find') : [],
    ]);
    const privateOwners = (pages || []).filter((p) => asText(p.visibility) === 'private' && p.createdBy).map((p) => asText(p.createdBy));
    const writers = (comments || []).filter((c) => c.userId).map((c) => asText(c.userId));
    const authors = [...new Set([...privateOwners, ...writers])];
    const onlyPrivate = refs.length > 0 && refs.every((ref) => ref.sourceType === 'page') && privateOwners.length === refs.length && new Set(privateOwners).size === 1;
    return { authors, onlyPrivateOf: onlyPrivate ? privateOwners[0] : '' };
};

const excluded = (companyId, note, authors) => store(companyId, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, [{
    $or: [
        { kind: 'document', sourceType: SOURCE_TYPE, sourceId: note.memoryId },
        ...note.derivedFrom.map(refOf).filter(Boolean).map((ref) => ({ kind: 'document', ...ref })),
        ...authors.map((userId) => ({ kind: 'author', userId })),
    ],
}, '_id', { lean: true }], 'findOne').then(Boolean);

const agentLive = async (companyId, agentId) => isObjectId(agentId)
    && Boolean(await store(companyId, SCHEMA_TYPE.AGENTS, [{ _id: oid(agentId), deletedStatusKey: { $ne: 1 } }, '_id', { lean: true }], 'findOne'));

const holdsSeat = async (companyId, userId) => Boolean(await store(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ userId: String(userId), ...ACTIVE_SEAT }, '_id', { lean: true }], 'findOne'));

const decide = async (companyId, memoryId) => {
    const note = await agentMemory.readAgentNote({ companyId, memoryId });
    if (!note) return { action: 'tombstone', reason: 'missing' };
    const derived = await derivedOf(companyId, note);
    if (await excluded(companyId, note, derived.authors)) return { action: 'erase', reason: 'erased', note };
    if (note.status !== agentMemory.STATUS.ACTIVE) return { action: 'tombstone', reason: 'retired', note };
    if (!(await agentLive(companyId, note.agentId))) return { action: 'tombstone', reason: 'agent deleted', note };
    if (derived.onlyPrivateOf && !(await holdsSeat(companyId, derived.onlyPrivateOf))) return { action: 'tombstone', reason: 'departed', note };
    return { action: 'ingest', reason: '', note, derived };
};

const chunkOf = (companyId, note, derived) => {
    const text = note.text;
    return {
        companyId: String(companyId),
        sourceType: SOURCE_TYPE,
        sourceId: note.memoryId,
        ordinal: 0,
        scope: SCOPE,
        agentId: note.agentId,
        projectId: null,
        projectIds: note.projectIds,
        runId: asText(note.source && note.source.runId),
        startedBy: asText(note.source && note.source.userId),
        starterOnly: note.starterOnly === true,
        tainted: note.tainted,
        taintRefs: note.taintSources.map((s) => `${s.kind}:${s.ref}`),
        derivedFrom: note.derivedFrom,
        derivedAuthors: derived.authors,
        derivedOnlyPrivateOf: derived.onlyPrivateOf,
        visibility: SCOPE,
        createdBy: '',
        authorKind: 'agent',
        title: TITLE,
        headingPath: [],
        text,
        textBytes: textBytesOf(text),
        contentHash: contentHashOf([], text),
        deleted: false,
        deletedAt: null,
        tombstoneReason: '',
        sourceUpdatedAt: versionOf(note),
    };
};

const unchanged = (stored, chunk, wantedModel) => Boolean(stored)
    && stored.deleted !== true
    && stored.contentHash === chunk.contentHash
    && (!wantedModel || stored.embeddingModel === wantedModel)
    && COMPARED_FIELDS.every((field) => sameValue(stored[field], chunk[field]));

const tellStore = async (method, args) => {
    try {
        await vectorStore.current()[method](args);
    } catch (error) {
        logger.error(`${LOG_PREFIX} vector store ${method} failed for ${args.companyId}: ${error.message}`);
    }
};

/* A failed or refused embed still writes the text; the memory backfill job's sweep tries again. */
const vectorFor = async (companyId, stored, chunk, wantedModel) => {
    if (!wantedModel) return { embedding: [], embeddingModel: null };
    if (stored && stored.contentHash === chunk.contentHash && stored.embeddingModel === wantedModel) return {};
    try {
        const { vectors } = await embeddings.embedTexts(companyId, [chunk.text]);
        if (Array.isArray(vectors[0]) && vectors[0].length) return { embedding: vectors[0], embeddingModel: wantedModel };
    } catch (error) {
        if (!embeddings.isBudgetRefusal(error)) logger.error(`${LOG_PREFIX} ${companyId}: memory ${chunk.sourceId} stored without a vector: ${error.message}`);
    }
    return { embedding: [], embeddingModel: null };
};

const ingest = async (companyId, note, derived) => {
    const chunk = chunkOf(companyId, note, derived);
    const plan = await embeddings.planFor(companyId);
    const wantedModel = plan ? plan.model : null;
    const stored = await chunkStore(companyId, [{ sourceType: SOURCE_TYPE, sourceId: note.memoryId, ordinal: 0 }, null, { lean: true }], 'findOne');
    if (unchanged(stored, chunk, wantedModel)) return { written: 0, changed: false };
    const row = { ...chunk, ...(await vectorFor(companyId, stored, chunk, wantedModel)) };
    try {
        await chunkStore(companyId, [
            { sourceType: SOURCE_TYPE, sourceId: note.memoryId, ordinal: 0, $or: [{ sourceUpdatedAt: { $lte: row.sourceUpdatedAt } }, { sourceUpdatedAt: null }] },
            { $set: row },
            { upsert: true },
        ], 'updateOne');
    } catch (error) {
        if (isDuplicateKey(error)) return { written: 0, stale: 1, changed: false };
        throw error;
    }
    if (row.embeddingModel) await tellStore('upsert', { companyId: String(companyId), chunks: [row] });
    return { written: 1, changed: true, embedded: !wantedModel || Boolean(row.embeddingModel || (stored && stored.embeddingModel === wantedModel)) };
};

const tombstone = async (companyId, where, reason) => {
    const rows = await chunkStore(companyId, [{ ...where, sourceType: SOURCE_TYPE, deleted: { $ne: true } }, 'sourceId', { lean: true }], 'find');
    const ids = [...new Set((rows || []).map((row) => asText(row.sourceId)))];
    if (!ids.length) return 0;
    const count = modified(await chunkStore(companyId, [
        { ...where, sourceType: SOURCE_TYPE, deleted: { $ne: true } },
        { $set: { deleted: true, deletedAt: new Date(), tombstoneReason: reason } },
    ], 'updateMany'));
    await tellStore('tombstone', { companyId: String(companyId), sourceType: SOURCE_TYPE, sourceIds: ids });
    return count;
};

const erase = async (companyId, where) => {
    const rows = await chunkStore(companyId, [{ ...where, sourceType: SOURCE_TYPE }, 'sourceId', { lean: true }], 'find');
    const sources = [...new Set((rows || []).map((row) => asText(row.sourceId)))].map((sourceId) => ({ sourceType: SOURCE_TYPE, sourceId }));
    if (!sources.length) return 0;
    const result = await chunkStore(companyId, [{ ...where, sourceType: SOURCE_TYPE }], 'deleteMany');
    await tellStore('erase', { companyId: String(companyId), sources });
    return (result && result.deletedCount) || 0;
};

const inFlight = new Map();

/* One sync per note at a time; one asked for while another runs goes again after it. */
const serialised = (key, run) => {
    const running = inFlight.get(key);
    if (running) {
        running.again = true;
        return running.done;
    }
    const entry = { again: false };
    entry.done = (async () => {
        try {
            let value;
            do {
                entry.again = false;
                value = await run();
            } while (entry.again);
            return value;
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, entry);
    return entry.done;
};

const sync = (companyId, memoryId) => {
    if (!isObjectId(memoryId)) return Promise.resolve(null);
    return serialised(`${companyId}:${memoryId}`, async () => {
        const decision = await decide(companyId, memoryId);
        const where = { sourceId: String(memoryId) };
        if (decision.action === 'ingest') return { action: 'ingest', leftOut: false, ...(await ingest(companyId, decision.note, decision.derived)) };
        if (decision.action === 'erase') return { action: 'erase', reason: decision.reason, leftOut: true, erased: await erase(companyId, where) };
        return { action: 'tombstone', reason: decision.reason, leftOut: true, tombstoned: await tombstone(companyId, where, decision.reason) };
    });
};

const tombstoneAgent = (companyId, agentId) => (isObjectId(agentId) ? tombstone(companyId, { agentId: String(agentId) }, 'agent deleted') : Promise.resolve(0));

const removeDepartedMember = (companyId, userId) => (isObjectId(userId) ? tombstone(companyId, { derivedOnlyPrivateOf: String(userId) }, 'departed') : Promise.resolve(0));

/* A rejoin brings back the notes its departure took out. */
const reindexAuthor = async (companyId, userId) => {
    if (!isObjectId(userId)) return 0;
    const rows = await chunkStore(companyId, [{ sourceType: SOURCE_TYPE, derivedOnlyPrivateOf: String(userId) }, 'sourceId', { lean: true }], 'find');
    const ids = [...new Set((rows || []).map((row) => asText(row.sourceId)))];
    for (const id of ids) await sync(companyId, id);
    return ids.length;
};

module.exports = { SOURCE_TYPE, SCOPE, TITLE, sync, tombstoneAgent, removeDepartedMember, reindexAuthor, erase };
