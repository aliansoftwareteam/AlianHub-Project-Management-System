const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const lexical = require('../Modules/Knowledge/adapters/lexical');
const { ADAPTER_METHODS, assertAdapter, createRetrieve } = require('../Modules/Knowledge/retrieval');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000011';
const OTHER = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';

const TEXT_SOURCES = { task: SCHEMA_TYPE.TASKS, page: SCHEMA_TYPE.PAGES, comment: SCHEMA_TYPE.COMMENTS };

const filter = {
    sourceTypes: ['task', 'page', 'comment', 'transcript'],
    clauses: {
        task: { ProjectID: { $in: [PROJECT] }, deletedStatusKey: { $ne: 1 } },
        page: { deletedStatusKey: { $ne: 1 }, $and: [{ $or: [{ ProjectID: { $in: [PROJECT] } }, { ProjectID: { $in: [null, undefined] } }] }, { $or: [{ visibility: { $ne: 'private' } }, { createdBy: ME }] }] },
        comment: { projectId: { $in: [PROJECT] }, isDeleted: { $ne: true } },
        transcript: { participants: ME, deletedStatusKey: { $ne: 1 } },
    },
};

const callsFor = (type) => mockDb.calls.filter((c) => c.type === type);

/* Every place a $text operator appears, as a path, so a test can say it only sits at the top. */
const textPaths = (node, path = []) => {
    if (!node || typeof node !== 'object') return [];
    return Object.entries(node).flatMap(([key, value]) => (key === '$text' ? [[...path, key].join('.')] : textPaths(value, [...path, key])));
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.crud.mockClear();
    jest.clearAllMocks();
    myCache.flushAll();
});

describe('the adapter contract', () => {
    it('names search, upsert, tombstone, erase and stats, and the lexical adapter implements all of them', () => {
        expect(ADAPTER_METHODS).toEqual(['search', 'upsert', 'tombstone', 'erase', 'stats']);
        expect(() => assertAdapter(lexical)).not.toThrow();
        expect(lexical.name).toBe('lexical');
    });

    it('rejects an adapter that is missing a method, and says which', () => {
        const partial = { name: 'partial', search: async () => [], upsert: async () => {}, tombstone: async () => {}, stats: async () => ({}) };
        expect(() => assertAdapter(partial)).toThrow(/erase/);
        expect(() => createRetrieve(partial)).toThrow(/erase/);
    });

    it('treats upsert, tombstone, erase and stats as no-ops for lexical: the source rows are the index', async () => {
        await expect(lexical.upsert({ companyId: C, chunks: [{ id: 'x' }] })).resolves.toBeDefined();
        await expect(lexical.tombstone({ companyId: C, sourceType: 'page', sourceId: 'x' })).resolves.toBeDefined();
        await expect(lexical.erase({ companyId: C, sourceType: 'page', sourceId: 'x' })).resolves.toBeDefined();
        await expect(lexical.stats({ companyId: C })).resolves.toMatchObject({ backend: 'lexical' });
        expect(mockDb.crud).not.toHaveBeenCalled();
    });
});

