const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const lexical = require('../Modules/Knowledge/adapters/lexical');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const { resolveVisibleSet, filterFor } = require('../Modules/Knowledge/visibleSet');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
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
const SOURCES = ['page', 'comment', 'transcript'];

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const callsFor = (type) => mockDb.calls.filter((c) => c.type === type);
const chunkSearchesOf = (sourceType) => callsFor(CHUNKS).filter((c) => c.method === 'aggregate' && c.data[0][0].$match && c.data[0][0].$match.sourceType === sourceType);
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));
const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Task', ProjectID: SHARED, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: at(1), ...over });
const comment = async (message, { task = seedTask(), ...over } = {}) => {
    const row = mockDb.seed(SCHEMA_TYPE.COMMENTS, {
        message, type: 'text', project: false, projectId: task.ProjectID, sprintId: task.sprintId, taskId: String(task._id), userId: MEMBER, isDeleted: false, updatedAt: at(1), ...over,
    });
    await indexer.syncComment(C, String(row._id));
    return String(row._id);
};
const transcript = async (text, over = {}) => {
    const row = mockDb.seed(SCHEMA_TYPE.CALLS, { callId: `call-${Math.random()}`, title: 'Call', participants: [MEMBER], transcript: text, summary: '', deletedStatusKey: 0, createdBy: MEMBER, updatedAt: at(1), ...over });
    await indexer.syncTranscript(C, String(row._id));
    return String(row._id);
};
const workspacePage = async (title, html, over = {}) => {
    const row = mockDb.seed(SCHEMA_TYPE.PAGES, { title, content: { html }, visibility: 'project', createdBy: OWNER, deletedStatusKey: 0, updatedAt: at(1), ...over });
    await indexer.syncPage(C, String(row._id));
    return String(row._id);
};

const ask = (userId, query, sourceTypes, over = {}) => retrieve({ companyId: C, caller: { kind: 'user', userId }, query, scope: { sourceTypes }, ...over });
const idsOf = (result) => result.passages.map((p) => p.sourceId);
const candidates = async (userId, query, sourceType) => {
    const set = await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId }, scope: { sourceTypes: [sourceType] } });
    return (await lexical.search({ companyId: C, query, filter: filterFor(set, { chunkSources: SOURCES }), limit: 20 })).map((p) => p.sourceId);
};
const indexReady = (sourceType, status = 'complete') => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status });

beforeAll(() => { process.env.KNOWLEDGE_INDEXER = 'tenant'; });
afterAll(() => {
    if (ENV.indexer === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV.indexer;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid]);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SHARED, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SECRET, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: OPEN_SPRINT, projectId: SHARED, private: false, AssigneeUserId: [] });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [SPRINTER] });
    [OWNER, ADMIN, MEMBER, SPRINTER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false }));
});

