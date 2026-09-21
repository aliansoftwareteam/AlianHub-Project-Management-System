const mongoose = require('mongoose');
const { knowledgeChunksSchema } = require('../../utils/mongo-handler/createSchema');
const { createAtlasVectorAdapter, INDEX_NAME, prefilterOf } = require('../../Modules/Knowledge/adapters/atlas');
const { filterFor } = require('../../Modules/Knowledge/visibleSet');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* The Atlas adapter against real servers. With KNOWLEDGE_ATLAS_TEST_URL pointing at a
 * mongodb/mongodb-atlas-local container, it builds the tenant's vector index, searches it under
 * the visible set's pre-filter and post-check, and erases through it. Against the plain MongoDB
 * the suite already runs on, it reports the store as unsupported and never throws. Without an
 * Atlas-local URL (CI has none) that half is skipped. */

jest.setTimeout(240000);

const ATLAS_URL = String(process.env.KNOWLEDGE_ATLAS_TEST_URL || '').trim();
const MODEL = 'text-embedding-3-small';
const ME = '6f0000000000000000000011';
const OTHER = '6f0000000000000000000012';
const PROJECT = new mongoose.Types.ObjectId();
const SECRET = new mongoose.Types.ObjectId();

/* The generic path of MongoDbCrudOpration: the tenant database's model, the method, its arguments. */
const crudOver = (connection) => (companyId, { data }, method) => {
    const db = connection.useDb(String(companyId), { useCache: true });
    const model = db.models.knowledge_chunks || db.model('knowledge_chunks', knowledgeChunksSchema, 'knowledge_chunks');
    return model[method](...data);
};

const set = (companyId, over = {}) => ({
    companyId, caller: { kind: 'user', userId: ME, agentId: null, runId: null }, privileged: false, projectId: null, projectIds: [String(PROJECT)], hiddenSprintIds: [], fileProjectIds: [],
    sourceTypes: ['page', 'transcript'], ...over,
});

const poll = async (check, deadlineMs = 180000) => {
    const deadline = Date.now() + deadlineMs;
    let value = await check();
    while (!value && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        value = await check();
    }
    return value;
};

describe('against a MongoDB server without Atlas Search', () => {
    let connection;
    const companyId = String(new mongoose.Types.ObjectId());

    beforeAll(async () => {
        connection = await mongoose.createConnection(resolveMongoUrl()).asPromise();
    });
    afterAll(async () => {
        await connection.useDb(companyId).dropDatabase().catch(() => {});
        await connection.close();
    });

    it('reads the store as unsupported, and a question gets the lexical fallback reason instead of an error', async () => {
        const store = createAtlasVectorAdapter({ crud: crudOver(connection) });
        await expect(store.prepare({ companyId })).resolves.toMatchObject({ status: 'unsupported' });
        const filter = filterFor(set(companyId), { chunkSources: ['page'] });
        const error = await store.search({ companyId, queryEmbedding: [1, 0, 0], model: MODEL, filter, limit: 5 }).catch((e) => e);
        expect(error.fallback).toMatch(/^vector store (unsupported|paused)$/);
    });
});

