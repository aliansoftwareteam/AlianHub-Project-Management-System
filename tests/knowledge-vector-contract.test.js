/* The contract every vector store answers to, run against the in-memory reference, the
 * in-database cosine adapter and the Atlas Vector Search adapter (over a fake Atlas). Each test
 * writes, tombstones and erases the way the indexer and erasure do: the chunk row first, then the
 * store is told. A store must then find what was written under the caller's visible set, search
 * only the current embedding model, hide a tombstone, forget an erasure, and keep companies apart. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { assertAdapter } = require('../Modules/Knowledge/adapters/contract');
const { resolveVisibleSet, filterFor } = require('../Modules/Knowledge/visibleSet');
const { createInMemoryVectorAdapter, createDatabaseVectorAdapter } = require('../Modules/Knowledge/adapters/vector');
const { createAtlasVectorAdapter } = require('../Modules/Knowledge/adapters/atlas');
const fakeAtlas = require('./fixtures/fakeAtlas').create(() => mockDb);

const C = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const ME = '6f0000000000000000000011';
const OTHER = '6f0000000000000000000012';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const OPEN_SPRINT = '6f0000000000000000000d01';
const PRIVATE_SPRINT = '6f0000000000000000000d02';
const MODEL = 'text-embedding-3-small';
const OLD_MODEL = 'text-embedding-ada-002';
const ALL = ['page', 'comment', 'transcript'];
const Q = [1, 0, 0];
const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const PROJECTS = { [ME]: [SHARED], [OTHER]: [SHARED, SECRET] };

let seq = 0;
const sourceId = () => `6f00000000000000000${String(++seq).padStart(5, '0')}`;

const chunk = (over = {}) => ({
    companyId: C, sourceType: 'page', sourceId: sourceId(), ordinal: 0, projectId: SHARED, sprintId: null, taskId: '', participants: [], visibility: 'project', createdBy: OTHER, authorKind: 'human',
    title: 'Page', headingPath: [], text: 'Some text about the harbour.', contentHash: 'h', embedding: [1, 0, 0], embeddingModel: MODEL, deleted: false, sourceUpdatedAt: new Date('2026-09-10T00:00:00Z'), ...over,
});

const STORES = [
    ['in-memory reference', () => createInMemoryVectorAdapter()],
    ['in-database cosine', () => createDatabaseVectorAdapter()],
    ['Atlas Vector Search', () => createAtlasVectorAdapter({ crud: fakeAtlas.crud })],
];

const filterAs = async (userId, companyId = C) => filterFor(
    await resolveVisibleSet({ companyId, caller: { kind: 'user', userId }, scope: { sourceTypes: ALL } }),
    { chunkSources: ALL },
);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    fakeAtlas.reset();
    myCache.flushAll();
    getRoleType.mockImplementation(async () => 3);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: SHARED, private: false, AssigneeUserId: [ME, OTHER], deletedStatusKey: 0 });
});

describe.each(STORES)('the vector store contract: %s', (label, make) => {
    let store;

    const write = async (rows) => {
        rows.forEach((row) => mockDb.seed(CHUNKS, row));
        const byCompany = new Map();
        rows.forEach((row) => byCompany.set(row.companyId, [...(byCompany.get(row.companyId) || []), row]));
        for (const [companyId, chunks] of byCompany) {
            await store.upsert({ companyId, chunks });
            if (store.prepare) await store.prepare({ companyId, model: MODEL });
        }
        return rows;
    };

    const tombstone = async (sourceType, sourceIds, { fromOrdinal = 0 } = {}) => {
        await mockDb.crud(C, { type: CHUNKS, data: [{ sourceType, sourceId: { $in: sourceIds }, ordinal: { $gte: fromOrdinal } }, { $set: { deleted: true } }] }, 'updateMany');
        await store.tombstone({ companyId: C, sourceType, sourceIds, ...(fromOrdinal ? { fromOrdinal } : {}) });
    };

    const erase = async (sources) => {
        for (const { sourceType, sourceId: id } of sources) await mockDb.crud(C, { type: CHUNKS, data: [{ sourceType, sourceId: id }] }, 'deleteMany');
        await store.erase({ companyId: C, sources });
    };

    const found = async (userId = ME, { model = MODEL, companyId = C, limit = 10 } = {}) => (await store.search({ companyId, queryEmbedding: Q, model, filter: await filterAs(userId, companyId), limit }))
        .map((p) => p.sourceId);

    beforeEach(() => { store = make(); });

    it('implements every method of the adapter contract, and says whether it tracks sources itself', () => {
        expect(() => assertAdapter(store)).not.toThrow();
        expect(typeof store.tracksSources).toBe('boolean');
    });

    it('finds what was written, by cosine, one passage per source from its best chunk', async () => {
        const a = sourceId();
        const [, , near, far] = await write([
            chunk({ sourceId: a, ordinal: 0, embedding: [0.5, 0.5, 0], text: 'intro' }),
            chunk({ sourceId: a, ordinal: 1, embedding: [1, 0, 0], text: 'appendix' }),
            chunk({ embedding: [0.8, 0.2, 0] }),
            chunk({ embedding: [0.2, 0.8, 0] }),
        ]);
        const passages = await store.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(ME), limit: 10 });
        expect(passages.map((p) => p.sourceId)).toEqual([a, near.sourceId, far.sourceId]);
        expect(passages[0]).toMatchObject({ id: `page:${a}`, sourceType: 'page', excerpt: 'appendix', score: 1 });
    });

    it('searches only vectors of the embedding model the question was embedded with', async () => {
        const [current, stale] = await write([chunk({ embedding: [0.9, 0.1, 0] }), chunk({ embedding: [1, 0, 0], embeddingModel: OLD_MODEL })]);
        expect(await found()).toEqual([current.sourceId]);
        expect(await found(ME, { model: OLD_MODEL })).toEqual([stale.sourceId]);
    });

    it("applies the caller's visible set: projects, private pages, private sprints and call participants", async () => {
        const rows = await write([
            chunk({ title: 'shared page' }),
            chunk({ title: 'secret project page', projectId: SECRET }),
            chunk({ title: 'my private page', visibility: 'private', createdBy: ME }),
            chunk({ title: 'their private page', visibility: 'private', createdBy: OTHER }),
            chunk({ title: 'open sprint comment', sourceType: 'comment', sprintId: OPEN_SPRINT }),
            chunk({ title: 'private sprint comment', sourceType: 'comment', sprintId: PRIVATE_SPRINT }),
            chunk({ title: 'my call', sourceType: 'transcript', participants: [ME, OTHER], visibility: 'participants' }),
            chunk({ title: 'their call', sourceType: 'transcript', participants: [OTHER], visibility: 'participants' }),
        ]);
        const titleOf = new Map(rows.map((row) => [row.sourceId, row.title]));
        expect((await found(ME)).map((id) => titleOf.get(id)).sort()).toEqual(['my call', 'my private page', 'open sprint comment', 'shared page']);
        expect((await found(OTHER)).map((id) => titleOf.get(id)).sort()).toEqual([
            'my call', 'open sprint comment', 'private sprint comment', 'secret project page', 'shared page', 'their call', 'their private page',
        ]);
    });

    it('hides a tombstoned source', async () => {
        const [gone, kept] = await write([chunk(), chunk({ embedding: [0.9, 0.1, 0] })]);
        await tombstone('page', [gone.sourceId]);
        expect(await found()).toEqual([kept.sourceId]);
    });

    it('hides only the chunks from the ordinal a tombstone names', async () => {
        const id = sourceId();
        await write([chunk({ sourceId: id, ordinal: 0, embedding: [0.6, 0.4, 0], text: 'kept' }), chunk({ sourceId: id, ordinal: 1, text: 'cut' })]);
        await tombstone('page', [id], { fromOrdinal: 1 });
        const passages = await store.search({ companyId: C, queryEmbedding: Q, model: MODEL, filter: await filterAs(ME), limit: 10 });
        expect(passages.map((p) => p.excerpt)).toEqual(['kept']);
    });

    it('forgets an erased source for good, and stops counting it', async () => {
        const [gone, kept] = await write([chunk(), chunk({ embedding: [0.9, 0.1, 0] })]);
        await erase([{ sourceType: 'page', sourceId: gone.sourceId }]);
        expect(await found()).toEqual([kept.sourceId]);
        expect((await store.stats({ companyId: C })).embedded).toEqual({ [MODEL]: 1 });
    });

    it('keeps companies apart', async () => {
        const [mine, theirs] = await write([chunk(), chunk({ companyId: C2 })]);
        expect(await found(ME)).toEqual([mine.sourceId]);
        expect(await found(ME, { companyId: C2 })).toEqual([theirs.sourceId]);
    });

    it('answers nothing for a question with no vector or no model', async () => {
        await write([chunk()]);
        await expect(store.search({ companyId: C, queryEmbedding: [], model: MODEL, filter: await filterAs(ME), limit: 5 })).resolves.toEqual([]);
        await expect(store.search({ companyId: C, queryEmbedding: Q, model: '', filter: await filterAs(ME), limit: 5 })).resolves.toEqual([]);
    });
});