describe('comments read from the chunk store', () => {
    beforeEach(() => SOURCES.forEach((s) => indexReady(s)));

    it('searches comment chunks, not comment rows, once the comment backfill is complete', async () => {
        const id = await comment('The anchor chain is rusted.');
        mockDb.calls.length = 0;

        const result = await ask(MEMBER, 'anchor', ['comment']);

        expect(idsOf(result)).toEqual([id]);
        expect(result.passages[0]).toMatchObject({ sourceType: 'comment', projectId: SHARED, authorKind: 'user', permission: { visibility: 'project', via: 'task' } });
        expect(result.passages[0].excerpt).toContain('anchor');
        expect(chunkSearchesOf('comment')).toHaveLength(1);
        expect(callsFor(SCHEMA_TYPE.COMMENTS).some((c) => c.data[0].$text)).toBe(false);
    });

    it('hides a comment on a task in a private sprint from a member the sprint is not shared with, and never selects it for them', async () => {
        const id = await comment('The mooring fee doubles.', { task: seedTask({ sprintId: PRIVATE_SPRINT }) });

        expect(await candidates(MEMBER, 'mooring', 'comment')).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'mooring', ['comment']))).toEqual([]);
        expect(idsOf(await ask(SPRINTER, 'mooring', ['comment']))).toEqual([id]);
        expect(idsOf(await ask(ADMIN, 'mooring', ['comment']))).toEqual([id]);
    });

    it('hides a comment on a task in a project the caller cannot open, and never selects it for them', async () => {
        const id = await comment('The buoy budget.', { task: seedTask({ ProjectID: SECRET }) });

        expect(await candidates(MEMBER, 'buoy', 'comment')).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'buoy', ['comment']))).toEqual([]);
        expect(idsOf(await ask(OWNER, 'buoy', ['comment']))).toEqual([id]);
    });

    it("hides a comment whose task moved into a private sprint behind the index's back", async () => {
        const task = seedTask();
        const id = await comment('The crane is booked.', { task });
        rowOf(SCHEMA_TYPE.TASKS, task._id).sprintId = PRIVATE_SPRINT;

        expect(await candidates(MEMBER, 'crane', 'comment')).toEqual([id]);
        expect(idsOf(await ask(MEMBER, 'crane', ['comment']))).toEqual([]);
        expect(idsOf(await ask(SPRINTER, 'crane', ['comment']))).toEqual([id]);
    });

    it("hides a comment whose task was deleted behind the index's back", async () => {
        const task = seedTask();
        const id = await comment('The gangway is fixed.', { task });
        rowOf(SCHEMA_TYPE.TASKS, task._id).deletedStatusKey = 1;

        expect(await candidates(OWNER, 'gangway', 'comment')).toEqual([id]);
        expect(idsOf(await ask(OWNER, 'gangway', ['comment']))).toEqual([]);
    });

    it('never shows the old text of a comment edited since it was indexed, and syncs it again', async () => {
        const id = await comment('The code word is albatross.');
        Object.assign(rowOf(SCHEMA_TYPE.COMMENTS, id), { message: 'The code word is withheld.', updatedAt: at(5) });

        const first = await ask(MEMBER, 'albatross', ['comment']);
        expect(first.passages.map((p) => [p.sourceId, p.title, p.excerpt])).toEqual([[id, 'The code word is withheld.', '']]);

        await events.drain();
        expect(idsOf(await ask(MEMBER, 'albatross', ['comment']))).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'withheld', ['comment']))).toEqual([id]);
    });

    it('ranks a comment an agent posted below one a person wrote at equal relevance', async () => {
        const person = await comment('Dredging starts in June.');
        const agent = await comment('Dredging starts in June.', { actorType: 'agent', updatedAt: at(9) });

        const result = await ask(MEMBER, 'dredging', ['comment']);

        expect(idsOf(result)).toEqual([person, agent]);
        expect(result.passages[1].score).toBe(result.passages[0].score / 2);
    });

    it('reads comment rows as before while the comment backfill is still running, even though pages are indexed', async () => {
        mockDb.store[SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE].find((s) => s.sourceType === 'comment').status = 'running';
        const task = seedTask();
        const row = mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'The lock gate.', type: 'text', projectId: SHARED, sprintId: OPEN_SPRINT, taskId: String(task._id), userId: MEMBER, updatedAt: at(1) });
        mockDb.calls.length = 0;

        const result = await ask(MEMBER, 'lock', ['page', 'comment']);

        expect(idsOf(result)).toEqual([String(row._id)]);
        expect(chunkSearchesOf('comment')).toEqual([]);
        expect(chunkSearchesOf('page')).toHaveLength(1);
        expect(callsFor(SCHEMA_TYPE.COMMENTS).some((c) => c.data[0].$text)).toBe(true);
    });
});

describe('transcripts read from the chunk store', () => {
    beforeEach(() => SOURCES.forEach((s) => indexReady(s)));

    it('returns a transcript passage only to the people on the call, never to an admin, and never selects it for anyone else', async () => {
        const id = await transcript('We chose the blue hull paint.', { participants: [MEMBER, SPRINTER] });

        expect(idsOf(await ask(MEMBER, 'hull', ['transcript']))).toEqual([id]);
        expect(idsOf(await ask(SPRINTER, 'hull', ['transcript']))).toEqual([id]);
        expect(idsOf(await ask(ADMIN, 'hull', ['transcript']))).toEqual([]);
        expect(await candidates(ADMIN, 'hull', 'transcript')).toEqual([]);
        expect(chunkSearchesOf('transcript').length).toBeGreaterThan(0);
        expect(callsFor(SCHEMA_TYPE.CALLS).some((c) => c.data[0].$and)).toBe(false);
    });

    it('rechecks the live call row: someone taken off the call no longer gets the passage', async () => {
        const id = await transcript('The keel inspection failed.', { participants: [MEMBER, SPRINTER] });
        rowOf(SCHEMA_TYPE.CALLS, id).participants = [MEMBER];

        expect(await candidates(SPRINTER, 'keel', 'transcript')).toEqual([id]);
        expect(idsOf(await ask(SPRINTER, 'keel', ['transcript']))).toEqual([]);
        expect(idsOf(await ask(MEMBER, 'keel', ['transcript']))).toEqual([id]);
    });

    it('returns one passage per call however many of its chunks match', async () => {
        const long = Array.from({ length: 120 }, (_, n) => `Line ${n}: the rudder needs work, rudder item ${n}.`).join('\n');
        const id = await transcript(long);
        expect(mockDb.store[CHUNKS].filter((c) => c.sourceId === id).length).toBeGreaterThan(2);

        expect(idsOf(await ask(MEMBER, 'rudder', ['transcript']))).toEqual([id]);
    });

    it('never returns a discarded call, even to someone who was on it', async () => {
        const id = await transcript('The sail loft closes.');
        rowOf(SCHEMA_TYPE.CALLS, id).deletedStatusKey = 1;
        expect(idsOf(await ask(MEMBER, 'loft', ['transcript']))).toEqual([]);
    });
});