(ATLAS_URL ? describe : describe.skip)('against Atlas Search (mongodb-atlas-local)', () => {
    let connection;
    let store;
    const companyId = String(new mongoose.Types.ObjectId());
    const chunks = () => connection.useDb(companyId).collection('knowledge_chunks');
    const ids = {};

    const chunk = (key, over = {}) => ({
        companyId, sourceType: 'page', sourceId: key, ordinal: 0, projectId: PROJECT, sprintId: null, taskId: '', participants: [], visibility: 'project', createdBy: OTHER, authorKind: 'human',
        title: key, headingPath: [], text: `${key} text`, contentHash: key, embedding: [1, 0, 0], embeddingModel: MODEL, deleted: false, sourceUpdatedAt: new Date(), ...over,
    });

    const search = async (over = {}, model = MODEL) => (await store.search({
        companyId, queryEmbedding: [1, 0, 0], model, filter: filterFor(set(companyId, over), { chunkSources: ['page', 'transcript'] }), limit: 10,
    })).map((p) => p.sourceId).sort();

    beforeAll(async () => {
        connection = await mongoose.createConnection(ATLAS_URL).asPromise();
        await chunks().insertMany([
            chunk('shared'),
            chunk('near', { embedding: [0.9, 0.1, 0] }),
            chunk('secret-project', { projectId: SECRET }),
            chunk('company-page', { projectId: null }),
            chunk('their-private', { visibility: 'private' }),
            chunk('my-private', { visibility: 'private', createdBy: ME }),
            chunk('old-model', { embeddingModel: 'text-embedding-ada-002' }),
            chunk('tombstoned', { deleted: true }),
            chunk('my-call', { sourceType: 'transcript', participants: [ME, OTHER], visibility: 'participants' }),
            chunk('their-call', { sourceType: 'transcript', participants: [OTHER], visibility: 'participants' }),
        ]);
        store = createAtlasVectorAdapter({ crud: crudOver(connection) });
        ids.first = await store.prepare({ companyId });
        const ready = await poll(async () => (await store.health({ companyId, refresh: true })).index.status === 'ready');
        expect(ready).toBe(true);
        /* A new index answers before it has caught up with every document. */
        await poll(async () => (await search()).includes('shared'));
    });

    afterAll(async () => {
        if (connection) {
            await connection.useDb(companyId).dropDatabase().catch(() => {});
            await connection.close();
        }
    });

    it('creates the tenant index with the chunk vector and every filter path, sized from a stored vector', async () => {
        expect(ids.first).toMatchObject({ name: INDEX_NAME, dimensions: 3 });
        const [index] = await chunks().listSearchIndexes(INDEX_NAME).toArray();
        expect(index.type).toBe('vectorSearch');
        expect(index.latestDefinition.fields[0]).toEqual({ type: 'vector', path: 'embedding', numDimensions: 3, similarity: 'cosine' });
        await expect(store.prepare({ companyId })).resolves.toMatchObject({ status: 'ready' });
        expect(await chunks().listSearchIndexes().toArray()).toHaveLength(1);
    });

    it("finds only what the caller's visible set admits, from the current model, and no tombstone", async () => {
        expect(await search()).toEqual(['company-page', 'my-call', 'my-private', 'near', 'shared'].sort());
        expect(await search({ projectId: String(PROJECT) })).toEqual(['my-call', 'my-private', 'near', 'shared'].sort());
        expect(await search({}, 'text-embedding-ada-002')).toEqual(['old-model']);
    });

    it('accepts the pre-filter Atlas is sent for every clause shape', async () => {
        const shapes = [set(companyId), set(companyId, { projectId: String(PROJECT) }), set(companyId, { projectBound: true, reachesProjectless: false }), set(companyId, { projectIds: [] })];
        for (const shape of shapes) {
            const { clauses } = filterFor(shape, { chunkSources: ['page', 'comment', 'transcript', 'guide', 'file'] });
            for (const clause of Object.values(clauses)) {
                const filter = prefilterOf({ ...clause, embeddingModel: MODEL });
                await chunks().aggregate([{ $vectorSearch: { index: INDEX_NAME, path: 'embedding', queryVector: [1, 0, 0], numCandidates: 20, limit: 10, filter } }]).toArray();
            }
        }
    });

    it('drops a chunk tombstoned or made private after indexing at once, before the index catches up', async () => {
        await chunks().updateOne({ sourceId: 'near' }, { $set: { deleted: true } });
        await chunks().updateOne({ sourceId: 'shared' }, { $set: { visibility: 'private' } });
        expect(await search()).toEqual(['company-page', 'my-call', 'my-private']);
        await chunks().updateOne({ sourceId: 'near' }, { $set: { deleted: false } });
        await chunks().updateOne({ sourceId: 'shared' }, { $set: { visibility: 'project' } });
    });

    it('erases through the adapter, so the vectors leave the index', async () => {
        await expect(store.erase({ companyId, sources: [{ sourceType: 'page', sourceId: 'my-private' }] })).resolves.toMatchObject({ erased: 1 });
        expect(await search()).not.toContain('my-private');
        expect(await poll(async () => {
            const raw = await chunks().aggregate([{ $vectorSearch: { index: INDEX_NAME, path: 'embedding', queryVector: [1, 0, 0], numCandidates: 50, limit: 50 } }, { $project: { sourceId: 1 } }]).toArray();
            return !raw.some((row) => row.sourceId === 'my-private');
        })).toBe(true);
    });
});
