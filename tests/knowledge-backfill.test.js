const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const backfill = require('../Modules/Knowledge/ingest/backfill');

const C = '6f0000000000000000000c01';
const OFF = '6f0000000000000000000c02';
const AUTHOR = '6f0000000000000000000011';
const LEFT = '6f0000000000000000000012';
const PROJECT = '6f0000000000000000000a01';
const TRASHED = '6f0000000000000000000a02';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const indexedIds = () => [...new Set((mockDb.store[CHUNKS] || []).filter((c) => !c.deleted).map((c) => c.sourceId))].sort();
const stateOf = (companyId = C) => (mockDb.store[STATE] || []).find((s) => s.companyId === companyId && s.sourceType === 'page');
const pageReads = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.PAGES && c.method === 'find');

let pages;

const seedPages = (n, over = () => ({})) => Array.from({ length: n }, (_, i) => String(mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id: `6f00000000000000000b${String(i + 1).padStart(4, '0')}`,
    title: `Page ${i + 1}`,
    content: { html: `<p>Body ${i + 1}</p>` },
    visibility: 'project',
    createdBy: AUTHOR,
    ProjectID: PROJECT,
    deletedStatusKey: 0,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over(i),
})._id));

beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'tenant'; });
afterAll(() => {
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.restoreAllMocks();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: OFF });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: TRASHED, deletedStatusKey: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: AUTHOR, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, status: 2, isDelete: true });
    pages = seedPages(5);
});

describe('backfilling the pages a company already has', () => {
    it('indexes in batches and saves its position after each one', async () => {
        const first = await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        expect(first).toMatchObject({ status: 'running', indexed: 2 });
        expect(stateOf()).toMatchObject({ companyId: C, sourceType: 'page', status: 'running', cursor: pages[1], indexed: 2 });
        expect(indexedIds()).toEqual(pages.slice(0, 2));
    });

    it('resumes from the saved position without reading the pages it already did', async () => {
        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });
        mockDb.calls.length = 0;

        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        const [read] = pageReads();
        expect(String(read.data[0]._id.$gt)).toBe(pages[1]);
        expect(indexedIds()).toEqual(pages.slice(0, 4));

        const done = await backfill.backfillCompany(C, { batchSize: 2 });
        expect(done).toMatchObject({ status: 'complete', indexed: 5 });
        expect(stateOf()).toMatchObject({ status: 'complete', cursor: pages[4], finishedAt: expect.any(Date) });
        expect(indexedIds()).toEqual(pages);
        expect(await backfill.pagesIndexed(C)).toBe(true);
    });

    it('picks up after a crash from the last batch it saved', async () => {
        const ingest = indexer.ingestPage;
        const spy = jest.spyOn(indexer, 'ingestPage').mockImplementation(async (companyId, page, context) => {
            if (String(page._id) === pages[3]) throw new Error('connection reset');
            return ingest(companyId, page, context);
        });

        await expect(backfill.backfillCompany(C, { batchSize: 2 })).rejects.toThrow('connection reset');
        expect(stateOf()).toMatchObject({ status: 'failed', cursor: pages[1], error: 'connection reset' });
        expect(await backfill.pagesIndexed(C)).toBe(false);

        spy.mockRestore();
        mockDb.calls.length = 0;
        const done = await backfill.backfillCompany(C, { batchSize: 2 });

        expect(String(pageReads()[0].data[0]._id.$gt)).toBe(pages[1]);
        expect(done.status).toBe('complete');
        expect(indexedIds()).toEqual(pages);
    });

    it('does not run again once complete', async () => {
        await backfill.backfillCompany(C, { batchSize: 10 });
        mockDb.calls.length = 0;
        const again = await backfill.backfillCompany(C, { batchSize: 10 });
        expect(again.status).toBe('complete');
        expect(pageReads()).toEqual([]);
    });

    it('leaves out deleted pages, pages in a trashed project and the private pages of someone who left', async () => {
        mockDb.store[SCHEMA_TYPE.PAGES].length = 0;
        const [kept, deleted, trashed, leftPrivate, leftShared] = seedPages(5, (i) => [
            {},
            { deletedStatusKey: 1 },
            { ProjectID: TRASHED },
            { createdBy: LEFT, visibility: 'private' },
            { createdBy: LEFT },
        ][i]);

        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(indexedIds()).toEqual([kept, leftShared].sort());
        expect(stateOf()).toMatchObject({ status: 'complete', indexed: 2, skipped: 2 });
        expect(mockDb.calls.filter((c) => c.type === CHUNKS && c.method === 'find').map((c) => c.data[0].sourceId)).not.toContain(deleted);
        [trashed, leftPrivate].forEach((id) => expect(indexedIds()).not.toContain(id));
    });

    it('indexes the pages of a project restored while the backfill is running', async () => {
        mockDb.store[SCHEMA_TYPE.PAGES].length = 0;
        const [first, second, third, fourth] = seedPages(4, (i) => (i < 2 ? {} : { ProjectID: TRASHED }));
        const crud = mockDb.crud.getMockImplementation();
        let restored = false;
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            const result = await crud(companyId, q, method);
            if (!restored && q.type === SCHEMA_TYPE.PAGES && method === 'find' && !q.data[0]._id) {
                restored = true;
                mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => p._id === TRASHED).deletedStatusKey = 0;
                await indexer.reindexProject(C, TRASHED);
            }
            return result;
        });

        try {
            await backfill.backfillCompany(C, { batchSize: 2 });
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        expect(restored).toBe(true);
        expect(indexedIds()).toEqual([first, second, third, fourth].sort());
    });

    it('waits behind an event sync of the same page instead of writing beside it', async () => {
        const [page] = pages;
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        const crud = mockDb.crud.getMockImplementation();
        let holding = true;
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (holding && q.type === SCHEMA_TYPE.PAGES && method === 'findOne' && String(q.data[0]._id) === page) {
                holding = false;
                await held;
            }
            return crud(companyId, q, method);
        });

        try {
            const eventSync = indexer.syncPage(C, page);
            const run = backfill.backfillCompany(C, { batchSize: 10 });
            for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));

            expect(mockDb.calls.filter((c) => c.type === CHUNKS && c.method !== 'find' && JSON.stringify(c.data[0]).includes(page))).toEqual([]);

            release();
            await Promise.all([eventSync, run]);
        } finally {
            mockDb.crud.mockImplementation(crud);
        }
        expect(indexedIds()).toEqual(pages);
    });

    it('runs every company whose indexer is on and skips the rest', async () => {
        await backfill.backfillAll({ batchSize: 10 });
        expect(indexedIds()).toEqual(pages);
        expect(stateOf(C)).toMatchObject({ status: 'complete' });
        expect(mockDb.calls.filter((c) => c.companyId === OFF)).toEqual([]);
    });
});