describe('workspace pages, which have no project', () => {
    beforeEach(() => SOURCES.forEach((s) => indexReady(s)));

    it('returns a company-wide workspace page to every member', async () => {
        const id = await workspacePage('Harbour handbook', '<p>Life jackets are in locker nine.</p>');

        for (const user of [OWNER, ADMIN, MEMBER, SPRINTER]) {
            const result = await ask(user, 'locker', ['page']);
            expect(idsOf(result)).toEqual([id]);
            expect(result.passages[0].permission).toEqual({ visibility: 'company', via: 'company' });
        }
        expect(chunkSearchesOf('page').length).toBeGreaterThan(0);
    });

    it('returns a private workspace page to its owner alone, not even to an admin, and never selects it for anyone else', async () => {
        const id = await workspacePage('My notes', '<p>The spare key is under the mat.</p>', { visibility: 'private', createdBy: MEMBER });
        expect(mockDb.store[CHUNKS].filter((c) => c.sourceId === id && !c.deleted).map((c) => [c.projectId, c.visibility])).toEqual([[null, 'private']]);

        expect(idsOf(await ask(MEMBER, 'mat', ['page']))).toEqual([id]);
        expect(idsOf(await ask(ADMIN, 'mat', ['page']))).toEqual([]);
        expect(idsOf(await ask(OWNER, 'mat', ['page']))).toEqual([]);
        expect(await candidates(ADMIN, 'mat', 'page')).toEqual([]);
    });

    it('is left out of a search scoped to one project', async () => {
        await workspacePage('Harbour handbook', '<p>Flares are in locker two.</p>');
        expect(idsOf(await ask(MEMBER, 'flares', ['page'], { scope: { sourceTypes: ['page'], projectId: SHARED } }))).toEqual([]);
    });

    it('rechecks the live page row: a workspace page made private behind the index back reaches only its owner', async () => {
        const id = await workspacePage('Mooring rules', '<p>Moor bow first.</p>');
        rowOf(SCHEMA_TYPE.PAGES, id).visibility = 'private';

        expect(await candidates(ADMIN, 'moor', 'page')).toEqual([id]);
        expect(idsOf(await ask(ADMIN, 'moor', ['page']))).toEqual([]);
        expect(idsOf(await ask(OWNER, 'moor', ['page']))).toEqual([id]);
    });
});

describe('every chunked source', () => {
    beforeEach(() => SOURCES.forEach((s) => indexReady(s)));

    it("never selects a tombstoned comment or transcript chunk, nor another company's", async () => {
        const commentId = await comment('The harbour master retires.');
        const callId = await transcript('The harbour master retires.');
        expect((await candidates(MEMBER, 'retires', 'comment'))).toEqual([commentId]);
        expect((await candidates(MEMBER, 'retires', 'transcript'))).toEqual([callId]);

        mockDb.store[CHUNKS].forEach((row) => { row.companyId = '6f0000000000000000000c99'; });
        expect(await candidates(MEMBER, 'retires', 'comment')).toEqual([]);
        expect(await candidates(MEMBER, 'retires', 'transcript')).toEqual([]);

        mockDb.store[CHUNKS].forEach((row) => { row.companyId = C; row.deleted = true; });
        expect(await candidates(MEMBER, 'retires', 'comment')).toEqual([]);
        expect(await candidates(MEMBER, 'retires', 'transcript')).toEqual([]);
    });

    it('narrows a transcript search scoped to one project to the calls of that project', async () => {
        const inShared = await transcript('Painting the bollards.', { projectId: SHARED });
        await transcript('Painting the bollards.', { projectId: SECRET });
        await transcript('Painting the bollards.');

        const scope = { sourceTypes: ['transcript'], projectId: SHARED };
        const set = await resolveVisibleSet({ companyId: C, caller: { kind: 'user', userId: MEMBER }, scope });
        const selected = await lexical.search({ companyId: C, query: 'bollards', filter: filterFor(set, { chunkSources: SOURCES }), limit: 20 });
        expect(selected.map((p) => p.sourceId)).toEqual([inShared]);
        expect(idsOf(await ask(MEMBER, 'bollards', ['transcript'], { scope }))).toEqual([inShared]);
    });
});

describe('ranking across the chunked sources', () => {
    beforeEach(() => SOURCES.forEach((s) => indexReady(s)));

    it('scales each source by its own best score, so a transcript can outrank a page that repeats the word', async () => {
        const page = await workspacePage('Tide tables', `<p>${'tide '.repeat(12)}</p>`);
        const call1 = await transcript('The tide turns at six.');

        const result = await ask(MEMBER, 'tide', ['page', 'transcript']);

        expect(idsOf(result).sort()).toEqual([page, call1].sort());
        expect(result.passages.map((p) => p.score)).toEqual([1, 1]);
    });
});