describe('lexical search builds a query MongoDB will run', () => {
    it('puts $text at the top level of each indexed source, beside the access-control clause', async () => {
        await lexical.search({ companyId: C, query: 'budget review', filter, limit: 5 });

        Object.entries(TEXT_SOURCES).forEach(([sourceType, type]) => {
            const [call] = callsFor(type);
            expect(call.companyId).toBe(C);
            expect(call.method).toBe('find');
            const [where, projection, options] = call.data;
            expect(textPaths(where)).toEqual(['$text']);
            expect(where.$text.$search).toBe('budget review');
            Object.entries(filter.clauses[sourceType]).forEach(([key, value]) => expect(where[key]).toEqual(value));
            expect(projection.score).toEqual({ $meta: 'textScore' });
            expect(options).toEqual({ sort: { score: { $meta: 'textScore' } }, limit: 5, lean: true });
        });
    });

    it('passes only plain words to $search, so a question cannot negate or phrase-match', () => {
        const search = lexical.textSearch('"budget" -secret (a+)+ review? budget');
        expect(search).not.toMatch(/["()+?]|(^|\s)-/);
        expect(search.split(' ')).toEqual(['budget', 'secret', 'a', 'review']);
    });

    it('searches transcripts with an escaped regular expression, since calls carry no text index, and keeps the participant rule', async () => {
        await lexical.search({ companyId: C, query: 'budget.*', filter, limit: 5 });
        const [call] = callsFor(SCHEMA_TYPE.CALLS);
        const [where] = call.data;
        expect(textPaths(where)).toEqual([]);
        expect(where.participants).toBe(ME);
        expect(where.deletedStatusKey).toEqual({ $ne: 1 });
        const patterns = JSON.stringify(where.$and);
        expect(patterns).toContain('"$regex":"budget"');
        expect(patterns).not.toContain('.*');
    });

    it('falls back to an escaped regular expression on a tenant with no text index yet', async () => {
        const noIndex = Object.assign(new Error('text index required for $text query'), { code: 27 });
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.PAGES && q.data[0].$text) { mockDb.calls.push({ companyId, type: q.type, method, data: q.data }); throw noIndex; }
            return crud(companyId, q, method);
        });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Quarterly plan', rawText: 'the budget (draft)', ProjectID: PROJECT, visibility: 'project', deletedStatusKey: 0, updatedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Hidden', rawText: 'budget', ProjectID: PROJECT, visibility: 'private', createdBy: OTHER, deletedStatusKey: 0, updatedAt: new Date() });

        try {
            const passages = await lexical.search({ companyId: C, query: '(a+)+ budget', filter, limit: 5 });
            const pageCalls = callsFor(SCHEMA_TYPE.PAGES);
            expect(pageCalls).toHaveLength(2);
            const [where] = pageCalls[1].data;
            expect(textPaths(where)).toEqual([]);
            expect(where.deletedStatusKey).toEqual({ $ne: 1 });
            expect(where.$and).toEqual(expect.arrayContaining(filter.clauses.page.$and));
            expect(JSON.stringify(where)).not.toContain('a+');
            expect(passages.filter((p) => p.sourceType === 'page').map((p) => p.title)).toEqual(['Quarterly plan']);
        } finally {
            mockDb.crud.mockImplementation(crud);
        }
    });

    it('does not fall back on any other failure: that source returns nothing and the error is logged', async () => {
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.TASKS) { mockDb.calls.push({ companyId, type: q.type, method, data: q.data }); throw new Error('connection reset'); }
            return crud(companyId, q, method);
        });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget', ProjectID: PROJECT, visibility: 'project', deletedStatusKey: 0, updatedAt: new Date() });
        try {
            const passages = await lexical.search({ companyId: C, query: 'budget', filter, limit: 5 });
            expect(callsFor(SCHEMA_TYPE.TASKS)).toHaveLength(1);
            expect(passages.map((p) => p.sourceType)).toEqual(['page']);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
        } finally {
            mockDb.crud.mockImplementation(crud);
        }
    });

    it('runs no query at all for a question with no searchable words, or for source types outside the filter', async () => {
        expect(await lexical.search({ companyId: C, query: ' ?! ', filter, limit: 5 })).toEqual([]);
        expect(mockDb.crud).not.toHaveBeenCalled();
        await lexical.search({ companyId: C, query: 'budget', filter: { ...filter, sourceTypes: ['page'] }, limit: 5 });
        expect([...new Set(mockDb.calls.map((c) => c.type))]).toEqual([SCHEMA_TYPE.PAGES]);
    });

    it('returns passages in the shape the interface promises', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Budget review', TaskKey: 'OPS-1', rawDescription: 'check the budget', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget', rawText: 'a budget', ProjectID: PROJECT, visibility: 'project', createdByAgent: true, deletedStatusKey: 0, updatedAt: new Date() });
        const passages = await lexical.search({ companyId: C, query: 'budget', filter, limit: 5 });
        expect(passages).toHaveLength(2);
        passages.forEach((p) => {
            expect(p).toEqual(expect.objectContaining({
                id: `${p.sourceType}:${p.sourceId}`,
                sourceId: expect.stringMatching(/^[a-f0-9]{24}$/),
                projectId: PROJECT,
                title: expect.any(String),
                excerpt: expect.any(String),
                score: expect.any(Number),
                authorKind: expect.stringMatching(/^(user|agent)$/),
                updatedAt: expect.any(Date),
            }));
        });
        expect(passages.find((p) => p.sourceType === 'page').authorKind).toBe('agent');
    });
});

