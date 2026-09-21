/* Files and project guides at question time. A file passage is visible exactly where its task
 * is; a guide passage to whoever can open its project. Each rule holds twice: in the chunk
 * search, which never selects what the caller may not see, and in recheck(), which re-reads the
 * live task, attachment and project, so an index that lags a change cannot leak past it. Every
 * passage, from the chunk store or from rows, says where its content came from. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/readStoredFile', () => ({ readStoredFile: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { knowledgeChunksSchema, taskSchema, pagesSchema } = require('../utils/mongo-handler/createSchema');
const { readStoredFile } = require('../common-storage/readStoredFile');
const lexical = require('../Modules/Knowledge/adapters/lexical');
const { createInMemoryVectorAdapter, createDatabaseVectorAdapter } = require('../Modules/Knowledge/adapters/vector');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const { askSources } = require('../Modules/Knowledge/askSources');
const { resolveVisibleSet, filterFor, SOURCE_TYPES } = require('../Modules/Knowledge/visibleSet');
const { INDEXED_SOURCES } = require('../Modules/Knowledge/sources');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c09';
const OWNER = '6f0000000000000000000011';
const ADMIN = '6f0000000000000000000012';
const MEMBER = '6f0000000000000000000013';
const SPRINTER = '6f0000000000000000000014';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const OPEN_SPRINT = '6f0000000000000000000d01';
const PRIVATE_SPRINT = '6f0000000000000000000d02';
const ENV = { indexer: process.env.KNOWLEDGE_INDEXER };

const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [SPRINTER]: 3 };
const PROJECTS = { [OWNER]: [SHARED, SECRET], [ADMIN]: [SHARED, SECRET], [MEMBER]: [SHARED], [SPRINTER]: [SHARED] };

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));
const callsFor = (type) => mockDb.calls.filter((c) => c.type === type);

const files = new Map();
let attachmentSeq = 0;

/* A task with one text attachment, indexed; returns the file's source id. */
const file = async (text, { name = 'notes.txt', attachmentOver = {}, ...taskOver } = {}) => {
    attachmentSeq += 1;
    const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Task', CompanyId: C, ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: at(1), attachments: [], ...taskOver });
    const attached = { id: `ret${String(attachmentSeq).padStart(14, '0')}`, filename: name, extension: name.slice(name.lastIndexOf('.') + 1), size: text.length, userId: MEMBER, url: `Project/${task.ProjectID}/Sprint/${task._id}/Attachment/${attachmentSeq}-${name}`, ...attachmentOver };
    task.attachments = [attached];
    files.set(`${C}:${attached.url}`, Buffer.from(text));
    await indexer.syncTaskFiles(C, String(task._id));
    return { sourceId: indexer.fileSourceId(task._id, attached.id), task, attached };
};

const guide = async (projectId, markdown, over = {}) => {
    const existing = rowOf(SCHEMA_TYPE.PROJECTS, projectId);
    Object.assign(existing, { ProjectName: 'Harbour works', aiGuide: { markdown }, ...over });
    await indexer.syncGuide(C, projectId);
    return projectId;
};

const ask = (userId, query, sourceTypes, over = {}) => retrieve({ companyId: C, caller: { kind: 'user', userId }, query, scope: { sourceTypes, ...(over.scope || {}) } });
const idsOf = (result) => result.passages.map((p) => p.sourceId);
const candidates = async (userId, query, sourceType) => {
    const set = await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId }, scope: { sourceTypes: [sourceType] } });
    return (await lexical.search({ companyId: C, query, filter: filterFor(set, { chunkSources: INDEXED_SOURCES }), limit: 20 })).map((p) => p.sourceId);
};
const indexReady = (sourceType, status = 'complete') => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status, lastSeenOnAt: new Date(), originFilledAt: new Date() });

beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'tenant'; });
afterAll(() => {
    if (ENV.indexer === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV.indexer;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    files.clear();
    jest.clearAllMocks();
    myCache.flushAll();
    indexer.clearFileRetries();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.textFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.TASKS, taskSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.PAGES, pagesSchema);
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid]);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    readStoredFile.mockImplementation(async ({ companyId, key }) => {
        const buffer = files.get(`${companyId}:${key}`);
        if (!buffer) throw Object.assign(new Error('not found'), { code: 'not_found' });
        return { buffer, size: buffer.length };
    });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SHARED, ProjectName: 'Shared', deletedStatusKey: 0, updatedAt: at(1) });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SECRET, ProjectName: 'Secret', deletedStatusKey: 0, updatedAt: at(1) });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: SHARED, private: false, AssigneeUserId: [] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [SPRINTER] });
    [OWNER, ADMIN, MEMBER, SPRINTER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false }));
});

