process.env.STORAGE_TYPE = 'server';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 1), isPrivileged: () => true }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f00000000000000000000a1']), visibleProjects: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Automations/engine', () => ({ defineRecurring: jest.fn(async () => undefined) }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn() }));
jest.mock('../Modules/AI/meetingNotes', () => ({ generateMeetingNotes: jest.fn(async () => ({ status: true, data: { summary: 'Summary.', actionItems: [] } })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const engine = require('../Modules/Automations/engine');
const pages = require('../Modules/Pages/controller');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const { retrieve } = require('../Modules/Knowledge/retrieval');
const flag = require('../Modules/Knowledge/flag');
const events = require('../Modules/Knowledge/ingest/events');
const backfill = require('../Modules/Knowledge/ingest/backfill');
const knowledge = require('../Modules/Knowledge/init');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f00000000000000000000a1';
const ENV = process.env.KNOWLEDGE_INDEXER;

const KNOWLEDGE_TYPES = [SCHEMA_TYPE.KNOWLEDGE_CHUNKS, SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, SCHEMA_TYPE.KNOWLEDGE_EXCLUSIONS];
const knowledgeCalls = () => mockDb.calls.filter((c) => KNOWLEDGE_TYPES.includes(c.type));
const companyReads = () => mockDb.calls.filter((c) => c.companyId === dbCollections.GLOBAL && c.type === dbCollections.COMPANIES && c.method !== 'findOneAndUpdate');

const call = async (handler, { uid = OWNER, params = {}, body = {} } = {}) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (b) => { res.body = b; return res; };
    res.json = res.send;
    await handler({ uid, params, body, query: {}, headers: { companyid: C } }, res);
    return res;
};

const seen = [];
const record = (envelope) => seen.push(envelope);

beforeAll(() => domainEventBus.bus.on('domain.event', record));
afterAll(() => {
    domainEventBus.bus.removeListener('domain.event', record);
    if (ENV === undefined) delete process.env.KNOWLEDGE_INDEXER;
    else process.env.KNOWLEDGE_INDEXER = ENV;
});

beforeEach(() => {
    delete process.env.KNOWLEDGE_INDEXER;
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    seen.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' }, knowledgeRetrieval: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType: 'page', status: 'complete', lastSeenOnAt: new Date() });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'One', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.calls.length = 0;
});

describe('with KNOWLEDGE_INDEXER unset, nothing new runs, reads or writes', () => {
    it.each([undefined, 'off', 'yes'])('reads %p as off', (value) => {
        if (value !== undefined) process.env.KNOWLEDGE_INDEXER = value;
        expect(flag.indexer.mode()).toBe('off');
    });

    it('registers no listener and no recurring job', () => {
        const before = ['pages:insert', 'pages:update'].map((name) => socketEmitter.listenerCount(name));
        knowledge.init({});
        expect(events.start()).toBe(false);
        expect(['pages:insert', 'pages:update'].map((name) => socketEmitter.listenerCount(name))).toEqual(before);
        expect(engine.defineRecurring).not.toHaveBeenCalled();
    });

    it('creates, edits and deletes a page with no chunk read or write and no company read', async () => {
        const created = await call(pages.createPage, { body: { title: 'Plan', projectId: PROJECT, contentBlocks: [{ type: 'paragraph', data: { text: 'Body.' } }] } });
        expect(created.body.status).toBe(true);
        const id = String(created.body.data._id);
        expect((await call(pages.updatePage, { params: { id }, body: { visibility: 'private' } })).body.status).toBe(true);
        expect((await call(pages.deletePage, { params: { id } })).body.status).toBe(true);
        await events.drain();

        expect(knowledgeCalls()).toEqual([]);
        expect(companyReads()).toEqual([]);
        expect(seen).toEqual([]);
    });

    it('trashes and restores a project and announces nothing', async () => {
        await updateProjectInternal(C, PROJECT, { deletedStatusKey: 1 });
        await updateProjectInternal(C, PROJECT, { deletedStatusKey: 0 });
        await events.drain();

        expect(knowledgeCalls()).toEqual([]);
        expect(seen).toEqual([]);
        expect(events.publishMemberDeparted(C, OWNER)).toBeNull();
        expect(events.publishMemberActivated(C, OWNER)).toBeNull();
        events.requestSync(C, PROJECT);
        await events.drain();
        expect(seen).toEqual([]);
    });

    it('retrieves pages from the page rows, never from chunks or the index state', async () => {
        mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Budget', rawText: 'budget', ProjectID: PROJECT, visibility: 'project', createdBy: OWNER, deletedStatusKey: 0 });
        const { passages } = await retrieve({ companyId: C, caller: { kind: 'user', userId: OWNER }, query: 'budget', scope: { sourceTypes: ['page'] } });

        expect(passages).toHaveLength(1);
        expect(knowledgeCalls()).toEqual([]);
        expect(companyReads()).toEqual([]);
    });

    it('runs no backfill', async () => {
        await backfill.backfillAll();
        backfill.ensureBackfill(C);
        await events.drain();
        expect(mockDb.calls).toEqual([]);
    });

    it('saves, edits and deletes a comment, and posts and undoes an agent comment, with no knowledge read or write and nothing announced', async () => {
        const comments = require('../Modules/Comments/controller');
        const { executors } = require('../Modules/Agents/actions');
        const { inverses } = require('../Modules/Agents/undo');
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Survey', CompanyId: C, ProjectID: PROJECT, sprintId: '6f00000000000000000000d1', deletedStatusKey: 0 });
        const commentListeners = ['comments:insert', 'comments:update', 'comments_project:insert', 'comments_project:update'].map((name) => socketEmitter.listenerCount(name));
        mockDb.calls.length = 0;

        const saved = await call(comments.save, { body: { data: { message: 'Planks.', type: 'text', project: false, taskId: String(task._id), projectId: PROJECT, sprintId: '6f00000000000000000000d1' } } });
        const id = String(saved.body.data._id);
        await call(comments.update, { body: { id, data: { message: 'Steel.' } } });
        await call(comments.update, { body: { id, data: { isDeleted: true } } });
        const { result } = await executors['task.comment']({ companyId: C, actor: { kind: 'agent', agentId: '6f00000000000000000000e1', userId: OWNER }, params: { taskId: String(task._id), body: 'Booked.' } });
        await inverses.comment(C, { commentId: result.commentId });
        await events.drain();

        expect(knowledgeCalls()).toEqual([]);
        expect(companyReads()).toEqual([]);
        expect(seen).toEqual([]);
        expect(['comments:insert', 'comments:update', 'comments_project:insert', 'comments_project:update'].map((name) => socketEmitter.listenerCount(name))).toEqual(commentListeners);
    });

    it('saves, edits and discards call notes with no knowledge read or write and nothing announced', async () => {
        const notes = require('../Modules/Calls/notes');
        const before = ['calls:insert', 'calls:update'].map((name) => socketEmitter.listenerCount(name));

        const created = await call(notes.createNotes, { body: { callId: 'call-off', participants: [], transcript: 'We met.' } });
        const id = String(created.body.data._id);
        await call(notes.updateNotes, { params: { id }, body: { summary: 'Edited.' } });
        await call(notes.updateNotes, { params: { id }, body: { status: 'discarded' } });
        await events.drain();

        expect(knowledgeCalls()).toEqual([]);
        expect(companyReads()).toEqual([]);
        expect(seen).toEqual([]);
        expect(['calls:insert', 'calls:update'].map((name) => socketEmitter.listenerCount(name))).toEqual(before);
    });

    it('does no work for a task deleted or moved to another sprint', async () => {
        const task = { _id: '6f00000000000000000000e9', CompanyId: C, ProjectID: PROJECT, sprintId: '6f00000000000000000000d1' };
        ['deletedStatusKey', 'sprintId'].forEach((field) => {
            const changedFields = new Set([field]);
            const type = domainEventBus.classifyTaskEvent('update', changedFields);
            domainEventBus.bus.emit(type, domainEventBus.buildEnvelope({ companyId: C, type, doc: task, changedFields }));
        });
        await events.drain();
        expect(mockDb.calls).toEqual([]);
    });

    it('retrieves comments and transcripts from their rows, never from chunks or the index state', async () => {
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Survey', ProjectID: PROJECT, deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.COMMENTS, { message: 'budget planks', type: 'text', projectId: PROJECT, taskId: String(task._id), userId: OWNER });
        mockDb.seed(SCHEMA_TYPE.CALLS, { callId: 'c', title: 'Budget call', transcript: 'budget', participants: [OWNER], deletedStatusKey: 0 });
        mockDb.calls.length = 0;

        const { passages } = await retrieve({ companyId: C, caller: { kind: 'user', userId: OWNER }, query: 'budget', scope: { sourceTypes: ['comment', 'transcript'] } });

        expect(passages.map((p) => p.sourceType).sort()).toEqual(['comment', 'transcript']);
        expect(knowledgeCalls()).toEqual([]);
        expect(companyReads()).toEqual([]);
    });
});
