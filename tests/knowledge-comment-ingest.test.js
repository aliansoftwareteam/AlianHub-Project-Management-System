process.env.STORAGE_TYPE = 'server';

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const comments = require('../Modules/Comments/controller');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
const OFF_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const P1 = '6f00000000000000000000a1';
const P2 = '6f00000000000000000000a2';
const OPEN_SPRINT = '6f00000000000000000000d1';
const PRIVATE_SPRINT = '6f00000000000000000000d2';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const chunksOf = (id) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === 'comment' && c.sourceId === String(id)).sort((a, b) => a.ordinal - b.ordinal);
const live = (id) => chunksOf(id).filter((c) => !c.deleted);
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Harbour survey', CompanyId: C, ProjectID: P1, sprintId: OPEN_SPRINT, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});
const seedComment = (task, over = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    message: 'The pier needs new planks.', type: 'text', project: false, projectId: task ? task.ProjectID : P1, sprintId: task ? task.sprintId : OPEN_SPRINT,
    taskId: task ? String(task._id) : undefined, userId: MEMBER, isDeleted: false, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = res.send;
    return res;
};
const call = async (handler, { uid, body = {} }) => {
    const res = response();
    await handler({ uid, params: {}, body, query: {}, headers: { companyid: C } }, res);
    return res;
};

/* The envelope the bus publishes for a task emit, built the way it builds one. */
const taskChanged = (task, fields) => {
    const changedFields = new Set(fields);
    const type = domainEventBus.classifyTaskEvent('update', changedFields);
    domainEventBus.bus.emit(type, domainEventBus.buildEnvelope({ companyId: C, type, doc: task, changedFields, actor: { kind: 'user' } }));
    return type;
};

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
    mockDb.uniqueFromSchema(CHUNKS, knowledgeChunksSchema);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, knowledgeIndexer: { mode: 'on' } });
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: OFF_COMPANY });
    ['page', 'comment', 'transcript'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete' }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, ProjectName: 'One', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, ProjectName: 'Two', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, status: 2, isDelete: false, roleType: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, status: 2, isDelete: false, roleType: 3 });
    getRoleType.mockImplementation(async (companyId, uid) => (uid === OWNER ? 1 : 3));
    visibleProjectIds.mockImplementation(async () => [P1, P2]);
});

