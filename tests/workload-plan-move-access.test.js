const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ createNotificationsBody: jest.fn() }));
jest.mock('../Modules/service.js', () => jest.fn());

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { requireTaskActionPermission } = require('../Config/permissionGuard');
const grid = require('../Modules/TimeSheet/controller/workloadGrid');
const pto = require('../Modules/Pto/controller');
const { requireMovedTaskFields } = require('../Modules/TimeSheet/helpers/planMoveAccess');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, P_OPEN, P_PRIVATE, P_PERSONAL, OPENS, settle } = world;
const { seed, rows, task, setRule } = world.create(mockDb);

const DAY = '2026-09-02';
const NEXT_DAY = '2026-09-03';
const STRANGER = '6f00000000000000000000ff';
const MOVE = [requireMovedTaskFields, grid.moveWorkloadChip];
const session = (uid) => ({ uid });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid } });

const through = (handlers, caller, { body = {}, query = {}, route = '/api/v1/timesheet/workload-move', method = 'POST' } = {}) => new Promise((resolve) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.send = res.json;
    const req = { ...caller, method, originalUrl: route, baseUrl: '', route: { path: route }, params: {}, query, headers: { companyid: CID }, aud: CID, body };
    const step = (at) => (at === handlers.length ? resolve({ code: 'passed' }) : Promise.resolve(handlers[at](req, res, () => step(at + 1))));
    step(0);
}).then(async (result) => { await settle(); return result; });

const plan = (UserId, taskId, ProjectId) => mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { UserId, TaskId: taskId, ProjectId, Date: new Date(`${DAY}T00:00:00.000Z`), EstimatedTime: 60 });
const planOf = (UserId, taskId) => rows(SCHEMA_TYPE.ESTIMATES_TIME).find((row) => row.TaskId === taskId && row.UserId === UserId);
const dayOf = (row) => row.Date.toISOString().slice(0, 10);
const toNextDay = (uid, taskId) => ({ body: { taskId, fromUserId: uid, toUserId: uid, fromDate: DAY, toDate: NEXT_DAY } });
const toPerson = (taskId, fromUserId, toUserId) => ({ body: { taskId, fromUserId, toUserId, fromDate: DAY, toDate: DAY } });
const snapshot = () => JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.ESTIMATES_TIME)]);

beforeEach(() => {
    delete process.env.PERMISSION_ENFORCEMENT_MODE;
    seed();
    [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST].forEach((uid) => plan(uid, T_OPEN, P_OPEN));
    plan(INSIDER, T_PRIVATE, P_PRIVATE);
    plan(INSIDER, T_PERSONAL, P_PERSONAL);
    plan(OUTSIDER, T_SECRET, P_OPEN);
});
afterAll(() => { delete process.env.PERMISSION_ENFORCEMENT_MODE; });

describe('moving planned work to another day', () => {
    it.each([
        ['an owner', OWNER],
        ['an admin', ADMIN],
        ['a member', INSIDER],
        ['a guest', GUEST],
    ])('moves the plan of %s and the task\'s due date with it', async (label, uid) => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';

        const answer = await through(MOVE, session(uid), toNextDay(uid, T_OPEN));

        expect(answer.code).toBe(200);
        expect(dayOf(planOf(uid, T_OPEN))).toBe(NEXT_DAY);
        expect(task(T_OPEN).DueDate.toISOString().slice(0, 10)).toBe(NEXT_DAY);
    });

    it.each([
        ['a member', INSIDER],
        ['a guest', GUEST],
    ])('is refused to %s whose role may not change a due date, and moves nothing', async (label, uid) => {
        process.env.PERMISSION_ENFORCEMENT_MODE = 'enforce';
        setRule('task_due_date', false);
        const before = snapshot();

        const answer = await through(MOVE, session(uid), toNextDay(uid, T_OPEN));

        expect(answer.code).toBe(403);
        expect(answer.body.permission).toBe('task.task_due_date');
        expect(snapshot()).toBe(before);
    });

    it.each([
        ['a signed-in member where permissions are not enforced', session(INSIDER), undefined],
        ['a signed-in member where they are enforced', session(INSIDER), 'enforce'],
        ['a personal token where permissions are not enforced', personalToken(INSIDER), undefined],
        ['an owner', session(OWNER), 'enforce'],
    ])('answers %s as the due date change on the task itself does', async (label, caller, mode) => {
        if (mode) process.env.PERMISSION_ENFORCEMENT_MODE = mode;
        setRule('task_due_date', false);
        const onTheTask = { body: { action: 'updateDueDate', firebaseObj: { DueDate: `${NEXT_DAY}T00:00:00.000Z` }, project: {}, task: { _id: T_OPEN }, obj: {} }, route: '/api/v2/tasks', method: 'PATCH' };

        const taskRoute = await through([requireTaskActionPermission()], caller, onTheTask);
        const planRoute = await through([requireMovedTaskFields], caller, toNextDay(caller.uid, T_OPEN));

        expect(planRoute.code).toBe(taskRoute.code);
    });

    it.each([
        ['a task on a list the caller is not on', OUTSIDER, T_SECRET],
        ['a task on another person\'s personal list', OWNER, T_PERSONAL],
        ['a task in a project the caller cannot open', OUTSIDER, T_PRIVATE],
    ])('answers not found for %s', async (label, uid, taskId) => {
        const before = snapshot();

        expect((await through(MOVE, session(uid), toNextDay(uid, taskId))).code).toBe(404);
        expect(snapshot()).toBe(before);
    });

    it.each(['off', 'enforce'].flatMap((mode) => [
        ['an owner', OWNER],
        ['an admin', ADMIN],
        ['a member on the private work', INSIDER],
        ['a member outside it', OUTSIDER],
        ['a guest', GUEST],
    ].map(([label, uid]) => [label, mode, uid])))('moves the own plan of %s, with permission enforcement %s, only on a task that person can open', async (label, mode, uid) => {
        process.env.PERMISSION_ENFORCEMENT_MODE = mode;

        for (const taskId of [T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL]) {
            if (!planOf(uid, taskId)) plan(uid, taskId, String(task(taskId).ProjectID));
            const before = snapshot();

            const answer = await through(MOVE, session(uid), toNextDay(uid, taskId));

            if (OPENS[uid].includes(taskId)) {
                expect([taskId, answer.code, dayOf(planOf(uid, taskId))]).toEqual([taskId, 200, NEXT_DAY]);
            } else {
                expect([taskId, answer.code]).toEqual([taskId, 404]);
                expect(snapshot()).toBe(before);
            }
        }
    });
});