describe('retrieve over any adapter', () => {
    const PAGE_LIVE = '6f0000000000000000000b01';
    const PAGE_GONE = '6f0000000000000000000b02';
    const PAGE_NOW_PRIVATE = '6f0000000000000000000b03';
    const PAGE_BY_AGENT = '6f0000000000000000000b04';

    const passage = (sourceId, over = {}) => ({
        id: `page:${sourceId}`, sourceType: 'page', sourceId, projectId: PROJECT, title: sourceId, excerpt: '', score: 1, authorKind: 'user', updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
    });

    const stub = (passages) => ({
        name: 'stub',
        search: jest.fn(async () => passages),
        upsert: async () => ({}),
        tombstone: async () => ({}),
        erase: async () => ({}),
        stats: async () => ({ backend: 'stub' }),
    });

    beforeEach(() => {
        getRoleType.mockResolvedValue(3);
        visibleProjectIds.mockResolvedValue([PROJECT]);
        mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_LIVE, title: 'Live', ProjectID: PROJECT, visibility: 'project', deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_GONE, title: 'Gone', ProjectID: PROJECT, visibility: 'project', deletedStatusKey: 1 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_NOW_PRIVATE, title: 'Now private', ProjectID: PROJECT, visibility: 'private', createdBy: OTHER, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_BY_AGENT, title: 'Agent', ProjectID: PROJECT, visibility: 'project', createdByAgent: true, deletedStatusKey: 0 });
    });

    it('hands the adapter the caller\'s visible set as its filter', async () => {
        const adapter = stub([]);
        await createRetrieve(adapter)({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'budget', limit: 4 });
        const [args] = adapter.search.mock.calls[0];
        expect(args).toMatchObject({ companyId: C, query: 'budget' });
        expect(args.limit).toBeGreaterThanOrEqual(4);
        expect(args.filter.sourceTypes).toEqual(['task', 'page', 'comment', 'transcript']);
        expect(Object.keys(args.filter.clauses).sort()).toEqual(['comment', 'file', 'guide', 'page', 'task', 'transcript']);
    });

    it('rechecks the ranked ids against the live rows and drops what the caller may no longer see', async () => {
        const adapter = stub([passage(PAGE_GONE, { score: 9 }), passage(PAGE_NOW_PRIVATE, { score: 8 }), passage(PAGE_LIVE, { score: 1 })]);
        const result = await createRetrieve(adapter)({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'budget' });
        expect(result.passages.map((p) => p.sourceId)).toEqual([PAGE_LIVE]);
        expect(result.passages[0].permission).toEqual({ visibility: 'project', via: 'project' });
        expect(result.backend).toBe('stub');
        expect(result.scope).toMatchObject({ projectId: null, projects: 1, sourceTypes: ['task', 'page', 'comment', 'transcript', 'guide', 'file'] });
    });

    it('ranks a human-written passage above an agent-written one at equal score, and keeps to the limit', async () => {
        const adapter = stub([passage(PAGE_BY_AGENT, { score: 2, authorKind: 'agent' }), passage(PAGE_LIVE, { score: 2 })]);
        const retrieveWith = createRetrieve(adapter);
        const ranked = await retrieveWith({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'budget' });
        expect(ranked.passages.map((p) => p.sourceId)).toEqual([PAGE_LIVE, PAGE_BY_AGENT]);
        const one = await retrieveWith({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'budget', limit: 1 });
        expect(one.passages.map((p) => p.sourceId)).toEqual([PAGE_LIVE]);
    });
});
