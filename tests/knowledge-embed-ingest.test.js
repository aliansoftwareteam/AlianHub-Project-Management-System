/* Embedding at ingest. A company in hybrid mode has every chunk embedded as it is written; the
 * embedding is reused while the text and the model are unchanged, replaced when either changes,
 * and never blocks the lexical write: a failed embed stores the chunk without a vector and queues
 * a retry. A company in "on" mode never embeds. The provider is a mock; nothing reaches a vendor. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => {
    const embed = jest.fn();
    return {
        __embed: embed,
        isEmbeddingConfigured: jest.fn(() => true),
        embeddingProvider: jest.fn(() => ({ name: 'openai', embed })),
        getProvider: jest.fn(),
        isAnyProviderConfigured: () => false,
    };
});

const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const llmProvider = require('../Modules/AICore/llmProvider');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const backfill = require('../Modules/Knowledge/ingest/backfill');
const { eraseDocument, erasePerson } = require('../Modules/Knowledge/ingest/erase');
const embeddings = require('../Modules/Knowledge/embeddings');
const vectorStore = require('../Modules/Knowledge/vectorStore');
const { createInMemoryVectorAdapter } = require('../Modules/Knowledge/adapters/vector');

const C = '6f0000000000000000000c01';
const ON = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000011';
const PROJECT = '6f0000000000000000000a01';
const SMALL = 'text-embedding-3-small';
const LARGE = 'text-embedding-3-large';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retrieval: process.env.KNOWLEDGE_RETRIEVAL, model: process.env.KNOWLEDGE_EMBEDDING_MODEL };

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const embed = llmProvider.__embed;
const vectorOf = (text, model) => [text.length, model.length, 1];
const answering = () => embed.mockImplementation(async ({ texts, model }) => ({ embeddings: texts.map((t) => vectorOf(t, model)), model, inputTokens: texts.length, outputTokens: 0, totalTokens: texts.length }));
const failing = () => embed.mockRejectedValue(Object.assign(new Error('OpenAI: socket hang up'), { type: 'network', retryable: true }));

const chunksOf = (sourceId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(sourceId) && !c.deleted).sort((a, b) => a.ordinal - b.ordinal);
const chunkWrites = () => mockDb.calls.filter((c) => c.type === CHUNKS && c.method !== 'find' && c.method !== 'findOne');
const embeddedTexts = () => embed.mock.calls.map(([opts]) => opts.texts);

const seedPage = (companyId, over = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    title: 'Handbook', content: { html: '<p>Intro paragraph.</p><h2>Leave</h2><p>Twenty days a year.</p>' }, visibility: 'project', createdBy: OWNER, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});
const seedComment = (over = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'The vault code is 4411.', type: 'text', project: true, projectId: PROJECT, isDeleted: false, userId: OWNER, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over });
const ready = (companyId, sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId, sourceType, status: 'complete', lastSeenOnAt: new Date() });

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
});

afterAll(() => {
    ['KNOWLEDGE_INDEXER', 'KNOWLEDGE_RETRIEVAL', 'KNOWLEDGE_EMBEDDING_MODEL'].forEach((key, i) => {
        const value = [ENV.indexer, ENV.retrieval, ENV.model][i];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    delete process.env.KNOWLEDGE_EMBEDDING_MODEL;
    llmProvider.isEmbeddingConfigured.mockReturnValue(true);
    answering();
    indexer.clearEmbedRetries();
    embeddings.resetBreaker();
    vectorStore.reset();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'hybrid' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: ON, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'One', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, status: 2, isDelete: false });
});

describe('the embedding model', () => {
    it('defaults to text-embedding-3-small and follows KNOWLEDGE_EMBEDDING_MODEL', () => {
        expect(embeddings.DEFAULT_MODEL).toBe(SMALL);
        expect(embeddings.model()).toBe(SMALL);
        process.env.KNOWLEDGE_EMBEDDING_MODEL = ` ${LARGE} `;
        expect(embeddings.model()).toBe(LARGE);
        process.env.KNOWLEDGE_EMBEDDING_MODEL = '';
        expect(embeddings.model()).toBe(SMALL);
    });
});

describe('a hybrid company embeds each chunk on write', () => {
    it('stores the vector and the model beside the text, in the same version-checked write, booked to the knowledge feature', async () => {
        const page = seedPage(C);
        const result = await indexer.ingestPage(C, page);

        const chunks = chunksOf(page._id);
        expect(chunks).toHaveLength(2);
        expect(result).toMatchObject({ written: 2, embedded: 2, embedFailed: false });
        expect(embed).toHaveBeenCalledTimes(1);
        expect(embed.mock.calls[0][0]).toEqual({ texts: chunks.map((c) => c.text), model: SMALL, spend: { feature: 'knowledge_embed', companyId: C } });
        chunks.forEach((chunk) => {
            expect(chunk.embedding).toEqual(vectorOf(chunk.text, SMALL));
            expect(chunk.embeddingModel).toBe(SMALL);
        });
        const writes = chunkWrites().filter((c) => c.method === 'updateOne');
        expect(writes).toHaveLength(2);
        writes.forEach((write) => {
            expect(write.data[1].$set.embedding).toEqual(expect.any(Array));
            expect(write.data[0].$or).toBeDefined();
        });
    });

    it('does not embed again while the text and the model are unchanged', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        mockDb.calls.length = 0;
        embed.mockClear();

        const result = await indexer.ingestPage(C, page);

        expect(result).toMatchObject({ written: 0, unchanged: 2, embedded: 0 });
        expect(embed).not.toHaveBeenCalled();
        expect(chunkWrites()).toEqual([]);
    });

    it('re-embeds only the chunk whose text changed, and keeps the other vector', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        const [intro] = chunksOf(page._id);
        embed.mockClear();

        page.content = { html: '<p>Intro paragraph.</p><h2>Leave</h2><p>Thirty days a year.</p>' };
        page.updatedAt = new Date('2026-09-02T00:00:00Z');
        await indexer.ingestPage(C, page);

        const chunks = chunksOf(page._id);
        expect(embeddedTexts()).toEqual([[chunks[1].text]]);
        expect(chunks[0].embedding).toEqual(intro.embedding);
        expect(chunks[1].embedding).toEqual(vectorOf(chunks[1].text, SMALL));
        chunks.forEach((chunk) => expect(chunk.embeddingModel).toBe(SMALL));
    });

    it('re-embeds every chunk when the model changes, with the new model', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        embed.mockClear();

        process.env.KNOWLEDGE_EMBEDDING_MODEL = LARGE;
        const result = await indexer.ingestPage(C, page);

        expect(result).toMatchObject({ written: 2, embedded: 2 });
        expect(embed).toHaveBeenCalledTimes(1);
        expect(embed.mock.calls[0][0].model).toBe(LARGE);
        chunksOf(page._id).forEach((chunk) => {
            expect(chunk.embeddingModel).toBe(LARGE);
            expect(chunk.embedding).toEqual(vectorOf(chunk.text, LARGE));
        });
    });

    it('embeds comments and transcripts the same way, through their syncs', async () => {
        const comment = seedComment();
        await indexer.syncComment(C, String(comment._id));
        const call = mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'c1', title: 'Standup', participants: [OWNER], transcript: 'We agreed the rollout.', deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z') });
        await indexer.syncTranscript(C, String(call._id));

        expect(chunksOf(comment._id).map((c) => c.embeddingModel)).toEqual([SMALL]);
        expect(chunksOf(call._id).map((c) => c.embeddingModel)).toEqual([SMALL]);
        expect(embed).toHaveBeenCalledTimes(2);
    });
});

describe('an embed failure never blocks the lexical write', () => {
    it('stores the chunk without a vector, reports the failure, and queues a retry that embeds once the provider answers', async () => {
        failing();
        const page = seedPage(C);

        const result = await indexer.ingestPage(C, page);

        expect(result).toMatchObject({ written: 2, embedded: 0, embedFailed: true });
        const chunks = chunksOf(page._id);
        expect(chunks.map((c) => c.text.length > 0)).toEqual([true, true]);
        chunks.forEach((chunk) => expect(chunk).toMatchObject({ embedding: [], embeddingModel: null }));
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
        expect(indexer.embedRetries()).toEqual([`${C}:page:${page._id}`]);

        answering();
        await indexer.flushEmbedRetries();

        expect(indexer.embedRetries()).toEqual([]);
        expect(embeddedTexts()).toHaveLength(2);
        chunksOf(page._id).forEach((chunk) => expect(chunk).toMatchObject({ embedding: vectorOf(chunk.text, SMALL), embeddingModel: SMALL }));
    });

    it('queues one retry per source however many chunks failed, and gives up after the last attempt', async () => {
        failing();
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        for (let attempt = 0; attempt < indexer.EMBED_RETRY_ATTEMPTS; attempt += 1) {
            expect(indexer.embedRetries()).toEqual([`${C}:page:${page._id}`]);
            await indexer.flushEmbedRetries();
        }
        expect(indexer.embedRetries()).toEqual([]);
        expect(embed).toHaveBeenCalledTimes(1 + indexer.EMBED_RETRY_ATTEMPTS);
        chunksOf(page._id).forEach((chunk) => expect(chunk.embeddingModel).toBeNull());
    });

    it('never overwrites a stored vector for unchanged text when a later embed fails', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        const before = chunksOf(page._id).map((c) => c.embedding);

        failing();
        page.content = { html: '<p>Intro paragraph.</p><h2>Leave</h2><p>Thirty days a year.</p>' };
        page.updatedAt = new Date('2026-09-02T00:00:00Z');
        await indexer.ingestPage(C, page);

        const chunks = chunksOf(page._id);
        expect(chunks[0]).toMatchObject({ embedding: before[0], embeddingModel: SMALL });
        expect(chunks[1]).toMatchObject({ embedding: [], embeddingModel: null });
    });

    it('writes without a vector and queues nothing while no instance key is set', async () => {
        llmProvider.isEmbeddingConfigured.mockReturnValue(false);
        const page = seedPage(C);
        const result = await indexer.ingestPage(C, page);
        expect(result).toMatchObject({ written: 2, embedded: 0, embedFailed: false });
        expect(embed).not.toHaveBeenCalled();
        expect(indexer.embedRetries()).toEqual([]);
        chunksOf(page._id).forEach((chunk) => expect(chunk).toMatchObject({ embedding: [], embeddingModel: null }));
    });
});

describe('a company outside hybrid never embeds', () => {
    it('writes chunks for an "on" company with no vector and no provider call', async () => {
        const page = seedPage(ON);
        const result = await indexer.ingestPage(ON, page);
        expect(result).toMatchObject({ written: 2, embedded: 0 });
        expect(embed).not.toHaveBeenCalled();
        expect(llmProvider.embeddingProvider).not.toHaveBeenCalled();
        chunksOf(page._id).forEach((chunk) => expect(chunk).toMatchObject({ embedding: [], embeddingModel: null }));
    });

    it('treats a hybrid row as off while KNOWLEDGE_RETRIEVAL is off for the installation', async () => {
        process.env.KNOWLEDGE_RETRIEVAL = 'off';
        try {
            const page = seedPage(C);
            await indexer.ingestPage(C, page);
            expect(embed).not.toHaveBeenCalled();
            chunksOf(page._id).forEach((chunk) => expect(chunk.embeddingModel).toBeNull());
        } finally {
            process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
        }
    });

    it('leaves the write of an "on" company as it was: no vector fields compared, no extra write', async () => {
        const page = seedPage(ON);
        await indexer.ingestPage(ON, page);
        mockDb.calls.length = 0;
        expect(await indexer.ingestPage(ON, page)).toMatchObject({ written: 0, unchanged: 2 });
        expect(chunkWrites()).toEqual([]);
    });
});

describe('the recurring job re-embeds what is still missing', () => {
    const seedChunk = (companyId, sourceId, over = {}) => mockDb.seed(CHUNKS, {
        companyId, sourceType: 'page', sourceId: String(sourceId), ordinal: 0, projectId: PROJECT, visibility: 'project', createdBy: OWNER, authorKind: 'human',
        title: 'Handbook', headingPath: ['Handbook'], text: 'Handbook\nIntro paragraph.', contentHash: 'stale', embedding: [], embeddingModel: null, deleted: false, sourceUpdatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
    });

    beforeEach(() => {
        ['page', 'comment', 'transcript'].forEach((sourceType) => { ready(C, sourceType); ready(ON, sourceType); });
    });

    it('syncs the sources of a hybrid company whose chunks carry no vector for the current model, and leaves an "on" company alone', async () => {
        const hybridPage = seedPage(C);
        const onPage = seedPage(ON);
        seedChunk(C, hybridPage._id);
        seedChunk(ON, onPage._id);
        const current = seedPage(C, { title: 'Current' });
        await indexer.ingestPage(C, current);
        embed.mockClear();

        const summary = await backfill.backfillAll();

        expect(summary).toMatchObject({ companies: 2, reembedded: { [C]: 1 } });
        expect(embed).toHaveBeenCalledTimes(1);
        chunksOf(hybridPage._id).forEach((chunk) => expect(chunk).toMatchObject({ embeddingModel: SMALL }));
        chunksOf(onPage._id).forEach((chunk) => expect(chunk).toMatchObject({ embeddingModel: null }));
    });

    it('re-embeds chunks left on an older model', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        process.env.KNOWLEDGE_EMBEDDING_MODEL = LARGE;
        embed.mockClear();

        await backfill.backfillAll();

        expect(embed).toHaveBeenCalledTimes(1);
        chunksOf(page._id).forEach((chunk) => expect(chunk.embeddingModel).toBe(LARGE));
    });

    it('stops the sweep at the first failure instead of paying for every source', async () => {
        const pages = [seedPage(C), seedPage(C, { title: 'Second' })];
        pages.forEach((page) => seedChunk(C, page._id));
        failing();

        const summary = await backfill.backfillAll();

        expect(embed).toHaveBeenCalledTimes(1);
        expect(summary.reembedded[C]).toBe(0);
    });

    it('sweeps at most a batch per run', async () => {
        const pages = Array.from({ length: indexer.REEMBED_BATCH + 2 }, (_, i) => seedPage(C, { title: `Page ${i}` }));
        pages.forEach((page) => seedChunk(C, page._id));

        const summary = await backfill.backfillAll();

        expect(summary.reembedded[C]).toBe(indexer.REEMBED_BATCH);
        expect(embed).toHaveBeenCalledTimes(indexer.REEMBED_BATCH);
    });
});

describe('the vector store seam', () => {
    let adapter;

    beforeEach(() => {
        adapter = createInMemoryVectorAdapter();
        jest.spyOn(adapter, 'upsert');
        jest.spyOn(adapter, 'tombstone');
        jest.spyOn(adapter, 'erase');
        vectorStore.use(adapter);
    });

    it('hands every embedded chunk to the store after the row is written', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        expect(adapter.upsert).toHaveBeenCalledTimes(1);
        const [{ companyId, chunks }] = adapter.upsert.mock.calls[0];
        expect(companyId).toBe(C);
        expect(chunks.map((c) => [c.sourceType, c.sourceId, c.ordinal, c.embeddingModel])).toEqual([['page', String(page._id), 0, SMALL], ['page', String(page._id), 1, SMALL]]);
        chunks.forEach((chunk) => expect(chunk.embedding).toEqual(expect.any(Array)));
    });

    it('hands nothing to the store for an "on" company or a failed embed', async () => {
        await indexer.ingestPage(ON, seedPage(ON));
        failing();
        await indexer.ingestPage(C, seedPage(C));
        expect(adapter.upsert).not.toHaveBeenCalled();
    });

    it('tells the store about tombstones and erasures by source', async () => {
        const page = seedPage(C);
        await indexer.ingestPage(C, page);
        await indexer.tombstonePages(C, [String(page._id)]);
        expect(adapter.tombstone).toHaveBeenCalledWith({ companyId: C, sourceType: 'page', sourceIds: [String(page._id)] });

        await eraseDocument(C, { sourceType: 'page', sourceId: String(page._id) });
        expect(adapter.erase).toHaveBeenCalledWith({ companyId: C, sources: [{ sourceType: 'page', sourceId: String(page._id) }] });
    });

    it("tells the store exactly which sources an erasure by person removed: the person's private pages and comments, never their shared pages or calls", async () => {
        const shared = seedPage(C, { title: 'Shared' });
        const secret = seedPage(C, { title: 'Secret', visibility: 'private' });
        const comment = seedComment();
        const call = mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'c1', title: 'Standup', participants: [OWNER], createdBy: OWNER, transcript: 'We agreed the rollout.', deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z') });
        await indexer.ingestPage(C, shared);
        await indexer.ingestPage(C, secret);
        await indexer.syncComment(C, String(comment._id));
        await indexer.syncTranscript(C, String(call._id));

        await erasePerson(C, OWNER);

        expect(adapter.erase).toHaveBeenCalledTimes(1);
        const [{ companyId, sources }] = adapter.erase.mock.calls[0];
        expect(companyId).toBe(C);
        expect(sources.map((s) => `${s.sourceType}:${s.sourceId}`).sort()).toEqual([`comment:${comment._id}`, `page:${secret._id}`].sort());
        const kept = chunksOf(shared._id).length + chunksOf(call._id).length;
        expect(kept).toBe(3);
        expect((await adapter.stats({ companyId: C })).embedded).toEqual({ [SMALL]: kept });
    });
});

describe('a bad key cannot pay for a corpus of refusals', () => {
    const refusing = (over = {}) => embed.mockRejectedValue(Object.assign(new Error('Invalid OpenAI API key. Check the API key configuration.'), { type: 'auth', code: 'invalid_api_key', retryable: false, retryAfterMs: null, ...over }));
    const paused = () => logger.warn.mock.calls.filter(([message]) => /paused/.test(message));

    it('stops embedding for the company after a run of consecutive failures, keeps writing the text, and says so once', async () => {
        refusing();
        const pages = Array.from({ length: embeddings.BREAKER_FAILURES + 3 }, (_, i) => seedPage(C, { title: `Page ${i}` }));
        for (const page of pages) await indexer.ingestPage(C, page);

        expect(embed).toHaveBeenCalledTimes(embeddings.BREAKER_FAILURES);
        pages.forEach((page) => {
            expect(chunksOf(page._id)).toHaveLength(2);
            chunksOf(page._id).forEach((chunk) => expect(chunk.embeddingModel).toBeNull());
        });
        expect(paused()).toHaveLength(1);
        expect(embeddings.breakerState(C)).toMatchObject({ open: true, reason: 'failures' });

        await indexer.flushEmbedRetries();
        expect(embed).toHaveBeenCalledTimes(embeddings.BREAKER_FAILURES);
        expect(indexer.embedRetries()).toEqual([]);
    });

    it('resumes after the cooldown, and a success closes the run of failures', async () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date('2026-09-18T10:00:00Z'));
            refusing();
            for (let i = 0; i < embeddings.BREAKER_FAILURES; i += 1) await indexer.ingestPage(C, seedPage(C, { title: `Page ${i}` }));
            answering();
            await indexer.ingestPage(C, seedPage(C, { title: 'Still paused' }));
            expect(embed).toHaveBeenCalledTimes(embeddings.BREAKER_FAILURES);

            jest.setSystemTime(new Date('2026-09-18T10:10:01Z'));
            const page = seedPage(C, { title: 'Resumed' });
            await indexer.ingestPage(C, page);
            expect(embed).toHaveBeenCalledTimes(embeddings.BREAKER_FAILURES + 1);
            chunksOf(page._id).forEach((chunk) => expect(chunk.embeddingModel).toBe(SMALL));
            expect(embeddings.breakerState(C)).toMatchObject({ open: false, failures: 0 });
            expect(embeddings.BREAKER_COOLDOWN_MS).toBe(10 * 60 * 1000);
        } finally {
            jest.useRealTimers();
        }
    });

    it('honours the wait the vendor asked for as the cooldown', async () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date('2026-09-18T10:00:00Z'));
            refusing({ type: 'rate_limit', code: 'rate_limit', retryable: true, retryAfterMs: 5000 });
            for (let i = 0; i < embeddings.BREAKER_FAILURES; i += 1) await indexer.ingestPage(C, seedPage(C, { title: `Page ${i}` }));
            expect(embeddings.breakerState(C)).toMatchObject({ open: true, until: new Date('2026-09-18T10:00:05Z').getTime() });

            answering();
            jest.setSystemTime(new Date('2026-09-18T10:00:06Z'));
            await indexer.ingestPage(C, seedPage(C, { title: 'Resumed' }));
            expect(embed).toHaveBeenCalledTimes(embeddings.BREAKER_FAILURES + 1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('pauses at once on a budget refusal, queues no retry, and never counts it as a provider failure', async () => {
        embed.mockRejectedValue(Object.assign(new Error('ai_budget_exhausted: this call is estimated at $0.0000'), { code: 'ai_budget_exhausted' }));
        const page = seedPage(C);

        const result = await indexer.ingestPage(C, page);

        expect(result).toMatchObject({ written: 2, embedded: 0, embedFailed: true, embedRefused: true });
        chunksOf(page._id).forEach((chunk) => expect(chunk).toMatchObject({ embedding: [], embeddingModel: null }));
        expect(indexer.embedRetries()).toEqual([]);
        expect(embeddings.breakerState(C)).toMatchObject({ open: true, reason: 'budget' });
        expect(logger.error).not.toHaveBeenCalled();

        await indexer.ingestPage(C, seedPage(C, { title: 'Second' }));
        expect(embed).toHaveBeenCalledTimes(1);
    });

    it('keeps one company\'s pause from touching another', async () => {
        refusing();
        for (let i = 0; i < embeddings.BREAKER_FAILURES; i += 1) await indexer.ingestPage(C, seedPage(C, { title: `Page ${i}` }));
        const other = '6f0000000000000000000c03';
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: other, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'hybrid' } });
        answering();
        const page = seedPage(other);
        await indexer.ingestPage(other, page);
        expect(embed).toHaveBeenCalledTimes(embeddings.BREAKER_FAILURES + 1);
        chunksOf(page._id).forEach((chunk) => expect(chunk.embeddingModel).toBe(SMALL));
    });
});

describe('the vector store seam, continued', () => {
    it('is not told about writes the store cannot use', async () => {
        const adapter = createInMemoryVectorAdapter();
        jest.spyOn(adapter, 'upsert');
        vectorStore.use(adapter);
        embed.mockRejectedValue(Object.assign(new Error('ai_budget_exhausted'), { code: 'ai_budget_exhausted' }));
        await indexer.ingestPage(C, seedPage(C));
        expect(adapter.upsert).not.toHaveBeenCalled();
    });

    it('falls back to the in-database store, whose vectors ride on the chunk rows', () => {
        vectorStore.reset();
        expect(vectorStore.current().name).toBe('vector-db');
    });
});
