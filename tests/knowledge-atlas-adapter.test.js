/* The Atlas Vector Search adapter for hosted deployments. Vectors stay on the chunk rows in each
 * tenant's database and Atlas indexes them there. The index is created or checked per tenant,
 * idempotently, and never blocks a caller. A question runs $vectorSearch with a pre-filter built
 * from the caller's visible set, then the same access clause as the in-database adapter on the
 * live documents, then retrieval's recheck() against the source rows, so access never rests on
 * the pre-filter or on an index that trails the collection. Whatever goes wrong with the store,
 * the question is answered from the lexical side and the backend says why. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/budget', () => ({ settings: jest.fn(async () => ({ monthlyBudgetUsd: 0 })) }));
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

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const llmProvider = require('../Modules/AICore/llmProvider');
const { createRetrieve } = require('../Modules/Knowledge/retrieval');
const embeddings = require('../Modules/Knowledge/embeddings');
const vectorStore = require('../Modules/Knowledge/vectorStore');
const { chunkClausesFor, filterFor } = require('../Modules/Knowledge/visibleSet');
const { matchesClause } = require('../Modules/Knowledge/adapters/vector');
const atlas = require('../Modules/Knowledge/adapters/atlas');
const fakeAtlasModule = require('./fixtures/fakeAtlas');

const fakeAtlas = fakeAtlasModule.create(() => mockDb);
const { createAtlasVectorAdapter, prefilterOf, indexDefinition, FILTER_PATHS, INDEX_NAME } = atlas;

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000011';
const OTHER = '6f0000000000000000000012';
const AGENT = '6f0000000000000000000013';
const PROJECT = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const HIDDEN_SPRINT = '6f0000000000000000000d02';
const SMALL = 'text-embedding-3-small';
const AT = new Date('2026-09-01T00:00:00Z');
const Q = [1, 0, 0];
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const ENV_KEYS = ['KNOWLEDGE_INDEXER', 'KNOWLEDGE_RETRIEVAL', 'KNOWLEDGE_VECTOR_STORE', 'KNOWLEDGE_ATLAS_NUM_CANDIDATES', 'KNOWLEDGE_ATLAS_VECTOR_LIMIT', 'KNOWLEDGE_EMBEDDING_DIMENSIONS', 'KNOWLEDGE_EMBEDDING_MODEL'];
const ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const embed = llmProvider.__embed;
const oid = (id) => new mongoose.Types.ObjectId(id);
const searches = () => fakeAtlas.calls.filter((call) => call.method === 'aggregate');
const creates = () => fakeAtlas.calls.filter((call) => call.method === 'createSearchIndex');
const stageOf = (call) => call.data[0][0].$vectorSearch;

const seedPage = (over = {}) => String(mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Harbour notes', ProjectID: PROJECT, visibility: 'project', createdBy: ME, deletedStatusKey: 0, updatedAt: AT, ...over })._id);
const seedChunk = (pageId, over = {}) => mockDb.seed(CHUNKS, {
    companyId: C, sourceType: 'page', sourceId: pageId, ordinal: 0, projectId: PROJECT, sprintId: null, taskId: '', participants: [], visibility: 'project', createdBy: ME, authorKind: 'human',
    title: 'Harbour notes', text: 'Park by the harbour.', contentHash: 'h', embedding: Q, embeddingModel: SMALL, deleted: false, sourceUpdatedAt: AT, ...over,
});
const indexedPage = (pageOver = {}, chunkOver = {}) => {
    const id = seedPage(pageOver);
    seedChunk(id, chunkOver);
    return id;
};
const ready = () => ['page', 'comment', 'transcript'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date() }));
const lexicalStub = (candidates = []) => ({ name: 'lexical', search: jest.fn(async () => candidates), upsert: async () => {}, tombstone: async () => {}, erase: async () => {}, stats: async () => ({}) });

const useAtlas = (options = {}) => vectorStore.use(createAtlasVectorAdapter({ crud: fakeAtlas.crud, ...options }));
const ask = (lexical = lexicalStub(), { userId = ME } = {}) => createRetrieve(lexical)({ companyId: C, caller: { kind: 'user', userId }, query: 'harbour' });
const ids = (result) => result.passages.map((p) => p.sourceId);

const set = (over = {}) => ({
    companyId: C, caller: { kind: 'user', userId: ME, agentId: null, runId: null }, privileged: false, projectId: null, projectIds: [PROJECT], hiddenSprintIds: [], fileProjectIds: [PROJECT],
    sourceTypes: ['page', 'comment', 'transcript', 'guide', 'file'], ...over,
});

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
});

afterAll(() => {
    Object.entries(ENV).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    fakeAtlas.reset();
    jest.clearAllMocks();
    myCache.flushAll();
    vectorStore.reset();
    embeddings.resetBreaker();
    ['KNOWLEDGE_VECTOR_STORE', 'KNOWLEDGE_ATLAS_NUM_CANDIDATES', 'KNOWLEDGE_ATLAS_VECTOR_LIMIT', 'KNOWLEDGE_EMBEDDING_DIMENSIONS', 'KNOWLEDGE_EMBEDDING_MODEL'].forEach((key) => delete process.env[key]);
    llmProvider.isEmbeddingConfigured.mockReturnValue(true);
    embed.mockImplementation(async ({ texts, model }) => ({ embeddings: texts.map(() => Q), model, inputTokens: texts.length, outputTokens: 0, totalTokens: texts.length }));
    visibleProjectIds.mockImplementation(async () => [PROJECT]);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'hybrid' } });
    ready();
});

describe('choosing the store', () => {
    it('keeps the in-database adapter by default and for "local", and takes Atlas for "atlas"', () => {
        expect(vectorStore.current().name).toBe('vector-db');
        vectorStore.reset();
        process.env.KNOWLEDGE_VECTOR_STORE = 'local';
        expect(vectorStore.current().name).toBe('vector-db');
        vectorStore.reset();
        process.env.KNOWLEDGE_VECTOR_STORE = 'atlas';
        expect(vectorStore.current().name).toBe('vector-atlas');
    });

    it('falls back to the in-database adapter for a value it does not know, and says so', () => {
        process.env.KNOWLEDGE_VECTOR_STORE = 'pinecone';
        expect(vectorStore.current().name).toBe('vector-db');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/KNOWLEDGE_VECTOR_STORE/));
    });
});

describe('the index', () => {
    it('indexes the chunk vector by cosine, at the dimensions of the embedding model, with every access field as a filter', () => {
        const definition = indexDefinition(1536);
        expect(definition.fields[0]).toEqual({ type: 'vector', path: 'embedding', numDimensions: 1536, similarity: 'cosine' });
        expect(definition.fields.slice(1)).toEqual(FILTER_PATHS.map((path) => ({ type: 'filter', path })));
        expect(FILTER_PATHS).toEqual(expect.arrayContaining(['companyId', 'sourceType', 'deleted', 'embeddingModel', 'projectId', 'sprintId', 'participants', 'visibility', 'createdBy', 'agentId', 'scope']));
    });

    it('declares as a filter every field the access clauses read, for every kind of caller', () => {
        const fields = new Set();
        const walk = (node) => Object.entries(node || {}).forEach(([key, cond]) => {
            if (key === '$and' || key === '$or') cond.forEach(walk);
            else fields.add(key);
        });
        [
            set(),
            set({ projectId: PROJECT }),
            set({ hiddenSprintIds: [HIDDEN_SPRINT] }),
            set({ projectBound: true, reachesProjectless: false, caller: { kind: 'agent', userId: ME, agentId: AGENT, runId: 'r' } }),
            set({ projectBound: true, reachesProjectless: true }),
        ].forEach((s) => Object.values(chunkClausesFor(s)).forEach(walk));
        walk({ companyId: C, sourceType: 'memory', deleted: { $ne: true }, agentId: AGENT });
        walk({ embeddingModel: SMALL });
        expect([...fields].filter((field) => !FILTER_PATHS.includes(field))).toEqual([]);
    });

    it('is created once per tenant: a second check finds it and creates nothing', async () => {
        const store = createAtlasVectorAdapter({ crud: fakeAtlas.crud });
        await expect(store.prepare({ companyId: C })).resolves.toMatchObject({ status: 'ready', dimensions: 1536 });
        await expect(store.prepare({ companyId: C })).resolves.toMatchObject({ status: 'ready' });
        expect(creates()).toHaveLength(1);
        expect(creates()[0].data[0]).toEqual({ name: INDEX_NAME, type: 'vectorSearch', definition: indexDefinition(1536) });
    });

    it('treats an index another server created in between as present', async () => {
        const store = createAtlasVectorAdapter({ crud: fakeAtlas.crud });
        const real = fakeAtlas.crud.getMockImplementation();
        let raced = false;
        fakeAtlas.crud.mockImplementation(async (companyId, q, method) => {
            if (method === 'createSearchIndex' && !raced) {
                raced = true;
                await real(companyId, q, method);
            }
            return real(companyId, q, method);
        });
        try {
            await expect(store.prepare({ companyId: C })).resolves.toMatchObject({ status: 'ready' });
        } finally {
            fakeAtlas.crud.mockImplementation(real);
        }
    });

    it('takes its dimensions from KNOWLEDGE_EMBEDDING_DIMENSIONS, then a stored vector of the model, then the model it knows', async () => {
        process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS = '8';
        await createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C });
        expect(fakeAtlas.indexOf(C).latestDefinition.fields[0].numDimensions).toBe(8);

        fakeAtlas.reset();
        delete process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS;
        indexedPage({}, { embedding: [1, 0, 0] });
        await createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C });
        expect(fakeAtlas.indexOf(C).latestDefinition.fields[0].numDimensions).toBe(3);

        fakeAtlas.reset();
        mockDb.store[CHUNKS].length = 0;
        process.env.KNOWLEDGE_EMBEDDING_MODEL = 'text-embedding-3-large';
        await createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C });
        expect(fakeAtlas.indexOf(C).latestDefinition.fields[0].numDimensions).toBe(3072);
    });

    it('creates nothing when it cannot tell the dimensions, and says why', async () => {
        process.env.KNOWLEDGE_EMBEDDING_MODEL = 'some-other-model';
        await expect(createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C })).resolves.toMatchObject({ status: 'missing', reason: 'dimensions_unknown' });
        expect(creates()).toEqual([]);
    });

    it('updates an index whose definition no longer matches, rather than leaving the old one', async () => {
        process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS = '8';
        await createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C });
        process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS = '16';
        fakeAtlas.startAs('BUILDING');
        await expect(createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C })).resolves.toMatchObject({ status: 'building', dimensions: 16 });
        expect(fakeAtlas.calls.filter((call) => call.method === 'updateSearchIndex')).toHaveLength(1);
        expect(fakeAtlas.indexOf(C).latestDefinition).toEqual(indexDefinition(16));
    });

    it.each([
        ['BUILDING', true, 'building'],
        ['PENDING', false, 'building'],
        ['READY', true, 'ready'],
        ['FAILED', false, 'failed'],
        ['STALE', true, 'ready'],
    ])('reads an Atlas status of %s (queryable %s) as %s', async (atlasStatus, queryable, status) => {
        const store = createAtlasVectorAdapter({ crud: fakeAtlas.crud });
        await store.prepare({ companyId: C });
        fakeAtlas.setStatus(C, atlasStatus, queryable);
        await expect(store.prepare({ companyId: C })).resolves.toMatchObject({ status });
    });

    it('never throws from a check: a plain MongoDB server reads as unsupported, an unreachable one as unreachable', async () => {
        fakeAtlas.mode('community');
        await expect(createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C })).resolves.toMatchObject({ status: 'unsupported' });
        fakeAtlas.mode('down');
        await expect(createAtlasVectorAdapter({ crud: fakeAtlas.crud }).prepare({ companyId: C })).resolves.toMatchObject({ status: 'unreachable' });
    });

    it('is checked for every tenant the recurring job walks, and for a new tenant without waiting on it', async () => {
        process.env.KNOWLEDGE_VECTOR_STORE = 'atlas';
        const store = useAtlas();
        const prepare = jest.spyOn(store, 'prepare');
        const backfill = require('../Modules/Knowledge/ingest/backfill');
        await backfill.backfillAll();
        expect(prepare).toHaveBeenCalledWith({ companyId: C });

        prepare.mockClear();
        let release;
        prepare.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        expect(vectorStore.prepareCompany('6f0000000000000000000c09')).toBeInstanceOf(Promise);
        expect(prepare).toHaveBeenCalledWith({ companyId: '6f0000000000000000000c09' });
        release();
    });

    it('is not asked for by the in-database adapter, and a failing check never rejects', async () => {
        await expect(vectorStore.prepareCompany(C)).resolves.toBeNull();
        vectorStore.use({ ...createAtlasVectorAdapter({ crud: fakeAtlas.crud }), prepare: async () => { throw new Error('boom'); } });
        await expect(vectorStore.prepareCompany(C)).resolves.toBeNull();
    });
});

describe('the query', () => {
    it('runs $vectorSearch on the tenant index with the pre-filter, then the full access clause on the live rows', async () => {
        const id = indexedPage();
        useAtlas();
        const result = await ask();
        expect(ids(result)).toEqual([id]);
        expect(result.backend).toBe('lexical+vector-atlas');
        const [call] = searches().filter((c) => stageOf(c).filter.$and.some((part) => part.sourceType && part.sourceType.$eq === 'page'));
        const stage = stageOf(call);
        expect(stage).toMatchObject({ index: INDEX_NAME, path: 'embedding', queryVector: Q, numCandidates: atlas.DEFAULT_NUM_CANDIDATES, limit: atlas.DEFAULT_LIMIT });
        expect(stage.filter.$and).toEqual(expect.arrayContaining([
            { embeddingModel: { $eq: SMALL } },
            { companyId: { $eq: C } },
            { sourceType: { $eq: 'page' } },
            { deleted: { $ne: true } },
        ]));
        const match = call.data[0][1].$match;
        expect(match).toMatchObject({ embeddingModel: SMALL, companyId: C, sourceType: 'page', deleted: { $ne: true } });
        expect(match.$and).toBeDefined();
    });

    it('searches only vectors of the current model version', async () => {
        indexedPage({}, { embeddingModel: 'text-embedding-ada-002' });
        const current = indexedPage({}, { embedding: [0.9, 0.1, 0] });
        useAtlas();
        expect(ids(await ask())).toEqual([current]);
    });

    it('takes numCandidates and limit from the environment, within what Atlas accepts', () => {
        expect(atlas.searchTuning()).toEqual({ numCandidates: atlas.DEFAULT_NUM_CANDIDATES, limit: atlas.DEFAULT_LIMIT });
        process.env.KNOWLEDGE_ATLAS_NUM_CANDIDATES = '400';
        process.env.KNOWLEDGE_ATLAS_VECTOR_LIMIT = '40';
        expect(atlas.searchTuning()).toEqual({ numCandidates: 400, limit: 40 });
        process.env.KNOWLEDGE_ATLAS_NUM_CANDIDATES = '20';
        expect(atlas.searchTuning()).toEqual({ numCandidates: 40, limit: 40 });
        process.env.KNOWLEDGE_ATLAS_NUM_CANDIDATES = '50000';
        expect(atlas.searchTuning().numCandidates).toBe(atlas.MAX_NUM_CANDIDATES);
        process.env.KNOWLEDGE_ATLAS_NUM_CANDIDATES = 'lots';
        process.env.KNOWLEDGE_ATLAS_VECTOR_LIMIT = '-3';
        expect(atlas.searchTuning()).toEqual({ numCandidates: atlas.DEFAULT_NUM_CANDIDATES, limit: atlas.DEFAULT_LIMIT });
    });

    it('asks for at least as many chunks as passages wanted', async () => {
        process.env.KNOWLEDGE_ATLAS_VECTOR_LIMIT = '5';
        indexedPage();
        useAtlas();
        await ask();
        expect(stageOf(searches()[0]).limit).toBeGreaterThanOrEqual(24);
    });
});

describe('the pre-filter', () => {
    const rows = [];
    const variants = {
        sourceType: ['page', 'comment', 'transcript', 'guide', 'file', 'memory'],
        projectId: [oid(PROJECT), oid(SECRET), null],
        sprintId: [null, oid(HIDDEN_SPRINT)],
        visibility: ['project', 'private'],
        createdBy: [ME, OTHER],
        participants: [[], [ME], [OTHER]],
        deleted: [false, true],
        agentId: [undefined, AGENT, OTHER],
    };
    Object.entries(variants).reduce((acc, [key, values]) => acc.flatMap((row) => values.map((value) => ({ ...row, [key]: value }))), [{ companyId: C, embeddingModel: SMALL }])
        .forEach((row) => rows.push(row));

    const sets = [
        set(),
        set({ projectId: PROJECT }),
        set({ hiddenSprintIds: [HIDDEN_SPRINT] }),
        set({ projectBound: true, reachesProjectless: false }),
        set({ projectBound: true, reachesProjectless: true }),
        set({ projectIds: [], fileProjectIds: [] }),
    ];
    const clauses = () => sets.flatMap((s) => Object.values(filterFor(s, { chunkSources: ['page', 'comment', 'transcript', 'guide', 'file'] }).clauses)
        .concat([{ companyId: C, sourceType: 'memory', deleted: { $ne: true }, agentId: AGENT }]));

    it('never keeps out a row the access clause lets in, so the post-check alone decides what narrows further', () => {
        clauses().forEach((clause) => {
            const filter = prefilterOf(clause);
            rows.forEach((row) => {
                if (matchesClause(row, clause)) expect(fakeAtlasModule.filterMatches(row, filter)).toBe(true);
            });
        });
    });

    it('narrows by what it can express: company, source, tombstone, project, sprint, visibility and agent', () => {
        const filter = prefilterOf({ ...filterFor(set({ hiddenSprintIds: [HIDDEN_SPRINT] }), { chunkSources: ['comment'] }).clauses.comment, embeddingModel: SMALL });
        const outside = rows.filter((row) => row.sourceType === 'comment' && !fakeAtlasModule.filterMatches(row, filter));
        expect(outside.some((row) => String(row.projectId) === SECRET)).toBe(true);
        expect(outside.some((row) => String(row.sprintId) === HIDDEN_SPRINT)).toBe(true);
        expect(outside.some((row) => row.deleted)).toBe(true);
        expect(rows.filter((row) => row.sourceType === 'page').every((row) => !fakeAtlasModule.filterMatches(row, filter))).toBe(true);

        const agentFilter = prefilterOf({ companyId: C, sourceType: 'memory', deleted: { $ne: true }, agentId: AGENT });
        expect(rows.filter((row) => fakeAtlasModule.filterMatches(row, agentFilter)).every((row) => row.agentId === AGENT)).toBe(true);
    });

    it('uses only declared filter paths, supported operators, no null and no empty list', () => {
        const check = (node) => Object.entries(node || {}).forEach(([key, cond]) => {
            if (key === '$and' || key === '$or') { cond.forEach(check); return; }
            expect(FILTER_PATHS).toContain(key);
            Object.entries(cond).forEach(([op, arg]) => {
                expect(['$eq', '$ne', '$in', '$nin']).toContain(op);
                if (Array.isArray(arg)) expect(arg.length).toBeGreaterThan(0);
                (Array.isArray(arg) ? arg : [arg]).forEach((value) => expect(value == null).toBe(false));
            });
        });
        clauses().forEach((clause) => check(prefilterOf(clause)));
    });
});

describe('access never rests on the pre-filter', () => {
    it('drops what a trailing index still shows as live, private to someone else, or in another project', async () => {
        const kept = indexedPage();
        const tombstoned = indexedPage();
        const madePrivate = indexedPage({ createdBy: OTHER }, { createdBy: OTHER });
        const moved = indexedPage();
        const store = useAtlas();
        await store.prepare({ companyId: C });
        fakeAtlas.lag(C);
        const live = (id) => mockDb.store[CHUNKS].find((row) => row.sourceId === id);
        live(tombstoned).deleted = true;
        live(madePrivate).visibility = 'private';
        live(moved).projectId = SECRET;

        const passages = await store.search({ companyId: C, queryEmbedding: Q, model: SMALL, filter: filterFor(set({ sourceTypes: ['page'] }), { chunkSources: ['page'] }), limit: 10 });

        expect(passages.map((p) => p.sourceId)).toEqual([kept]);
    });

    it('rechecks what the store returns against the live source rows', async () => {
        const kept = indexedPage();
        const madePrivate = indexedPage({ createdBy: OTHER }, { createdBy: OTHER });
        const deletedPage = indexedPage();
        useAtlas();
        mockDb.store[SCHEMA_TYPE.PAGES].find((row) => String(row._id) === madePrivate).visibility = 'private';
        mockDb.store[SCHEMA_TYPE.PAGES].find((row) => String(row._id) === deletedPage).deletedStatusKey = 1;

        const result = await ask();

        expect(result.backend).toBe('lexical+vector-atlas');
        expect(ids(result)).toEqual([kept]);
    });
});

describe('when the store cannot answer, the lexical side does', () => {
    const lexicalOnly = () => {
        const id = seedPage();
        return { id, lexical: lexicalStub([{ id: `page:${id}`, sourceType: 'page', sourceId: id, projectId: PROJECT, title: 't', excerpt: 'e', score: 3, authorKind: 'user', updatedAt: AT }]) };
    };

    it('while the index is building, without running a search', async () => {
        indexedPage();
        fakeAtlas.startAs('BUILDING');
        useAtlas();
        const { id, lexical } = lexicalOnly();
        const result = await ask(lexical);
        expect(result.backend).toBe('lexical (vector index building)');
        expect(ids(result)).toEqual([id]);
        expect(searches()).toEqual([]);
    });

    it('when the index is missing, and starts creating it', async () => {
        indexedPage();
        fakeAtlas.startAs('BUILDING');
        const store = useAtlas();
        const prepare = jest.spyOn(store, 'prepare');
        await store.prepare({ companyId: C });
        prepare.mockClear();
        fakeAtlas.reset();
        await store.health({ companyId: C, refresh: true });
        const result = await ask(lexicalOnly().lexical);
        expect(result.backend).toBe('lexical (vector index missing)');
        expect(prepare).toHaveBeenCalledWith({ companyId: C });
    });

    it('when the index failed', async () => {
        indexedPage();
        fakeAtlas.startAs('FAILED');
        useAtlas();
        expect((await ask(lexicalOnly().lexical)).backend).toBe('lexical (vector index failed)');
    });

    it('on a MongoDB server without Atlas Search, and stops asking it', async () => {
        indexedPage();
        const store = useAtlas();
        await store.prepare({ companyId: C });
        fakeAtlas.mode('community');
        const first = await ask(lexicalOnly().lexical);
        expect(first.backend).toBe('lexical (vector store unsupported)');
        const asked = fakeAtlas.calls.length;
        const second = await ask(lexicalOnly().lexical);
        expect(second.backend).toMatch(/^lexical \(vector store (unsupported|paused)\)$/);
        expect(fakeAtlas.calls.length).toBe(asked);
    });

    it('when Atlas is unreachable, and pauses after repeated failures until the cooldown passes', async () => {
        indexedPage();
        let now = Date.now();
        const store = useAtlas({ now: () => now });
        await store.prepare({ companyId: C });
        fakeAtlas.mode('down');
        for (let i = 0; i < atlas.BREAKER_FAILURES; i += 1) {
            expect((await ask(lexicalOnly().lexical)).backend).toBe('lexical (vector store unreachable)');
        }
        const asked = searches().length;
        expect((await ask(lexicalOnly().lexical)).backend).toBe('lexical (vector store paused)');
        expect(searches().length).toBe(asked);
        expect(await store.health({ companyId: C })).toMatchObject({ breaker: { open: true, reason: 'unreachable' } });

        fakeAtlas.mode('atlas');
        now += atlas.BREAKER_COOLDOWN_MS + 1;
        expect((await ask(lexicalOnly().lexical)).backend).toBe('lexical+vector-atlas');
        expect(await store.health({ companyId: C })).toMatchObject({ breaker: { open: false } });
    });

    it('never errors the caller, whatever the store throws', async () => {
        indexedPage();
        const store = useAtlas();
        await store.prepare({ companyId: C });
        const real = fakeAtlas.crud.getMockImplementation();
        fakeAtlas.crud.mockImplementation(async (companyId, q, method) => {
            if (method === 'aggregate' && q.data[0][0] && q.data[0][0].$vectorSearch) throw new TypeError('something odd');
            return real(companyId, q, method);
        });
        try {
            await expect(ask(lexicalOnly().lexical)).resolves.toMatchObject({ backend: 'lexical (vector failed)' });
        } finally {
            fakeAtlas.crud.mockImplementation(real);
        }
    });
});

describe('writes', () => {
    it('upsert starts the index check for a tenant whose index is not known yet', async () => {
        const store = createAtlasVectorAdapter({ crud: fakeAtlas.crud });
        const prepare = jest.spyOn(store, 'prepare');
        await store.upsert({ companyId: C, chunks: [{ sourceType: 'page', sourceId: 'x', ordinal: 0, embedding: Q, embeddingModel: SMALL }] });
        expect(prepare).toHaveBeenCalledWith({ companyId: C });
    });

    it('erase removes the named sources from the tenant store, and only those', async () => {
        const gone = indexedPage();
        const kept = indexedPage();
        const store = createAtlasVectorAdapter({ crud: fakeAtlas.crud });
        await expect(store.erase({ companyId: C, sources: [{ sourceType: 'page', sourceId: gone }] })).resolves.toMatchObject({ backend: 'vector-atlas', erased: 1 });
        expect(mockDb.store[CHUNKS].map((row) => row.sourceId)).toEqual([kept]);
        await expect(store.erase({ companyId: C, sources: [] })).resolves.toMatchObject({ erased: 0 });
        expect(mockDb.store[CHUNKS]).toHaveLength(1);
    });
});

describe('the console figures', () => {
    it('show the store, the index state and the breaker for Atlas', async () => {
        const figures = require('../Modules/Knowledge/figures');
        indexedPage();
        const store = useAtlas();
        await store.prepare({ companyId: C });
        const result = await figures.workspaceFigures(C, { refresh: true });
        expect(result.vectorStore).toMatchObject({ backend: 'atlas', index: { name: INDEX_NAME, status: 'ready', dimensions: 3 }, breaker: { open: false } });

        fakeAtlas.setStatus(C, 'BUILDING', false);
        expect((await figures.workspaceFigures(C, { refresh: true })).vectorStore.index.status).toBe('building');
    });

    it('show the in-database store with no index to manage', async () => {
        const figures = require('../Modules/Knowledge/figures');
        const result = await figures.workspaceFigures(C, { refresh: true });
        expect(result.vectorStore).toEqual({ backend: 'local', index: null, breaker: null });
    });
});
