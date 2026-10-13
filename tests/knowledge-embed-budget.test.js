/* The workspace budget holds for embeddings as it does for chat, through the real meter and
 * reservation with only the vendor mocked. Once the month is spent, a question is answered
 * from the lexical side at no cost, the indexer and the sweep write chunks without vectors and
 * spend nothing, and the company stays paused rather than asking again on every write. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000a01']), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 3), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => {
    const NodeCache = require('node-cache');
    return { AI_API_KEY: 'sk-proj-BUDGETSECRET0123456789', AI_MODEL: '', myCache: new NodeCache() };
});
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const backfill = require('../Modules/Knowledge/ingest/backfill');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const embeddings = require('../Modules/Knowledge/embeddings');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000011';
const PROJECT = '6f0000000000000000000a01';
const MODEL = 'text-embedding-3-small';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retrieval: process.env.KNOWLEDGE_RETRIEVAL, router: process.env.AI_MODEL_ROUTER };

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const ledger = () => mockDb.store[SCHEMA_TYPE.AI_USAGE] || [];
const holds = () => mockDb.store[SCHEMA_TYPE.AI_RESERVATIONS] || [];
const chunksOf = (sourceId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(sourceId) && !c.deleted);
const spent = (usd) => mockDb.seed(SCHEMA_TYPE.AI_USAGE, { companyId: C, feature: 'ask', model: 'gpt-4.1', costUsd: usd, totalTokens: 1, billedToWorkspace: true, at: new Date() });
const seedPage = (over = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    title: 'Harbour handbook', content: { html: '<p>Park by the harbour.</p>' }, visibility: 'project', createdBy: ME, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});
const answering = () => axios.post.mockImplementation(async (url, body) => ({
    data: { data: body.input.map((text, index) => ({ index, embedding: [1, 0, 0] })), model: body.model, usage: { prompt_tokens: body.input.length * 3, total_tokens: body.input.length * 3 } },
}));
const ask = () => retrieve({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'harbour', scope: { sourceTypes: ['page'] } });

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    process.env.KNOWLEDGE_RETRIEVAL = 'tenant';
    process.env.AI_MODEL_ROUTER = 'on';
});

afterAll(() => {
    [['KNOWLEDGE_INDEXER', ENV.indexer], ['KNOWLEDGE_RETRIEVAL', ENV.retrieval], ['AI_MODEL_ROUTER', ENV.router]].forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    embeddings.resetBreaker();
    indexer.clearEmbedRetries();
    answering();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(dbCollections.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'hybrid' }, agentMonthlyBudgetUsd: 1 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'One', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ME, status: 2, isDelete: false });
    ['page', 'comment', 'transcript'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date() }));
});

describe('with budget left', () => {
    it('embeds through the meter: a hold, a request, a settled hold and a ledger row', async () => {
        const page = seedPage();
        const result = await indexer.ingestPage(C, page);
        expect(result).toMatchObject({ written: 1, embedded: 1, embedFailed: false });
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(chunksOf(page._id)[0]).toMatchObject({ embeddingModel: MODEL, embedding: [1, 0, 0] });
        expect(ledger().map((r) => r.feature)).toEqual(['knowledge_embed']);
        expect(holds().map((h) => h.state)).toEqual(['settled']);
    });
});

describe('once the month is spent', () => {
    beforeEach(() => spent(1.5));

    it('the indexer writes the chunks without vectors, spends nothing, queues no retry and pauses the company', async () => {
        const first = seedPage();
        const result = await indexer.ingestPage(C, first);

        expect(result).toMatchObject({ written: 1, embedded: 0, embedFailed: true, embedRefused: true });
        expect(chunksOf(first._id)[0]).toMatchObject({ embedding: [], embeddingModel: null });
        expect(axios.post).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(1);
        expect(holds().map((h) => h.state)).toEqual(['released']);
        expect(indexer.embedRetries()).toEqual([]);

        const second = seedPage({ title: 'Second' });
        expect(await indexer.ingestPage(C, second)).toMatchObject({ written: 1, embedded: 0, embedFailed: false });
        expect(chunksOf(second._id)[0].embeddingModel).toBeNull();
        expect(holds()).toHaveLength(1);
        expect(embeddings.breakerState(C)).toMatchObject({ open: true, reason: 'budget' });
    });

    it('Ask is answered from the lexical side, at no cost, and says so', async () => {
        const page = seedPage();
        await indexer.ingestPage(C, page);
        embeddings.resetBreaker();

        const result = await ask();

        expect(result.backend).toBe('lexical (budget exhausted)');
        expect(result.passages.map((p) => p.sourceId)).toEqual([String(page._id)]);
        expect(axios.post).not.toHaveBeenCalled();
        expect(ledger().map((r) => r.feature)).toEqual(['ask']);
        expect(holds().map((h) => h.state)).toEqual(['released', 'released']);
        expect(embeddings.breakerState(C)).toMatchObject({ open: true, reason: 'budget' });
    });

    it('the recurring sweep does not spend either', async () => {
        const page = seedPage();
        mockDb.seed(CHUNKS, {
            companyId: C, sourceType: 'page', sourceId: String(page._id), ordinal: 0, projectId: PROJECT, visibility: 'project', createdBy: ME, authorKind: 'human',
            title: 'Harbour handbook', headingPath: ['Harbour handbook'], text: 'Harbour handbook\nPark by the harbour.', contentHash: 'stale', embedding: [], embeddingModel: null, deleted: false, sourceUpdatedAt: new Date('2026-09-01T00:00:00Z'),
        });

        const summary = await backfill.backfillAll();

        expect(summary.reembedded[C]).toBe(0);
        expect(axios.post).not.toHaveBeenCalled();
        expect(ledger()).toHaveLength(1);
        expect(chunksOf(page._id).every((c) => c.embeddingModel === null)).toBe(true);
    });
});