describe('the sources retrieval knows', () => {
    it('names files and guides beside the others, and holds both in the chunk store only', () => {
        expect(SOURCE_TYPES).toEqual(['task', 'page', 'comment', 'transcript', 'guide', 'file']);
        expect(INDEXED_SOURCES).toEqual(['page', 'comment', 'transcript', 'guide', 'file']);
    });
});

describe('file passages', () => {
    beforeEach(() => INDEXED_SOURCES.forEach((s) => indexReady(s)));

    it('are found by the text inside the file, with the task they hang on', async () => {
        const { sourceId, task } = await file('The anchor chain is rusted through.');

        const result = await ask(MEMBER, 'anchor', ['file']);

        expect(idsOf(result)).toEqual([sourceId]);
        expect(result.passages[0]).toMatchObject({ sourceType: 'file', projectId: SHARED, title: 'notes.txt', origin: 'member', permission: { visibility: 'project', via: 'task' } });
        expect(result.passages[0].excerpt).toContain('anchor chain');

        const [source] = await askSources({ companyId: C, uid: MEMBER, question: 'anchor', projects: [{ _id: SHARED, ProjectName: 'Shared' }] });
        expect(source).toMatchObject({ kind: 'file', id: sourceId, taskId: String(task._id), project: 'Shared', origin: 'member' });
    });

    it('are hidden on a task in a private sprint from a member the sprint is not shared with, and never selected for them', async () => {
        const { sourceId } = await file('The mooring fee doubles.', { sprintId: PRIVATE_SPRINT });

        expect(await candidates(MEMBER, 'mooring', 'file')).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'mooring', ['file']))).toEqual([]);
        expect(idsOf(await ask(SPRINTER, 'mooring', ['file']))).toEqual([sourceId]);
        expect(idsOf(await ask(ADMIN, 'mooring', ['file']))).toEqual([sourceId]);
    });

    it('are hidden on a task in a project the caller cannot open, and never selected for them', async () => {
        const { sourceId } = await file('The buoy budget.', { ProjectID: SECRET });

        expect(await candidates(MEMBER, 'buoy', 'file')).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'buoy', ['file']))).toEqual([]);
        expect(idsOf(await ask(OWNER, 'buoy', ['file']))).toEqual([sourceId]);
    });

    it('never cross a company: another company\'s chunk under the same project id is not selected', async () => {
        const { sourceId } = await file('The harbour lease.');
        mockDb.store[CHUNKS].filter((c) => c.sourceId === sourceId).forEach((c) => { c.companyId = OTHER_COMPANY; });

        expect(await candidates(MEMBER, 'lease', 'file')).toEqual([]);
    });

    it('never select a tombstoned chunk', async () => {
        const { sourceId } = await file('The harbour lease.');
        mockDb.store[CHUNKS].filter((c) => c.sourceId === sourceId).forEach((c) => { c.deleted = true; });

        expect(await candidates(MEMBER, 'lease', 'file')).toEqual([]);
    });

    it('drop at recheck when the task moved to a private sprint and no event said so', async () => {
        const { sourceId, task } = await file('The crane inspection.');
        rowOf(SCHEMA_TYPE.TASKS, task._id).sprintId = PRIVATE_SPRINT;

        expect(await candidates(MEMBER, 'crane', 'file')).toEqual([sourceId]);
        expect(idsOf(await ask(MEMBER, 'crane', ['file']))).toEqual([]);
        expect(idsOf(await ask(SPRINTER, 'crane', ['file']))).toEqual([sourceId]);
    });

    it('drop at recheck when the task moved to a project the caller cannot open and no event said so', async () => {
        const { sourceId, task } = await file('The dredging quote.');
        rowOf(SCHEMA_TYPE.TASKS, task._id).ProjectID = SECRET;

        expect(await candidates(MEMBER, 'dredging', 'file')).toEqual([sourceId]);
        expect(idsOf(await ask(MEMBER, 'dredging', ['file']))).toEqual([]);
    });

    it('drop at recheck when the task was deleted and no event said so', async () => {
        const { sourceId, task } = await file('The slipway plan.');
        rowOf(SCHEMA_TYPE.TASKS, task._id).deletedStatusKey = 1;

        expect(await candidates(MEMBER, 'slipway', 'file')).toEqual([sourceId]);
        expect(idsOf(await ask(MEMBER, 'slipway', ['file']))).toEqual([]);
    });

    it('drop at recheck when the attachment was removed from the task and no event said so', async () => {
        const { sourceId, task } = await file('The ferry timetable.');
        rowOf(SCHEMA_TYPE.TASKS, task._id).attachments = [];

        expect(await candidates(MEMBER, 'ferry', 'file')).toEqual([sourceId]);
        expect(idsOf(await ask(MEMBER, 'ferry', ['file']))).toEqual([]);
    });

    it('drop at recheck when the task row is gone', async () => {
        const { sourceId } = await file('The lighthouse rota.');
        mockDb.store[SCHEMA_TYPE.TASKS].length = 0;

        expect(await candidates(MEMBER, 'lighthouse', 'file')).toEqual([sourceId]);
        expect(idsOf(await ask(MEMBER, 'lighthouse', ['file']))).toEqual([]);
    });

    it('follow a moved task: once the move is heard, the old project no longer finds it and the new one does', async () => {
        const { sourceId, task } = await file('The pontoon order.');
        Object.assign(rowOf(SCHEMA_TYPE.TASKS, task._id), { ProjectID: SECRET, updatedAt: at(2) });
        await indexer.reindexTask(C, String(task._id), { moved: true });

        expect(await candidates(MEMBER, 'pontoon', 'file')).toEqual([]);
        expect(idsOf(await ask(OWNER, 'pontoon', ['file']))).toEqual([sourceId]);
        expect((await ask(OWNER, 'pontoon', ['file'])).passages[0].projectId).toBe(SECRET);
    });

    it('stay inside one project when the question is scoped to it', async () => {
        await file('The gangway audit.');
        expect(idsOf(await ask(OWNER, 'gangway', ['file'], { scope: { projectId: SECRET } }))).toEqual([]);
    });

    it('take one slot per file, however many of its chunks match', async () => {
        const long = Array.from({ length: 12 }, (_, i) => `# Part ${i}\n\nThe tide gauge reading ${i}.`).join('\n\n');
        const { sourceId } = await file(long, { name: 'gauge.md' });
        const other = await file('A short tide note.');

        expect(idsOf(await ask(MEMBER, 'tide', ['file'])).sort()).toEqual([sourceId, other.sourceId].sort());
    });

    it('are not searched at all until the file backfill is complete: there are no rows to fall back to', async () => {
        const { sourceId } = await file('The winch manual.');
        mockDb.store[SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE].find((s) => s.sourceType === 'file').status = 'running';
        mockDb.calls.length = 0;

        const result = await ask(MEMBER, 'winch', ['file']);

        expect(idsOf(result)).toEqual([]);
        expect(callsFor(CHUNKS).filter((c) => c.method === 'aggregate')).toHaveLength(0);
        expect(sourceId).toBeTruthy();
    });

    it('are searched by vector under the same rules, in both adapters', async () => {
        const open = await file('The anchor chain.');
        const hidden = await file('The anchor winch.', { sprintId: PRIVATE_SPRINT });
        mockDb.store[CHUNKS].forEach((c) => Object.assign(c, { embedding: [1, 0], embeddingModel: 'm' }));
        const memory = createInMemoryVectorAdapter();
        await memory.upsert({ companyId: C, chunks: mockDb.store[CHUNKS].map((c) => ({ ...c })) });

        for (const adapter of [memory, createDatabaseVectorAdapter()]) {
            const found = async (userId) => {
                const set = await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId }, scope: { sourceTypes: ['file'] } });
                return (await adapter.search({ companyId: C, queryEmbedding: [1, 0], model: 'm', filter: filterFor(set, { chunkSources: INDEXED_SOURCES }), limit: 10 }));
            };
            expect((await found(MEMBER)).map((p) => p.sourceId)).toEqual([open.sourceId]);
            expect((await found(SPRINTER)).map((p) => p.sourceId).sort()).toEqual([open.sourceId, hidden.sourceId].sort());
            expect((await found(MEMBER))[0]).toMatchObject({ sourceType: 'file', origin: 'member' });
        }
    });
});

