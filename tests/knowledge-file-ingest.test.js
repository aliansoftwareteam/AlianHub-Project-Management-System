/* Task attachments as a knowledge source. The text of a file is extracted away from the request
 * that attached it, from bytes read through the storage abstraction for the task's own company,
 * under limits; its chunks follow the task exactly as comments do; a file that cannot be read is
 * recorded and never holds up the next one. */
process.env.STORAGE_TYPE = 'server';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { myCache } = require('../Config/config');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const { readStoredFile } = require('../common-storage/readStoredFile');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const extractor = require('../Modules/Knowledge/ingest/extract/extractor');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');
const { eraseDocument } = require('../Modules/Knowledge/ingest/erase');

const C = '6f0000000000000000000c01';
const OFF_COMPANY = '6f0000000000000000000c02';
const MEMBER = '6f0000000000000000000003';
const P1 = '6f00000000000000000000a1';
const P2 = '6f00000000000000000000a2';
const OPEN_SPRINT = '6f00000000000000000000d1';
const OTHER_SPRINT = '6f00000000000000000000d2';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER, bytes: process.env.KNOWLEDGE_FILE_MAX_BYTES };
const LATER = Date.now() + 24 * 60 * 60 * 1000;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
const keyOf = (task, name) => `Project/${task.ProjectID}/Sprint/${task._id}/Attachment/${name}`;
const sourceOf = (task, attachment) => indexer.fileSourceId(task._id, attachment.id);
const rowsOf = (sourceId) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === 'file' && c.sourceId === sourceId).sort((a, b) => a.ordinal - b.ordinal);
const live = (sourceId) => rowsOf(sourceId).filter((c) => !c.deleted);
const markerOf = (sourceId) => rowsOf(sourceId).find((c) => c.ordinal === 0 && c.deleted);
const chunkWrites = () => mockDb.calls.filter((c) => c.type === CHUNKS && !['find', 'findOne'].includes(c.method));
const taskRow = (task) => mockDb.store[SCHEMA_TYPE.TASKS].find((row) => String(row._id) === String(task._id));

let attachmentSeq = 0;
const attachment = (name, over = {}) => {
    attachmentSeq += 1;
    return { id: `att${String(attachmentSeq).padStart(14, '0')}`, filename: name, extension: name.slice(name.lastIndexOf('.') + 1), size: 64, type: 'text', userId: MEMBER, createdAt: at(1), ...over };
};

const seedTask = (attachments = [], over = {}) => {
    const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Harbour survey', CompanyId: C, ProjectID: P1, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: at(1), attachments: [], ...over });
    task.attachments = attachments.map((a) => ({ url: keyOf(task, a.filename), ...a }));
    return task;
};

/* What storage holds, by company and key; anything else is missing. */
const files = new Map();
const store = (companyId, key, content) => files.set(`${companyId}:${key}`, Buffer.from(content));
const storeFor = (task, texts) => task.attachments.forEach((a, i) => store(C, a.url, texts[i]));

/* The envelope the bus publishes for a task emit, built the way it builds one. */
const taskEnvelope = (task, fields, companyId = C) => {
    const changedFields = new Set(fields);
    const type = domainEventBus.classifyTaskEvent('update', changedFields);
    return domainEventBus.buildEnvelope({ companyId, type, doc: task, changedFields, actor: { kind: 'user' } });
};
const taskChanged = async (task, fields) => {
    const envelope = taskEnvelope(task, fields);
    domainEventBus.bus.emit(envelope.type, envelope);
    await events.drain();
};

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    expect(events.start()).toBe(true);
});

afterAll(() => {
    events.stop();
    if (ENV.indexer === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV.indexer;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    files.clear();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    myCache.flushAll();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: OFF_COMPANY });
    ['page', 'comment', 'transcript', 'guide', 'file'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date(), originFilledAt: new Date() }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'One', deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Two', deletedStatusKey: 0 });
    readStoredFile.mockImplementation(async ({ companyId, key, maxBytes }) => {
        const buffer = files.get(`${companyId}:${key}`);
        if (!buffer) throw Object.assign(new Error('not found'), { code: 'not_found' });
        if (buffer.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'too_large' });
        return { buffer, size: buffer.length };
    });
});

