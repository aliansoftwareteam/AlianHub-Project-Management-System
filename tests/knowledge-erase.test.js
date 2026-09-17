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

    it('touches only the knowledge store: no audit row is written or changed', async () => {
        await indexed({ createdBy: ALICE, visibility: 'private' });
        mockDb.calls.length = 0;
        await erasePerson(C, ALICE);
        expect([...new Set(mockDb.calls.map((c) => c.type))].sort()).toEqual([CHUNKS, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS].sort());
    });
});

describe('an erasure sticks', () => {
    const backfill = require('../Modules/Knowledge/ingest/backfill');
    const events = require('../Modules/Knowledge/ingest/events');
    const ENV = process.env.KNOWLEDGE_INDEXER;

    beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'all'; });
    afterAll(() => {
        if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
        else process.env.KNOWLEDGE_INDEXER = ENV;
    });

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ALICE, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: BOB, status: 2, isDelete: false });
    });

    it('keeps an erased document out when it is synced, re-indexed with its project, or backfilled', async () => {
        const erased = await indexed({ createdBy: ALICE });
        const kept = await indexed({ createdBy: BOB });
        await eraseDocument(C, { sourceType: 'page', sourceId: String(erased._id) });

        await indexer.syncPage(C, String(erased._id));
        await indexer.reindexProject(C, PROJECT);
        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(stored(erased._id)).toEqual([]);
        expect(stored(kept._id)).toHaveLength(2);
    });

    it("keeps an erased person's private pages out after a project restore, a backfill and a rejoin, and leaves their shared pages", async () => {
        const secret = await indexed({ createdBy: ALICE, visibility: 'private' });
        const shared = await indexed({ createdBy: ALICE });
        await erasePerson(C, ALICE);

        await indexer.reindexProject(C, PROJECT);
        await backfill.backfillCompany(C, { batchSize: 10 });
        await events.handle({ type: 'member.rejoined', companyId: C, entity: { kind: 'member', id: ALICE }, data: { userId: ALICE } });

        expect(stored(secret._id)).toEqual([]);
        expect(stored(shared._id).filter((c) => !c.deleted)).toHaveLength(2);
    });
});
