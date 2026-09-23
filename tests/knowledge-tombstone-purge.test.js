const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const { contentHashOf } = require('../Modules/Knowledge/ingest/chunker');
const domainEventBus = require('../event/domainEventBus');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');
const purge = require('../Modules/Knowledge/ingest/purge');

const C = '6f0000000000000000000c75';
const AUTHOR = '6f0000000000000000000075';
const P1 = '6f00000000000000000000a5';
const S1 = '6f00000000000000000000d5';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, retention: process.env.KNOWLEDGE_TOMBSTONE_RETENTION_DAYS };
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-23T00:00:00Z').getTime();
const EMPTY_HASH = contentHashOf([], '');

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const rows = () => mockDb.store[CHUNKS] || [];
const chunksOf = (sourceType, id) => rows().filter((c) => c.sourceType === sourceType && c.sourceId === String(id));
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));
const daysAgo = (days) => new Date(NOW - days * DAY);

let serial = 0;
const chunk = (over = {}) => {
    serial += 1;
    return mockDb.seed(CHUNKS, {
        companyId: C,
        sourceType: 'page',
        sourceId: `6f00000000000000000${String(serial).padStart(5, '0')}`,
        ordinal: 0,
        headingPath: ['Heading'],
        title: 'A title',
        text: 'Words that were deleted.',
        contentHash: contentHashOf(['Heading'], 'Words that were deleted.'),
        embedding: [0.1, 0.2],
        embeddingModel: 'text-embedding-3-small',
        deleted: true,
        deletedAt: daysAgo(40),
        tombstoneReason: '',
        ...over,
    });
};

const expectBlanked = (row) => expect(row).toMatchObject({
    deleted: true, text: '', title: '', headingPath: [], embedding: [], embeddingModel: null, contentHash: EMPTY_HASH,
});

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Task', CompanyId: C, ProjectID: P1, sprintId: S1, deletedStatusKey: 0, updatedAt: daysAgo(60), ...over });
const seedComment = (task) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    message: 'The pier needs planks.', type: 'text', projectId: task.ProjectID, sprintId: task.sprintId, taskId: String(task._id), userId: AUTHOR, isDeleted: false, updatedAt: daysAgo(60),
});
const setDeleted = (task, deletedStatusKey, updatedAt) => {
    Object.assign(rowOf(SCHEMA_TYPE.TASKS, task._id), { deletedStatusKey, updatedAt });
    const changedFields = new Set(['deletedStatusKey']);
    const type = domainEventBus.classifyTaskEvent('update', changedFields);
    domainEventBus.bus.emit(type, domainEventBus.buildEnvelope({ companyId: C, type, doc: rowOf(SCHEMA_TYPE.TASKS, task._id), changedFields, actor: { kind: 'user' } }));
};

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    expect(events.start()).toBe(true);
});

afterAll(() => {
    events.stop();
    Object.entries({ KNOWLEDGE_INDEXER: ENV.indexer, KNOWLEDGE_TOMBSTONE_RETENTION_DAYS: ENV.retention }).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
});

beforeEach(() => {
    delete process.env.KNOWLEDGE_TOMBSTONE_RETENTION_DAYS;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    purge.resetSchedule();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    ['page', 'comment', 'transcript', 'guide', 'file'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date(), originFilledAt: new Date() }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, deletedStatusKey: 0 });
});