afterEach(() => {
    if (ENV.bytes === undefined) delete process.env.KNOWLEDGE_FILE_MAX_BYTES;
    else process.env.KNOWLEDGE_FILE_MAX_BYTES = ENV.bytes;
});

describe('an attachment added to a task', () => {
    it('is announced by the bus as a task change naming attachments', () => {
        expect(domainEventBus.classifyTaskEvent('update', new Set(['attachments']))).toBe('task.updated');
        expect(taskEnvelope(seedTask(), ['attachments']).changedFields).toEqual(['attachments']);
    });

    it('is indexed with its task, project and sprint, from the text of the stored file', async () => {
        const task = seedTask([attachment('survey-notes.txt')]);
        storeFor(task, ['The north pier needs new planks.\nOrder the timber in March.']);

        await taskChanged(task, ['attachments']);

        const rows = live(sourceOf(task, task.attachments[0]));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            companyId: C,
            sourceType: 'file',
            ordinal: 0,
            projectId: P1,
            sprintId: OPEN_SPRINT,
            taskId: String(task._id),
            visibility: 'project',
            createdBy: MEMBER,
            authorKind: 'human',
            origin: 'member',
            title: 'survey-notes.txt',
            fileKey: task.attachments[0].url,
            pieceCount: 1,
            deleted: false,
        });
        expect(rows[0].text).toContain('The north pier needs new planks.');
        expect(rows[0].text).toContain('Order the timber in March.');
    });

    it('chunks a markdown file on its headings', async () => {
        const task = seedTask([attachment('mooring.md')]);
        storeFor(task, ['Intro line.\n\n# Mooring\n\nUse the north cleat.\n\n## At night\n\nShow a white light.']);

        await taskChanged(task, ['attachments']);

        expect(live(sourceOf(task, task.attachments[0])).map((c) => c.headingPath)).toEqual([
            ['mooring.md'],
            ['mooring.md', 'Mooring'],
            ['mooring.md', 'Mooring', 'At night'],
        ]);
    });

    it('is extracted away from the event that announced it: the handler returns while the bytes are still being read', async () => {
        const task = seedTask([attachment('slow.txt')]);
        let release;
        readStoredFile.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ buffer: Buffer.from('Slow harbour text.'), size: 18 }); }));

        await events.handle(taskEnvelope(task, ['attachments']));
        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(0);

        await new Promise((resolve) => setImmediate(resolve));
        release();
        await events.drain();
        expect(live(sourceOf(task, task.attachments[0])).map((c) => c.text)).toEqual(['slow.txt\nSlow harbour text.']);
    });

    it('reads the bytes through storage for the task\'s own company by the key on the task row, never by anything the event carries', async () => {
        const task = seedTask([attachment('real.txt')]);
        storeFor(task, ['Real harbour text.']);
        store(C, 'Project/evil/other.txt', 'Text from the path the event named.');
        store(OFF_COMPANY, task.attachments[0].url, 'Another company\'s text.');
        const envelope = taskEnvelope(task, ['attachments']);
        envelope.data = { ...envelope.data, path: 'Project/evil/other.txt', url: 'Project/evil/other.txt', key: 'Project/evil/other.txt', attachments: [{ id: task.attachments[0].id, url: 'Project/evil/other.txt' }] };

        domainEventBus.bus.emit(envelope.type, envelope);
        await events.drain();

        expect(readStoredFile).toHaveBeenCalledTimes(1);
        expect(readStoredFile.mock.calls[0][0]).toMatchObject({ companyId: C, key: task.attachments[0].url, maxBytes: 10 * 1024 * 1024 });
        expect(live(sourceOf(task, task.attachments[0]))[0].text).toContain('Real harbour text.');
    });

    it('is picked up from a task created with attachments already on it', async () => {
        const task = seedTask([attachment('intake.txt')]);
        storeFor(task, ['Filed with the task.']);

        const envelope = domainEventBus.buildEnvelope({ companyId: C, type: 'task.created', doc: task, changedFields: new Set(), actor: { kind: 'system' } });
        domainEventBus.bus.emit(envelope.type, envelope);
        await events.drain();

        expect(live(sourceOf(task, task.attachments[0]))[0].text).toContain('Filed with the task.');
    });

    it('costs nothing for a task change that names neither attachments nor a field that moves the task', async () => {
        const task = seedTask([attachment('notes.txt')]);
        mockDb.calls.length = 0;
        await taskChanged(task, ['Task_Priority']);
        expect(mockDb.calls).toHaveLength(0);
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('does nothing for a company whose indexer is off', async () => {
        const task = seedTask([attachment('notes.txt')], { CompanyId: OFF_COMPANY });
        const envelope = taskEnvelope(task, ['attachments'], OFF_COMPANY);
        domainEventBus.bus.emit(envelope.type, envelope);
        await events.drain();
        expect(readStoredFile).not.toHaveBeenCalled();
        expect(mockDb.store[CHUNKS] || []).toHaveLength(0);
    });
});