describe('comment events on the bus', () => {
    it('carry the company id, so a comment saved through the controller is ingested with its task, project and sprint', async () => {
        const task = seedTask();
        const res = await call(comments.save, { uid: MEMBER, body: { data: { message: 'Order the timber for the pier.', type: 'text', project: false, taskId: String(task._id), projectId: P1, sprintId: OPEN_SPRINT } } });
        expect(res.body.status).toBe(true);
        await events.drain();

        const rows = live(res.body.data._id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            companyId: C,
            sourceType: 'comment',
            sourceId: String(res.body.data._id),
            ordinal: 0,
            projectId: P1,
            sprintId: OPEN_SPRINT,
            taskId: String(task._id),
            visibility: 'project',
            createdBy: MEMBER,
            authorKind: 'human',
            embeddingModel: null,
            deleted: false,
        });
        expect(rows[0].text).toBe('Order the timber for the pier.');
    });

    it('ingests a task comment saved the way the task view sends it, with its ids under objId', async () => {
        const task = seedTask();
        const res = await call(comments.save, { uid: MEMBER, body: { data: { message: 'Planks arrive Tuesday.', type: 'text', project: false, objId: { taskId: String(task._id), projectId: P1, sprintId: OPEN_SPRINT } } } });
        expect(res.body.status).toBe(true);
        await events.drain();

        expect(live(res.body.data._id).map((r) => [r.text, r.taskId, r.sprintId])).toEqual([['Planks arrive Tuesday.', String(task._id), OPEN_SPRINT]]);
    });

    it('ingests a project comment saved from the project conversation', async () => {
        const res = await call(comments.save, { uid: MEMBER, body: { data: { message: 'Welcome aboard.', type: 'text', project: true, projectId: P1 } } });
        expect(res.body.status).toBe(true);
        await events.drain();

        expect(live(res.body.data._id).map((r) => [r.text, r.projectId, r.taskId])).toEqual([['Welcome aboard.', P1, '']]);
    });

    it('re-ingests a comment edited through the controller', async () => {
        const task = seedTask();
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));

        const res = await call(comments.update, { uid: MEMBER, body: { id: String(comment._id), data: { message: 'The pier needs steel piles.' } } });
        expect(res.body.status).toBe(true);
        await events.drain();

        expect(live(comment._id).map((r) => r.text)).toEqual(['The pier needs steel piles.']);
    });

    it('tombstones a comment deleted through the controller', async () => {
        const task = seedTask();
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));
        expect(live(comment._id)).toHaveLength(1);

        const res = await call(comments.update, { uid: MEMBER, body: { id: String(comment._id), data: { isDeleted: true } } });
        expect(res.body.status).toBe(true);
        await events.drain();

        expect(live(comment._id)).toEqual([]);
        expect(chunksOf(comment._id).every((r) => r.deleted && r.deletedAt instanceof Date)).toBe(true);
    });

    it('announces a comment as comment.created, comment.updated and comment.deleted, with its company', async () => {
        const task = seedTask();
        const announced = [];
        const listen = (envelope) => { if (envelope.entity.kind === 'comment') announced.push(envelope); };
        domainEventBus.bus.on('domain.event', listen);
        try {
            const saved = await call(comments.save, { uid: MEMBER, body: { data: { message: 'Draft.', type: 'text', project: false, taskId: String(task._id), projectId: P1, sprintId: OPEN_SPRINT } } });
            const id = String(saved.body.data._id);
            await call(comments.update, { uid: MEMBER, body: { id, data: { message: 'Final.' } } });
            await call(comments.update, { uid: MEMBER, body: { id, data: { isDeleted: true } } });
            await events.drain();
            expect(announced.map((e) => [e.type, e.companyId, e.entity.id])).toEqual([
                ['comment.created', C, id],
                ['comment.updated', C, id],
                ['comment.deleted', C, id],
            ]);
        } finally {
            domainEventBus.bus.removeListener('domain.event', listen);
        }
    });

    it('ingests a comment an agent posts as agent-written, and undoing it tombstones it', async () => {
        const { executors } = require('../Modules/Agents/actions');
        const { inverses } = require('../Modules/Agents/undo');
        const task = seedTask();
        const actor = { kind: 'agent', agentId: '6f00000000000000000000e1', agentName: 'Scribe', userId: OWNER };

        const { result } = await executors['task.comment']({ companyId: C, actor, params: { taskId: String(task._id), body: 'Survey booked for Monday.' } });
        await events.drain();
        expect(live(result.commentId).map((r) => [r.authorKind, r.text, r.taskId])).toEqual([['agent', 'Survey booked for Monday.', String(task._id)]]);

        await inverses.comment(C, { commentId: result.commentId });
        await events.drain();
        expect(live(result.commentId)).toEqual([]);
    });

    it('leaves out a chat message whose task id names no task, and a media comment', async () => {
        const chat = seedComment(null, { taskId: '6f00000000000000000000f9', message: 'Lunch at noon?' });
        const media = seedComment(seedTask(), { type: 'image', message: 'pier.png' });

        await indexer.syncComment(C, String(chat._id));
        await indexer.syncComment(C, String(media._id));

        expect(live(chat._id)).toEqual([]);
        expect(live(media._id)).toEqual([]);
    });

    it('does nothing for a company whose own switch is off', async () => {
        await domainEventBus.bus.emit('comment.created', { companyId: OFF_COMPANY, type: 'comment.created', entity: { kind: 'comment', id: '6f00000000000000000000f1' }, data: {} });
        await events.drain();
        expect(mockDb.calls.filter((c) => c.type === CHUNKS || c.type === SCHEMA_TYPE.COMMENTS)).toEqual([]);
    });
});

