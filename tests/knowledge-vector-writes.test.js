/* Every path that tombstones or erases chunks tells the vector store which sources went, so a
 * store that keeps vectors of its own never answers from a source the chunk store no longer
 * holds. That includes the erase re-check inside a sync (#788's follow-up): an exclusion found
 * while syncing removes the chunks and the store's vectors alike. With the Atlas adapter an
 * erasure by document or by person leaves nothing for $vectorSearch to return. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const erase = require('../Modules/Knowledge/ingest/erase');
const vectorStore = require('../Modules/Knowledge/vectorStore');
const { createInMemoryVectorAdapter } = require('../Modules/Knowledge/adapters/vector');
const { createAtlasVectorAdapter } = require('../Modules/Knowledge/adapters/atlas');
const fakeAtlas = require('./fixtures/fakeAtlas').create(() => mockDb);

const C = '6f0000000000000000000c01';
const ALICE = '6f0000000000000000000011';
const PROJECT = '6f0000000000000000000a01';
const TASK = '6f0000000000000000000b01';
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const MODEL = 'text-embedding-3-small';
const TWO_SECTIONS = '<p>One.</p><h2>Two</h2><p>Two.</p>';

const recording = () => {
    const base = createInMemoryVectorAdapter();
    const calls = [];
    const told = (method) => async (args) => {
        calls.push([method, args]);
        return base[method](args);
    };
    return { name: 'recording', tracksSources: true, calls, search: base.search, stats: base.stats, upsert: told('upsert'), tombstone: told('tombstone'), erase: told('erase') };
};

const pageRow = (over = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    title: 'Notes', content: { html: TWO_SECTIONS }, visibility: 'project', createdBy: ALICE, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});
const indexedPage = async (over) => {
    const page = pageRow(over);
    await indexer.ingestPage(C, page);
    return page;
};
const stored = (sourceId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(sourceId));
const toldOf = (store, method) => store.calls.filter(([m]) => m === method).map(([, args]) => args);
const tombstonedIds = (store) => toldOf(store, 'tombstone').flatMap((args) => args.sourceIds.map((id) => `${args.sourceType}:${id}`)).sort();

let store;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    fakeAtlas.reset();
    store = vectorStore.use(recording());
});

afterAll(() => vectorStore.reset());

describe('the erase re-check inside a sync', () => {
    it('removes the chunks of a source erased since it was indexed and tells the store', async () => {
        const page = await indexedPage();
        mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, { companyId: C, kind: 'document', sourceType: 'page', sourceId: String(page._id), userId: '' });

        const result = await indexer.syncPage(C, String(page._id));

        expect(result).toMatchObject({ action: 'erase', erased: 2 });
        expect(stored(page._id)).toEqual([]);
        expect(toldOf(store, 'erase')).toEqual([{ companyId: C, sources: [{ sourceType: 'page', sourceId: String(page._id) }] }]);
    });

    it('with the Atlas adapter, leaves nothing for $vectorSearch to return', async () => {
        const atlas = vectorStore.use(createAtlasVectorAdapter({ crud: fakeAtlas.crud }));
        const page = await indexedPage();
        mockDb.store[CHUNKS].forEach((row) => Object.assign(row, { embedding: [1, 0, 0], embeddingModel: MODEL }));
        await atlas.prepare({ companyId: C, model: MODEL });
        fakeAtlas.lag(C);
        mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS, { companyId: C, kind: 'document', sourceType: 'page', sourceId: String(page._id), userId: '' });

        await indexer.syncPage(C, String(page._id));

        const found = await fakeAtlas.crud(C, { type: CHUNKS, data: [[{ $vectorSearch: { index: 'knowledge_chunks_vector', path: 'embedding', queryVector: [1, 0, 0], numCandidates: 10, limit: 10 } }]] }, 'aggregate');
        expect(found).toEqual([]);
    });
});

describe('tombstones tell the store', () => {
    it('when a project is trashed', async () => {
        const a = await indexedPage();
        const b = await indexedPage();
        await indexedPage({ ProjectID: '6f0000000000000000000a02' });
        await indexer.tombstoneProject(C, PROJECT);
        expect(tombstonedIds(store)).toEqual([`page:${a._id}`, `page:${b._id}`].sort());
        expect(toldOf(store, 'tombstone').every((args) => args.companyId === C)).toBe(true);
    });

    it('when a member leaves, for their private pages', async () => {
        const secret = await indexedPage({ visibility: 'private' });
        await indexedPage();
        await indexer.removeDepartedMember(C, ALICE);
        expect(tombstonedIds(store)).toEqual([`page:${secret._id}`]);
    });

    it('when a task is deleted, for the comments and files under it', async () => {
        mockDb.seed(CHUNKS, { companyId: C, sourceType: 'comment', sourceId: 'c1', ordinal: 0, taskId: TASK, contentHash: 'h', deleted: false });
        mockDb.seed(CHUNKS, { companyId: C, sourceType: 'file', sourceId: `${TASK}:a1`, ordinal: 0, taskId: TASK, contentHash: 'h', deleted: false });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, deletedStatusKey: 1, updatedAt: new Date() });
        await indexer.reindexTask(C, TASK);
        expect(tombstonedIds(store)).toEqual([`comment:c1`, `file:${TASK}:a1`]);
    });

    it('when a page loses sections, from the first ordinal it no longer has', async () => {
        const page = await indexedPage();
        await indexer.ingestPage(C, { ...page, content: { html: '<p>One.</p>' }, updatedAt: new Date('2026-09-02T00:00:00Z') });
        expect(toldOf(store, 'tombstone')).toEqual([{ companyId: C, sourceType: 'page', sourceIds: [String(page._id)], fromOrdinal: 1 }]);
    });

    it('never for what the write did not tombstone', async () => {
        await indexer.tombstoneProject(C, PROJECT);
        await indexer.removeDepartedMember(C, ALICE);
        expect(toldOf(store, 'tombstone')).toEqual([]);
    });
});

describe('with a store whose vectors ride on the chunk rows', () => {
    const chunkCalls = () => mockDb.calls.filter((call) => call.type === CHUNKS).map((call) => call.method);

    it.each([
        ['the in-database store', () => vectorStore.reset()],
        ['the Atlas store', () => vectorStore.use(createAtlasVectorAdapter({ crud: fakeAtlas.crud }))],
    ])('%s: a tombstone issues its write and nothing more', async (label, choose) => {
        choose();
        await indexedPage();
        await indexedPage({ visibility: 'private' });
        mockDb.calls.length = 0;
        await indexer.tombstoneProject(C, PROJECT);
        expect(chunkCalls()).toEqual(['updateMany']);
        mockDb.calls.length = 0;
        await indexer.removeDepartedMember(C, ALICE);
        expect(chunkCalls()).toEqual(['updateMany']);
        mockDb.calls.length = 0;
        await indexer.tombstonePages(C, ['6f00000000000000000000f1']);
        expect(chunkCalls()).toEqual(['updateMany']);
    });

    it('a shortened page reads no chunk ids for the store', async () => {
        vectorStore.reset();
        const page = await indexedPage();
        mockDb.calls.length = 0;
        await indexer.ingestPage(C, { ...page, content: { html: '<p>One.</p>' }, updatedAt: new Date('2026-09-02T00:00:00Z') });
        expect(mockDb.calls.filter((call) => call.type === CHUNKS && call.method === 'find')).toHaveLength(1);
    });
});

describe('erasure through the console paths with the Atlas adapter', () => {
    const vectorHits = () => fakeAtlas.crud(C, { type: CHUNKS, data: [[{ $vectorSearch: { index: 'knowledge_chunks_vector', path: 'embedding', queryVector: [1, 0, 0], numCandidates: 10, limit: 10 } }, { $project: { sourceId: 1 } }]] }, 'aggregate')
        .then((rows) => rows.map((row) => row.sourceId).sort());

    beforeEach(async () => {
        vectorStore.use(createAtlasVectorAdapter({ crud: fakeAtlas.crud }));
    });

    const embedAll = async () => {
        mockDb.store[CHUNKS].forEach((row) => Object.assign(row, { embedding: [1, 0, 0], embeddingModel: MODEL }));
        await vectorStore.current().prepare({ companyId: C, model: MODEL });
    };

    it('by document', async () => {
        const doomed = await indexedPage();
        const kept = await indexedPage();
        await embedAll();
        await erase.eraseDocument(C, { sourceType: 'page', sourceId: String(doomed._id) });
        expect(await vectorHits()).toEqual([String(kept._id), String(kept._id)]);
    });

    it('by person', async () => {
        const secret = await indexedPage({ visibility: 'private' });
        const shared = await indexedPage();
        await embedAll();
        await erase.erasePerson(C, ALICE);
        expect(stored(secret._id)).toEqual([]);
        expect(await vectorHits()).toEqual([String(shared._id), String(shared._id)]);
    });
});
