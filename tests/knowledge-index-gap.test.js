process.env.STORAGE_TYPE = 'server';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f00000000000000000000a1']), visibleProjects: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn() }));
jest.mock('../Modules/AI/meetingNotes', () => ({ generateMeetingNotes: jest.fn(async () => ({ status: false, reason: 'off' })) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const pages = require('../Modules/Pages/controller');
const comments = require('../Modules/Comments/controller');
const notes = require('../Modules/Calls/notes');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const backfill = require('../Modules/Knowledge/ingest/backfill');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f00000000000000000000a1';
const SPRINT = '6f00000000000000000000d1';
const ENV = process.env.KNOWLEDGE_INDEXER;
const MINUTE = 60 * 1000;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const STATE = SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE;
const stateOf = (sourceType) => mockDb.store[STATE].find((s) => s.sourceType === sourceType);
const liveChunkIds = (sourceType) => [...new Set((mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === sourceType && !c.deleted).map((c) => c.sourceId))];
const chunkSearchesOf = (sourceType) => mockDb.calls.filter((c) => c.type === CHUNKS && c.method === 'aggregate' && c.data[0][0].$match.sourceType === sourceType);
const knowledgeCalls = () => mockDb.calls.filter((c) => [CHUNKS, STATE, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS].includes(c.type));
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));
const ago = (ms) => new Date(Date.now() - ms);

const call = async (handler, { params = {}, body = {} } = {}) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.json = res.send;
    await handler({ uid: ME, params, body, query: {}, headers: { companyid: C } }, res);
    return res;
};

const ask = (query, sourceTypes) => retrieve({ companyId: C, caller: { kind: 'user', userId: ME }, query, scope: { sourceTypes } });
const idsOf = (result) => result.passages.map((p) => p.sourceId);

/* A write the controllers make carries no updatedAt in the fake store; the real one stamps it. */
const stamped = (type, id) => { rowOf(type, id).updatedAt = new Date(); return String(id); };

let task;

beforeAll(() => {
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    expect(events.start()).toBe(true);
});

afterAll(() => {
    events.stop();
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    backfill.resetHeartbeats();
    process.env.KNOWLEDGE_INDEXER = 'tenant';
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'One', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ME, status: 2, isDelete: false });
    task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Survey', CompanyId: C, ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 0, updatedAt: ago(60 * MINUTE) });
    ['page', 'comment', 'transcript'].forEach((sourceType) => mockDb.seed(STATE, {
        companyId: C, sourceType, status: 'complete', cursor: '', lastRunAt: ago(60 * MINUTE), lastSeenOnAt: ago(60 * MINUTE),
    }));
});