describe('files that are not indexed', () => {
    it('skips a type it does not read, records it as skipped, and never asks storage for it', async () => {
        const task = seedTask([attachment('diagram.png', { type: 'image' })]);

        await taskChanged(task, ['attachments']);

        expect(readStoredFile).not.toHaveBeenCalled();
        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(0);
        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:unsupported', text: '', taskId: String(task._id), title: 'diagram.png' });
    });

    it('skips a file linked from a cloud drive: its bytes are not ours to read', async () => {
        const task = seedTask([attachment('brief.pdf', { source: 'google', externalUrl: 'https://drive.example.test/brief.pdf' })]);
        task.attachments[0].url = '';

        await taskChanged(task, ['attachments']);

        expect(readStoredFile).not.toHaveBeenCalled();
        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:linked' });
    });

    it('never follows an attachment whose key is a url', async () => {
        const task = seedTask([attachment('brief.txt')]);
        task.attachments[0].url = 'https://example.test/brief.txt';

        await taskChanged(task, ['attachments']);

        expect(readStoredFile).not.toHaveBeenCalled();
        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:linked' });
    });

    it('skips a file whose recorded size is over the limit without reading it', async () => {
        process.env.KNOWLEDGE_FILE_MAX_BYTES = '1024';
        const task = seedTask([attachment('huge.txt', { size: 4096 })]);
        storeFor(task, ['x']);

        await taskChanged(task, ['attachments']);

        expect(readStoredFile).not.toHaveBeenCalled();
        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:too_large' });
    });

    it('skips a file storage finds over the limit, whatever size the attachment claimed, and does not retry it', async () => {
        process.env.KNOWLEDGE_FILE_MAX_BYTES = '1024';
        const task = seedTask([attachment('liar.txt', { size: 10 })]);
        storeFor(task, ['x'.repeat(4096)]);

        await taskChanged(task, ['attachments']);

        expect(readStoredFile).toHaveBeenCalledTimes(1);
        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(0);
        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:too_large' });
        expect(await indexer.pendingFiles(C)).toEqual([]);
    });

    it('skips a file with no text in it', async () => {
        const task = seedTask([attachment('blank.txt')]);
        storeFor(task, ['   \n  ']);

        await taskChanged(task, ['attachments']);

        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:empty' });
    });

    it('ignores an attachment whose id could not name a source', async () => {
        const task = seedTask([attachment('odd.txt', { id: 'has:colon and spaces' }), attachment('fine.txt')]);
        storeFor(task, ['Odd.', 'Fine harbour text.']);

        await taskChanged(task, ['attachments']);

        expect((mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === 'file').map((c) => c.sourceId)).toEqual([sourceOf(task, task.attachments[1])]);
    });
});

