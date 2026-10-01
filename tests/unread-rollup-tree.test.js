const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { ObjectId } = require('mongodb');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { updateUnReadCommentsCountFun, updateSprintCount } = require('../Modules/notification-count/controller');
const { parentIdsOf } = require('../Modules/notification-count/unreadParents');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000d01';
const ROOT = '6f0000000000000000000e01';
const CHILD = '6f0000000000000000000e02';
const GRANDCHILD = '6f0000000000000000000e03';
const SECOND_CHILD = '6f0000000000000000000e04';
const UNCHAINED = '6f0000000000000000000e05';

const own = (taskId) => `task_${PROJECT}_${SPRINT}_${taskId}_comments`;
const below = (taskId) => `parentTask_${PROJECT}_${SPRINT}_${taskId}_comments`;

const settle = async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const counts = () => {
    const doc = (mockDb.store[SCHEMA_TYPE.USERID] || []).find((row) => String(row.userId) === ME) || {};
    return Object.fromEntries(Object.entries(doc).filter(([key]) => key.endsWith('_comments')));
};

const change = async (taskId, extra = {}) => {
    await updateUnReadCommentsCountFun({ body: { companyId: C, key: 2, projectId: PROJECT, sprintId: SPRINT, taskId, userIds: [ME], ...extra } });
    await settle();
};
const comment = (taskId, extra) => change(taskId, extra);
const read = (taskId, extra) => change(taskId, { read: true, messageCount: 0, ...extra });

const seedTask = (id, parent, ancestors) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: new ObjectId(id), ProjectID: PROJECT, sprintId: SPRINT, ParentTaskId: parent, isParentTask: !parent, ...(ancestors ? { ancestors } : {}),
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    jest.clearAllMocks();
    seedTask(ROOT, '', []);
    seedTask(CHILD, ROOT, [ROOT]);
    seedTask(GRANDCHILD, CHILD, [ROOT, CHILD]);
    seedTask(SECOND_CHILD, ROOT, [ROOT]);
    seedTask(UNCHAINED, CHILD);
});

describe('the tasks above a row', () => {
    it('are read from the stored chain, root first', async () => {
        expect(await parentIdsOf(C, { taskId: GRANDCHILD })).toEqual([ROOT, CHILD]);
        expect(await parentIdsOf(C, { taskId: CHILD })).toEqual([ROOT]);
        expect(await parentIdsOf(C, { taskId: ROOT })).toEqual([]);
    });

    it('follow the named parent when the caller names one', async () => {
        expect(await parentIdsOf(C, { taskId: GRANDCHILD, parentTaskId: CHILD })).toEqual([ROOT, CHILD]);
        expect(await parentIdsOf(C, { taskId: ROOT, parentTaskId: CHILD })).toEqual([ROOT, CHILD]);
    });

    it('are found through the parent for a row that stores no chain', async () => {
        expect(await parentIdsOf(C, { taskId: UNCHAINED })).toEqual([ROOT, CHILD]);
    });

    it('fall back to the named parent when neither task is stored', async () => {
        const gone = '6f0000000000000000000eaa';
        expect(await parentIdsOf(C, { taskId: '6f0000000000000000000eab', parentTaskId: gone })).toEqual([gone]);
        expect(await parentIdsOf(C, { taskId: 'default' })).toEqual([]);
    });
});

describe('an unread comment on a level-three subtask', () => {
    it('reaches its parent and the root', async () => {
        await comment(GRANDCHILD, { parentTaskId: CHILD });
        expect(counts()).toEqual({ [own(GRANDCHILD)]: 1, [below(CHILD)]: 1, [below(ROOT)]: 1 });
    });

    it('reaches them when the caller names no parent', async () => {
        await comment(GRANDCHILD);
        expect(counts()).toEqual({ [own(GRANDCHILD)]: 1, [below(CHILD)]: 1, [below(ROOT)]: 1 });
    });

    it('is counted once on each task above it, beside the rows next to it', async () => {
        await comment(GRANDCHILD);
        await comment(GRANDCHILD);
        await comment(CHILD);
        await comment(SECOND_CHILD);
        expect(counts()).toEqual({
            [own(GRANDCHILD)]: 2,
            [own(CHILD)]: 1,
            [own(SECOND_CHILD)]: 1,
            [below(CHILD)]: 2,
            [below(ROOT)]: 4,
        });
    });

    it('clears from its parent and the root when read, and leaves what is still unread', async () => {
        await comment(GRANDCHILD);
        await comment(GRANDCHILD);
        await comment(SECOND_CHILD);
        await read(GRANDCHILD, { parentTaskId: CHILD, prevCount: 2 });
        expect(counts()).toEqual({ [own(SECOND_CHILD)]: 1, [below(ROOT)]: 1 });
    });

    it('clears by what was stored, whatever count the reader sends', async () => {
        await comment(GRANDCHILD);
        await comment(GRANDCHILD);
        await read(GRANDCHILD, { prevCount: 0 });
        expect(counts()).toEqual({});
    });

    it('tells the open clients, never with an empty document', async () => {
        await comment(GRANDCHILD);
        await read(GRANDCHILD);
        const told = socketEmitter.emit.mock.calls.filter(([, payload]) => payload.module === 'userIdNotification');
        expect(told.length).toBeGreaterThan(0);
        expect(told.every(([, payload]) => payload.data && String(payload.data.userId) === ME)).toBe(true);
    });
});

describe('marking a level-three subtask unread', () => {
    it('moves its parent and the root by the difference', async () => {
        await comment(GRANDCHILD);
        await change(GRANDCHILD, { set: true, messageCount: 4, prevCount: 1 });
        expect(counts()).toEqual({ [own(GRANDCHILD)]: 4, [below(CHILD)]: 4, [below(ROOT)]: 4 });
    });
});

describe('removing a row\'s unread count, as a delete or a move does', () => {
    it('takes it off every task above the row', async () => {
        await comment(GRANDCHILD);
        await comment(SECOND_CHILD);
        const rows = mockDb.store[SCHEMA_TYPE.USERID].map((row) => ({ ...row }));
        await new Promise((resolve) => updateSprintCount(C, rows, own(GRANDCHILD), `sprint_${PROJECT}_${SPRINT}_comments`, [below(ROOT), below(CHILD)], -1, resolve));
        expect(counts()).toMatchObject({ [below(ROOT)]: 1 });
        expect(counts()[below(CHILD)]).toBeUndefined();
    });
});