describe('a comment follows its task', () => {
    it('is tombstoned when its task is deleted, and comes back when the task is restored', async () => {
        const task = seedTask();
        const comment = seedComment(task);
        const other = seedComment(seedTask({ TaskName: 'Other' }));
        await indexer.syncComment(C, String(comment._id));
        await indexer.syncComment(C, String(other._id));

        rowOf(SCHEMA_TYPE.TASKS, task._id).deletedStatusKey = 1;
        taskChanged(rowOf(SCHEMA_TYPE.TASKS, task._id), ['deletedStatusKey']);
        await events.drain();
        expect(live(comment._id)).toEqual([]);
        expect(live(other._id)).toHaveLength(1);

        rowOf(SCHEMA_TYPE.TASKS, task._id).deletedStatusKey = 0;
        taskChanged(rowOf(SCHEMA_TYPE.TASKS, task._id), ['deletedStatusKey']);
        await events.drain();
        expect(live(comment._id)).toHaveLength(1);
    });

    it('is indexed when its task is restored even if it was deleted before the comment was ever indexed', async () => {
        const task = seedTask({ deletedStatusKey: 1 });
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));
        expect(chunksOf(comment._id)).toEqual([]);

        rowOf(SCHEMA_TYPE.TASKS, task._id).deletedStatusKey = 0;
        taskChanged(rowOf(SCHEMA_TYPE.TASKS, task._id), ['deletedStatusKey']);
        await events.drain();

        expect(live(comment._id)).toHaveLength(1);
    });

    it("takes its task's new sprint when the task moves", async () => {
        const task = seedTask();
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));

        Object.assign(rowOf(SCHEMA_TYPE.TASKS, task._id), { sprintId: PRIVATE_SPRINT, updatedAt: new Date('2026-09-02T00:00:00Z') });
        expect(taskChanged(rowOf(SCHEMA_TYPE.TASKS, task._id), ['sprintId'])).toBe('task.sprint_changed');
        await events.drain();

        expect(live(comment._id).map((r) => r.sprintId)).toEqual([PRIVATE_SPRINT]);
    });

    it('reads nothing for a task change that cannot change who sees its comments', async () => {
        const task = seedTask();
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));
        mockDb.calls.length = 0;

        expect(taskChanged(task, ['statusType'])).toBe('task.status_changed');
        taskChanged(task, ['rawDescription']);
        await events.drain();

        expect(mockDb.calls).toEqual([]);
    });

    it("is tombstoned with its task's project when that is trashed, and comes back on restore", async () => {
        const doomed = seedComment(seedTask({ ProjectID: P1 }));
        const safe = seedComment(seedTask({ ProjectID: P2 }));
        await indexer.syncComment(C, String(doomed._id));
        await indexer.syncComment(C, String(safe._id));

        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await events.drain();
        expect(live(doomed._id)).toEqual([]);
        expect(live(safe._id)).toHaveLength(1);

        await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
        await events.drain();
        expect(live(doomed._id)).toHaveLength(1);
    });

    it('is left out while its project is in the trash', async () => {
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((p) => p._id === P2).deletedStatusKey = 1;
        const comment = seedComment(seedTask({ ProjectID: P2 }));
        await indexer.syncComment(C, String(comment._id));
        expect(live(comment._id)).toEqual([]);
    });
});

describe('comments are shared content', () => {
    it("stay searchable when their author leaves, while the author's private pages go", async () => {
        const comment = seedComment(seedTask(), { userId: MEMBER });
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Diary', content: { html: '<p>Mine.</p>' }, visibility: 'private', createdBy: MEMBER, ProjectID: P1, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z') });
        await indexer.syncComment(C, String(comment._id));
        await indexer.syncPage(C, String(page._id));

        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((u) => u.userId === MEMBER).isDelete = true;
        await events.handle({ type: 'member.departed', companyId: C, entity: { kind: 'member', id: MEMBER }, data: { userId: MEMBER } });
        await indexer.syncComment(C, String(comment._id));

        expect(live(comment._id)).toHaveLength(1);
        expect((mockDb.store[CHUNKS] || []).filter((c) => c.sourceId === String(page._id) && !c.deleted)).toEqual([]);
    });
});