describe('a file that fails', () => {
    it('is recorded, and the next file is still indexed', async () => {
        const task = seedTask([attachment('broken.pdf'), attachment('fine.txt')]);
        storeFor(task, ['%PDF-1.4 broken beyond repair', 'Fine harbour text.']);

        await taskChanged(task, ['attachments']);

        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 1 });
        expect(live(sourceOf(task, task.attachments[1]))[0].text).toContain('Fine harbour text.');
    });

    it('is recorded as timed out when the parser is abandoned, and the next file is still indexed', async () => {
        const task = seedTask([attachment('stuck.pdf'), attachment('fine.txt')]);
        storeFor(task, ['%PDF-1.4 stuck', 'Fine harbour text.']);
        const real = extractor.extractText;
        jest.spyOn(extractor, 'extractText').mockImplementation((input, options) => (input.kind === 'pdf'
            ? Promise.reject(Object.assign(new Error('abandoned after 20000 ms'), { code: 'timed_out' }))
            : real(input, options)));

        await taskChanged(task, ['attachments']);

        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'extract:timed_out', extractAttempts: 1 });
        expect(live(sourceOf(task, task.attachments[1]))[0].text).toContain('Fine harbour text.');
    });

    it('holds nothing up when storage cannot be reached for it', async () => {
        const task = seedTask([attachment('lost.txt'), attachment('fine.txt')]);
        store(C, task.attachments[1].url, 'Fine harbour text.');

        await taskChanged(task, ['attachments']);

        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 1 });
        expect(live(sourceOf(task, task.attachments[1]))).toHaveLength(1);
    });

    it('is retried at most twice: three attempts in all, and no sync after that reads it again', async () => {
        const task = seedTask([attachment('broken.pdf')]);
        storeFor(task, ['%PDF-1.4 broken beyond repair']);
        const sourceId = sourceOf(task, task.attachments[0]);

        await taskChanged(task, ['attachments']);
        expect(await indexer.pendingFiles(C)).toEqual([sourceId]);
        expect(readStoredFile).toHaveBeenCalledTimes(1);

        await indexer.resumeFiles(C, { now: LATER });
        expect(markerOf(sourceId)).toMatchObject({ extractAttempts: 2 });
        expect(await indexer.pendingFiles(C)).toEqual([sourceId]);

        await indexer.resumeFiles(C, { now: LATER });
        expect(markerOf(sourceId)).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 3 });
        expect(await indexer.pendingFiles(C)).toEqual([]);
        expect(readStoredFile).toHaveBeenCalledTimes(3);

        await indexer.resumeFiles(C, { now: LATER });
        await indexer.syncFile(C, sourceId);
        await taskChanged(task, ['attachments']);
        await indexer.syncTaskFiles(C, String(task._id));
        expect(readStoredFile).toHaveBeenCalledTimes(3);
        expect(indexer.FILE_EXTRACT_ATTEMPTS).toBe(3);
    });

    it('is indexed by a retry that succeeds, and not retried again', async () => {
        const task = seedTask([attachment('late.txt')]);
        const sourceId = sourceOf(task, task.attachments[0]);

        await taskChanged(task, ['attachments']);
        expect(markerOf(sourceId)).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 1 });

        storeFor(task, ['Arrived late but whole.']);
        await indexer.resumeFiles(C, { now: LATER });

        expect(live(sourceId)[0].text).toContain('Arrived late but whole.');
        expect(await indexer.pendingFiles(C)).toEqual([]);
    });
});

