/* Task 046 A3: a whiteboard is kept on the server, one per list of a project. The scene is its cards
   (a card stands for a task and carries where it sits), a revision, who saved it last and a short history. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => require('./fixtures/taskListRules').taskListRules()) }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const rules = require('../Modules/Whiteboards/boardRules');
const store = require('../Modules/Whiteboards/boardStore');
const { relay, EVENT } = require('../socket/controller/whiteboardSocket');

const { BoardRefused, MAX_ELEMENTS, MAX_PATCH_BYTES, MAX_COORDINATE, MAX_SNAPSHOTS, SNAPSHOT_INTERVAL_MS, parsePatch, applyPatch } = rules;

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ANA = '6f0000000000000000000001';
const BEN = '6f0000000000000000000002';
const PROJECT = '6f0000000000000000000a01';
const LIST = '6f0000000000000000000b01';
const OTHER_LIST = '6f0000000000000000000b02';
const taskId = (n) => `6f00000000000000000${String(n).padStart(5, '0')}`;
const T1 = taskId(1);
const T2 = taskId(2);
const T3 = taskId(3);

const card = (id, task, x = 10, y = 20, extra = {}) => ({ id, type: 'task', taskId: task, x, y, ...extra });
const seedTask = (_id, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID: PROJECT, sprintId: LIST, TaskName: `Task ${_id.slice(-2)}`, TaskKey: `AP-${Number(_id.slice(-3))}`, deletedStatusKey: 0, ...doc });
const boards = () => mockDb.store[SCHEMA_TYPE.WHITEBOARDS] || [];
const key = { companyId: C, projectId: PROJECT, sprintId: LIST };
const save = (uid, patch, options = {}) => store.saveBoard({ ...key, uid, patch: parsePatch(patch), ...options });
const refusal = (fn) => {
    try { fn(); } catch (error) { if (error instanceof BoardRefused) return error.field; throw error; }
    return null;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    [T1, T2, T3].forEach((id) => seedTask(id));
});

describe('what a save may carry', () => {
    it('takes cards to add or move and cards to take off, against the revision it was made on', () => {
        expect(parsePatch({ baseRevision: 3, upsert: [card('a', T1, 10.4, 20.6, { z: 2 })], remove: ['b'] })).toEqual({
            baseRevision: 3,
            upsert: [{ id: 'a', type: 'task', taskId: T1, x: 10, y: 21, z: 2 }],
            remove: ['b'],
        });
        expect(parsePatch({ baseRevision: 0, upsert: [card('a', T1)] }).upsert[0].z).toBe(0);
    });

    it.each([
        ['body', []],
        ['body', { baseRevision: 0 }],
        ['baseRevision', { upsert: [card('a', T1)] }],
        ['baseRevision', { baseRevision: -1, upsert: [card('a', T1)] }],
        ['baseRevision', { baseRevision: '1', upsert: [card('a', T1)] }],
        ['elements', { baseRevision: 0, elements: [card('a', T1)] }],
        ['revision', { baseRevision: 0, revision: 9, upsert: [card('a', T1)] }],
        ['upsert', { baseRevision: 0, upsert: 'all' }],
        ['upsert', { baseRevision: 0, upsert: [card('a', T1), card('a', T2)] }],
        ['upsert', { baseRevision: 0, upsert: Array.from({ length: MAX_ELEMENTS + 1 }, (_, n) => card(`c${n}`, taskId(n))) }],
        ['upsert.id', { baseRevision: 0, upsert: [card('a b', T1)] }],
        ['upsert.id', { baseRevision: 0, upsert: [card('x'.repeat(41), T1)] }],
        ['upsert.type', { baseRevision: 0, upsert: [{ ...card('a', T1), type: 'image' }] }],
        ['upsert.taskId', { baseRevision: 0, upsert: [card('a', 'not-an-id')] }],
        ['upsert.taskId', { baseRevision: 0, upsert: [card('a', { $ne: null })] }],
        ['upsert.x', { baseRevision: 0, upsert: [card('a', T1, -1)] }],
        ['upsert.x', { baseRevision: 0, upsert: [card('a', T1, MAX_COORDINATE + 1)] }],
        ['upsert.y', { baseRevision: 0, upsert: [card('a', T1, 1, '20')] }],
        ['upsert.y', { baseRevision: 0, upsert: [card('a', T1, 1, Number.NaN)] }],
        ['upsert.z', { baseRevision: 0, upsert: [card('a', T1, 1, 1, { z: 1.5 })] }],
        ['upsert.text', { baseRevision: 0, upsert: [card('a', T1, 1, 1, { text: '<img src=x onerror=alert(1)>' })] }],
        ['upsert.src', { baseRevision: 0, upsert: [card('a', T1, 1, 1, { src: 'data:image/png;base64,AAAA' })] }],
        ['upsert.title', { baseRevision: 0, upsert: [card('a', T1, 1, 1, { title: 'Renamed from the board' })] }],
        ['remove', { baseRevision: 0, remove: 'a' }],
        ['remove', { baseRevision: 0, remove: ['a', { $gt: '' }] }],
    ])('refuses a bad %s', (field, body) => {
        expect(refusal(() => parsePatch(body))).toBe(field);
    });

    it('refuses a save larger than the byte limit, whatever it holds', () => {
        const body = { baseRevision: 0, upsert: [card('a', T1)], remove: ['x'.repeat(MAX_PATCH_BYTES)] };
        let caught;
        try { parsePatch(body); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(BoardRefused);
        expect({ field: caught.field, statusCode: caught.statusCode }).toEqual({ field: 'body', statusCode: 413 });
    });

    it('says its limits', () => {
        expect({ MAX_ELEMENTS, MAX_PATCH_BYTES, MAX_COORDINATE, MAX_SNAPSHOTS }).toEqual({ MAX_ELEMENTS: 2000, MAX_PATCH_BYTES: 512 * 1024, MAX_COORDINATE: 100000, MAX_SNAPSHOTS: 20 });
    });
});

describe('applying a save to the scene', () => {
    const scene = [{ id: 'a', type: 'task', taskId: T1, x: 1, y: 1, z: 0 }, { id: 'b', type: 'task', taskId: T2, x: 2, y: 2, z: 0 }];

    it('moves the cards it names, adds the new ones, takes off the removed ones and leaves the rest alone', () => {
        const next = applyPatch(scene, parsePatch({ baseRevision: 1, upsert: [card('a', T1, 50, 60), card('c', T3, 7, 8)], remove: ['b'] }));
        expect(next).toEqual([{ id: 'a', type: 'task', taskId: T1, x: 50, y: 60, z: 0 }, { id: 'c', type: 'task', taskId: T3, x: 7, y: 8, z: 0 }]);
        expect(scene[0]).toEqual({ id: 'a', type: 'task', taskId: T1, x: 1, y: 1, z: 0 });
    });

    it('keeps the task a card stands for: a move cannot point it at another task', () => {
        const next = applyPatch(scene, parsePatch({ baseRevision: 1, upsert: [card('a', T3, 9, 9)] }));
        expect(next[0]).toEqual({ id: 'a', type: 'task', taskId: T1, x: 9, y: 9, z: 0 });
    });

    it('keeps one card per task: a second card for a task moves the first', () => {
        const next = applyPatch(scene, parsePatch({ baseRevision: 1, upsert: [card('z', T2, 40, 40)] }));
        expect(next).toEqual([scene[0], { id: 'b', type: 'task', taskId: T2, x: 40, y: 40, z: 0 }]);
    });

    it('refuses to grow a board past its limit', () => {
        const full = Array.from({ length: MAX_ELEMENTS }, (_, n) => ({ id: `c${n}`, type: 'task', taskId: taskId(n + 10), x: 0, y: 0, z: 0 }));
        expect(refusal(() => applyPatch(full, parsePatch({ baseRevision: 1, upsert: [card('one-more', T1)] })))).toBe('upsert');
        expect(applyPatch(full, parsePatch({ baseRevision: 1, upsert: [card('one-more', T1)], remove: ['c0'] }))).toHaveLength(MAX_ELEMENTS);
    });
});

describe('saving a board', () => {
    it('makes the board on the first save, at revision 1, with who saved it and when', async () => {
        const now = new Date('2026-10-01T10:00:00Z');
        const result = await save(ANA, { baseRevision: 0, upsert: [card('a', T1, 100, 200)] }, { now });
        expect(result).toMatchObject({ saved: true, board: { revision: 1, updatedBy: ANA, elements: [{ id: 'a', type: 'task', taskId: T1, x: 100, y: 200, z: 0 }] } });
        expect(boards()).toHaveLength(1);
        expect(boards()[0]).toMatchObject({ revision: 1, createdBy: ANA, updatedBy: ANA, savedAt: now, deletedStatusKey: 0 });
        expect([String(boards()[0].projectId), String(boards()[0].sprintId)]).toEqual([PROJECT, LIST]);
        expect((await store.readBoard(C, PROJECT, LIST)).revision).toBe(1);
        expect(await store.readBoard(C, PROJECT, OTHER_LIST)).toBeNull();
    });

    it('applies a save made on the current revision and moves the revision on by one', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        const result = await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 300, 300)], remove: ['b'] });
        expect(result.board).toMatchObject({ revision: 2, elements: [{ id: 'a', x: 300, y: 300 }] });
        expect(boards()[0].elements).toHaveLength(1);
    });

    it('answers a save made on an older revision with the board as it is now, and writes nothing', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        await save(BEN, { baseRevision: 1, upsert: [card('b', T2, 500, 500)] });
        const stale = await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 900, 900)] });
        expect(stale).toMatchObject({ conflict: true, board: { revision: 2 } });
        expect(stale.saved).toBeUndefined();
        expect(boards()[0].elements.map((e) => [e.id, e.x])).toEqual([['a', 10], ['b', 500]]);
    });

    it('lets the stale save go in on top once it is made on the current revision: each card keeps its last writer', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        await save(BEN, { baseRevision: 1, upsert: [card('b', T2, 500, 500)] });
        const { board } = await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 900, 900)] });
        const again = await save(ANA, { baseRevision: board.revision, upsert: [card('a', T1, 900, 900)] });
        expect(again.board.elements.map((e) => [e.id, e.x])).toEqual([['a', 900], ['b', 500]]);
        expect(again.board).toMatchObject({ revision: 3, updatedBy: ANA });
    });

    it('answers a first save with the existing board when someone else made it first', async () => {
        await save(BEN, { baseRevision: 0, upsert: [card('b', T2)] });
        const late = await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        expect(late).toMatchObject({ conflict: true, board: { revision: 1, elements: [{ id: 'b' }] } });
        expect(boards()).toHaveLength(1);
    });

    it('holds each write to the revision it read, so two saves racing on one revision cannot both land', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        mockDb.calls.length = 0;
        await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 5, 5)] });
        const write = mockDb.calls.find((c) => c.type === SCHEMA_TYPE.WHITEBOARDS && c.method === 'findOneAndUpdate');
        expect(write.data[0]).toMatchObject({ revision: 1, deletedStatusKey: 0 });
        expect(write.data[1].$set.revision).toBe(2);
    });

    it('leaves out a new card for a task that is not in this list, is deleted, or that the writer may not open', async () => {
        seedTask(taskId(40), { sprintId: OTHER_LIST });
        seedTask(taskId(41), { deletedStatusKey: 1 });
        for (const id of [taskId(40), taskId(41), taskId(99)]) {
            expect(await save(ANA, { baseRevision: 0, upsert: [card('x', id)] })).toEqual({ saved: true, board: null });
        }
        expect(await save(ANA, { baseRevision: 0, upsert: [card('x', T1)] }, { admits: () => false })).toEqual({ saved: true, board: null });
        expect(boards()).toEqual([]);

        const mixed = await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('x', taskId(40)), card('y', T2)] }, { admits: (task) => String(task._id) !== T2 });
        expect(mixed.board.elements.map((element) => element.id)).toEqual(['a']);
    });

    it('keeps a card that is already on the board when the writer may not open its task', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        const { board } = await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 5, 5)] }, { admits: (task) => String(task._id) !== T2 });
        expect(board.elements.map((element) => element.id)).toEqual(['a', 'b']);
    });

    it('writes nothing, and tells nobody, when a save leaves the board as it was', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1, 7, 7)] });
        socketEmitter.emit.mockClear();
        const same = await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 7, 7), card('x', taskId(99))] });
        expect(same).toMatchObject({ saved: true, board: { revision: 1, updatedBy: ANA } });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('drops the cards whose task has left the list when the next save is written', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] });
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === T2).sprintId = OTHER_LIST;
        const { board } = await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 5, 5)] });
        expect(board.elements.map((e) => e.id)).toEqual(['a']);
    });

    it('reads and writes inside the company it is given', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        await store.readBoard(C, PROJECT, LIST);
        await store.listHistory(C, PROJECT, LIST);
        expect(mockDb.calls.length).toBeGreaterThan(3);
        expect(mockDb.calls.filter((c) => c.companyId !== C)).toEqual([]);
        expect(OTHER_COMPANY).not.toBe(C);
    });
});

describe('earlier states of a board', () => {
    const at = (minutes) => new Date(Date.UTC(2026, 9, 1, 10, minutes));
    const history = () => store.listHistory(C, PROJECT, LIST);

    it('keeps the state a save replaces when someone else wrote it', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] }, { now: at(0) });
        await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 70, 70)] }, { now: at(1) });
        expect(await history()).toEqual([{ revision: 1, savedBy: ANA, savedAt: at(0), cards: 1, reason: 'author' }]);
    });

    it('does not keep every small move by the same person, only one state per interval', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2), card('c', T3)] }, { now: at(0) });
        await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 11, 11)] }, { now: at(1) });
        await save(ANA, { baseRevision: 2, upsert: [card('a', T1, 12, 12)] }, { now: at(2) });
        expect((await history()).map((entry) => [entry.revision, entry.reason])).toEqual([[1, 'interval']]);
        const later = new Date(at(1).getTime() + SNAPSHOT_INTERVAL_MS + 1000);
        await save(ANA, { baseRevision: 3, upsert: [card('a', T1, 13, 13)] }, { now: later });
        expect((await history()).map((entry) => [entry.revision, entry.reason])).toEqual([[3, 'interval'], [1, 'interval']]);
    });

    it('keeps the state before a save that rearranges most of the board', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2), card('c', T3)] }, { now: at(0) });
        await save(ANA, { baseRevision: 1, upsert: [card('a', T1, 11, 11)] }, { now: at(1) });
        await save(ANA, { baseRevision: 2, upsert: [card('a', T1, 0, 0), card('b', T2, 0, 0), card('c', T3, 0, 0)] }, { now: at(2) });
        expect((await history()).map((entry) => [entry.revision, entry.reason])).toEqual([[2, 'bulk'], [1, 'interval']]);
    });

    it('keeps no more than the last few states', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] }, { now: at(0) });
        for (let n = 1; n <= MAX_SNAPSHOTS + 5; n += 1) {
            await save(n % 2 ? BEN : ANA, { baseRevision: n, upsert: [card('a', T1, n, n)] }, { now: at(n) });
        }
        const kept = await history();
        expect(kept).toHaveLength(MAX_SNAPSHOTS);
        expect(kept[0].revision).toBe(MAX_SNAPSHOTS + 5);
        expect(kept[kept.length - 1].revision).toBe(6);
    });

    it('restores an earlier state as a new revision, keeping the state it replaces', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1, 1, 1), card('b', T2, 2, 2)] }, { now: at(0) });
        await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 800, 800)], remove: ['b'] }, { now: at(1) });
        const restored = await store.restoreBoard({ ...key, uid: ANA, revision: 1, now: at(2) });
        expect(restored).toMatchObject({ saved: true, board: { revision: 3, updatedBy: ANA } });
        expect(restored.board.elements.map((e) => [e.id, e.x])).toEqual([['a', 1], ['b', 2]]);
        expect((await history()).map((entry) => [entry.revision, entry.reason, entry.savedBy])).toEqual([[2, 'restore', BEN], [1, 'author', ANA]]);
    });

    it('restores only the cards whose task is still in the list', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1), card('b', T2)] }, { now: at(0) });
        await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 9, 9)] }, { now: at(1) });
        mockDb.store[SCHEMA_TYPE.TASKS].find((t) => t._id === T2).deletedStatusKey = 1;
        const restored = await store.restoreBoard({ ...key, uid: ANA, revision: 1, now: at(2) });
        expect(restored.board.elements.map((e) => e.id)).toEqual(['a']);
    });

    it('says so when the state asked for is not kept', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        expect(await store.restoreBoard({ ...key, uid: ANA, revision: 7 })).toEqual({ missing: true });
        expect(await store.restoreBoard({ companyId: C, projectId: PROJECT, sprintId: OTHER_LIST, uid: ANA, revision: 1 })).toEqual({ missing: true });
        expect(boards()[0].revision).toBe(1);
    });
});

describe('the change relay', () => {
    const ROOM = `project_sprint_${PROJECT}_${LIST}`;
    const join = (prefix, socketId, { companyId = C, inRoom = true } = {}) => {
        const emit = jest.fn();
        const roomName = `${prefix}**${socketId}`;
        const socket = { id: socketId, rooms: new Set(inRoom ? [roomName] : []), identity: { companyId, uid: ANA } };
        helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
        return emit;
    };
    const change = { type: 'update', module: 'whiteboards', companyId: C, projectId: PROJECT, sprintId: LIST, boardId: 'board-1', revision: 4, elements: [card('a', T1)], updatedBy: ANA };

    beforeEach(() => {
        require('../Config/config').myCache.flushAll();
        require('../socket/roomAccess').forgetVerdicts();
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ANA, roleType: 1, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: new mongoose.Types.ObjectId(PROJECT), ProjectName: 'Team', isPrivateSpace: false, AssigneeUserId: [ANA] });
        [LIST, OTHER_LIST].forEach((id) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: new mongoose.Types.ObjectId(id), projectId: PROJECT, private: false, AssigneeUserId: [] }));
    });

    it('tells the people who have the list open that the board changed: its id and revision, and nothing of what is on it', async () => {
        const watching = join(ROOM, 's1');
        await relay(change);
        expect(watching).toHaveBeenCalledTimes(1);
        expect(watching).toHaveBeenCalledWith(EVENT, { boardId: 'board-1', revision: 4 });
    });

    it('reaches no other list, no other company, and no socket that has left the room', async () => {
        const otherList = join(`project_sprint_${PROJECT}_${OTHER_LIST}`, 's2');
        const otherCompany = join(ROOM, 's3', { companyId: OTHER_COMPANY });
        const left = join(ROOM, 's4', { inRoom: false });
        await relay(change);
        await relay({ ...change, companyId: '' });
        await relay(undefined);
        [otherList, otherCompany, left].forEach((emit) => expect(emit).not.toHaveBeenCalled());
    });

    it('reaches nobody who can no longer open the list', async () => {
        const watching = join(ROOM, 's5');
        mockDb.store[SCHEMA_TYPE.SPRINTS].forEach((row) => Object.assign(row, { private: true, AssigneeUserId: [BEN] }));
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS][0].roleType = 3;
        await relay(change);
        expect(watching).not.toHaveBeenCalled();
    });

    it('is fed by every save and restore', async () => {
        const saved = await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 3, 3)] });
        await store.restoreBoard({ ...key, uid: ANA, revision: 1 });
        const sent = socketEmitter.emit.mock.calls.filter(([, payload]) => payload.module === 'whiteboards');
        expect(sent.map(([event, payload]) => [event, payload.revision])).toEqual([['update', 1], ['update', 2], ['update', 3]]);
        expect(sent[0][1]).toEqual({ type: 'update', module: 'whiteboards', companyId: C, projectId: PROJECT, sprintId: LIST, boardId: String(saved.board._id), revision: 1 });
    });

    it('is not fed by a save that was refused or answered with a conflict', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        socketEmitter.emit.mockClear();
        await save(BEN, { baseRevision: 0, upsert: [card('b', T2)] });
        const full = Array.from({ length: MAX_ELEMENTS }, (_, n) => card(`c${n}`, taskId(n + 100)));
        await expect(save(BEN, { baseRevision: 1, upsert: full })).rejects.toBeInstanceOf(BoardRefused);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('is named whiteboardChanged, listens for board updates and is loaded with the socket server', () => {
        expect(EVENT).toBe('whiteboardChanged');
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'socketinit.js'), 'utf8');
        expect(source).toMatch(/require\('\.\/controller\/whiteboardSocket'\)/);
        const controller = require('fs').readFileSync(require('path').join(__dirname, '..', 'socket', 'controller', 'whiteboardSocket.js'), 'utf8');
        expect(controller).toMatch(/whiteboards:update/);
    });
});

describe('the stored row', () => {
    it('declares every field a save writes, so the strict schema keeps them', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1, 5, 6, { z: 3 })] }, { now: new Date('2026-10-01T10:00:00Z') });
        await save(BEN, { baseRevision: 1, upsert: [card('a', T1, 7, 8)] }, { now: new Date('2026-10-01T10:01:00Z') });
        const [doc] = boards();
        const declared = Object.keys(schema.whiteboards);
        expect(Object.keys(doc).filter((field) => !['_id', 'createdAt', 'updatedAt'].includes(field) && !declared.includes(field))).toEqual([]);
        const Model = mongoose.models.WhiteboardShape || mongoose.model('WhiteboardShape', new mongoose.Schema(schema.whiteboards, { strict: true }));
        const kept = new Model(doc).toObject();
        expect(kept.elements).toEqual(doc.elements);
        expect(kept.history).toEqual(doc.history);
        expect(kept).toMatchObject({ revision: 2, updatedBy: BEN, createdBy: ANA, savedAt: doc.savedAt, historyKeptAt: doc.historyKeptAt, deletedStatusKey: 0 });
        expect([String(kept.projectId), String(kept.sprintId)]).toEqual([PROJECT, LIST]);
    });

    it('is a strict collection of its own with one live board per list', () => {
        expect(SCHEMA_TYPE.WHITEBOARDS).toBe('whiteboards');
        expect(dbCollections.WHITEBOARDS).toBe('whiteboards');
        expect(createSchema.whiteboardsSchema.options.strict).toBe(true);
        expect(createSchema.whiteboardsSchema.indexes()).toContainEqual([
            { projectId: 1, sprintId: 1 },
            expect.objectContaining({ unique: true, partialFilterExpression: { deletedStatusKey: 0 } }),
        ]);
    });

    it('never reads the history along with the board', async () => {
        await save(ANA, { baseRevision: 0, upsert: [card('a', T1)] });
        mockDb.calls.length = 0;
        await store.readBoard(C, PROJECT, LIST);
        const [read] = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.WHITEBOARDS);
        expect(read.data[1]).toEqual({ history: 0 });
    });
});