describe('guide passages', () => {
    beforeEach(() => INDEXED_SOURCES.forEach((s) => indexReady(s)));

    it('reach anyone who can open the project, as the project\'s guide', async () => {
        await guide(SHARED, '## Stages\n1. Dredge the harbour basin');

        const result = await ask(MEMBER, 'dredge', ['guide']);

        expect(idsOf(result)).toEqual([SHARED]);
        expect(result.passages[0]).toMatchObject({ sourceType: 'guide', projectId: SHARED, title: 'Harbour works project guide', authorKind: 'agent', origin: 'agent', permission: { visibility: 'project', via: 'project' } });
    });

    it('never reach someone who cannot open the project, and are never selected for them', async () => {
        await guide(SECRET, '## Stages\n1. Survey the wreck');

        expect(await candidates(MEMBER, 'wreck', 'guide')).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'wreck', ['guide']))).toEqual([]);
        expect(idsOf(await ask(OWNER, 'wreck', ['guide']))).toEqual([SECRET]);
    });

    it('drop at recheck when the caller lost the project after the chunk search narrowed by it', async () => {
        await guide(SHARED, '## Stages\n1. Rebuild the jetty');
        const set = await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId: MEMBER }, scope: { sourceTypes: ['guide'] } });
        const passages = await lexical.search({ companyId: C, query: 'jetty', filter: filterFor(set, { chunkSources: INDEXED_SOURCES }), limit: 10 });
        expect(passages.map((p) => p.sourceId)).toEqual([SHARED]);

        const { recheck } = require('../Modules/Knowledge/visibleSet');
        expect(await recheck({ set: { ...set, projectIds: [] }, passages })).toEqual([]);
    });

    it('drop at recheck when the project was trashed and no event said so', async () => {
        await guide(SHARED, '## Stages\n1. Repaint the beacon');
        rowOf(SCHEMA_TYPE.PROJECTS, SHARED).deletedStatusKey = 1;

        expect(await candidates(MEMBER, 'beacon', 'guide')).toEqual([SHARED]);
        expect(idsOf(await ask(MEMBER, 'beacon', ['guide']))).toEqual([]);
    });

    it('drop at recheck when the guide was cleared and no event said so', async () => {
        await guide(SHARED, '## Stages\n1. Replace the fenders');
        rowOf(SCHEMA_TYPE.PROJECTS, SHARED).aiGuide = null;

        expect(idsOf(await ask(MEMBER, 'fenders', ['guide']))).toEqual([]);
    });

    it('never show text the guide no longer says: a changed guide keeps its place with no excerpt, and a sync is queued', async () => {
        await guide(SHARED, '## Stages\n1. Order the old pilings');
        rowOf(SCHEMA_TYPE.PROJECTS, SHARED).aiGuide = { markdown: '## Stages\n1. Order the new bollards' };

        const result = await ask(MEMBER, 'pilings', ['guide']);

        expect(idsOf(result)).toEqual([SHARED]);
        expect(result.passages[0].excerpt).toBe('');
        await events.drain();
        expect(mockDb.store[CHUNKS].filter((c) => c.sourceType === 'guide' && !c.deleted).map((c) => c.text).join('\n')).toContain('new bollards');
    });

    it('keep their excerpt through a project update that left the guide alone', async () => {
        await guide(SHARED, '## Stages\n1. Order the old pilings');
        rowOf(SCHEMA_TYPE.PROJECTS, SHARED).updatedAt = at(9);

        const result = await ask(MEMBER, 'pilings', ['guide']);

        expect(result.passages[0].excerpt).toContain('old pilings');
    });

    it('stay inside one project when the question is scoped to it', async () => {
        await guide(SHARED, '## Stages\n1. Dredge the harbour basin');
        expect(idsOf(await ask(OWNER, 'dredge', ['guide'], { scope: { projectId: SECRET } }))).toEqual([]);
        expect(idsOf(await ask(OWNER, 'dredge', ['guide'], { scope: { projectId: SHARED } }))).toEqual([SHARED]);
    });

    it('lose a tie to text a person wrote, as agent drafts do', async () => {
        await guide(SHARED, 'The capstan is greased monthly.');
        const { sourceId } = await file('The capstan is greased monthly.', { name: 'a.txt' });

        const result = await ask(MEMBER, 'capstan greased monthly', ['guide', 'file']);

        expect(result.passages.map((p) => p.sourceType)).toEqual(['file', 'guide']);
        expect(result.passages[0].sourceId).toBe(sourceId);
    });
});

