const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const { eraseDocument, erasePerson } = require('../Modules/Knowledge/ingest/erase');

const C = '6f0000000000000000000c01';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const stored = (pageId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(pageId));

const indexed = async (over) => {
    const page = mockDb.seed(SCHEMA_TYPE.PAGES, {
        title: 'Notes', content: { html: '<p>One.</p><h2>Two</h2><p>Two.</p>' }, visibility: 'project', ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
    });
    await indexer.ingestPage(C, page);
    return page;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
});

describe('erasing from the chunk store', () => {
    it("removes every chunk of one document, tombstoned or not, and nothing else's", async () => {
        const doomed = await indexed({ createdBy: ALICE });
        const kept = await indexed({ createdBy: ALICE });
        await indexer.ingestPage(C, { ...doomed, content: { html: '<p>One.</p>' }, updatedAt: new Date('2026-09-02T00:00:00Z') });
        expect(stored(doomed._id).map((c) => c.deleted)).toEqual([false, true]);

        const result = await eraseDocument(C, { sourceType: 'page', sourceId: String(doomed._id) });

        expect(result).toEqual({ erased: 2 });
        expect(stored(doomed._id)).toEqual([]);
        expect(stored(kept._id)).toHaveLength(2);
    });

    it("removes a person's private pages and keeps what they shared and what others wrote", async () => {
        const alicePrivate = await indexed({ createdBy: ALICE, visibility: 'private' });
        const aliceShared = await indexed({ createdBy: ALICE });
        const bobPrivate = await indexed({ createdBy: BOB, visibility: 'private' });

        const result = await erasePerson(C, ALICE);

        expect(result).toEqual({ erased: 2 });
        expect(stored(alicePrivate._id)).toEqual([]);
        expect(stored(aliceShared._id)).toHaveLength(2);
        expect(stored(bobPrivate._id)).toHaveLength(2);
    });

    it('refuses an erase that names no document or no person, rather than erasing everything', async () => {
        await indexed({ createdBy: ALICE, visibility: 'private' });
        await expect(eraseDocument(C, { sourceType: 'page', sourceId: '' })).rejects.toThrow(/sourceId/);
        await expect(eraseDocument(C, { sourceType: '', sourceId: 'x' })).rejects.toThrow(/sourceType/);
        await expect(erasePerson(C, '')).rejects.toThrow(/user/);
        expect(mockDb.store[CHUNKS]).toHaveLength(2);
    });

    it('touches only the knowledge store: no audit row is written or changed', async () => {
        await indexed({ createdBy: ALICE, visibility: 'private' });
        mockDb.calls.length = 0;
        await erasePerson(C, ALICE);
        expect([...new Set(mockDb.calls.map((c) => c.type))].sort()).toEqual([CHUNKS, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS].sort());
    });
});

describe('an erasure sticks', () => {
    const backfill = require('../Modules/Knowledge/ingest/backfill');
    const events = require('../Modules/Knowledge/ingest/events');
    const ENV = process.env.KNOWLEDGE_INDEXER;

    beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'all'; });
    afterAll(() => {
        if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
        else process.env.KNOWLEDGE_INDEXER = ENV;
    });

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ALICE, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: BOB, status: 2, isDelete: false });
    });

    it('keeps an erased document out when it is synced, re-indexed with its project, or backfilled', async () => {
        const erased = await indexed({ createdBy: ALICE });
        const kept = await indexed({ createdBy: BOB });
        await eraseDocument(C, { sourceType: 'page', sourceId: String(erased._id) });

        await indexer.syncPage(C, String(erased._id));
        await indexer.reindexProject(C, PROJECT);
        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(stored(erased._id)).toEqual([]);
        expect(stored(kept._id)).toHaveLength(2);
    });

    it("keeps an erased person's private pages out after a project restore, a backfill and a rejoin, and leaves their shared pages", async () => {
        const secret = await indexed({ createdBy: ALICE, visibility: 'private' });
        const shared = await indexed({ createdBy: ALICE });
        await erasePerson(C, ALICE);

        await indexer.reindexProject(C, PROJECT);
        await backfill.backfillCompany(C, { batchSize: 10 });
        await events.handle({ type: 'member.activated', companyId: C, entity: { kind: 'member', id: ALICE }, data: { userId: ALICE } });

        expect(stored(secret._id)).toEqual([]);
        expect(stored(shared._id).filter((c) => !c.deleted)).toHaveLength(2);
    });
});