describe('purging tombstoned chunks', () => {
    it('removes a tombstone older than the retention period and keeps a recent one and every live chunk', async () => {
        const old = chunk({ deletedAt: daysAgo(31) });
        const recent = chunk({ deletedAt: daysAgo(29) });
        const alive = chunk({ deleted: false, deletedAt: null });

        const result = await purge.purgeTombstones(C, { now: NOW });

        expect(result).toMatchObject({ purged: 1 });
        expect(rows().map((r) => r._id).sort()).toEqual([recent._id, alive._id].sort());
    });

    it('keeps 30 days by default and reads the period from KNOWLEDGE_TOMBSTONE_RETENTION_DAYS', async () => {
        expect(purge.retentionDays()).toBe(30);
        process.env.KNOWLEDGE_TOMBSTONE_RETENTION_DAYS = '7';
        expect(purge.retentionDays()).toBe(7);
        const eight = chunk({ deletedAt: daysAgo(8) });
        const six = chunk({ deletedAt: daysAgo(6) });

        await purge.purgeTombstones(C, { now: NOW });

        expect(rows().map((r) => r._id)).toEqual([six._id]);
        expect(rows()).not.toContainEqual(expect.objectContaining({ _id: eight._id }));
    });

    it('purges nothing when the retention period is 0, and falls back to 30 days on a value that is not a number', async () => {
        process.env.KNOWLEDGE_TOMBSTONE_RETENTION_DAYS = '0';
        chunk({ deletedAt: daysAgo(400) });
        expect(await purge.purgeTombstones(C, { now: NOW })).toMatchObject({ purged: 0, blanked: 0 });
        expect(rows()).toHaveLength(1);

        process.env.KNOWLEDGE_TOMBSTONE_RETENTION_DAYS = 'soon';
        expect(purge.retentionDays()).toBe(30);
    });

    it('never touches a file still owed an extraction, however old its tombstone', async () => {
        const owed = chunk({ sourceType: 'file', text: '', contentHash: EMPTY_HASH, extractDueAt: daysAgo(35), deletedAt: daysAgo(90) });

        await purge.purgeTombstones(C, { now: NOW });

        expect(rows()).toEqual([owed]);
    });

    it("keeps a file's outcome record, emptied of its text, so a skipped or failed file is not read again", async () => {
        const skipped = chunk({ sourceType: 'file', fileKey: 'k/empty.pdf', tombstoneReason: 'skipped:empty' });
        const failed = chunk({ sourceType: 'file', fileKey: 'k/bad.pdf', tombstoneReason: 'extract:failed', extractAttempts: 3 });
        const failedTail = chunk({ sourceType: 'file', sourceId: failed.sourceId, ordinal: 1, tombstoneReason: '' });

        const result = await purge.purgeTombstones(C, { now: NOW });

        expect(result).toMatchObject({ purged: 1, blanked: 2 });
        expect(rows()).not.toContainEqual(expect.objectContaining({ _id: failedTail._id }));
        expectBlanked(rowOf(CHUNKS, skipped._id));
        expect(rowOf(CHUNKS, skipped._id)).toMatchObject({ tombstoneReason: 'skipped:empty', fileKey: 'k/empty.pdf' });
        expectBlanked(rowOf(CHUNKS, failed._id));
        expect(rowOf(CHUNKS, failed._id)).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 3 });
    });

    it("keeps a departed member's agent-note marker, emptied, so a rejoin can bring the note back, and purges other old notes", async () => {
        const departed = chunk({ sourceType: 'memory', tombstoneReason: 'departed', derivedOnlyPrivateOf: AUTHOR });
        const retired = chunk({ sourceType: 'memory', tombstoneReason: 'agent deleted' });

        await purge.purgeTombstones(C, { now: NOW });

        expect(rows()).not.toContainEqual(expect.objectContaining({ _id: retired._id }));
        expectBlanked(rowOf(CHUNKS, departed._id));
        expect(rowOf(CHUNKS, departed._id)).toMatchObject({ tombstoneReason: 'departed', derivedOnlyPrivateOf: AUTHOR });
    });

    it('is idempotent: a second pass finds nothing to purge or empty', async () => {
        chunk();
        chunk({ tombstoneReason: 'task', sourceType: 'comment' });
        await purge.purgeTombstones(C, { now: NOW });

        expect(await purge.purgeTombstones(C, { now: NOW })).toEqual({ purged: 0, blanked: 0 });
    });
});

describe("a deleted task's comments after the purge", () => {
    it('leaves one empty marker per comment, and a restore still brings the comment back with its text', async () => {
        const task = seedTask();
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));
        chunk({ sourceType: 'comment', sourceId: String(comment._id), ordinal: 1, taskId: String(task._id), tombstoneReason: 'task', deleted: false, deletedAt: null });

        setDeleted(task, 1, daysAgo(50));
        await events.drain();
        chunksOf('comment', comment._id).forEach((c) => { c.deletedAt = daysAgo(50); });
        expect(chunksOf('comment', comment._id).every((c) => c.deleted && c.tombstoneReason === 'task')).toBe(true);

        await purge.purgeTombstones(C, { now: NOW });

        expect(chunksOf('comment', comment._id)).toHaveLength(1);
        expectBlanked(chunksOf('comment', comment._id)[0]);
        expect(chunksOf('comment', comment._id)[0]).toMatchObject({ ordinal: 0, tombstoneReason: 'task' });

        setDeleted(task, 0, daysAgo(1));
        await events.drain();

        const back = chunksOf('comment', comment._id).filter((c) => !c.deleted);
        expect(back).toHaveLength(1);
        expect(back[0].text).toContain('The pier needs planks.');
    });
});

describe('when the purge runs', () => {
    it('runs at most once a day per company', async () => {
        chunk();
        expect(await purge.purgeDue(C, { now: NOW })).toMatchObject({ purged: 1 });
        chunk();
        expect(await purge.purgeDue(C, { now: NOW + DAY - 1 })).toBeNull();
        expect(await purge.purgeDue(C, { now: NOW + DAY })).toMatchObject({ purged: 1 });
    });

    it("is part of the recurring knowledge.backfill job's pass over each company", async () => {
        const backfill = require('../Modules/Knowledge/ingest/backfill');
        chunk({ deletedAt: new Date(Date.now() - 31 * DAY) });

        await backfill.backfillAll();

        expect(rows().filter((r) => r.deleted === true)).toEqual([]);
    });

    it('reads the partial index the chunk schema declares for it', () => {
        const declared = knowledgeChunksSchema.indexes().find(([key]) => JSON.stringify(key) === JSON.stringify(purge.INDEX_KEY));
        expect(declared).toBeDefined();
        expect(declared[1]).toMatchObject(purge.INDEX_OPTIONS);
        expect(purge.INDEX_OPTIONS.partialFilterExpression).toEqual({ deleted: true });
    });
});
