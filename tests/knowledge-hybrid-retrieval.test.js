/* Hybrid retrieval. For a company in hybrid mode the question is embedded once, the lexical
 * and vector candidates are fused by reciprocal rank, and everything #745 and #747 forced still
 * holds afterwards: the per-source floor on the lexical side, the agent penalty, one passage per
 * source, and the recheck against live rows. A company in "on" mode gets the lexical answer
 * exactly as before, and no embedding is ever computed for it. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
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

const { myCache } = require('../Config/config');
const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const llmProvider = require('../Modules/AICore/llmProvider');
const { createRetrieve, fuseByRank, RRF_K } = require('../Modules/Knowledge/retrieval');
const vectorStore = require('../Modules/Knowledge/vectorStore');

const C = '6f0000000000000000000c01';
const ON = '6f0000000000000000000c02';
const ME = '6f0000000000000000000011';
const OTHER = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';
const SMALL = 'text-embedding-3-small';
const AT = new Date('2026-09-01T00:00:00Z');
const NEWER = new Date('2026-09-09T00:00:00Z');
const QUERY_VECTOR = [1, 0, 0];
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retrieval: process.env.KNOWLEDGE_RETRIEVAL };

const embed = llmProvider.__embed;
const rrf = (...ranks) => ranks.reduce((sum, rank) => sum + 1 / (RRF_K + rank), 0);

const passage = (sourceType, sourceId, score, over = {}) => ({ id: `${sourceType}:${sourceId}`, sourceType, sourceId, projectId: PROJECT, title: sourceId, excerpt: `${sourceType} excerpt`, score, authorKind: 'user', updatedAt: AT, ...over });
const lexicalStub = (candidates) => ({ name: 'lexical', search: jest.fn(async () => candidates), upsert: async () => {}, tombstone: async () => {}, erase: async () => {}, stats: async () => ({}) });
const vectorStub = (candidates) => ({ name: 'stub-vector', search: jest.fn(async () => candidates), upsert: async () => {}, tombstone: async () => {}, erase: async () => {}, stats: async () => ({}) });

const seed = (type, doc) => String(mockDb.seed(type, doc)._id);
const livePage = (over = {}) => seed(SCHEMA_TYPE.PAGES, { title: 'p', ProjectID: PROJECT, visibility: 'project', createdBy: ME, deletedStatusKey: 0, updatedAt: AT, ...over });
const liveTask = () => seed(SCHEMA_TYPE.TASKS, { TaskName: 't', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: AT });
const ready = (companyId) => ['page', 'comment', 'transcript'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId, sourceType, status: 'complete', lastSeenOnAt: new Date() }));

const ask = (lexical, vector, { companyId = C, userId = ME, query = 'harbour budget', limit } = {}) => {
    vectorStore.use(vector);
    return createRetrieve(lexical)({ companyId, caller: { kind: 'user', userId }, query, limit });
};
const ids = (result) => result.passages.map((p) => p.sourceId);
const scores = (result) => result.passages.map((p) => Number(p.score.toFixed(6)));

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
});

afterAll(() => {
    if (ENV.indexer === undefined) delete process.env.KNOWLEDGE_INDEXER; else process.env.KNOWLEDGE_INDEXER = ENV.indexer;
    if (ENV.retrieval === undefined) delete process.env.KNOWLEDGE_RETRIEVAL; else process.env.KNOWLEDGE_RETRIEVAL = ENV.retrieval;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    vectorStore.reset();
    llmProvider.isEmbeddingConfigured.mockReturnValue(true);
    embed.mockImplementation(async ({ texts, model }) => ({ embeddings: texts.map(() => QUERY_VECTOR), model, inputTokens: texts.length, outputTokens: 0, totalTokens: texts.length }));
    visibleProjectIds.mockImplementation(async () => [PROJECT]);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'hybrid' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: ON, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'on' } });
    ready(C);
    ready(ON);
});

describe('reciprocal rank fusion', () => {
    it('sums 1/(k + rank) over the lists a passage appears in, and orders by the sum', () => {
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => passage('page', id, 0));
        const fused = fuseByRank([[a, b, c], [b, d, a]]);
        expect(fused.map((p) => p.sourceId)).toEqual(['b', 'a', 'd', 'c']);
        expect(fused.map((p) => Number(p.score.toFixed(6)))).toEqual([rrf(2, 1), rrf(1, 3), rrf(2), rrf(3)].map((n) => Number(n.toFixed(6))));
        expect(RRF_K).toBe(60);
    });

    it('keeps the passage from the list that ranked it higher, so the lexical excerpt wins a tie', () => {
        const fromLexical = passage('page', 'a', 8, { excerpt: 'lexical excerpt' });
        const fromVector = passage('page', 'a', 0.9, { excerpt: 'vector excerpt' });
        expect(fuseByRank([[fromLexical], [fromVector]])[0].excerpt).toBe('lexical excerpt');
        expect(fuseByRank([[passage('page', 'z', 1), fromLexical], [fromVector]])[0].excerpt).toBe('vector excerpt');
    });
});

describe('a hybrid company fuses lexical and vector candidates', () => {
    it('embeds the question once, booked to the knowledge feature with the asker, and searches the vector store under the same filter', async () => {
        const [p1, p2, p3] = [livePage(), livePage(), livePage()];
        const lexical = lexicalStub([passage('page', p1, 8), passage('page', p2, 6)]);
        const vector = vectorStub([passage('page', p2, 0.9), passage('page', p3, 0.8)]);

        const result = await ask(lexical, vector);

        expect(ids(result)).toEqual([p2, p1, p3]);
        expect(scores(result)).toEqual([rrf(2, 1), rrf(1), rrf(2)].map((n) => Number(n.toFixed(6))));
        expect(result.backend).toBe('lexical+stub-vector');
        expect(embed).toHaveBeenCalledTimes(1);
        expect(embed.mock.calls[0][0]).toEqual({ texts: ['harbour budget'], model: SMALL, spend: { feature: 'knowledge_embed', companyId: C, userId: ME } });
        expect(vector.search).toHaveBeenCalledTimes(1);
        const [args] = vector.search.mock.calls[0];
        expect(args).toMatchObject({ companyId: C, queryEmbedding: QUERY_VECTOR, model: SMALL, limit: 24 });
        expect(args.filter).toBe(lexical.search.mock.calls[0][0].filter);
        expect(args.filter.chunkSources).toEqual(['page', 'comment', 'transcript']);
    });

    it('still scales the lexical side against its floor, so a lone weak page stays below strong tasks', async () => {
        const weak = livePage({ updatedAt: NEWER });
        const [t1, t2] = [liveTask(), liveTask()];
        const lexical = lexicalStub([passage('page', weak, 0.4, { updatedAt: NEWER }), passage('task', t1, 3), passage('task', t2, 2.4)]);

        const result = await ask(lexical, vectorStub([]));

        expect(ids(result)).toEqual([t1, t2, weak]);
    });

    it('applies the agent penalty after fusion: an agent draft ranked first everywhere ends below the human page ranked second', async () => {
        const draft = livePage({ createdByAgent: true });
        const human = livePage();
        const lexical = lexicalStub([passage('page', draft, 5, { authorKind: 'agent' }), passage('page', human, 4)]);
        const vector = vectorStub([passage('page', draft, 0.9, { authorKind: 'agent' }), passage('page', human, 0.8)]);

        const result = await ask(lexical, vector);

        expect(ids(result)).toEqual([human, draft]);
        expect(scores(result)).toEqual([rrf(2, 2), rrf(1, 1) / 2].map((n) => Number(n.toFixed(6))));
    });

    it('returns one passage per source when both sides found it, from the side that ranked it higher', async () => {
        const page = livePage();
        const lexical = lexicalStub([passage('page', page, 8, { excerpt: 'lexical excerpt' })]);
        const vector = vectorStub([passage('page', page, 0.9, { excerpt: 'vector excerpt' })]);

        const result = await ask(lexical, vector);

        expect(result.passages).toHaveLength(1);
        expect(result.passages[0]).toMatchObject({ sourceId: page, excerpt: 'lexical excerpt', score: expect.closeTo(rrf(1, 1), 6), permission: { visibility: 'project', via: 'project' } });
    });

    it('rechecks a vector-only candidate against the live row and drops a page made private after it was indexed', async () => {
        const hidden = livePage({ visibility: 'private', createdBy: OTHER });
        const lexical = lexicalStub([]);
        const vector = vectorStub([passage('page', hidden, 0.99)]);

        expect(ids(await ask(lexical, vector))).toEqual([]);
        visibleProjectIds.mockImplementation(async () => [PROJECT]);
        expect(ids(await ask(lexical, vector, { userId: OTHER }))).toEqual([hidden]);
    });

    it('drops a vector-only candidate whose row was deleted, and keeps to the limit', async () => {
        const gone = livePage({ deletedStatusKey: 1 });
        const [a, b] = [livePage(), livePage()];
        const lexical = lexicalStub([passage('page', a, 3)]);
        const vector = vectorStub([passage('page', gone, 0.99), passage('page', b, 0.9)]);

        const result = await ask(lexical, vector, { limit: 1 });

        expect(ids(result)).toEqual([a]);
    });

    it('answers from the lexical side alone when the question cannot be embedded, and says so in the log', async () => {
        embed.mockRejectedValue(new Error('OpenAI: socket hang up'));
        const [p1, p2] = [livePage(), livePage()];
        const lexical = lexicalStub([passage('page', p1, 8), passage('page', p2, 6)]);
        const vector = vectorStub([passage('page', p2, 0.9)]);

        const result = await ask(lexical, vector);

        expect(ids(result)).toEqual([p1, p2]);
        expect(scores(result)).toEqual([1, 0.75]);
        expect(result.backend).toBe('lexical');
        expect(vector.search).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
    });

    it('answers from the lexical side alone when the vector store fails', async () => {
        const [p1, p2] = [livePage(), livePage()];
        const lexical = lexicalStub([passage('page', p1, 8), passage('page', p2, 6)]);
        const vector = vectorStub([]);
        vector.search.mockRejectedValue(new Error('vector store down'));

        const result = await ask(lexical, vector);

        expect(ids(result)).toEqual([p1, p2]);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('vector store down'));
    });

    it('embeds nothing while no source has its chunk store built, since there is nothing to search by vector', async () => {
        mockDb.store[SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE].length = 0;
        const page = livePage();
        const vector = vectorStub([]);

        const result = await ask(lexicalStub([passage('page', page, 8)]), vector);

        expect(ids(result)).toEqual([page]);
        expect(embed).not.toHaveBeenCalled();
        expect(vector.search).not.toHaveBeenCalled();
    });

    it('embeds nothing while no instance key is set', async () => {
        llmProvider.isEmbeddingConfigured.mockReturnValue(false);
        const page = livePage();
        const vector = vectorStub([]);

        const result = await ask(lexicalStub([passage('page', page, 8)]), vector);

        expect(ids(result)).toEqual([page]);
        expect(embed).not.toHaveBeenCalled();
        expect(vector.search).not.toHaveBeenCalled();
        expect(result.backend).toBe('lexical');
    });
});

describe('a company outside hybrid is answered exactly as before', () => {
    it('never computes a query embedding or searches vectors for an "on" company, and ranks the lexical candidates as beta does', async () => {
        const [p1, p2] = [livePage(), livePage()];
        const vector = vectorStub([passage('page', p2, 0.99)]);

        const result = await ask(lexicalStub([passage('page', p1, 8), passage('page', p2, 6)]), vector, { companyId: ON });

        expect(ids(result)).toEqual([p1, p2]);
        expect(scores(result)).toEqual([1, 0.75]);
        expect(result.backend).toBe('lexical');
        expect(embed).not.toHaveBeenCalled();
        expect(llmProvider.embeddingProvider).not.toHaveBeenCalled();
        expect(vector.search).not.toHaveBeenCalled();
    });

    it('never computes a query embedding while KNOWLEDGE_RETRIEVAL is off for the installation, whatever the company row says', async () => {
        process.env.KNOWLEDGE_RETRIEVAL = 'off';
        try {
            const page = livePage();
            const vector = vectorStub([]);
            await ask(lexicalStub([passage('page', page, 8)]), vector);
            expect(embed).not.toHaveBeenCalled();
            expect(vector.search).not.toHaveBeenCalled();
        } finally {
            process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
        }
    });
});