describe('erasing comments and transcripts', () => {
    const backfill = require('../Modules/Knowledge/ingest/backfill');
    const ENV = process.env.KNOWLEDGE_INDEXER;
    const TASK = '6f00000000000000000000e1';

    const storedOf = (sourceType, id) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === sourceType && c.sourceId === String(id));
    const seedComment = async (over) => {
        const row = mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'The quay wall is cracked.', type: 'text', projectId: PROJECT, taskId: TASK, userId: ALICE, isDeleted: false, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over });
        await indexer.syncComment(C, String(row._id));
        return row;
    };
    const seedCall = async (over) => {
        const row = mockDb.seed(SCHEMA_TYPE.CALLS, { callId: `call-${Math.random()}`, title: 'Quay call', participants: [ALICE, BOB], transcript: 'The quay wall.', createdBy: ALICE, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over });
        await indexer.syncTranscript(C, String(row._id));
        return row;
    };

    beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'all'; });
    afterAll(() => {
        if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
        else process.env.KNOWLEDGE_INDEXER = ENV;
    });

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ALICE, status: 2, isDelete: false });
    });

    it('erases one comment and keeps it out through a sync, a task re-index and a backfill', async () => {
        const erased = await seedComment({});
        const kept = await seedComment({});
        expect(storedOf('comment', erased._id)).toHaveLength(1);

        expect(await eraseDocument(C, { sourceType: 'comment', sourceId: String(erased._id) })).toEqual({ erased: 1 });
        await indexer.syncComment(C, String(erased._id));
        await indexer.reindexTask(C, TASK, { moved: true });
        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(storedOf('comment', erased._id)).toEqual([]);
        expect(storedOf('comment', kept._id)).toHaveLength(1);
    });

    it('erases one transcript and keeps it out through a sync and a backfill', async () => {
        const erased = await seedCall({});
        const kept = await seedCall({});

        await eraseDocument(C, { sourceType: 'transcript', sourceId: String(erased._id) });
        await indexer.syncTranscript(C, String(erased._id));
        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(storedOf('transcript', erased._id)).toEqual([]);
        expect(storedOf('transcript', kept._id).length).toBeGreaterThan(0);
    });

    it("erasing a person removes their private pages and the comments they wrote, and keeps the calls they were on and everyone else's comments", async () => {
        const mine = await seedComment({ userId: ALICE });
        const theirs = await seedComment({ userId: BOB });
        const call = await seedCall({ createdBy: ALICE });
        const secret = await indexed({ createdBy: ALICE, visibility: 'private' });
        const shared = await indexed({ createdBy: ALICE });

        const result = await erasePerson(C, ALICE);
        await indexer.syncTranscript(C, String(call._id));

        expect(result).toEqual({ erased: 3 });
        expect(stored(secret._id)).toEqual([]);
        expect(storedOf('comment', mine._id)).toEqual([]);
        expect(storedOf('comment', theirs._id).filter((c) => !c.deleted)).toHaveLength(1);
        expect(stored(shared._id).filter((c) => !c.deleted)).toHaveLength(2);
        expect(storedOf('transcript', call._id).filter((c) => !c.deleted).length).toBeGreaterThan(0);
        expect(mockDb.store[SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS]).toEqual([expect.objectContaining({ kind: 'author', userId: ALICE })]);
    });

    it("keeps an erased person's comments out after a sync, a project restore, a task restore, a backfill and a rejoin", async () => {
        const events = require('../Modules/Knowledge/ingest/events');
        const comment = await seedComment({ userId: ALICE });
        expect(storedOf('comment', comment._id)).toHaveLength(1);
        await erasePerson(C, ALICE);
        const taskRow = () => mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === TASK);

        await indexer.syncComment(C, String(comment._id));
        await indexer.tombstoneProject(C, PROJECT);
        await indexer.reindexProject(C, PROJECT);
        taskRow().deletedStatusKey = 1;
        await indexer.reindexTask(C, TASK);
        taskRow().deletedStatusKey = 0;
        await indexer.reindexTask(C, TASK);
        await backfill.backfillCompany(C, { batchSize: 10 });
        await events.handle({ type: 'member.activated', companyId: C, entity: { kind: 'member', id: ALICE }, data: { userId: ALICE } });
        await events.drain();

        expect(storedOf('comment', comment._id)).toEqual([]);
    });

    it('erasing a person keeps the files they attached and the guides of their projects: both are shared task and project content', async () => {
        const { readStoredFile } = require('../common-storage/readStoredFile');
        readStoredFile.mockResolvedValue({ buffer: Buffer.from('The quay survey, attached by Alice.'), size: 35 });
        const attached = { id: 'erase000000000001', filename: 'survey.txt', extension: 'txt', size: 35, userId: ALICE, url: `Project/${PROJECT}/Sprint/${TASK}/Attachment/survey.txt` };
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === TASK).attachments = [attached];
        Object.assign(mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => p._id === PROJECT), { ProjectName: 'Quay', aiGuide: { markdown: '## Stages\n1. Survey the quay' }, createdBy: ALICE });
        await indexer.syncTaskFiles(C, TASK);
        await indexer.syncGuide(C, PROJECT);
        const fileId = indexer.fileSourceId(TASK, attached.id);
        expect(storedOf('file', fileId)[0]).toMatchObject({ createdBy: ALICE, deleted: false });

        await erasePerson(C, ALICE);
        await indexer.syncFile(C, fileId);
        await indexer.syncGuide(C, PROJECT);

        expect(storedOf('file', fileId).filter((c) => !c.deleted)).toHaveLength(1);
        expect(storedOf('guide', PROJECT).filter((c) => !c.deleted).length).toBeGreaterThan(0);
    });
});