describe('backfilling comments and transcripts beside pages', () => {
    const TASK = '6f00000000000000000000e1';
    const stateFor = (sourceType) => (mockDb.store[STATE] || []).find((s) => s.companyId === C && s.sourceType === sourceType);
    const liveIds = (sourceType) => [...new Set((mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === sourceType && !c.deleted).map((c) => c.sourceId))].sort();
    const batchReads = (type) => mockDb.calls.filter((c) => c.type === type && c.method === 'find' && c.data[2] && c.data[2].sort && c.data[2].sort._id === 1);

    let comments;
    let calls;

    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK, ProjectID: PROJECT, sprintId: '6f00000000000000000000d1', deletedStatusKey: 0 });
        comments = Array.from({ length: 5 }, (_, i) => String(mockDb.seed(SCHEMA_TYPE.COMMENTS, {
            _id: `6f00000000000000000c${String(i + 1).padStart(4, '0')}`, message: `Comment ${i + 1}`, type: 'text', projectId: PROJECT, taskId: TASK, userId: AUTHOR, isDeleted: false, updatedAt: new Date('2026-09-01T00:00:00Z'),
        })._id));
        calls = Array.from({ length: 5 }, (_, i) => String(mockDb.seed(SCHEMA_TYPE.CALLS, {
            _id: `6f00000000000000000f${String(i + 1).padStart(4, '0')}`, callId: `call-${i}`, title: `Call ${i + 1}`, participants: [AUTHOR], transcript: `Transcript ${i + 1}`, createdBy: AUTHOR, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'),
        })._id));
    });

    it('keeps a position per source and resumes each from its own', async () => {
        const first = await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        expect(first.status).toBe('running');
        expect(stateFor('page')).toMatchObject({ status: 'running', cursor: pages[1], indexed: 2 });
        expect(stateFor('comment')).toMatchObject({ status: 'running', cursor: comments[1], indexed: 2 });
        expect(stateFor('transcript')).toMatchObject({ status: 'running', cursor: calls[1], indexed: 2 });
        expect(liveIds('comment')).toEqual(comments.slice(0, 2));
        expect(liveIds('transcript')).toEqual(calls.slice(0, 2));
        mockDb.calls.length = 0;

        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        expect(String(batchReads(SCHEMA_TYPE.PAGES)[0].data[0]._id.$gt)).toBe(pages[1]);
        expect(String(batchReads(SCHEMA_TYPE.COMMENTS)[0].data[0]._id.$gt)).toBe(comments[1]);
        expect(String(batchReads(SCHEMA_TYPE.CALLS)[0].data[0]._id.$gt)).toBe(calls[1]);

        const done = await backfill.backfillCompany(C, { batchSize: 2 });
        expect(done.status).toBe('complete');
        ['page', 'comment', 'transcript'].forEach((sourceType) => expect(stateFor(sourceType)).toMatchObject({ status: 'complete', indexed: 5 }));
        expect(liveIds('comment')).toEqual(comments);
        expect(liveIds('transcript')).toEqual(calls);
        expect(await backfill.indexedSources(C, ['page', 'comment', 'transcript'])).toEqual(['page', 'comment', 'transcript']);
    });

    it('lets one source fail without holding the others back, and resumes the failed one from its saved position', async () => {
        const ingest = indexer.ingestComment;
        const spy = jest.spyOn(indexer, 'ingestComment').mockImplementation(async (companyId, row, context) => {
            if (String(row._id) === comments[3]) throw new Error('connection reset');
            return ingest(companyId, row, context);
        });

        await expect(backfill.backfillCompany(C, { batchSize: 2 })).rejects.toThrow('connection reset');
        expect(stateFor('comment')).toMatchObject({ status: 'failed', cursor: comments[1], error: 'connection reset' });
        expect(stateFor('page')).toMatchObject({ status: 'complete' });
        expect(stateFor('transcript')).toMatchObject({ status: 'complete' });
        expect(await backfill.indexedSources(C, ['page', 'comment', 'transcript'])).toEqual(['page', 'transcript']);

        spy.mockRestore();
        mockDb.calls.length = 0;
        const done = await backfill.backfillCompany(C, { batchSize: 2 });

        expect(String(batchReads(SCHEMA_TYPE.COMMENTS)[0].data[0]._id.$gt)).toBe(comments[1]);
        expect(batchReads(SCHEMA_TYPE.PAGES)).toEqual([]);
        expect(done.status).toBe('complete');
        expect(liveIds('comment')).toEqual(comments);
    });

    it('leaves out deleted comments, media comments, comments on deleted tasks and discarded calls', async () => {
        mockDb.store[SCHEMA_TYPE.COMMENTS].length = 0;
        mockDb.store[SCHEMA_TYPE.CALLS].length = 0;
        const DELETED_TASK = '6f00000000000000000000e2';
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: DELETED_TASK, ProjectID: PROJECT, deletedStatusKey: 1 });
        const seedComment = (over) => String(mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'Note', type: 'text', projectId: PROJECT, taskId: TASK, userId: AUTHOR, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over })._id);
        const kept = seedComment({});
        seedComment({ isDeleted: true });
        seedComment({ type: 'image' });
        seedComment({ taskId: DELETED_TASK });
        const keptCall = String(mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'a', participants: [AUTHOR], transcript: 'Kept', deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z') })._id);
        mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'b', participants: [AUTHOR], transcript: 'Gone', deletedStatusKey: 1, updatedAt: new Date('2026-09-01T00:00:00Z') });

        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(liveIds('comment')).toEqual([kept]);
        expect(stateFor('comment')).toMatchObject({ status: 'complete', indexed: 1, skipped: 1 });
        expect(liveIds('transcript')).toEqual([keptCall]);
    });
});

