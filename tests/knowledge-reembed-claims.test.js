/* Two servers sweeping for chunks off the current model (the recurring job on one, a console
 * re-embed on another) must not both pay for the same source. Each server is its own copy of the
 * indexer module, sharing one database and one provider. */
const mockDb = require('./fixtures/fakeMongo').create();
const mockEmbed = { model: 'model-old', calls: 0, during: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Knowledge/embeddings', () => ({
    model: () => mockEmbed.model,
    planFor: async () => ({ model: mockEmbed.model }),
    readiness: () => 'ready',
    isBudgetRefusal: () => false,
    embedTexts: async (companyId, texts) => {
        mockEmbed.calls += 1;
        if (mockEmbed.during) await mockEmbed.during(companyId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { vectors: texts.map(() => [1, 0, 0]), model: mockEmbed.model };
    },
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const serverA = require('../Modules/Knowledge/ingest/indexer');

let serverB;
jest.isolateModules(() => { serverB = require('../Modules/Knowledge/ingest/indexer'); });

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const live = () => (mockDb.store[CHUNKS] || []).filter((c) => c.deleted !== true);

const seedPage = (i) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    title: `Harbour ${i}`, content: { html: `<p>Park by harbour ${i}.</p>` }, visibility: 'project', createdBy: '6f0000000000000000000011', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'),
});

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockEmbed.model = 'model-old';
    const pages = [1, 2, 3].map(seedPage);
    for (const page of pages) await serverA.syncPage(C, String(page._id));
    mockEmbed.model = 'model-new';
    mockEmbed.calls = 0;
});

it('the two servers are separate copies of the indexer', () => {
    expect(serverB).not.toBe(serverA);
});

it('two servers re-embedding at once pay for each source once', async () => {
    expect(live().every((c) => c.embeddingModel === 'model-old')).toBe(true);
    await Promise.all([serverA.reembedMissing(C), serverB.reembedMissing(C)]);
    expect(mockEmbed.calls).toBe(3);
    expect(live().every((c) => c.embeddingModel === 'model-new')).toBe(true);
    expect(live().some((c) => c.embedLeaseUntil)).toBe(false);
});

it('passes over a source another server has claimed, and takes it once that claim runs out', async () => {
    const [first] = live();
    const claimed = live().find((c) => c.sourceId === first.sourceId && c.ordinal === 0);
    claimed.embedLeaseUntil = new Date(Date.now() + 60 * 1000);
    await serverA.reembedMissing(C);
    expect(mockEmbed.calls).toBe(2);
    expect(live().filter((c) => c.sourceId === first.sourceId).every((c) => c.embeddingModel === 'model-old')).toBe(true);

    claimed.embedLeaseUntil = new Date(Date.now() - 1000);
    await serverA.reembedMissing(C);
    expect(mockEmbed.calls).toBe(3);
    expect(live().every((c) => c.embeddingModel === 'model-new')).toBe(true);
});

it('releases only a claim it still holds', async () => {
    let taken = null;
    mockEmbed.during = () => {
        if (taken) return;
        taken = live().find((c) => c.ordinal === 0 && c.embedLeaseUntil);
        taken.embedLeaseOwner = 'another-server';
        taken.embedLeaseUntil = new Date(Date.now() + 60 * 1000);
    };
    try {
        await serverA.reembedMissing(C);
    } finally {
        mockEmbed.during = null;
    }
    expect(taken).toBeTruthy();
    expect(taken.embedLeaseOwner).toBe('another-server');
    expect(taken.embedLeaseUntil).toBeInstanceOf(Date);
});

it('claims and releases without touching the chunk timestamps', async () => {
    mockDb.calls.length = 0;
    await serverA.reembedMissing(C);
    const leaseWrites = mockDb.calls.filter((c) => c.type === CHUNKS && ['findOneAndUpdate', 'updateOne'].includes(c.method) && JSON.stringify(c.data[1] || {}).includes('embedLease'));
    expect(leaseWrites.length).toBe(6);
    leaseWrites.forEach((c) => expect(c.data[2]).toEqual(expect.objectContaining({ timestamps: false })));
});
