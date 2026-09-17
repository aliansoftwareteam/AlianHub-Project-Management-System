const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const backfill = require('../Modules/Knowledge/ingest/backfill');

const C = '6f0000000000000000000c01';
const OFF = '6f0000000000000000000c02';
const AUTHOR = '6f0000000000000000000011';
const LEFT = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';
const TRASHED = '6f0000000000000000000a02';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const indexedIds = () => [...new Set((mockDb.store[CHUNKS] || []).filter((c) => !c.deleted).map((c) => c.sourceId))].sort();
const stateOf = (companyId = C) => (mockDb.store[STATE] || []).find((s) => s.companyId === companyId && s.sourceType === 'page');
const pageReads = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.PAGES && c.method === 'find');

let pages;

const seedPages = (n, over = () => ({})) => Array.from({ length: n }, (_, i) => String(mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id: `6f00000000000000000b${String(i + 1).padStart(4, '0')}`,
    title: `Page ${i + 1}`,
    content: { html: `<p>Body ${i + 1}</p>` },
    visibility: 'project',
    createdBy: AUTHOR,
    ProjectID: PROJECT,
    deletedStatusKey: 0,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over(i),
})._id));

beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'tenant'; });
afterAll(() => {
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.restoreAllMocks();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: OFF });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: TRASHED, deletedStatusKey: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: AUTHOR, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, status: 2, isDelete: true });
    pages = seedPages(5);
});

describe('backfilling the pages a company already has', () => {
    it('indexes in batches and saves its position after each one', async () => {
        const first = await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        expect(first).toMatchObject({ status: 'running', indexed: 2 });
        expect(stateOf()).toMatchObject({ companyId: C, sourceType: 'page', status: 'running', cursor: pages[1], indexed: 2 });
        expect(indexedIds()).toEqual(pages.slice(0, 2));
    });

    it('resumes from the saved position without reading the pages it already did', async () => {
        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });
        mockDb.calls.length = 0;

        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        const [read] = pageReads();
        expect(String(read.data[0]._id.$gt)).toBe(pages[1]);
        expect(indexedIds()).toEqual(pages.slice(0, 4));

        const done = await backfill.backfillCompany(C, { batchSize: 2 });
        expect(done).toMatchObject({ status: 'complete', indexed: 5 });
        expect(stateOf()).toMatchObject({ status: 'complete', cursor: pages[4], finishedAt: expect.any(Date) });
        expect(indexedIds()).toEqual(pages);
        expect(await backfill.pagesIndexed(C)).toBe(true);
    });

    it('picks up after a crash from the last batch it saved', async () => {
        const ingest = indexer.ingestPage;
        const spy = jest.spyOn(indexer, 'ingestPage').mockImplementation(async (companyId, page, context) => {
            if (String(page._id) === pages[3]) throw new Error('connection reset');
            return ingest(companyId, page, context);
        });

        await expect(backfill.backfillCompany(C, { batchSize: 2 })).rejects.toThrow('connection reset');
        expect(stateOf()).toMatchObject({ status: 'failed', cursor: pages[1], error: 'connection reset' });
        expect(await backfill.pagesIndexed(C)).toBe(false);

        spy.mockRestore();
        mockDb.calls.length = 0;
        const done = await backfill.backfillCompany(C, { batchSize: 2 });

        expect(String(pageReads()[0].data[0]._id.$gt)).toBe(pages[1]);
        expect(done.status).toBe('complete');
        expect(indexedIds()).toEqual(pages);
    });

    it('does not run again once complete', async () => {
        await backfill.backfillCompany(C, { batchSize: 10 });
        mockDb.calls.length = 0;
        const again = await backfill.backfillCompany(C, { batchSize: 10 });
        expect(again.status).toBe('complete');
        expect(pageReads()).toEqual([]);
    });

    it('leaves out deleted pages, pages in a trashed project and the private pages of someone who left', async () => {
        mockDb.store[SCHEMA_TYPE.PAGES].length = 0;
        const [kept, deleted, trashed, leftPrivate, leftShared] = seedPages(5, (i) => [
            {},
            { deletedStatusKey: 1 },
            { ProjectID: TRASHED },
            { createdBy: LEFT, visibility: 'private' },
            { createdBy: LEFT },
        ][i]);

        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(indexedIds()).toEqual([kept, leftShared].sort());
        expect(stateOf()).toMatchObject({ status: 'complete', indexed: 2, skipped: 2 });
        expect(mockDb.calls.filter((c) => c.type === CHUNKS && c.method === 'find').map((c) => c.data[0].sourceId)).not.toContain(deleted);
        [trashed, leftPrivate].forEach((id) => expect(indexedIds()).not.toContain(id));
    });

    it('runs every company whose indexer is on and skips the rest', async () => {
        await backfill.backfillAll({ batchSize: 10 });
        expect(indexedIds()).toEqual(pages);
        expect(stateOf(C)).toMatchObject({ status: 'complete' });
        expect(mockDb.calls.filter((c) => c.companyId === OFF)).toEqual([]);
    });
});