describe('backfilling project guides and task files', () => {
    const { readStoredFile } = require('../common-storage/readStoredFile');
    const stateFor = (sourceType) => (mockDb.store[STATE] || []).find((s) => s.companyId === C && s.sourceType === sourceType);
    const liveIds = (sourceType) => [...new Set((mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === sourceType && !c.deleted).map((c) => c.sourceId))].sort();
    const batchReads = (type) => mockDb.calls.filter((c) => c.type === type && c.method === 'find' && c.data[2] && c.data[2].sort && c.data[2].sort._id === 1);
    const SPRINT = '6f00000000000000000000d1';

    let guided;
    let tasks;

    const attachmentOf = (taskId, n, name = `notes-${n}.txt`) => ({ id: `bf${String(n).padStart(15, '0')}`, filename: name, extension: name.slice(name.lastIndexOf('.') + 1), size: 20, userId: AUTHOR, url: `Project/${PROJECT}/Sprint/${taskId}/Attachment/${name}` });

    beforeEach(() => {
        mockDb.store[SCHEMA_TYPE.PAGES].length = 0;
        guided = Array.from({ length: 3 }, (_, i) => String(mockDb.seed(SCHEMA_TYPE.PROJECTS, {
            _id: `6f00000000000000000d${String(i + 1).padStart(4, '0')}`, ProjectName: `Guided ${i + 1}`, aiGuide: { markdown: `## Stages\n1. Step ${i + 1}` }, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'),
        })._id));
        tasks = Array.from({ length: 5 }, (_, i) => {
            const _id = `6f00000000000000000e${String(i + 1).padStart(4, '0')}`;
            return String(mockDb.seed(SCHEMA_TYPE.TASKS, { _id, TaskName: `Task ${i + 1}`, ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, attachments: [attachmentOf(_id, i + 1)], updatedAt: new Date('2026-09-01T00:00:00Z') })._id);
        });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f00000000000000000e0099', TaskName: 'No files', ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, attachments: [] });
        readStoredFile.mockReset();
        readStoredFile.mockImplementation(async ({ key }) => ({ buffer: Buffer.from(`Text of ${key}`), size: 20 }));
    });

    afterEach(() => indexer.clearFileRetries());

    it('indexes every guide and every attachment a company already had, and only then says the source is ready', async () => {
        expect(await backfill.indexedSources(C, ['guide', 'file'])).toEqual([]);

        const done = await backfill.backfillCompany(C, { batchSize: 2 });

        expect(done.status).toBe('complete');
        expect(liveIds('guide')).toEqual(guided);
        expect(liveIds('file')).toEqual(tasks.map((taskId, i) => indexer.fileSourceId(taskId, attachmentOf(taskId, i + 1).id)).sort());
        expect(stateFor('guide')).toMatchObject({ status: 'complete', indexed: 3 });
        expect(stateFor('file')).toMatchObject({ status: 'complete', indexed: 5 });
        expect(await backfill.indexedSources(C, ['guide', 'file'])).toEqual(['guide', 'file']);
    });

    it('walks only the tasks that carry an attachment and the projects that carry a guide', async () => {
        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(batchReads(SCHEMA_TYPE.TASKS)[0].data[0]).toMatchObject({ 'attachments.0': { $exists: true }, deletedStatusKey: { $ne: 1 } });
        expect(batchReads(SCHEMA_TYPE.PROJECTS)[0].data[0]).toMatchObject({ 'aiGuide.markdown': { $exists: true }, deletedStatusKey: { $ne: 1 } });
        expect(readStoredFile).toHaveBeenCalledTimes(5);
    });

    it('keeps a position per source, resumes each from its own, and reads no file twice', async () => {
        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1 });

        expect(stateFor('guide')).toMatchObject({ status: 'running', cursor: guided[1], indexed: 2 });
        expect(stateFor('file')).toMatchObject({ status: 'running', cursor: tasks[1], indexed: 2 });
        expect(await backfill.indexedSources(C, ['guide', 'file'])).toEqual([]);
        expect(readStoredFile).toHaveBeenCalledTimes(2);
        mockDb.calls.length = 0;

        await backfill.backfillCompany(C, { batchSize: 2 });

        expect(String(batchReads(SCHEMA_TYPE.PROJECTS)[0].data[0]._id.$gt)).toBe(guided[1]);
        expect(String(batchReads(SCHEMA_TYPE.TASKS)[0].data[0]._id.$gt)).toBe(tasks[1]);
        expect(readStoredFile).toHaveBeenCalledTimes(5);
        expect(stateFor('file')).toMatchObject({ status: 'complete', indexed: 5 });
    });

    it('counts a file it could not read as skipped and carries on to the next', async () => {
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => String(t._id) === tasks[1]).attachments.push(attachmentOf(tasks[1], 77, 'diagram.png'));
        readStoredFile.mockImplementation(async ({ key }) => {
            if (key.includes('notes-3')) throw Object.assign(new Error('gone'), { code: 'not_found' });
            return { buffer: Buffer.from(`Text of ${key}`), size: 20 };
        });

        const done = await backfill.backfillCompany(C, { batchSize: 10 });

        expect(done.status).toBe('complete');
        expect(stateFor('file')).toMatchObject({ status: 'complete', indexed: 4, skipped: 2 });
        expect(liveIds('file')).toHaveLength(4);
    });

    it('picks up after a crash from the last batch it saved', async () => {
        const sync = indexer.syncTaskFiles;
        const spy = jest.spyOn(indexer, 'syncTaskFiles').mockImplementation(async (companyId, taskId) => {
            if (taskId === tasks[3]) throw new Error('connection reset');
            return sync(companyId, taskId);
        });

        await expect(backfill.backfillCompany(C, { batchSize: 2 })).rejects.toThrow('connection reset');
        expect(stateFor('file')).toMatchObject({ status: 'failed', cursor: tasks[1] });
        expect(stateFor('guide')).toMatchObject({ status: 'complete' });
        expect(await backfill.indexedSources(C, ['guide', 'file'])).toEqual(['guide']);

        spy.mockRestore();
        await backfill.backfillCompany(C, { batchSize: 2 });
        expect(stateFor('file')).toMatchObject({ status: 'complete' });
        expect(liveIds('file')).toHaveLength(5);
    });

    it('leaves out the guide of a trashed project and the files of a deleted task', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: '6f00000000000000000d0050', ProjectName: 'Binned', aiGuide: { markdown: 'Binned guide' }, deletedStatusKey: 1 });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f00000000000000000e0050', ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 1, attachments: [attachmentOf('6f00000000000000000e0050', 50)] });

        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(liveIds('guide')).toEqual(guided);
        expect(liveIds('file')).toHaveLength(5);
    });
});

