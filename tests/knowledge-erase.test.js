const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const { eraseDocument, erasePerson } = require('../Modules/Knowledge/ingest/erase');

const C = '6f0000000000000000000c01';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const stored = (pageId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(pageId));

const indexed = async (over) => {
    const page = mockDb.seed(SCHEMA_TYPE.PAGES, {
        title: 'Notes', content: { html: '<p>One.</p><h2>Two</h2><p>Two.</p>' }, visibility: 'project', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
    });
    await indexer.ingestPage(C, page);
    return page;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
});

describe('erasing from the chunk store', () => {
    it("removes every chunk of one document, tombstoned or not, and nothing else's", async () => {
        const doomed = await indexed({ createdBy: ALICE });
        const kept = await indexed({ createdBy: ALICE });
        await indexer.ingestPage(C, { ...doomed, content: { html: '<p>One.</p>' }, updatedAt: new Date('2026-09-02T00:00:00Z') });
        expect(stored(doomed._id).map((c) => c.deleted)).toEqual([false, true]);

        const result = await eraseDocument(C, { sourceType: 'page', sourceId: String(doomed._id) });

        expect(result).toEqual({ erased: 2 });
        expect(stored(doomed._id)).toEqual([]);
        expect(stored(kept._id)).toHaveLength(2);
    });

    it("removes a person's private pages and keeps what they shared and what others wrote", async () => {
        const alicePrivate = await indexed({ createdBy: ALICE, visibility: 'private' });
        const aliceShared = await indexed({ createdBy: ALICE });
        const bobPrivate = await indexed({ createdBy: BOB, visibility: 'private' });

        const result = await erasePerson(C, ALICE);

        expect(result).toEqual({ erased: 2 });
        expect(stored(alicePrivate._id)).toEqual([]);
        expect(stored(aliceShared._id)).toHaveLength(2);
        expect(stored(bobPrivate._id)).toHaveLength(2);
    });

    it('refuses an erase that names no document or no person, rather than erasing everything', async () => {
        await indexed({ createdBy: ALICE, visibility: 'private' });
        await expect(eraseDocument(C, { sourceType: 'page', sourceId: '' })).rejects.toThrow(/sourceId/);
        await expect(eraseDocument(C, { sourceType: '', sourceId: 'x' })).rejects.toThrow(/sourceType/);
        await expect(erasePerson(C, '')).rejects.toThrow(/user/);
        expect(mockDb.store[CHUNKS]).toHaveLength(2);
    });

    it('touches only the chunk store: no audit row is written or changed', async () => {
        await indexed({ createdBy: ALICE, visibility: 'private' });
        mockDb.calls.length = 0;
        await erasePerson(C, ALICE);
        expect(mockDb.calls.map((c) => c.type)).toEqual([CHUNKS]);
    });
});