describe('a file follows its task', () => {
    const indexed = async (over = {}) => {
        const task = seedTask([attachment('notes.txt')], over);
        storeFor(task, ['The anchor chain is rusted.']);
        await indexer.syncTaskFiles(C, String(task._id));
        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(1);
        readStoredFile.mockClear();
        return task;
    };

    it('leaves the index when the attachment is removed from the task', async () => {
        const task = await indexed();
        const sourceId = sourceOf(task, task.attachments[0]);
        taskRow(task).attachments = [];

        await taskChanged(taskRow(task), ['attachments']);

        expect(live(sourceId)).toHaveLength(0);
        expect(rowsOf(sourceId)[0]).toMatchObject({ deleted: true });
    });

    it('keeps the other files of the task when one is removed, and reads none of them again', async () => {
        const task = seedTask([attachment('keep.txt'), attachment('drop.txt')]);
        storeFor(task, ['Keep this.', 'Drop this.']);
        await indexer.syncTaskFiles(C, String(task._id));
        readStoredFile.mockClear();
        const [keep, drop] = task.attachments;
        taskRow(task).attachments = [keep];

        await taskChanged(taskRow(task), ['attachments']);

        expect(live(sourceOf(task, keep))).toHaveLength(1);
        expect(live(sourceOf(task, drop))).toHaveLength(0);
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('leaves the index when the task is deleted, in one write and without reading the file', async () => {
        const task = await indexed();
        Object.assign(taskRow(task), { deletedStatusKey: 1, updatedAt: at(2) });
        mockDb.calls.length = 0;

        await taskChanged(taskRow(task), ['deletedStatusKey']);

        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(0);
        expect(rowsOf(sourceOf(task, task.attachments[0]))[0]).toMatchObject({ deleted: true, tombstoneReason: 'task' });
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('comes back when the task is restored, from the text already extracted', async () => {
        const task = await indexed();
        Object.assign(taskRow(task), { deletedStatusKey: 1, updatedAt: at(2) });
        await taskChanged(taskRow(task), ['deletedStatusKey']);
        Object.assign(taskRow(task), { deletedStatusKey: 0, updatedAt: at(3) });

        await taskChanged(taskRow(task), ['deletedStatusKey']);

        expect(live(sourceOf(task, task.attachments[0])).map((c) => c.text)).toEqual(['notes.txt\nThe anchor chain is rusted.']);
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('is never indexed for a task that is already deleted', async () => {
        const task = seedTask([attachment('notes.txt')], { deletedStatusKey: 1 });
        storeFor(task, ['Deleted task text.']);

        await indexer.syncTaskFiles(C, String(task._id));

        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(0);
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('is re-tagged with the task\'s new project and sprint when the task moves, without reading the file', async () => {
        const task = await indexed();
        Object.assign(taskRow(task), { ProjectID: P2, sprintId: OTHER_SPRINT, updatedAt: at(2) });

        await taskChanged(taskRow(task), ['sprintId', 'ProjectID']);

        expect(live(sourceOf(task, task.attachments[0]))[0]).toMatchObject({ projectId: P2, sprintId: OTHER_SPRINT });
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('is not written back under the old project by an older read that finishes after the move', async () => {
        const task = await indexed();
        const stale = { ...taskRow(task), attachments: [...task.attachments] };
        Object.assign(taskRow(task), { ProjectID: P2, sprintId: OTHER_SPRINT, updatedAt: at(2) });
        await taskChanged(taskRow(task), ['sprintId', 'ProjectID']);

        await indexer.ingestFile(C, { _id: sourceOf(task, task.attachments[0]), task: stale, attachment: stale.attachments[0], kind: 'text', pieces: [{ ordinal: 0, headingPath: ['notes.txt'], text: 'notes.txt\nThe anchor chain is rusted.', contentHash: live(sourceOf(task, task.attachments[0]))[0].contentHash }] });

        expect(live(sourceOf(task, task.attachments[0]))[0]).toMatchObject({ projectId: P2, sprintId: OTHER_SPRINT });
    });

    it('leaves the index when its project is trashed and comes back when the project is restored', async () => {
        const task = await indexed();
        const sourceId = sourceOf(task, task.attachments[0]);

        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await events.drain();
        expect(live(sourceId)).toHaveLength(0);

        await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
        await events.drain();
        expect(live(sourceId)).toHaveLength(1);
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('is never indexed in a trashed project', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => p._id === P1).deletedStatusKey = 1;
        const task = seedTask([attachment('notes.txt')]);
        storeFor(task, ['Trashed project text.']);

        await indexer.syncTaskFiles(C, String(task._id));

        expect(live(sourceOf(task, task.attachments[0]))).toHaveLength(0);
        expect(readStoredFile).not.toHaveBeenCalled();
    });

    it('is extracted once: a second sync of an indexed file reads nothing and writes nothing but its owed mark', async () => {
        const task = await indexed();
        mockDb.calls.length = 0;

        await indexer.syncFile(C, sourceOf(task, task.attachments[0]));
        await taskChanged(task, ['attachments']);

        expect(readStoredFile).not.toHaveBeenCalled();
        const onlyTheMark = (update) => ['$set', '$unset'].every((op) => !update[op] || Object.keys(update[op]).every((field) => field === 'extractDueAt'));
        expect(chunkWrites().filter((c) => !onlyTheMark(c.data[1]))).toHaveLength(0);
    });

    it('is extracted again when a crash left only some of its chunks written', async () => {
        const task = seedTask([attachment('long.md')]);
        storeFor(task, ['# One\n\nFirst part.\n\n# Two\n\nSecond part.']);
        await indexer.syncTaskFiles(C, String(task._id));
        const sourceId = sourceOf(task, task.attachments[0]);
        expect(live(sourceId).length).toBeGreaterThan(1);
        mockDb.store[CHUNKS] = mockDb.store[CHUNKS].filter((c) => !(c.sourceId === sourceId && c.ordinal > 0));
        readStoredFile.mockClear();

        await indexer.syncFile(C, sourceId);

        expect(readStoredFile).toHaveBeenCalledTimes(1);
        expect(live(sourceId).map((c) => c.headingPath.slice(-1)[0])).toEqual(['long.md', 'One', 'Two']);
    });
});

describe('erasure by document', () => {
    it('removes a file\'s chunks for good: no later sync, task restore or project restore writes them back', async () => {
        const task = seedTask([attachment('contract.txt')]);
        storeFor(task, ['The signed contract text.']);
        await indexer.syncTaskFiles(C, String(task._id));
        const sourceId = sourceOf(task, task.attachments[0]);

        expect(await eraseDocument(C, { sourceType: 'file', sourceId })).toEqual({ erased: 1 });
        expect(rowsOf(sourceId)).toHaveLength(0);

        await indexer.syncFile(C, sourceId);
        await taskChanged(task, ['attachments']);
        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
        await events.drain();
        expect(rowsOf(sourceId)).toHaveLength(0);
    });
});

describe('where a file came from', () => {
    const originOf = async (task) => {
        storeFor(task, task.attachments.map(() => 'Some harbour text.'));
        await indexer.syncTaskFiles(C, String(task._id));
        return live(sourceOf(task, task.attachments[0]))[0].origin;
    };

    it('reads as a member\'s when a member attached it to a task made in the workspace', async () => {
        expect(await originOf(seedTask([attachment('notes.txt')]))).toBe('member');
    });

    it('reads as external on a task that arrived by email', async () => {
        expect(await originOf(seedTask([attachment('invoice.txt')], { origin: { kind: 'email', ref: '9f2c4e6a8b0d1f3a' } }))).toBe('external');
    });

    it('reads as external on a task filed through a public form, including the file the form upload path stored', async () => {
        expect(await originOf(seedTask([attachment('cv.txt')], { origin: { kind: 'form', ref: 'submission-1' } }))).toBe('external');

        const task = seedTask([attachment('cv.txt')], { origin: { kind: 'form', ref: 'submission-2' } });
        task.attachments[0].url = 'formAttachment/6f00000000000000000000f1/abcdef0123456789abcdef01.txt';
        expect(await originOf(task)).toBe('external');
    });

    it('reads as external when the attachment itself is marked as inbound', async () => {
        expect(await originOf(seedTask([attachment('mail.txt', { origin: { kind: 'email', ref: 'abc' } })]))).toBe('external');
    });
});

describe('files whose bytes or keys cannot be trusted', () => {
    const { xlsxOf, lyingZipOf } = require('./fixtures/knowledgeFiles');

    it('skips a file whose bytes are not the type its name says, and does not retry it', async () => {
        const task = seedTask([attachment('rates.csv')]);
        files.set(`${C}:${task.attachments[0].url}`, xlsxOf({ One: [['hidden']] }));

        await taskChanged(task, ['attachments']);

        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:type_mismatch' });
        expect(await indexer.pendingFiles(C)).toEqual([]);
    });

    it('skips an archive that inflates past the budget with its own reason, and does not retry it', async () => {
        const saved = process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES;
        process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES = String(1024 * 1024);
        try {
            const task = seedTask([attachment('report.docx')]);
            files.set(`${C}:${task.attachments[0].url}`, lyingZipOf([['word/document.xml', Buffer.alloc(4 * 1024 * 1024, 0x41)]], 10));

            await taskChanged(task, ['attachments']);

            expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'skipped:inflated_too_large' });
            expect(await indexer.pendingFiles(C)).toEqual([]);
        } finally {
            if (saved === undefined) delete process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES;
            else process.env.KNOWLEDGE_FILE_MAX_UNZIPPED_BYTES = saved;
        }
    });

    it('records a parser stopped for memory as a failure to retry, and the next file is still indexed', async () => {
        const task = seedTask([attachment('heavy.pdf'), attachment('fine.txt')]);
        storeFor(task, ['%PDF-1.4 heavy', 'Fine harbour text.']);
        const real = extractor.extractText;
        jest.spyOn(extractor, 'extractText').mockImplementation((input, options) => (input.kind === 'pdf'
            ? Promise.reject(Object.assign(new Error('memory cap'), { code: 'too_much_memory' }))
            : real(input, options)));

        await taskChanged(task, ['attachments']);

        expect(markerOf(sourceOf(task, task.attachments[0]))).toMatchObject({ tombstoneReason: 'extract:too_much_memory', extractAttempts: 1 });
        expect(await indexer.pendingFiles(C)).toEqual([sourceOf(task, task.attachments[0])]);
        expect(live(sourceOf(task, task.attachments[1]))).toHaveLength(1);
    });

    it('skips an attachment whose key is not where the app stores this task\'s files, without reading it', async () => {
        const other = seedTask();
        const task = seedTask([attachment('a.txt'), attachment('b.txt'), attachment('c.txt'), attachment('d.txt')]);
        task.attachments[0].url = `Project/${P1}/Sprint/${other._id}/Attachment/a.txt`;
        task.attachments[1].url = 'Payroll/2026/salaries.txt';
        task.attachments[2].url = `Project/${P1}/Sprint/${task._id}/Attachment/../../../Payroll/salaries.txt`;
        task.attachments[3].url = 'formAttachment/6f00000000000000000000f1/abcdef0123456789abcdef01.txt';
        task.attachments.forEach((a) => store(C, a.url, 'Someone else\'s text.'));

        await taskChanged(task, ['attachments']);

        expect(readStoredFile).not.toHaveBeenCalled();
        task.attachments.forEach((a) => expect(markerOf(sourceOf(task, a))).toMatchObject({ tombstoneReason: 'skipped:foreign_key' }));
    });

    it('reads a key the app wrote for this task, under the project it had when the file was uploaded', async () => {
        const task = seedTask([attachment('moved.txt')]);
        task.attachments[0].url = `Project/${P2}/Sprint/${task._id}/Attachment/20260901T000000000Z_moved.txt`;
        store(C, task.attachments[0].url, 'Uploaded before the move.');

        await taskChanged(task, ['attachments']);

        expect(live(sourceOf(task, task.attachments[0]))[0].text).toContain('Uploaded before the move.');
    });
});

describe('work that outlives the process', () => {
    /* A new module registry is a restarted process: its queues and timers start empty, and only
     * what is in the database carries over. */
    const restarted = () => {
        let fresh;
        jest.isolateModules(() => {
            fresh = {
                indexer: require('../Modules/Knowledge/ingest/indexer'),
                events: require('../Modules/Knowledge/ingest/events'),
                storage: require('../common-storage/readStoredFile'),
            };
        });
        fresh.storage.readStoredFile.mockReset();
        fresh.storage.readStoredFile.mockImplementation(async ({ companyId, key }) => {
            const buffer = files.get(`${companyId}:${key}`);
            if (!buffer) throw Object.assign(new Error('not found'), { code: 'not_found' });
            return { buffer, size: buffer.length };
        });
        return fresh;
    };

    it('marks a file pending before it is queued, so a restart that lost the queue still extracts it', async () => {
        const task = seedTask([attachment('queued.txt')]);
        storeFor(task, ['Queued before the restart.']);
        const before = restarted();
        before.storage.readStoredFile.mockImplementation(() => new Promise(() => {}));

        await before.events.handle(taskEnvelope(task, ['attachments']));
        expect(await indexer.pendingFiles(C)).toEqual([sourceOf(task, task.attachments[0])]);

        const after = restarted();
        await after.indexer.resumeFiles(C);

        expect(live(sourceOf(task, task.attachments[0]))[0].text).toContain('Queued before the restart.');
        expect(await after.indexer.pendingFiles(C)).toEqual([]);
    });

    it('picks up pending files when the indexer starts', async () => {
        const task = seedTask([attachment('queued.txt')]);
        storeFor(task, ['Picked up at start.']);
        const before = restarted();
        before.storage.readStoredFile.mockImplementation(() => new Promise(() => {}));
        await before.events.handle(taskEnvelope(task, ['attachments']));

        const after = restarted();
        expect(after.events.start()).toBe(true);
        try {
            await after.events.drain();
        } finally {
            after.events.stop();
        }

        expect(live(sourceOf(task, task.attachments[0]))[0].text).toContain('Picked up at start.');
    });

    it('retries a failed file after a restart once its retry is due, and not before', async () => {
        const task = seedTask([attachment('late.txt')]);
        const sourceId = sourceOf(task, task.attachments[0]);
        await taskChanged(task, ['attachments']);
        expect(markerOf(sourceId)).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 1 });
        storeFor(task, ['Arrived after the restart.']);

        const after = restarted();
        await after.indexer.resumeFiles(C);
        expect(after.storage.readStoredFile).not.toHaveBeenCalled();

        await after.indexer.resumeFiles(C, { now: LATER });
        expect(live(sourceId)[0].text).toContain('Arrived after the restart.');
    });

    it('keeps the retry limit across restarts', async () => {
        const task = seedTask([attachment('never.txt')]);
        const sourceId = sourceOf(task, task.attachments[0]);
        await taskChanged(task, ['attachments']);

        let reads = 1;
        for (let i = 0; i < 4; i += 1) {
            const after = restarted();
            await after.indexer.resumeFiles(C, { now: LATER });
            reads += after.storage.readStoredFile.mock.calls.length;
        }

        expect(reads).toBe(3);
        expect(markerOf(sourceId)).toMatchObject({ tombstoneReason: 'extract:failed', extractAttempts: 3 });
        expect(await indexer.pendingFiles(C)).toEqual([]);
    });

    it('is picked up by the heartbeat whatever the heartbeat\'s age, and by the recurring job', async () => {
        const first = seedTask([attachment('one.txt')]);
        const second = seedTask([attachment('two.txt')]);
        await taskChanged(first, ['attachments']);
        await taskChanged(second, ['attachments']);
        storeFor(first, ['First, by the heartbeat.']);
        storeFor(second, ['Second, by the recurring job.']);
        mockDb.store[CHUNKS].filter((c) => c.sourceType === 'file').forEach((c) => { c.extractDueAt = new Date(Date.now() - 1000); });
        mockDb.store[CHUNKS].find((c) => c.sourceId === sourceOf(second, second.attachments[0])).extractDueAt = new Date(Date.now() + 60000);

        events.resetFileSweeps();
        events.keepAlive(C);
        await events.drain();
        expect(live(sourceOf(first, first.attachments[0]))).toHaveLength(1);
        expect(live(sourceOf(second, second.attachments[0]))).toHaveLength(0);

        mockDb.store[CHUNKS].find((c) => c.sourceId === sourceOf(second, second.attachments[0])).extractDueAt = new Date(Date.now() - 1000);
        await require('../Modules/Knowledge/ingest/backfill').backfillAll();
        expect(live(sourceOf(second, second.attachments[0]))).toHaveLength(1);
    });

    it('takes a bounded number of due files per sweep', async () => {
        const tasks = Array.from({ length: indexer.FILE_SWEEP_BATCH + 5 }, (_, i) => seedTask([attachment(`f${i}.txt`)]));
        for (const task of tasks) await indexer.syncTaskFiles(C, String(task._id));
        readStoredFile.mockClear();

        await indexer.resumeFiles(C, { now: LATER });

        expect(readStoredFile).toHaveBeenCalledTimes(indexer.FILE_SWEEP_BATCH);
    });
});