describe('moving planned work to another person', () => {
    it('puts a person who can open the task\'s project on the task', async () => {
        const answer = await through(MOVE, session(ADMIN), toPerson(T_PRIVATE, INSIDER, OWNER));

        expect(answer.code).toBe(200);
        expect(task(T_PRIVATE).AssigneeUserId).toEqual([OWNER]);
        expect(planOf(OWNER, T_PRIVATE)).toBeDefined();
    });

    it.each([
        ['a member who cannot open the task\'s project', OUTSIDER],
        ['a guest who cannot open it', GUEST],
        ['someone who is not a member', STRANGER],
    ])('refuses %s, and moves nothing', async (label, toUserId) => {
        const before = snapshot();

        const answer = await through(MOVE, session(OWNER), toPerson(T_PRIVATE, INSIDER, toUserId));

        expect(answer.code).toBe(400);
        expect(snapshot()).toBe(before);
    });

    it('stays with owners and admins', async () => {
        expect((await through(MOVE, session(INSIDER), toPerson(T_OPEN, INSIDER, OUTSIDER))).code).toBe(403);
    });
});

describe('the route', () => {
    it('judges the task fields before the plan is moved', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules/TimeSheet/routes.js'), 'utf8');

        expect(routes).toMatch(/'\/api\/v1\/timesheet\/workload-move', requireMovedTaskFields, gridctrl\.moveWorkloadChip\)/);
    });
});

describe('the time off a calendar names', () => {
    const list = (uid) => through([pto.listPto], session(uid), { query: { status: 'approved', from: '2026-09-01', to: '2026-09-30', pageSize: '50' }, route: '/api/v1/pto', method: 'GET' });
    const names = (answer) => answer.body.data.map((row) => row.userName).sort();

    beforeEach(() => {
        [INSIDER, OUTSIDER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.PTO_ENTRIES, {
            userId, status: 'approved', type: 'vacation', startDate: new Date('2026-09-10T00:00:00.000Z'), endDate: new Date('2026-09-11T00:00:00.000Z'), deletedStatusKey: 0,
        }));
    });

    it.each([
        ['an owner', OWNER, ['Ian Insider', 'Mia Member']],
        ['an admin', ADMIN, ['Ian Insider', 'Mia Member']],
        ['the person themselves', INSIDER, ['Ian Insider']],
        ['another member', OUTSIDER, ['Mia Member']],
        ['a guest', GUEST, []],
    ])('is, for %s, what that person is told about', async (label, uid, expected) => {
        const answer = await list(uid);

        expect(answer.code).toBe(200);
        expect(names(answer)).toEqual(expected);
        expect(answer.body.total).toBe(expected.length);
    });

    it('is the caller\'s own whoever a member asks for', async () => {
        const answer = await through([pto.listPto], session(OUTSIDER), { query: { status: 'approved', userId: INSIDER, search: 'Ian' }, route: '/api/v1/pto', method: 'GET' });

        expect(names(answer)).toEqual(['Mia Member']);
    });
});
