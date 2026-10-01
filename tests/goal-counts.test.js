/* Task 046 M3: how a target counted from tasks gets its numbers, when they are counted again, and
   what a task change leaves behind for the next count. The handlers and the event bus are the real
   ones, over fakeMongo; the clock is the test's. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const logger = require('../Config/loggerConfig');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const goals = require('../Modules/Goals/controller');
const counts = require('../Modules/Goals/goalCounts');
const goalEvents = require('../Modules/Goals/goalEvents');
const { CLOSED_STATUS_TYPES } = require('../Modules/Tasks/helpers/taskSignals');
const { schema } = require('../utils/mongo-handler/schema');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const COLLEAGUE = '6f0000000000000000000005';
const ROLES = { [ADMIN]: 2, [AUTHOR]: 3, [COLLEAGUE]: 3 };
const T0 = new Date('2026-10-01T10:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

let seq = 0;
const nextId = (prefix) => `6f${prefix}${String(++seq).padStart(20, '0')}`;
const project = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: nextId('a0'), ProjectName: 'Project', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const list = (proj, over = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: nextId('b0'), projectId: String(proj._id), name: 'List', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...over })._id);
const task = (proj, sprintId, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: nextId('f0'), CompanyId: C, TaskName: 'Task', ProjectID: String(proj._id), sprintId, deletedStatusKey: 0, isParentTask: true, statusType: 'default_active', ...over,
});
const taskId = (...args) => String(task(...args)._id);

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, targetId, query } = {}) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body, query: query || {}, params: { id, targetId } }, res);
    return res;
};
const stored = () => mockDb.store[SCHEMA_TYPE.GOALS] || [];
const goalRow = (id) => stored().find((row) => String(row._id) === id);
const counting = async (linked, body = {}) => {
    const res = await call(goals.createGoal, AUTHOR, { body: { name: 'Ship it', targets: [{ name: 'Tasks done', kind: 'tasks', sources: linked }], ...body } });
    expect(res.statusCode).toBe(200);
    return res.body.data._id;
};
const read = async (id, uid = AUTHOR) => (await call(goals.getGoal, uid, { id })).body.data;
const numbers = (goal) => ({ ...goal.targets[0].counted, at: undefined, progressPct: goal.targets[0].progressPct });
const counted = (done, total, progressPct) => ({ done, total, at: undefined, progressPct });
const aggregates = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TASKS && c.method === 'aggregate');
const goalWrites = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS && c.method === 'findOneAndUpdate');
const setClock = (date) => jest.setSystemTime(date);
const after = (ms) => setClock(new Date(Date.now() + ms));

let open;
let openList;

beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    jest.clearAllMocks();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    open = project({ ProjectName: 'Open' });
    openList = list(open);
});

afterEach(async () => {
    await goalEvents.flushAll();
    await counts.idle();
    jest.useRealTimers();
});

describe('the count', () => {
    it('is the top-level tasks of a list that are not deleted or archived, and how many of them are done', async () => {
        const other = list(open, { name: 'Other' });
        CLOSED_STATUS_TYPES.forEach((statusType) => task(open, openList, { statusType }));
        task(open, openList, { statusType: 'Close' });
        task(open, openList, { statusType: '', status: { type: 'done' } });
        const parent = task(open, openList, { statusType: 'active' });
        const child = task(open, openList, { statusType: 'close', isParentTask: false, ParentTaskId: String(parent._id) });
        task(open, openList, { statusType: 'close', isParentTask: false, ParentTaskId: String(child._id) });
        task(open, openList, { statusType: 'close', deletedStatusKey: 1 });
        task(open, openList, { statusType: 'close', deletedStatusKey: 2 });
        task(open, openList, { statusType: 'close', deletedStatusKey: 3 });
        task(open, openList, { statusType: 'close', deletedStatusKey: 4 });
        task(open, openList, { statusType: 'close', deletedStatusKey: 6 });
        task(open, openList, { statusType: 'close', deletedStatusKey: 7 });
        task(open, openList, { statusType: 'close', mainChat: true });
        task(open, other, { statusType: 'close' });

        expect(numbers(await read(await counting({ sprintIds: [openList] })))).toEqual(counted(5, 6, 83));
    });

    it('keeps a task as it stood when its list or its project was closed', async () => {
        task(open, openList, { statusType: 'close', deletedStatusKey: 5 });
        task(open, openList, { statusType: 'active', deletedStatusKey: 5 });
        task(open, openList, { statusType: 'done', deletedStatusKey: 8 });
        expect(counts.COUNTED_STATES).toEqual([0, 5, 8]);
        expect(numbers(await read(await counting({ sprintIds: [openList] })))).toEqual(counted(2, 3, 67));
    });

    it('counts a task named on its own whatever its level, and once when its list is counted too', async () => {
        const parent = task(open, openList, { statusType: 'active' });
        const child = task(open, openList, { statusType: 'active', isParentTask: false, ParentTaskId: String(parent._id) });
        const grandchild = taskId(open, openList, { statusType: 'close', isParentTask: false, ParentTaskId: String(child._id) });
        const gone = taskId(open, openList, { statusType: 'close', deletedStatusKey: 1 });

        expect(numbers(await read(await counting({ taskIds: [grandchild] })))).toEqual(counted(1, 1, 100));
        expect(numbers(await read(await counting({ taskIds: [grandchild, String(child._id), gone] })))).toEqual(counted(1, 2, 50));
        expect(numbers(await read(await counting({ sprintIds: [openList], taskIds: [String(parent._id), grandchild] })))).toEqual(counted(1, 2, 50));
    });

    it('moves the goal with the target\'s weight', async () => {
        task(open, openList, { statusType: 'close' });
        task(open, openList);
        const res = await call(goals.createGoal, AUTHOR, { body: { name: 'Q4', targets: [{ name: 'Tasks', kind: 'tasks', weight: 3, sources: { sprintIds: [openList] } }, { name: 'Flag', kind: 'boolean' }] } });
        expect(res.body.data).toMatchObject({ progressPct: 38, targets: [{ progressPct: 50 }, { progressPct: 0 }] });
    });

    it('is one grouped read of the tasks collection for a target, planned on the list index and the id', () => {
        const [list1, task1] = ['6f00000000000000000000b1', '6f00000000000000000000f1'];
        const pipeline = counts.countPipeline({ sprintIds: [list1], taskIds: [task1] });
        expect(pipeline).toEqual([
            {
                $match: {
                    $or: [
                        { sprintId: { $in: [list1, new mongoose.Types.ObjectId(list1)] }, deletedStatusKey: { $in: [0, 5, 8] }, isParentTask: true, mainChat: { $ne: true } },
                        { _id: { $in: [new mongoose.Types.ObjectId(task1)] }, deletedStatusKey: { $in: [0, 5, 8] }, mainChat: { $ne: true } },
                    ],
                },
            },
            { $group: { _id: { statusType: '$statusType', type: '$status.type' }, n: { $sum: 1 } } },
        ]);
        expect(Object.keys(pipeline[0].$match)).toEqual(['$or']);
        expect(counts.countPipeline({ sprintIds: [list1], taskIds: [] })[0].$match.$or).toHaveLength(1);
        expect(JSON.stringify(pipeline)).not.toMatch(/\$inc|\$lookup|\$where/);
    });

    it('reads the tasks once for each target, and not at all for a target with nothing linked', async () => {
        task(open, openList);
        mockDb.calls.length = 0;
        await call(goals.createGoal, AUTHOR, { body: { name: 'Q4', targets: [{ name: 'A', kind: 'tasks', sources: { sprintIds: [openList] } }, { name: 'B', kind: 'tasks' }, { name: 'C', kind: 'number', target: 5 }] } });
        expect(aggregates()).toHaveLength(1);
        mockDb.calls.forEach((c) => expect([c.type, c.companyId]).toEqual([c.type, C]));
    });
});

describe('when a count is made again', () => {
    const target = (over) => ({ kind: 'tasks', counted: { done: 1, total: 2, at: T0 }, dirty: false, ...over });
    const at = (ms) => new Date(T0.getTime() + ms);

    it.each([
        ['a count just made', target(), 0, false],
        ['a count under ten minutes old that nothing has touched', target(), 10 * MINUTE - 1, false],
        ['a count ten minutes old, whatever happened', target(), 10 * MINUTE, true],
        ['a touched count under thirty seconds old', target({ dirty: true }), 30 * SECOND - 1, false],
        ['a touched count thirty seconds old', target({ dirty: true }), 30 * SECOND, true],
        ['a target never counted', target({ counted: undefined }), 0, true],
        ['a target whose count has no time', target({ counted: { done: 1, total: 2 } }), 0, true],
        ['a target that is not counted from tasks', { kind: 'number', dirty: true }, 60 * MINUTE, false],
    ])('%s', (_case, stored_, age, due) => {
        expect(counts.isDue(stored_, at(age))).toBe(due);
    });

    it('answers a read with the stored numbers at once, and counts behind it', async () => {
        task(open, openList, { statusType: 'close' });
        const id = await counting({ sprintIds: [openList] });
        task(open, openList);
        after(10 * MINUTE);
        mockDb.calls.length = 0;
        const emit = jest.spyOn(socketEmitter, 'emit');

        const stale = await read(id);
        expect(numbers(stale)).toEqual(counted(1, 1, 100));
        expect(stale.targets[0]).toMatchObject({ updating: true, dirty: false });
        expect(stale.targets[0].counted.at).toEqual(T0);

        await counts.idle();
        expect(aggregates()).toHaveLength(1);
        expect(emit.mock.calls.map(([type, payload]) => [type, payload])).toEqual([['update', { type: 'update', companyId: C, module: 'goals' }]]);
        const fresh = await read(id);
        expect(numbers(fresh)).toEqual(counted(1, 2, 50));
        expect(fresh).toMatchObject({ progressPct: 50, targets: [{ updating: false, reachedAt: null }] });
        expect(fresh.targets[0].counted.at).toEqual(new Date(T0.getTime() + 10 * MINUTE));
        emit.mockRestore();
    });

    it('does the same for every goal a list read returns, one after another, and once however often it is asked', async () => {
        const first = await counting({ sprintIds: [openList] });
        const second = await counting({ sprintIds: [openList] }, { name: 'Second' });
        await counting({ sprintIds: [openList] }, { name: 'Archived' }).then((id) => call(goals.archiveGoal, AUTHOR, { id }));
        task(open, openList, { statusType: 'done' });
        after(10 * MINUTE);
        mockDb.calls.length = 0;

        const listed = (await call(goals.listGoals, AUTHOR)).body.data;
        expect(listed.map((goal) => goal.targets[0].updating)).toEqual([true, true]);
        await call(goals.listGoals, AUTHOR);
        await call(goals.getGoal, AUTHOR, { id: first });
        await counts.idle();
        expect(aggregates()).toHaveLength(2);
        expect(goalWrites()).toHaveLength(2);
        for (const id of [first, second]) expect(numbers(await read(id))).toEqual(counted(1, 1, 100));
        const archived = (await call(goals.listGoals, AUTHOR, { query: { archived: 'true' } })).body.data[0];
        expect(archived.targets[0]).toMatchObject({ counted: { done: 0, total: 0 }, updating: false });
        mockDb.calls.length = 0;
        await call(goals.listGoals, AUTHOR, { query: { archived: 'true' } });
        await call(goals.getGoal, AUTHOR, { id: archived._id });
        await counts.idle();
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS).map((c) => c.method)).toEqual(['find', 'findOne']);
        expect(aggregates()).toEqual([]);
    });

    it('reads a goal once for a count, however many reads asked for it before it began', async () => {
        const id = await counting({ sprintIds: [openList] });
        after(10 * MINUTE);
        mockDb.calls.length = 0;
        [1, 2, 3].forEach(() => counts.recountSoon(C, id));
        await counts.idle();
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS && c.method === 'findOne')).toHaveLength(1);
    });

    it('is not made again by reads inside thirty seconds, even when a task has changed', async () => {
        const id = await counting({ sprintIds: [openList] });
        task(open, openList, { statusType: 'close' });
        goalRow(id).targets[0].dirty = true;
        mockDb.calls.length = 0;

        after(29 * SECOND);
        expect((await read(id)).targets[0]).toMatchObject({ dirty: true, updating: false, counted: { done: 0, total: 0 } });
        await read(id);
        await counts.idle();
        expect(aggregates()).toEqual([]);

        after(1 * SECOND);
        expect((await read(id)).targets[0]).toMatchObject({ dirty: true, updating: true });
        await read(id);
        await counts.idle();
        expect(aggregates()).toHaveLength(1);
        expect((await read(id)).targets[0]).toMatchObject({ dirty: false, updating: false, counted: { done: 1, total: 1 } });
    });

    it('heals a change nobody announced once the count is ten minutes old', async () => {
        const id = await counting({ sprintIds: [openList] });
        mockDb.store[SCHEMA_TYPE.TASKS].push({ _id: nextId('f0'), ProjectID: String(open._id), sprintId: openList, deletedStatusKey: 0, isParentTask: true, statusType: 'close' });
        after(10 * MINUTE - SECOND);
        await read(id);
        await counts.idle();
        expect(numbers(await read(id))).toEqual(counted(0, 0, 0));
        after(SECOND);
        await read(id);
        await counts.idle();
        expect(numbers(await read(id))).toEqual(counted(1, 1, 100));
    });

    it('counts only the targets that are due, and leaves who last changed the goal alone', async () => {
        const res = await call(goals.createGoal, AUTHOR, { body: { name: 'Q4', visibility: 'workspace', targets: [{ name: 'A', kind: 'tasks', sources: { sprintIds: [openList] } }, { name: 'B', kind: 'tasks', sources: { sprintIds: [openList] } }] } });
        const id = res.body.data._id;
        task(open, openList, { statusType: 'close' });
        after(MINUTE);
        goalRow(id).targets[0].dirty = true;
        await read(id, COLLEAGUE);
        await counts.idle();
        expect(goalRow(id).targets.map((entry) => [entry.name, entry.counted.total, entry.dirty])).toEqual([['A', 1, false], ['B', 0, false]]);
        expect(goalRow(id)).toMatchObject({ updatedBy: AUTHOR, revision: 1, progressPct: 50 });
    });

    it('lands on the goal as it is: a goal changed while it was counted is counted again', async () => {
        const id = await counting({ sprintIds: [openList] });
        task(open, openList, { statusType: 'close' });
        after(10 * MINUTE);
        const original = mockDb.crud.getMockImplementation();
        let raced = false;
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (!raced && method === 'aggregate' && query.type === SCHEMA_TYPE.TASKS) {
                raced = true;
                Object.assign(goalRow(id), { name: 'Renamed meanwhile', revision: goalRow(id).revision + 1 });
            }
            return original(companyId, query, method);
        });
        expect(await counts.refresh(C, id)).toBe(true);
        mockDb.crud.mockImplementation(original);
        expect(goalRow(id)).toMatchObject({ name: 'Renamed meanwhile', revision: 2 });
        expect(goalRow(id).targets[0].counted).toMatchObject({ done: 1, total: 1 });
    });

    it('does not let one failed count stop the next', async () => {
        const first = await counting({ sprintIds: [openList] });
        const second = await counting({ sprintIds: [openList] }, { name: 'Second' });
        task(open, openList, { statusType: 'close' });
        after(10 * MINUTE);
        const original = mockDb.crud.getMockImplementation();
        let failed = false;
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (!failed && method === 'aggregate') { failed = true; throw new Error('the database went away'); }
            return original(companyId, query, method);
        });
        await call(goals.listGoals, AUTHOR);
        await counts.idle();
        mockDb.crud.mockImplementation(original);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect([first, second].map((id) => goalRow(id).targets[0].counted.total).sort()).toEqual([0, 1]);
    });
});

describe('a task change', () => {
    const envelope = (type, { changedFields = [], sprintId = openList, previous = null, id = nextId('f0'), companyId = C, kind = 'task' } = {}) => ({
        ...domainEventBus.buildEnvelope({ companyId, type, doc: { _id: id, ProjectID: String(open._id), sprintId }, changedFields, previous, actor: { kind: 'user', userId: AUTHOR }, depth: 0 }),
        ...(kind === 'task' ? {} : { entity: { kind, id } }),
    });
    const heard = async (...envelopes) => {
        envelopes.forEach((entry) => goalEvents.onEnvelope(entry));
        jest.advanceTimersByTime(goalEvents.FOLD_MS);
        await goalEvents.flushAll();
    };
    const dirtyOf = (id) => goalRow(id).targets.map((entry) => entry.dirty === true);

    it.each([
        ['a task made in the list', () => envelope('task.created')],
        ['a status change', () => envelope('task.status_changed', { changedFields: ['status', 'statusKey', 'statusType'] })],
        ['a card dragged to another status group', () => envelope('task.updated', { changedFields: ['groupByStatusIndex'] })],
        ['a move into the list', () => envelope('task.sprint_changed', { changedFields: ['sprintId'] })],
        ['a move out of the list', () => envelope('task.sprint_changed', { changedFields: ['sprintId'], sprintId: '6f00000000000000000000b9', previous: { sprintId: openList } })],
        ['an archive, a delete or a restore', () => envelope('task.updated', { changedFields: ['deletedStatusKey'] })],
        ['an archive announced under another change', () => envelope('task.assignee_changed', { changedFields: ['AssigneeUserId', 'deletedStatusKey'] })],
        ['a task made a subtask', () => envelope('task.updated', { changedFields: ['isParentTask', 'ParentTaskId'] })],
        ['a task the automation engine made', () => envelope('task.updated', { changedFields: ['created'] })],
    ])('marks the counts of its list for the next read: %s', async (_case, make) => {
        const id = await counting({ sprintIds: [openList] });
        await heard(make());
        expect(dirtyOf(id)).toEqual([true]);
        expect(goalRow(id).targets[0].counted).toMatchObject({ done: 0, total: 0 });
    });

    it.each([
        ['a rename', () => envelope('task.renamed', { changedFields: ['TaskName'] })],
        ['a new assignee', () => envelope('task.assignee_changed', { changedFields: ['AssigneeUserId'] })],
        ['a change in another list', () => envelope('task.status_changed', { changedFields: ['statusType'], sprintId: '6f00000000000000000000b9' })],
        ['an event derived from stored state', () => envelope('task.due_date_passed')],
        ['something that is not a task', () => envelope('task.created', { kind: 'page' })],
        ['nothing at all', () => undefined],
    ])('leaves them alone: %s', async (_case, make) => {
        const id = await counting({ sprintIds: [openList] });
        mockDb.calls.length = 0;
        await heard(make());
        expect(dirtyOf(id)).toEqual([false]);
        expect(goalWrites()).toEqual([]);
    });

    it('reads and marks the goals of the company the task is in, and of no other', async () => {
        await counting({ sprintIds: [openList] });
        mockDb.calls.length = 0;
        await heard(envelope('task.created', { companyId: OTHER_COMPANY }), envelope('task.created'));
        const touched = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS);
        expect(touched.map((c) => c.companyId).sort()).toEqual(expect.arrayContaining([C, OTHER_COMPANY]));
        touched.forEach((c) => expect([C, OTHER_COMPANY]).toContain(c.companyId));
        expect(mockDb.calls.filter((c) => c.type !== SCHEMA_TYPE.GOALS)).toEqual([]);
    });

    it('marks a target that names the task itself, whichever list it is in', async () => {
        const named = taskId(open, list(open, { name: 'Elsewhere' }));
        const id = await counting({ taskIds: [named] });
        await heard(envelope('task.status_changed', { changedFields: ['statusType'], id: named, sprintId: '6f00000000000000000000b9' }));
        expect(dirtyOf(id)).toEqual([true]);
    });

    it('marks only the targets that count that list or task, on every goal that has one', async () => {
        const other = list(open, { name: 'Other' });
        const res = await call(goals.createGoal, AUTHOR, { body: { name: 'Mixed', targets: [
            { name: 'This list', kind: 'tasks', sources: { sprintIds: [openList] } },
            { name: 'Other list', kind: 'tasks', sources: { sprintIds: [other] } },
            { name: 'Flag', kind: 'boolean' },
        ] } });
        const second = await counting({ sprintIds: [other, openList] }, { name: 'Second' });
        const untouched = await counting({ sprintIds: [other] }, { name: 'Untouched' });
        const archived = await counting({ sprintIds: [openList] }, { name: 'Archived' });
        await call(goals.archiveGoal, AUTHOR, { id: archived });

        await heard(envelope('task.created'));
        expect(dirtyOf(res.body.data._id)).toEqual([true, false, false]);
        expect(dirtyOf(second)).toEqual([true]);
        expect(dirtyOf(untouched)).toEqual([false]);
        expect(dirtyOf(archived)).toEqual([false]);
        expect(goalRow(res.body.data._id)).toMatchObject({ revision: 1, updatedBy: AUTHOR, name: 'Mixed' });
        expect(goalRow(res.body.data._id).targets[2]).toEqual(expect.objectContaining({ name: 'Flag', kind: 'boolean' }));
    });

    it('folds everything that happens in five seconds into one read of the goals, and writes a goal once', async () => {
        const id = await counting({ sprintIds: [openList] });
        mockDb.calls.length = 0;
        for (let n = 0; n < 25; n += 1) goalEvents.onEnvelope(envelope('task.status_changed', { changedFields: ['statusType'] }));
        jest.advanceTimersByTime(goalEvents.FOLD_MS - 1);
        expect(goalEvents.FOLD_MS).toBe(5000);
        expect(mockDb.calls).toEqual([]);
        jest.advanceTimersByTime(1);
        await goalEvents.flushAll();
        expect(mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS && c.method === 'find')).toHaveLength(1);
        expect(goalWrites()).toHaveLength(1);
        expect(goalRow(id).revision).toBe(1);

        await heard(envelope('task.created'), envelope('task.created'));
        expect(goalWrites()).toHaveLength(1);
        expect(goalRow(id).revision).toBe(1);
    });

    it('moves the revision on, so a count that was under way is made again and the mark is not lost', async () => {
        const id = await counting({ sprintIds: [openList] });
        task(open, openList, { statusType: 'close' });
        after(10 * MINUTE);
        const original = mockDb.crud.getMockImplementation();
        let raced = false;
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            const answer = await original(companyId, query, method);
            if (!raced && method === 'aggregate' && query.type === SCHEMA_TYPE.TASKS) {
                raced = true;
                task(open, openList, { statusType: 'close' });
                await goalEvents.markDirty(C, [openList], []);
            }
            return answer;
        });
        await counts.refresh(C, id);
        mockDb.crud.mockImplementation(original);
        expect(goalRow(id).targets[0]).toMatchObject({ counted: { done: 2, total: 2 }, dirty: false });
    });

    it('is heard through the bus from the writers that announce a task, and counted on the next read', async () => {
        goalEvents.start();
        const moved = task(open, openList);
        const other = list(open, { name: 'Other' });
        const here = await counting({ sprintIds: [openList] });
        const there = await counting({ sprintIds: [other] }, { name: 'There' });
        expect(numbers(await read(here))).toEqual(counted(0, 1, 0));

        Object.assign(moved, { statusType: 'close' });
        socketEmitter.emit('update', { type: 'update', module: 'task', data: { ...moved }, updatedFields: { $set: { statusType: 'close', statusKey: 4 } } });
        jest.advanceTimersByTime(2000 + goalEvents.FOLD_MS);
        await goalEvents.flushAll();
        expect([dirtyOf(here), dirtyOf(there)]).toEqual([[true], [false]]);

        after(30 * SECOND);
        await read(here);
        await counts.idle();
        expect(numbers(await read(here))).toEqual(counted(1, 1, 100));

        Object.assign(moved, { sprintId: other });
        socketEmitter.emit('update', { type: 'update', module: 'task', data: { ...moved }, updatedFields: { sprintId: other } });
        jest.advanceTimersByTime(2000 + goalEvents.FOLD_MS);
        await goalEvents.flushAll();
        expect([dirtyOf(here), dirtyOf(there)]).toEqual([[true], [true]]);

        after(10 * MINUTE);
        await call(goals.listGoals, AUTHOR);
        await counts.idle();
        expect([numbers(await read(here)), numbers(await read(there))]).toEqual([counted(0, 0, 0), counted(1, 1, 100)]);
    });
});

describe('the stored row', () => {
    const { checkType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
    const Goal = mongoose.model('goal_count_fit', checkType(SCHEMA_TYPE.GOALS));
    const leaves = (value, path = '') => (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
        ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, path ? `${path}.${key}` : key))
        : [path]);
    const read_ = (value, path) => path.split('.').reduce((at, key) => (at == null ? undefined : at[key]), value);

    it('keeps every field a counted target is saved and counted with', async () => {
        const stale = list(project({ isPrivateSpace: true, AssigneeUserId: [AUTHOR] }));
        const named = taskId(open, openList, { statusType: 'close' });
        const id = await counting({ sprintIds: [openList, stale], taskIds: [named] });
        mockDb.store[SCHEMA_TYPE.SPRINTS].find((row) => String(row._id) === stale).deletedStatusKey = 1;
        after(10 * MINUTE);
        await counts.refresh(C, id);
        await goalEvents.markDirty(C, [openList], []);

        const [save] = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS && c.method === 'save');
        const written = [save.data.targets[0], ...goalWrites().map((c) => c.data[1].$set.targets[0])];
        expect(written).toHaveLength(3);
        expect(written[2]).toMatchObject({ dirty: true, counted: { done: 1, total: 1, skipped: { sprintIds: [stale], taskIds: [] } } });
        written.forEach((sent) => {
            const cast = new Goal({ name: 'N', ownerUserId: AUTHOR, visibility: 'private', targets: [sent] });
            expect(cast.validateSync() || null).toBeNull();
            const kept = cast.toObject({ minimize: false }).targets[0];
            expect(leaves(sent).filter((path) => read_(sent, path) !== undefined && JSON.stringify(read_(kept, path)) !== JSON.stringify(read_(sent, path)))).toEqual([]);
        });
    });

    it('declares the counted fields where the count writes them', () => {
        const declared = schema.goals.targets.type[0];
        expect(Object.keys(declared.sources)).toEqual(['sprintIds', 'taskIds']);
        expect(Object.keys(declared.counted)).toEqual(['done', 'total', 'at', 'skipped']);
        expect(Object.keys(declared.counted.skipped)).toEqual(['sprintIds', 'taskIds']);
        expect(declared.dirty.type).toBe(Boolean);
    });

    it('leaves a target that is not counted from tasks without those fields', () => {
        const cast = new Goal({ name: 'N', ownerUserId: AUTHOR, visibility: 'private', targets: [{ id: 't', name: 'T', kind: 'boolean', done: true }] });
        const kept = cast.toObject().targets[0];
        expect(['sources', 'counted', 'dirty'].filter((key) => key in kept)).toEqual([]);
    });

    it('is found by the mark\'s filter after the schema has cast it', () => {
        const filter = { deletedStatusKey: 0, targets: { $elemMatch: { kind: 'tasks', dirty: { $ne: true }, $or: [{ 'sources.sprintIds': { $in: [openList] } }, { 'sources.taskIds': { $in: ['6f00000000000000000000f1'] } }] } } };
        expect(Goal.find(filter).cast(Goal)).toEqual(filter);
    });
});
