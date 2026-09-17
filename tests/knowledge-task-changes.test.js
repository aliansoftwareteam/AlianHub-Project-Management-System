const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a), validateObjectId: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { knowledgeChunksSchema } = require('../utils/mongo-handler/createSchema');
const domainEventBus = require('../event/domainEventBus');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');
const indexer = require('../Modules/Knowledge/ingest/indexer');
const events = require('../Modules/Knowledge/ingest/events');

const C = '6f0000000000000000000c01';
const AUTHOR = '6f0000000000000000000001';
const P1 = '6f00000000000000000000a1';
const P2 = '6f00000000000000000000a2';
const S1 = '6f00000000000000000000d1';
const S2 = '6f00000000000000000000d2';
const ENV = process.env.KNOWLEDGE_INDEXER;

const CHUNKS = SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
const chunksOf = (id) => (mockDb.store[CHUNKS] || []).filter((c) => c.sourceType === 'comment' && c.sourceId === String(id));
const live = (id) => chunksOf(id).filter((c) => !c.deleted);
const rowOf = (type, id) => mockDb.store[type].find((row) => String(row._id) === String(id));
const at = (day) => new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`);
const commentReads = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.COMMENTS);
const chunkWrites = () => mockDb.calls.filter((c) => c.type === CHUNKS && !['find', 'findOne', 'aggregate'].includes(c.method));

const seedTask = (over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Task', CompanyId: C, ProjectID: P1, sprintId: S1, deletedStatusKey: 0, updatedAt: at(1), ...over });
const seedComment = (task, over = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    message: 'The pier needs planks.', type: 'text', projectId: task.ProjectID, sprintId: task.sprintId, taskId: String(task._id), userId: AUTHOR, isDeleted: false, updatedAt: at(1), ...over,
});
const indexed = async (task, over) => {
    const comment = seedComment(task, over);
    await indexer.syncComment(C, String(comment._id));
    return comment;
};

/* A task emit as the bus turns it into an envelope; a move sets deletedStatusKey 0 with the rest. */
const taskChanged = (task, updatedFields) => {
    const changedFields = new Set(Object.keys(updatedFields));
    const type = domainEventBus.classifyTaskEvent('update', changedFields);
    domainEventBus.bus.emit(type, domainEventBus.buildEnvelope({ companyId: C, type, doc: task, changedFields, actor: { kind: 'user' } }));
};
const move = (task, { ProjectID, sprintId, updatedAt }) => {
    Object.assign(rowOf(SCHEMA_TYPE.TASKS, task._id), { ProjectID, sprintId, deletedStatusKey: 0, updatedAt });
    taskChanged(rowOf(SCHEMA_TYPE.TASKS, task._id), { ProjectID, sprintId, statusType: 'active', statusKey: 1, AssigneeUserId: [], deletedStatusKey: 0 });
};
const setDeleted = (task, deletedStatusKey, updatedAt) => {
    Object.assign(rowOf(SCHEMA_TYPE.TASKS, task._id), { deletedStatusKey, ...(updatedAt ? { updatedAt } : {}) });
    taskChanged(rowOf(SCHEMA_TYPE.TASKS, task._id), { deletedStatusKey });
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
    ['page', 'comment', 'transcript'].forEach((sourceType) => mockDb.seed(SCHEMA_TYPE.KNOWLEDGE_INDEX_STATE, { companyId: C, sourceType, status: 'complete', lastSeenOnAt: new Date() }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P1, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P2, deletedStatusKey: 0 });
});

describe('a task moved to another project or sprint', () => {
    it('re-tags its comment chunks without reading a single comment', async () => {
        const task = seedTask();
        const comments = [await indexed(task), await indexed(task, { message: 'Second note.' })];
        mockDb.calls.length = 0;

        move(task, { ProjectID: P2, sprintId: S2, updatedAt: at(3) });
        await events.drain();

        expect(commentReads()).toEqual([]);
        comments.forEach((comment) => expect(live(comment._id).map((c) => [c.projectId, c.sprintId])).toEqual([[P2, S2]]));
    });

    it('re-tags a bulk move of 200 tasks with no comment read and no more than a few company re-indexes at once', async () => {
        const tasks = [];
        for (let i = 0; i < 200; i += 1) {
            const task = seedTask({ TaskName: `Task ${i}` });
            await indexed(task, { message: `Note ${i}.` });
            tasks.push(task);
        }
        mockDb.calls.length = 0;
        const crud = mockDb.crud.getMockImplementation();
        let inFlight = 0;
        let most = 0;
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            const counted = companyId === C && [SCHEMA_TYPE.TASKS, CHUNKS].includes(q.type);
            if (counted) { inFlight += 1; most = Math.max(most, inFlight); }
            try {
                await new Promise((resolve) => setTimeout(resolve, 1));
                return await crud(companyId, q, method);
            } finally {
                if (counted) inFlight -= 1;
            }
        });

        try {
            tasks.forEach((task) => move(task, { ProjectID: P2, sprintId: S2, updatedAt: at(3) }));
            await events.drain();
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        expect(commentReads()).toEqual([]);
        expect(most).toBeGreaterThan(0);
        expect(most).toBeLessThanOrEqual(events.MAX_CONCURRENT_PER_COMPANY);
        expect((mockDb.store[CHUNKS] || []).filter((c) => !c.deleted).every((c) => c.projectId === P2 && c.sprintId === S2)).toBe(true);
    });

    it("keeps an older comment sync from writing the task's old project back after the move", async () => {
        const task = seedTask();
        const comment = await indexed(task);
        const staleRead = { ...rowOf(SCHEMA_TYPE.COMMENTS, comment._id) };
        const oldTask = { ...rowOf(SCHEMA_TYPE.TASKS, task._id) };

        move(task, { ProjectID: P2, sprintId: S2, updatedAt: at(3) });
        await events.drain();
        await indexer.ingestComment(C, staleRead, { task: oldTask });

        expect(live(comment._id).map((c) => c.projectId)).toEqual([P2]);
    });
});

describe('archiving and unarchiving a task', () => {
    it('reads no comment and changes no chunk, since an archived task still shows its comments', async () => {
        const task = seedTask();
        const comment = await indexed(task);
        mockDb.calls.length = 0;

        setDeleted(task, 2);
        await events.drain();
        setDeleted(task, 0);
        await events.drain();

        expect(commentReads()).toEqual([]);
        expect(chunkWrites()).toEqual([]);
        expect(live(comment._id)).toHaveLength(1);
    });
});

describe('deleting and restoring a task', () => {
    it('tombstones every comment of a deleted task in one write, and brings them back only when the task really comes back', async () => {
        const task = seedTask();
        const comments = [await indexed(task), await indexed(task, { message: 'Two.' }), await indexed(task, { message: 'Three.' })];
        mockDb.calls.length = 0;

        setDeleted(task, 1, at(2));
        await events.drain();
        comments.forEach((comment) => expect(live(comment._id)).toEqual([]));
        expect(chunkWrites().filter((c) => c.method === 'updateMany' && c.data[1].$set && c.data[1].$set.deleted === true)).toHaveLength(1);
        expect(commentReads()).toEqual([]);

        setDeleted(task, 0, at(3));
        await events.drain();
        comments.forEach((comment) => expect(live(comment._id)).toHaveLength(1));
    });

    it('brings back a comment that was left out before it was ever indexed, because its task was already deleted', async () => {
        const task = seedTask({ deletedStatusKey: 1 });
        const comment = seedComment(task);
        await indexer.syncComment(C, String(comment._id));
        expect(live(comment._id)).toEqual([]);

        setDeleted(task, 0, at(3));
        await events.drain();

        expect(live(comment._id)).toHaveLength(1);
    });

    it('carries on past a sync that fails in the middle of a restore, and retries it', async () => {
        const task = seedTask();
        const comments = [];
        for (let i = 0; i < 5; i += 1) comments.push(await indexed(task, { message: `Note ${i}.` }));
        setDeleted(task, 1, at(2));
        await events.drain();
        const crud = mockDb.crud.getMockImplementation();
        let failed = false;
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (!failed && q.type === SCHEMA_TYPE.COMMENTS && method === 'findOne' && String(q.data[0]._id) === String(comments[2]._id)) {
                failed = true;
                throw new Error('connection reset');
            }
            return crud(companyId, q, method);
        });

        try {
            setDeleted(task, 0, at(3));
            await events.drain();
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        expect(failed).toBe(true);
        comments.forEach((comment) => expect(live(comment._id)).toHaveLength(1));
    });
});

describe('restoring a project', () => {
    it('carries on past a sync that fails in the middle of the batch, and retries it', async () => {
        const task = seedTask();
        const comments = [];
        for (let i = 0; i < 5; i += 1) comments.push(await indexed(task, { message: `Note ${i}.` }));
        await updateProjectInternal(C, P1, { deletedStatusKey: 1 });
        await events.drain();
        comments.forEach((comment) => expect(live(comment._id)).toEqual([]));
        const crud = mockDb.crud.getMockImplementation();
        let failed = false;
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (!failed && q.type === SCHEMA_TYPE.COMMENTS && method === 'findOne' && String(q.data[0]._id) === String(comments[1]._id)) {
                failed = true;
                throw new Error('connection reset');
            }
            return crud(companyId, q, method);
        });

        try {
            await updateProjectInternal(C, P1, { deletedStatusKey: 0 });
            await events.drain();
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        expect(failed).toBe(true);
        comments.forEach((comment) => expect(live(comment._id)).toHaveLength(1));
    });
});

describe('restoring a project whose page keeps failing', () => {
    it('still restores its comments, and reports the page', async () => {
        const task = seedTask();
        const comment = await indexed(task);
        const page = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Broken', content: { html: '<p>x</p>' }, visibility: 'project', createdBy: AUTHOR, ProjectID: P1, deletedStatusKey: 0, updatedAt: at(1) });
        await indexer.tombstoneProject(C, P1);
        const crud = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            if (q.type === SCHEMA_TYPE.PAGES && method === 'findOne' && String(q.data[0]._id) === String(page._id)) throw new Error('corrupt page');
            return crud(companyId, q, method);
        });

        try {
            await expect(indexer.reindexProject(C, P1)).rejects.toThrow(/corrupt page/);
        } finally {
            mockDb.crud.mockImplementation(crud);
        }

        expect(live(comment._id)).toHaveLength(1);
    });
});

describe('a deleted comment', () => {
    it('cannot be written back by a read taken before it was deleted', async () => {
        const task = seedTask();
        const comment = await indexed(task, { updatedAt: at(1) });
        const before = { ...rowOf(SCHEMA_TYPE.COMMENTS, comment._id) };
        Object.assign(rowOf(SCHEMA_TYPE.COMMENTS, comment._id), { isDeleted: true, updatedAt: at(6) });
        await indexer.syncComment(C, String(comment._id));

        await indexer.ingestComment(C, before, { task: rowOf(SCHEMA_TYPE.TASKS, task._id) });

        expect(live(comment._id)).toEqual([]);
    });

    it('is tombstoned even when its task was stamped after the comment was last written', async () => {
        const task = seedTask();
        const comment = await indexed(task, { updatedAt: at(1) });
        move(task, { ProjectID: P1, sprintId: S2, updatedAt: at(5) });
        await events.drain();
        expect(live(comment._id).map((c) => time(c.sourceUpdatedAt))).toEqual([time(at(5))]);

        Object.assign(rowOf(SCHEMA_TYPE.COMMENTS, comment._id), { isDeleted: true, updatedAt: at(3) });
        await indexer.syncComment(C, String(comment._id));

        expect(live(comment._id)).toEqual([]);
    });

    it('comes back with a newer version if it is written again', async () => {
        const task = seedTask();
        const comment = await indexed(task);
        move(task, { ProjectID: P1, sprintId: S2, updatedAt: at(5) });
        await events.drain();
        Object.assign(rowOf(SCHEMA_TYPE.COMMENTS, comment._id), { isDeleted: true, updatedAt: at(3) });
        await indexer.syncComment(C, String(comment._id));

        Object.assign(rowOf(SCHEMA_TYPE.COMMENTS, comment._id), { isDeleted: false, message: 'Written again.', updatedAt: at(7) });
        await indexer.syncComment(C, String(comment._id));

        expect(live(comment._id).map((c) => [c.text, time(c.sourceUpdatedAt)])).toEqual([['Written again.', time(at(7))]]);
    });
});

function time(value) {
    return new Date(value).getTime();
}