describe('a company whose indexer was switched off and on again', () => {
    it('writes nothing while off, then serves rows and catches up on what changed in between for pages, comments and transcripts', async () => {
        mockDb.store[SCHEMA_TYPE.COMPANIES][0].knowledgeIndexer = { mode: 'off' };
        const page = await call(pages.createPage, { body: { title: 'Mooring rules', projectId: PROJECT, contentBlocks: [{ type: 'paragraph', data: { text: 'Moor bow first, always.' } }] } });
        const comment = await call(comments.save, { body: { data: { message: 'The bollard is loose.', type: 'text', project: false, taskId: String(task._id), projectId: PROJECT, sprintId: SPRINT } } });
        const callNotes = await call(notes.createNotes, { body: { callId: 'gap-call', participants: [], transcript: 'We repainted the lighthouse.' } });
        await events.drain();
        expect(knowledgeCalls()).toEqual([]);
        const ids = { page: stamped(SCHEMA_TYPE.PAGES, page.body.data._id), comment: stamped(SCHEMA_TYPE.COMMENTS, comment.body.data._id), transcript: stamped(SCHEMA_TYPE.CALLS, callNotes.body.data._id) };

        mockDb.store[SCHEMA_TYPE.COMPANIES][0].knowledgeIndexer = { mode: 'on' };
        mockDb.calls.length = 0;

        const first = await ask('bow bollard lighthouse', ['page', 'comment', 'transcript']);
        expect(idsOf(first).sort()).toEqual(Object.values(ids).sort());
        ['page', 'comment', 'transcript'].forEach((sourceType) => expect(chunkSearchesOf(sourceType)).toEqual([]));

        await events.drain();
        ['page', 'comment', 'transcript'].forEach((sourceType) => {
            expect(stateOf(sourceType)).toMatchObject({ status: 'complete', catchUpFrom: null });
            expect(Date.now() - new Date(stateOf(sourceType).lastSeenOnAt).getTime()).toBeLessThan(MINUTE);
            expect(liveChunkIds(sourceType)).toEqual([ids[sourceType]]);
        });

        mockDb.calls.length = 0;
        const second = await ask('bow bollard lighthouse', ['page', 'comment', 'transcript']);
        expect(idsOf(second).sort()).toEqual(Object.values(ids).sort());
        ['page', 'comment', 'transcript'].forEach((sourceType) => expect(chunkSearchesOf(sourceType)).toHaveLength(1));
    });

    it('catches up on a row deleted while off, and on a task restored while off', async () => {
        const doomed = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Old plan', content: { html: '<p>Harbour.</p>' }, visibility: 'project', createdBy: ME, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: ago(90 * MINUTE) });
        await indexer.syncPage(C, String(doomed._id));
        const restoredTask = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Back', CompanyId: C, ProjectID: PROJECT, sprintId: SPRINT, deletedStatusKey: 1, updatedAt: ago(90 * MINUTE) });
        const onRestored = mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'Back again.', type: 'text', projectId: PROJECT, sprintId: SPRINT, taskId: String(restoredTask._id), userId: ME, updatedAt: ago(90 * MINUTE) });
        await indexer.syncComment(C, String(onRestored._id));
        expect(liveChunkIds('page')).toEqual([String(doomed._id)]);
        expect(liveChunkIds('comment')).toEqual([]);

        Object.assign(rowOf(SCHEMA_TYPE.PAGES, doomed._id), { deletedStatusKey: 1, updatedAt: ago(10 * MINUTE) });
        Object.assign(rowOf(SCHEMA_TYPE.TASKS, restoredTask._id), { deletedStatusKey: 0, updatedAt: ago(10 * MINUTE) });

        await domainEventBus.bus.emit('page.updated', { companyId: C, type: 'page.updated', entity: { kind: 'page', id: '6f00000000000000000000f1' }, data: {} });
        await events.drain();

        expect(liveChunkIds('page')).toEqual([]);
        expect(liveChunkIds('comment')).toEqual([String(onRestored._id)]);
        ['page', 'comment', 'transcript'].forEach((sourceType) => expect(stateOf(sourceType).status).toBe('complete'));
    });

    it('reads chunks and catches nothing up while the heartbeat is fresh, and beats each source at most once a minute', async () => {
        mockDb.store[STATE].forEach((state) => { state.lastSeenOnAt = ago(2 * MINUTE); });
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Tide tables', content: { html: '<p>Tides.</p>' }, visibility: 'project', createdBy: ME, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: ago(MINUTE) });
        await indexer.syncPage(C, String(page._id));
        mockDb.calls.length = 0;

        expect(idsOf(await ask('tides', ['page']))).toEqual([String(page._id)]);
        expect(idsOf(await ask('tides', ['page']))).toEqual([String(page._id)]);
        await domainEventBus.bus.emit('page.updated', { companyId: C, type: 'page.updated', entity: { kind: 'page', id: String(page._id) }, data: {} });
        await events.drain();

        expect(chunkSearchesOf('page')).toHaveLength(2);
        const beaten = mockDb.calls.filter((c) => c.type === STATE && ['updateMany', 'updateOne', 'findOneAndUpdate'].includes(c.method)).flatMap((c) => c.data[0].sourceType.$in);
        expect(beaten.sort()).toEqual(['comment', 'page', 'transcript']);
        expect(mockDb.calls.filter((c) => c.method === 'find' && c.data[0] && c.data[0].updatedAt)).toEqual([]);
        expect(stateOf('page').status).toBe('complete');
    });

    it('catches up after the full walk when the indexer went quiet while a backfill was still running', async () => {
        mockDb.store[STATE].length = 0;
        const pagesBefore = [0, 1, 2].map((i) => String(mockDb.seed(SCHEMA_TYPE.PAGES, {
            _id: `6f00000000000000000b000${i}`, title: `Page ${i}`, content: { html: `<p>Body ${i}.</p>` }, visibility: 'project', createdBy: ME, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: ago(90 * MINUTE),
        })._id));
        await backfill.backfillCompany(C, { batchSize: 2, maxBatches: 1, sourceTypes: ['page'] });
        stateOf('page').lastSeenOnAt = ago(30 * MINUTE);
        Object.assign(rowOf(SCHEMA_TYPE.PAGES, pagesBefore[0]), { content: { html: '<p>Rewritten while off.</p>' }, updatedAt: ago(5 * MINUTE) });

        await backfill.keepAlive(C);
        expect(stateOf('page')).toMatchObject({ status: 'running', catchUpFrom: expect.any(Date) });
        await backfill.backfillCompany(C, { batchSize: 2, sourceTypes: ['page'] });

        expect(stateOf('page')).toMatchObject({ status: 'complete', catchUpFrom: null });
        expect(mockDb.store[CHUNKS].filter((c) => c.sourceId === pagesBefore[0] && !c.deleted).map((c) => c.text).join(' ')).toContain('Rewritten while off.');
    });
});

describe('a catch-up that is still pending', () => {
    it('keeps a source on its rows even with a fresh heartbeat and a complete status', async () => {
        Object.assign(stateOf('page'), { lastSeenOnAt: new Date(), catchUpFrom: ago(30 * MINUTE) });
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Buoys', rawText: 'buoys', visibility: 'project', createdBy: ME, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: ago(MINUTE) });
        mockDb.calls.length = 0;

        expect(idsOf(await ask('buoys', ['page']))).toEqual([String(page._id)]);
        expect(chunkSearchesOf('page')).toEqual([]);
    });

    it('is started by the recurring job for a company whose heartbeat went stale', async () => {
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Anchors', content: { html: '<p>Anchors.</p>' }, visibility: 'project', createdBy: ME, ProjectID: PROJECT, deletedStatusKey: 0, updatedAt: ago(5 * MINUTE) });

        await backfill.backfillAll({ batchSize: 10 });

        expect(liveChunkIds('page')).toEqual([String(page._id)]);
        ['page', 'comment', 'transcript'].forEach((sourceType) => expect(stateOf(sourceType)).toMatchObject({ status: 'complete', catchUpFrom: null }));
    });
});

describe('with KNOWLEDGE_INDEXER off', () => {
    it('never writes a heartbeat', async () => {
        delete process.env.KNOWLEDGE_INDEXER;
        mockDb.calls.length = 0;
        await ask('anything', ['page', 'comment', 'transcript']);
        await backfill.backfillAll();
        await events.drain();
        expect(knowledgeCalls()).toEqual([]);
    });
});
