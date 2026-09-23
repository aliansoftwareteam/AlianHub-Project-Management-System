/* The console's figures come from a size stored on each chunk when it is written, grouped over an
 * index that holds every field the grouping reads, so no chunk's text or vector is read to count. */
const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { myCache: new NodeCache() };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 25 })) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema, knowledgeIndexStateSchema } = require('../utils/mongo-handler/createSchema');
const backfill = require('../Modules/Knowledge/ingest/backfill');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const embeddings = require('../Modules/Knowledge/embeddings');
const figures = require('../Modules/Knowledge/figures');

const C = '6f0000000000000000000c01';
const ALICE = '6f0000000000000000000011';
const PROJECT = '6f0000000000000000000a01';
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const FIGURES_KEY = { sourceType: 1, deleted: 1, sourceId: 1, embeddingModel: 1, updatedAt: 1, textBytes: 1 };
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retrieval: process.env.KNOWLEDGE_RETRIEVAL };

const db = () => mockDbFor(C);
const chunks = () => db().store[CHUNKS] || [];
const chunkCalls = () => db().calls.filter((call) => call.type === CHUNKS);

let seq = 0;
const chunk = (over = {}) => {
    seq += 1;
    return db().seed(CHUNKS, {
        companyId: C, sourceType: 'page', sourceId: `6f00000000000000000${String(seq).padStart(5, '0')}`, ordinal: 0, text: 'Some words here.', contentHash: `h${seq}`,
        createdBy: ALICE, visibility: 'project', deleted: false, embedding: [0.5, 0.5], embeddingModel: null, updatedAt: new Date('2026-09-10T00:00:00Z'), ...over,
    });
};

/* Every field a pipeline reads: the keys its $match stages name and every "$field" it refers to. */
const fieldsRead = (pipeline) => {
    const found = new Set();
    const walk = (value, inMatch) => {
        if (typeof value === 'string' && value.startsWith('$') && !value.startsWith('$$')) found.add(value.slice(1).split('.')[0]);
        if (Array.isArray(value)) value.forEach((item) => walk(item, inMatch));
        else if (value && typeof value === 'object' && !(value instanceof Date)) {
            Object.entries(value).forEach(([key, inner]) => {
                if (inMatch && !key.startsWith('$')) found.add(key.split('.')[0]);
                walk(inner, inMatch || key === '$match');
            });
        }
    };
    walk(pipeline, false);
    return found;
};

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
});

afterAll(() => {
    [['KNOWLEDGE_INDEXER', ENV.indexer], ['KNOWLEDGE_RETRIEVAL', ENV.retrieval]].forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    myCache.flushAll();
    embeddings.resetBreaker();
    backfill.resetHeartbeats();
    db().uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    db().uniqueFromSchema(STATE, knowledgeIndexStateSchema);
    mockDbFor('global').seed('companies', { _id: C, Cst_CompanyName: 'Acme', knowledgeIndexer: { mode: 'on' } });
});

describe('the stored size of a chunk', () => {
    it('is declared on the strict chunk schema, with the index the figures group over', () => {
        expect(knowledgeChunksSchema.get('strict')).toBe(true);
        expect(knowledgeChunksSchema.path('textBytes')).toBeDefined();
        expect(knowledgeChunksSchema.path('textBytes').instance).toBe('Number');
        expect(knowledgeChunksSchema.indexes().map(([key]) => key)).toContainEqual(FIGURES_KEY);
    });

    it('is written with each chunk as the UTF-8 length of its text', async () => {
        db().seed(SCHEMA_TYPE.PAGES, {
            title: 'Café notes', content: { html: '<p>Crème brûlée at the café ☕ by the harbour.</p>' }, visibility: 'project', createdBy: ALICE, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'),
        });
        await backfill.backfillSource(C, 'page');
        const written = chunks().filter((c) => c.sourceType === 'page' && c.deleted !== true);
        expect(written.length).toBeGreaterThan(0);
        written.forEach((c) => expect(c.textBytes).toBe(Buffer.byteLength(c.text, 'utf8')));
        expect(written.some((c) => c.textBytes > c.text.length)).toBe(true);
    });

    it('is zero on the empty record a file owed an extraction starts from', async () => {
        const task = db().seed(SCHEMA_TYPE.TASKS, { ProjectID: PROJECT, deletedStatusKey: 0, attachments: [{ id: 'a1', filename: 'notes.txt' }] });
        await indexer.markFilesPending(C, String(task._id));
        const marker = chunks().find((c) => c.sourceType === 'file');
        expect(marker).toMatchObject({ text: '', textBytes: 0 });
    });
});

describe('the figures read no chunk bodies', () => {
    it('sums the stored size rather than measuring the text', async () => {
        chunk({ sourceId: 'p1', text: 'abc', textBytes: 7 });
        chunk({ sourceId: 'p2', text: 'abcd', textBytes: 11, ordinal: 0 });
        chunk({ sourceId: 'p3', text: 'gone', textBytes: 5, deleted: true });

        const result = await figures.workspaceFigures(C);
        const page = result.sources.find((s) => s.sourceType === 'page');

        expect(page).toMatchObject({ chunks: 2, tombstones: 1, sources: 2, textBytes: 23 });
    });

    it('never names the text or the vector in what it asks of the chunk store, and never finds whole chunks', async () => {
        chunk({ sourceId: 'p1', textBytes: 16 });
        chunk({ sourceType: 'file', sourceId: 'f1', ordinal: 0, deleted: true, text: '', textBytes: 0, tombstoneReason: 'skipped:too_large' });
        db().calls.length = 0;

        await figures.workspaceFigures(C);

        const calls = chunkCalls();
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.map((call) => call.method)).not.toContain('find');
        calls.filter((call) => call.method === 'aggregate').forEach((call) => {
            const read = fieldsRead(call.data[0]);
            expect(read.has('text')).toBe(false);
            expect(read.has('embedding')).toBe(false);
            expect(JSON.stringify(call.data[0])).not.toMatch(/\$strLenBytes|\$bsonSize/);
        });
    });

    it('groups every chunk only by fields the figures index holds, so the server answers from the index', async () => {
        chunk({ sourceId: 'p1', textBytes: 16 });
        db().calls.length = 0;

        await figures.workspaceFigures(C);

        const indexed = new Set(Object.keys(FIGURES_KEY));
        const overEveryType = chunkCalls()
            .filter((call) => call.method === 'aggregate')
            .map((call) => call.data[0])
            .filter((pipeline) => pipeline[0] && pipeline[0].$match && pipeline[0].$match.sourceType && pipeline[0].$match.sourceType.$in);
        expect(overEveryType.length).toBeGreaterThan(0);
        overEveryType.forEach((pipeline) => {
            expect([...fieldsRead(pipeline)].filter((field) => field !== '_id' && !indexed.has(field))).toEqual([]);
        });
    });
});