describe('filling in where existing chunks came from', () => {
    const stateFor = (sourceType) => (mockDb.store[STATE] || []).find((s) => s.companyId === C && s.sourceType === sourceType);
    const originsOf = (sourceType) => Object.fromEntries((mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === sourceType).map((c) => [c.sourceId, c.origin]));
    const seedPage = (over) => String(mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Extra', content: { html: '<p>Extra body.</p>' }, visibility: 'project', createdBy: AUTHOR, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over })._id);
    const forgetOrigins = () => {
        mockDb.store[CHUNKS].forEach((c) => { delete c.origin; });
        mockDb.store[STATE].forEach((s) => { delete s.originFilledAt; });
        mockDb.calls.length = 0;
    };

    it('gives the chunks of a source indexed before the field existed their origin, once, without walking the source again', async () => {
        const drafted = seedPage({ _id: '6f00000000000000000b0077', createdByAgent: true });
        await backfill.backfillCompany(C, { batchSize: 10 });
        forgetOrigins();

        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(originsOf('page')).toEqual({ ...Object.fromEntries(pages.map((id) => [id, 'member'])), [drafted]: 'agent' });
        expect(stateFor('page').originFilledAt).toBeInstanceOf(Date);
        expect(pageReads().filter((c) => c.data[2] && c.data[2].sort)).toEqual([]);

        mockDb.calls.length = 0;
        await backfill.backfillCompany(C, { batchSize: 10 });
        expect(mockDb.calls.filter((c) => c.type === CHUNKS && c.method === 'updateMany')).toEqual([]);
    });

    it('re-syncs a page an inbound path filed, so it reads as external', async () => {
        const inbound = seedPage({ _id: '6f00000000000000000b0078', origin: { kind: 'email', ref: 'abc' } });
        await backfill.backfillCompany(C, { batchSize: 10 });
        forgetOrigins();

        await backfill.backfillCompany(C, { batchSize: 10 });

        expect(originsOf('page')[inbound]).toBe('external');
    });

    it('records the fill on a source walked from the start, whose chunks were written with their origin', async () => {
        await backfill.backfillCompany(C, { batchSize: 10 });
        expect(stateFor('page').originFilledAt).toBeInstanceOf(Date);
        expect(originsOf('page')).toEqual(Object.fromEntries(pages.map((id) => [id, 'member'])));
    });
});
