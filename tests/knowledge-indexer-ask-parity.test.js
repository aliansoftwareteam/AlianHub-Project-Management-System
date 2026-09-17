const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn(), visibleProjectIds: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: () => false }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects, visibleProjectIds } = require('../Modules/Agents/scope');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const { gather } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const ENV = { retrieval: process.env.KNOWLEDGE_RETRIEVAL, indexer: process.env.KNOWLEDGE_INDEXER };

let ids;

/* The sources and reads Ask produces on beta, before the knowledge interface, for the rows seeded below. */
const beta = () => [
    { kind: 'task', id: ids.review, ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: PROJECT, detail: 'In progress · High · Check the numbers', updatedAt: new Date('2026-09-02T00:00:00Z') },
    { kind: 'page', id: ids.wiki, ref: `page:${ids.wiki.slice(-6)}`, title: 'Budget wiki', project: 'Ops', projectId: PROJECT, detail: '', updatedAt: new Date('2026-09-03T00:00:00Z') },
];
const BETA_READS = [[C, SCHEMA_TYPE.SPRINTS, 'find'], [C, SCHEMA_TYPE.TEAMS_MANAGEMENT, 'find'], [C, SCHEMA_TYPE.TASKS, 'find'], [C, SCHEMA_TYPE.PAGES, 'find']];

beforeEach(async () => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    jest.clearAllMocks();
    visibleProjects.mockResolvedValue([{ _id: PROJECT, ProjectName: 'Ops' }]);
    visibleProjectIds.mockResolvedValue([PROJECT]);

    const seed = (type, doc) => String(mockDb.seed(type, doc)._id);
    ids = {
        review: seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget review', TaskKey: 'OPS-1', status: { text: 'In progress' }, Task_Priority: 'High', rawDescription: 'Check the   numbers', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-02T00:00:00Z') }),
        wiki: seed(SCHEMA_TYPE.PAGES, { title: 'Budget wiki', rawText: 'numbers', content: { html: '<p>The budget in numbers.</p>' }, ProjectID: PROJECT, visibility: 'project', createdBy: OTHER, deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z') }),
        bodyOnly: seed(SCHEMA_TYPE.PAGES, { title: 'Quarterly plan', rawText: 'the budget lives in the body', content: { html: '<p>The budget lives in the body.</p>' }, ProjectID: PROJECT, visibility: 'project', createdBy: OTHER, deletedStatusKey: 0, updatedAt: new Date('2026-09-03T00:00:00Z') }),
    };
    await Promise.all(mockDb.store[SCHEMA_TYPE.PAGES].map((page) => indexer.ingestPage(C, page)));
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, Cst_CompanyName: 'Acme', knowledgeRetrieval: { mode: 'on' }, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType: 'page', status: 'complete' });
    mockDb.calls.length = 0;
});

afterAll(() => {
    Object.entries({ KNOWLEDGE_RETRIEVAL: ENV.retrieval, KNOWLEDGE_INDEXER: ENV.indexer }).forEach(([name, value]) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    });
});

describe('with KNOWLEDGE_RETRIEVAL off, Ask is what beta gathers, whatever the indexer does', () => {
    it.each([
        ['unset', 'all', undefined],
        ['off', 'all', 'off'],
        ['off', 'tenant', 'off'],
    ])('KNOWLEDGE_RETRIEVAL %s with KNOWLEDGE_INDEXER %s: the same sources from the same reads, and no knowledge store touched', async (_label, indexerMode, retrievalMode) => {
        if (retrievalMode === undefined) delete process.env.KNOWLEDGE_RETRIEVAL;
        else process.env.KNOWLEDGE_RETRIEVAL = retrievalMode;
        process.env.KNOWLEDGE_INDEXER = indexerMode;

        const out = await gather(C, ME, { question: 'What is the budget?' });

        expect(out.sources).toEqual(beta());
        expect(mockDb.calls.map((c) => [String(c.companyId), c.type, c.method])).toEqual(BETA_READS);
    });
});
