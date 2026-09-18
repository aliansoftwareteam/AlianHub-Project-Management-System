/* The vector adapter contract: search by a query embedding under the caller's access filter,
 * plus upsert, tombstone, erase and stats. The in-memory adapter and the in-database adapter rank
 * one fixture the same way, keep to one passage per source, and honour the same visible-set
 * clauses the lexical adapter does. The in-database candidate set is bounded to the newest
 * chunks per source type, so a question never reads the whole store. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { ADAPTER_METHODS, assertAdapter } = require('../Modules/Knowledge/retrieval');
const { resolveVisibleSet, filterFor } = require('../Modules/Knowledge/visibleSet');
const vector = require('../Modules/Knowledge/adapters/vector');

const { createInMemoryVectorAdapter, createDatabaseVectorAdapter, cosine, CANDIDATE_CHUNKS_PER_SOURCE } = vector;

const C = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const ME = '6f0000000000000000000011';
const OTHER = '6f0000000000000000000012';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const OPEN_SPRINT = '6f0000000000000000000d01';
const PRIVATE_SPRINT = '6f0000000000000000000d02';
const MODEL = 'text-embedding-3-small';
const ALL = ['page', 'comment', 'transcript'];
const Q = [1, 0, 0];

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const PROJECTS = { [ME]: [SHARED], [OTHER]: [SHARED, SECRET] };
const chunkSearches = () => mockDb.calls.filter((c) => c.type === CHUNKS && c.method === 'aggregate');

let seq = 0;
const sourceId = () => `6f00000000000000000${String(++seq).padStart(5, '0')}`;
const day = (n) => new Date(`2026-09-${String(n).padStart(2, '0')}T00:00:00Z`);

const chunk = (over = {}) => ({
    companyId: C, sourceType: 'page', sourceId: sourceId(), ordinal: 0, projectId: SHARED, sprintId: null, taskId: '', participants: [], visibility: 'project', createdBy: OTHER, authorKind: 'human',
    title: 'Page', headingPath: [], text: 'Some text about the harbour.', contentHash: 'h', embedding: [0, 1, 0], embeddingModel: MODEL, deleted: false, sourceUpdatedAt: day(10), ...over,
});

const seedRows = (rows) => rows.map((row) => mockDb.seed(CHUNKS, row));

const adapters = () => {
    const memory = createInMemoryVectorAdapter();
    const db = createDatabaseVectorAdapter();
    return { memory, db, both: [['memory', memory], ['db', db]] };
};

const loaded = async (rows) => {
    const { memory, db, both } = adapters();
    seedRows(rows);
    await memory.upsert({ companyId: C, chunks: rows.filter((r) => r.companyId === C) });
    await memory.upsert({ companyId: C2, chunks: rows.filter((r) => r.companyId === C2) });
    return { memory, db, both };
};

const filterAs = async (userId, { sourceTypes = ALL, chunkSources = ALL, projectId } = {}) => filterFor(
    await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId }, scope: { sourceTypes, ...(projectId ? { projectId } : {}) } }),
    { chunkSources },
);

const ranked = async (adapter, userId, { limit = 10, model = MODEL, query = Q, ...scope } = {}) => (await adapter.search({ companyId: C, queryEmbedding: query, model, filter: await filterAs(userId, scope), limit }))
    .map((p) => [p.sourceId, Number(p.score.toFixed(6))]);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    getRoleType.mockImplementation(async () => 3);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: SHARED, private: false, AssigneeUserId: [ME, OTHER], deletedStatusKey: 0 });
});

describe('the contract', () => {
    it('is the retrieval adapter contract, and both adapters implement it', () => {
        const { memory, db } = adapters();
        expect(ADAPTER_METHODS).toEqual(['search', 'upsert', 'tombstone', 'erase', 'stats']);
        expect(() => assertAdapter(memory)).not.toThrow();
        expect(() => assertAdapter(db)).not.toThrow();
        expect(memory.name).toBe('vector-memory');
        expect(db.name).toBe('vector-db');
    });

    it('scores by cosine, and treats an empty or mismatched vector as no similarity', () => {
        expect(cosine([1, 0], [1, 0])).toBe(1);
        expect(cosine([1, 0], [0, 1])).toBe(0);
        expect(cosine([1, 0], [-1, 0])).toBe(-1);
        expect(cosine([2, 0], [1, 0])).toBeCloseTo(1);
        expect(cosine([], [1])).toBe(0);
        expect(cosine([1, 0], [1])).toBe(0);
        expect(cosine([0, 0], [1, 0])).toBe(0);
    });

    it('documents the in-database candidate bound', () => {
        expect(Number.isInteger(CANDIDATE_CHUNKS_PER_SOURCE)).toBe(true);
        expect(CANDIDATE_CHUNKS_PER_SOURCE).toBeGreaterThanOrEqual(100);
        expect(CANDIDATE_CHUNKS_PER_SOURCE).toBeLessThanOrEqual(1000);
    });

    it('leaves upsert, tombstone and erase to the chunk rows in the database adapter, and counts vectors per model in stats', async () => {
        const { db } = adapters();
        seedRows([chunk(), chunk({ embeddingModel: 'text-embedding-3-large' }), chunk({ embedding: [], embeddingModel: null }), chunk({ deleted: true })]);
        mockDb.calls.length = 0;
        await expect(db.upsert({ companyId: C, chunks: [chunk()] })).resolves.toMatchObject({ backend: 'vector-db', skipped: true });
        await expect(db.tombstone({ companyId: C, sourceType: 'page', sourceIds: ['x'] })).resolves.toMatchObject({ backend: 'vector-db', skipped: true });
        await expect(db.erase({ companyId: C, sources: [{ sourceType: 'page', sourceId: 'x' }] })).resolves.toMatchObject({ backend: 'vector-db', skipped: true });
        expect(mockDb.calls).toEqual([]);
        expect(await db.stats({ companyId: C })).toEqual({ backend: 'vector-db', candidateBound: CANDIDATE_CHUNKS_PER_SOURCE, embedded: { [MODEL]: 1, 'text-embedding-3-large': 1 }, unembedded: 1 });
    });

    it('keeps its own rows in the memory adapter: tombstone hides, erase removes, stats counts', async () => {
        const { memory } = adapters();
        const rows = [chunk({ embedding: [1, 0, 0] }), chunk({ embedding: [1, 0, 0] })];
        await memory.upsert({ companyId: C, chunks: rows });
        expect(await memory.stats({ companyId: C })).toEqual({ backend: 'vector-memory', embedded: { [MODEL]: 2 }, unembedded: 0 });

        await memory.tombstone({ companyId: C, sourceType: 'page', sourceIds: [rows[0].sourceId] });
        expect(await ranked(memory, ME)).toEqual([[rows[1].sourceId, 1]]);

        await memory.erase({ companyId: C, sources: [{ sourceType: 'page', sourceId: rows[1].sourceId }] });
        expect(await ranked(memory, ME)).toEqual([]);
        expect(await memory.stats({ companyId: C })).toEqual({ backend: 'vector-memory', embedded: {}, unembedded: 0 });
    });

    it("erases exactly the sources it is told, so a person's shared pages and calls survive an erasure by person", async () => {
        const { memory } = adapters();
        const rows = {
            secret: chunk({ embedding: [1, 0, 0], visibility: 'private', createdBy: OTHER, title: 'secret' }),
            shared: chunk({ embedding: [1, 0, 0], createdBy: OTHER, title: 'shared' }),
            comment: chunk({ sourceType: 'comment', embedding: [1, 0, 0], createdBy: OTHER, sprintId: OPEN_SPRINT, title: 'comment' }),
            call: chunk({ sourceType: 'transcript', embedding: [1, 0, 0], createdBy: OTHER, participants: [OTHER], visibility: 'participants', title: 'call' }),
        };
        await memory.upsert({ companyId: C, chunks: Object.values(rows) });

        await memory.erase({ companyId: C, sources: [{ sourceType: 'page', sourceId: rows.secret.sourceId }, { sourceType: 'comment', sourceId: rows.comment.sourceId }] });

        const passages = await memory.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(OTHER), limit: 10 });
        expect(passages.map((p) => p.title).sort()).toEqual(['call', 'shared']);
        expect(await memory.stats({ companyId: C })).toEqual({ backend: 'vector-memory', embedded: { [MODEL]: 2 }, unembedded: 0 });
    });

    it('fails the whole search when the candidates of any one source cannot be read, rather than answering from the rest', async () => {
        const { db, memory } = adapters();
        seedRows([chunk({ embedding: [1, 0, 0] })]);
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (q.type === CHUNKS && method === 'aggregate' && q.data[0][0].$match.sourceType === 'comment') throw new Error('comment candidates unavailable');
            return crud(companyId, q, method);
        });
        try {
            await expect(db.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(ME), limit: 5 })).rejects.toThrow(/comment candidates unavailable/);
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        await memory.upsert({ companyId: C, chunks: [chunk({ embedding: [1, 0, 0] }), chunk({ sourceType: 'comment', embedding: [1, 0, 0], sprintId: OPEN_SPRINT })] });
        const filter = await filterAs(ME);
        filter.clauses.comment = { projectId: { $regex: 'x' } };
        await expect(memory.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter, limit: 5 })).rejects.toThrow(/unsupported operator/);
    });
});

describe('both adapters rank a fixture the same way', () => {
    it('by cosine to the query, one passage per source from its best chunk, in the interface shape', async () => {
        const a = sourceId();
        const rows = [
            chunk({ sourceId: a, ordinal: 0, embedding: [0.5, 0.5, 0], text: 'Harbour intro', title: 'Harbour guide' }),
            chunk({ sourceId: a, ordinal: 1, embedding: [1, 0, 0], text: 'Harbour appendix', title: 'Harbour guide' }),
            chunk({ embedding: [0.7, 0.7, 0], authorKind: 'agent' }),
            chunk({ embedding: [0.1, 1, 0] }),
            chunk({ embedding: [0, 1, 0], title: 'orthogonal' }),
            chunk({ embedding: [-1, 0, 0], title: 'opposite' }),
        ];
        const { both } = await loaded(rows);

        for (const [, adapter] of both) {
            const passages = await adapter.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(ME), limit: 10 });
            expect(passages.map((p) => [p.sourceId, Number(p.score.toFixed(6))])).toEqual([[a, 1], [rows[2].sourceId, 0.707107], [rows[3].sourceId, 0.099504]]);
            expect(passages[0]).toEqual({
                id: `page:${a}`, sourceType: 'page', sourceId: a, projectId: SHARED, title: 'Harbour guide', excerpt: 'Harbour appendix', score: 1, authorKind: 'user', updatedAt: day(10),
            });
            expect(passages[1].authorKind).toBe('agent');
        }
    });

    it('keeps to the limit after collapsing to one passage per source', async () => {
        const rows = [chunk({ embedding: [1, 0, 0] }), chunk({ embedding: [0.9, 0.1, 0] }), chunk({ embedding: [0.8, 0.2, 0] })];
        const { both } = await loaded(rows);
        for (const [, adapter] of both) {
            expect((await ranked(adapter, ME, { limit: 2 })).map(([id]) => id)).toEqual([rows[0].sourceId, rows[1].sourceId]);
        }
    });

    it('returns nothing for an empty query vector, a model with no vectors, or no chunk sources', async () => {
        const { both } = await loaded([chunk({ embedding: [1, 0, 0] })]);
        for (const [, adapter] of both) {
            expect(await ranked(adapter, ME, { query: [] })).toEqual([]);
            expect(await ranked(adapter, ME, { model: 'text-embedding-3-large' })).toEqual([]);
            expect(await ranked(adapter, ME, { chunkSources: [] })).toEqual([]);
        }
    });

    it('searches only the sources whose chunk store is built, like the lexical adapter', async () => {
        const rows = [chunk({ embedding: [1, 0, 0] }), chunk({ sourceType: 'comment', embedding: [1, 0, 0], sprintId: OPEN_SPRINT })];
        const { both, db } = await loaded(rows);
        for (const [, adapter] of both) {
            expect((await ranked(adapter, ME, { chunkSources: ['comment'] })).map(([id]) => id)).toEqual([rows[1].sourceId]);
        }
        mockDb.calls.length = 0;
        await ranked(db, ME, { chunkSources: ['comment'] });
        expect(chunkSearches().map((c) => c.data[0][0].$match.sourceType)).toEqual(['comment']);
    });
});

describe('the access filter is the visible set, exactly as the lexical adapter applies it', () => {
    const fixture = () => {
        const rows = {
            shared: chunk({ embedding: [1, 0, 0], title: 'shared' }),
            privateByOther: chunk({ embedding: [1, 0, 0], visibility: 'private', createdBy: OTHER, title: 'private' }),
            secretProject: chunk({ embedding: [1, 0, 0], projectId: SECRET, title: 'secret' }),
            companyWide: chunk({ embedding: [1, 0, 0], projectId: null, title: 'company-wide' }),
            openSprintComment: chunk({ sourceType: 'comment', embedding: [1, 0, 0], sprintId: OPEN_SPRINT, title: 'open comment' }),
            privateSprintComment: chunk({ sourceType: 'comment', embedding: [1, 0, 0], sprintId: PRIVATE_SPRINT, title: 'private comment' }),
            myCall: chunk({ sourceType: 'transcript', embedding: [1, 0, 0], participants: [ME, OTHER], visibility: 'participants', title: 'my call' }),
            theirCall: chunk({ sourceType: 'transcript', embedding: [1, 0, 0], participants: [OTHER], visibility: 'participants', title: 'their call' }),
            otherCompany: chunk({ companyId: C2, embedding: [1, 0, 0], title: 'other company' }),
            tombstoned: chunk({ embedding: [1, 0, 0], deleted: true, title: 'tombstoned' }),
            otherModel: chunk({ embedding: [1, 0, 0], embeddingModel: 'text-embedding-3-large', title: 'other model' }),
            noVector: chunk({ embedding: [], embeddingModel: null, title: 'no vector' }),
        };
        return rows;
    };

    const titles = async (adapter, userId, scope) => (await adapter.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(userId, scope), limit: 20 })).map((p) => p.title).sort();

    it.each([
        ['a private page', (rows) => rows.privateByOther, ME, OTHER],
        ["a page in a project the caller cannot open", (rows) => rows.secretProject, ME, OTHER],
        ['a comment in a private sprint', (rows) => rows.privateSprintComment, ME, OTHER],
        ['a transcript the caller was not on', (rows) => rows.theirCall, ME, OTHER],
    ])('%s reaches only the person allowed to see it, in both adapters', async (label, pick, denied, allowed) => {
        const rows = fixture();
        const { both } = await loaded(Object.values(rows));
        const wanted = pick(rows).title;
        for (const [, adapter] of both) {
            expect(await titles(adapter, denied)).not.toContain(wanted);
            expect(await titles(adapter, allowed)).toContain(wanted);
        }
    });

    it.each([
        ["another company's chunk", 'other company'],
        ['a tombstoned chunk', 'tombstoned'],
        ['a chunk embedded with another model', 'other model'],
        ['a chunk with no vector', 'no vector'],
    ])('%s reaches nobody, in both adapters', async (label, title) => {
        const { both } = await loaded(Object.values(fixture()));
        for (const [, adapter] of both) {
            expect(await titles(adapter, ME)).not.toContain(title);
            expect(await titles(adapter, OTHER)).not.toContain(title);
        }
    });

    it('gives a member the shared page, the company-wide page, the open-sprint comment and their own call', async () => {
        const { both } = await loaded(Object.values(fixture()));
        for (const [, adapter] of both) {
            expect(await titles(adapter, ME)).toEqual(['company-wide', 'my call', 'open comment', 'shared']);
        }
    });

    it('leaves company-wide pages out of a search scoped to one project', async () => {
        const { both } = await loaded(Object.values(fixture()));
        for (const [, adapter] of both) {
            expect(await titles(adapter, ME, { projectId: SHARED })).toEqual(['my call', 'open comment', 'shared']);
        }
    });

    it('puts the clause of each source, with the model, in the first stage of the database query', async () => {
        const { db } = await loaded([chunk({ embedding: [1, 0, 0] })]);
        mockDb.calls.length = 0;
        const filter = await filterAs(ME);
        await db.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter, limit: 5 });
        const pipelines = Object.fromEntries(chunkSearches().map((c) => [c.data[0][0].$match.sourceType, c.data[0]]));
        expect(Object.keys(pipelines).sort()).toEqual(ALL.slice().sort());
        ALL.forEach((sourceType) => {
            const [match, sort, limit] = pipelines[sourceType];
            expect(match.$match).toEqual({ ...filter.clauses[sourceType], embeddingModel: MODEL });
            expect(sort).toEqual({ $sort: { sourceUpdatedAt: -1, ordinal: 1 } });
            expect(limit).toEqual({ $limit: CANDIDATE_CHUNKS_PER_SOURCE });
        });
    });
});

describe('the in-database candidate set is bounded', () => {
    it('reads only the newest chunks per source type, so an older better match past the bound is not seen', async () => {
        const { db } = adapters();
        const oldest = chunk({ embedding: [1, 0, 0], sourceUpdatedAt: day(1), title: 'oldest and best' });
        const newer = Array.from({ length: CANDIDATE_CHUNKS_PER_SOURCE }, (_, i) => chunk({ embedding: [0.5, 0.5, 0], sourceUpdatedAt: day(2 + (i % 20)), title: `newer ${i}` }));
        seedRows([oldest, ...newer]);

        const passages = await db.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(ME, { chunkSources: ['page'] }), limit: 3 });

        expect(passages).toHaveLength(3);
        expect(passages.map((p) => p.title)).not.toContain('oldest and best');
        passages.forEach((p) => expect(p.score).toBeCloseTo(0.707107));
    });
});