describe('where a passage came from', () => {
    beforeEach(() => INDEXED_SOURCES.forEach((s) => indexReady(s)));

    const page = async (title, html, over = {}) => {
        const row = mockDb.seed(SCHEMA_TYPE.PAGES, { title, content: { html }, visibility: 'project', ProjectID: SHARED, createdBy: OWNER, deletedStatusKey: 0, updatedAt: at(1), ...over });
        await indexer.syncPage(C, String(row._id));
        return String(row._id);
    };
    const comment = async (message, over = {}) => {
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Task', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: at(1) });
        const row = mockDb.seed(SCHEMA_TYPE.COMMENTS, { message, type: 'text', project: false, projectId: SHARED, sprintId: OPEN_SPRINT, taskId: String(task._id), userId: MEMBER, isDeleted: false, updatedAt: at(1), ...over });
        await indexer.syncComment(C, String(row._id));
        return String(row._id);
    };
    const originsOf = async (query, sourceTypes) => Object.fromEntries((await ask(OWNER, query, sourceTypes)).passages.map((p) => [p.sourceId, p.origin]));

    it('is a member for a page a person wrote, an agent for a page an agent drafted, and external for a page an inbound path filed', async () => {
        const written = await page('Rigging notes', '<p>The rigging is sound.</p>');
        const drafted = await page('Rigging draft', '<p>The rigging may be sound.</p>', { createdByAgent: true });
        const inbound = await page('Rigging mail', '<p>The rigging report attached.</p>', { origin: { kind: 'email', ref: 'abc' } });

        expect(mockDb.store[CHUNKS].filter((c) => c.sourceType === 'page').map((c) => [c.sourceId, c.origin]).sort()).toEqual([[written, 'member'], [drafted, 'agent'], [inbound, 'external']].sort());
        expect(await originsOf('rigging', ['page'])).toEqual({ [written]: 'member', [drafted]: 'agent', [inbound]: 'external' });
    });

    it('is a member for a person\'s comment and an agent for an agent\'s', async () => {
        const said = await comment('The bilge pump works.');
        const drafted = await comment('The bilge pump may work.', { isAgent: true });

        expect(await originsOf('bilge', ['comment'])).toEqual({ [said]: 'member', [drafted]: 'agent' });
    });

    it('is a member for a call transcript', async () => {
        const row = mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'call-1', title: 'Call', participants: [OWNER], transcript: 'We discussed the keel.', summary: '', deletedStatusKey: 0, createdBy: OWNER, updatedAt: at(1) });
        await indexer.syncTranscript(C, String(row._id));

        expect(await originsOf('keel', ['transcript'])).toEqual({ [String(row._id)]: 'member' });
    });

    it('is external for a file on a task that arrived by email, and the run contract reads it as such', async () => {
        const { sourceId } = await file('The invoice for the hull paint.', { origin: { kind: 'email', ref: '9f2c4e6a8b0d1f3a' } });

        const result = await ask(OWNER, 'invoice', ['file']);

        expect(result.passages[0]).toMatchObject({ sourceId, origin: 'external' });
        const taint = require('../Modules/Agents/taint');
        expect(taint.fromContext({ passages: result.passages })).toEqual([expect.objectContaining({ kind: 'passage', ref: `file:${sourceId}` })]);
    });

    it('is external for a task that arrived from outside and a member for any other, searched from their rows', async () => {
        const inbound = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Propeller complaint', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, origin: { kind: 'form', ref: 'submission-9' }, updatedAt: at(1) });
        const own = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Propeller service', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: at(1) });

        expect(await originsOf('propeller', ['task'])).toEqual({ [String(inbound._id)]: 'external', [String(own._id)]: 'member' });
        expect(callsFor(SCHEMA_TYPE.TASKS).find((c) => c.method === 'find' && c.data[0].$text).data[1]).toMatchObject({ origin: 1 });
    });

    it('is read from rows the same way while a source\'s chunk store is not built', async () => {
        mockDb.store[SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE].length = 0;
        const written = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Ballast notes', rawText: 'ballast', visibility: 'project', ProjectID: SHARED, createdBy: OWNER, deletedStatusKey: 0, updatedAt: at(1) });
        const drafted = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Ballast draft', rawText: 'ballast', visibility: 'project', ProjectID: SHARED, createdBy: OWNER, createdByAgent: true, deletedStatusKey: 0, updatedAt: at(1) });
        const inbound = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Ballast mail', rawText: 'ballast', visibility: 'project', ProjectID: SHARED, createdBy: OWNER, origin: { kind: 'webhook', ref: 'd-1' }, deletedStatusKey: 0, updatedAt: at(1) });

        expect(await originsOf('ballast', ['page'])).toEqual({ [String(written._id)]: 'member', [String(drafted._id)]: 'agent', [String(inbound._id)]: 'external' });
        expect(callsFor(SCHEMA_TYPE.PAGES).find((c) => c.method === 'find').data[1]).toMatchObject({ origin: 1, createdByAgent: 1 });
    });

    it('reads a chunk written before the field existed as not external', async () => {
        const written = await page('Fender notes', '<p>The fenders are worn.</p>');
        const drafted = await page('Fender draft', '<p>The fenders look worn.</p>', { createdByAgent: true });
        mockDb.store[CHUNKS].forEach((c) => { delete c.origin; });

        expect(await originsOf('fenders', ['page'])).toEqual({ [written]: 'member', [drafted]: 'agent' });
    });
});
