const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const capacity = require('../Modules/CapacityPlanning/controller');
const grid = require('../Modules/TimeSheet/controller/workloadGrid');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MATE = 'a00000000000000000000002';
const SEES_EVERYONE = 'a00000000000000000000003';
const SEES_OWN = 'a00000000000000000000004';
const EVERYONE_ROLE = 3;
const OWN_ROLE = 5;
const PERMISSION_EVERYONE = 2;
const PERMISSION_OWN = 1;
const DAY = '2026-09-02';

const oid = () => new mongoose.Types.ObjectId().toString();

const send = async (handler, uid, { query = {}, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = res.json;
    await handler({ uid, aud: C, params: {}, body, query, headers: { companyid: C } }, res);
    return res;
};
const run = async (handler, uid, request) => {
    const res = await send(handler, uid, request);
    expect(res.statusCode).toBe(200);
    return res.body.data;
};

const seedRule = (section, key, permissions) => {
    const roles = (value) => [EVERYONE_ROLE, OWN_ROLE].map((role, index) => ({ key: role, permission: Array.isArray(value) ? value[index] : value }));
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: roles(true) });
    mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parent._id), roles: roles(permissions) });
};

let open;
let secret;
let list;
let sharedWork;
let closedDoorWork;
let errand;

const seedTask = (TaskName, project, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), TaskName, ProjectID: String(project._id), AssigneeUserId: [MATE], statusType: 'active', isParentTask: true, deletedStatusKey: 0, ...extra,
});
const plan = (UserId, task, EstimatedTime) => mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, {
    UserId, TaskId: String(task._id), ProjectId: task.ProjectID, Date: new Date(`${DAY}T00:00:00.000Z`), EstimatedTime,
});

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [MATE, EVERYONE_ROLE], [SEES_EVERYONE, EVERYONE_ROLE], [SEES_OWN, OWN_ROLE]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `User ${userId.slice(-1)}` });
    });
    seedRule('project', 'private_projects', 1);
    seedRule('sheet_settings', 'workload_timesheet', [PERMISSION_EVERYONE, PERMISSION_OWN]);
    mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Crew', assigneeUsersArray: [MATE] });

    open = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [] });
    secret = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Secret', isPrivateSpace: true, AssigneeUserId: [MATE] });
    list = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Errands', isPrivateSpace: true, isPersonal: true, personalOwner: MATE, AssigneeUserId: [MATE] });
    const shared = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Shared', projectId: String(open._id) });
    const closedDoor = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Closed door', projectId: String(open._id), private: true, AssigneeUserId: [MATE] });

    sharedWork = seedTask('Shared work', open, { sprintId: String(shared._id) });
    closedDoorWork = seedTask('Closed door work', open, { sprintId: String(closedDoor._id) });
    errand = seedTask('Errand', list);
    plan(MATE, sharedWork, 60);
    plan(MATE, closedDoorWork, 120);
    plan(MATE, seedTask('Secret work', secret), 240);
    plan(MATE, errand, 480);
    plan(SEES_OWN, sharedWork, 15);

    const due = { DueDate: new Date('2026-09-20T12:00:00.000Z'), points: 1 };
    seedTask('Shared later', open, { ...due, sprintId: String(shared._id), totalEstimatedTime: 60 });
    seedTask('Closed door later', open, { ...due, sprintId: String(closedDoor._id), totalEstimatedTime: 120 });
    seedTask('Secret later', secret, { ...due, totalEstimatedTime: 240 });
    seedTask('Errand later', list, { ...due, totalEstimatedTime: 480 });
});

const VIEWERS = [
    ['an owner, short of the personal list', OWNER, 7, 7],
    ['the person themselves', MATE, 15, 15],
    ['a member who sees everyone\'s workload, within the projects and sprints they can open', SEES_EVERYONE, 1, 1],
];

describe('the capacity plan', () => {
    const planFor = (uid) => run(capacity.getCapacityPlan, uid, { query: { from: '2026-09-01', to: '2026-09-05' } });
    const allocated = (data, userId) => (data.users.find((row) => row.userId === userId) || {}).allocatedHours;

    it.each(VIEWERS)('counts the planned hours %s', async (_who, uid, hours) => {
        expect(allocated(await planFor(uid), MATE)).toBe(hours);
    });

    it('shows a member who sees only their own workload their own row', async () => {
        const data = await planFor(SEES_OWN);
        expect(data.users.map((row) => row.userId)).toEqual([SEES_OWN]);
        expect(data.users[0].allocatedHours).toBe(0.25);
        expect(data.totals.users).toBe(1);
    });
});

describe('the capacity months', () => {
    const monthsFor = (uid) => run(capacity.getMonthlyCapacity, uid, { query: { from: '2026-09', to: '2026-09' } });
    const crew = (data) => data.teams.find((team) => team.name === 'Crew');

    it.each(VIEWERS)('counts the committed and pipeline hours %s', async (_who, uid, committed, pipeline) => {
        const cell = crew(await monthsFor(uid)).months['2026-09'];
        expect([cell.committedHours, cell.pipelineHours]).toEqual([committed, pipeline]);
    });

    it('shows a member who sees only their own workload their own hours and no one else\'s team', async () => {
        const data = await monthsFor(SEES_OWN);
        expect(crew(data)).toBeUndefined();
        expect(data.teams).toHaveLength(1);
        expect(data.teams[0]).toMatchObject({ unassigned: true, members: 1 });
        expect(data.teams[0].months['2026-09'].committedHours).toBe(0.3);
    });
});

describe('the workload grid', () => {
    const gridFor = (uid, body = {}) => run(grid.getWorkloadGrid, uid, { body: { start: DAY, end: DAY, userIds: [MATE], ...body } });
    const chipNames = (data, userId = MATE) => (data.users.find((row) => row.userId === userId) || { days: [] }).days
        .flatMap((day) => day.chips || []).map((chip) => chip.name).sort();

    it.each([
        ['an owner, short of the personal list', OWNER, ['Closed door work', 'Secret work', 'Shared work']],
        ['the person themselves', MATE, ['Closed door work', 'Errand', 'Secret work', 'Shared work']],
        ['a member who sees everyone\'s workload, within the projects and sprints they can open', SEES_EVERYONE, ['Shared work']],
    ])('shows the planned work %s', async (_who, uid, names) => {
        expect(chipNames(await gridFor(uid))).toEqual(names);
    });

    it('answers a member who sees only their own workload with their own row, whoever they ask for', async () => {
        const data = await gridFor(SEES_OWN);
        expect(data.users.map((row) => row.userId)).toEqual([SEES_OWN]);
        expect(chipNames(data, SEES_OWN)).toEqual(['Shared work']);
        expect(JSON.stringify(data)).not.toContain('Secret work');
    });

    it('does not widen to every project when the projects asked for are not the caller\'s to open', async () => {
        const data = await gridFor(SEES_EVERYONE, { projectIds: [String(secret._id), String(list._id)] });
        expect(chipNames(data)).toEqual([]);
    });

    it.each([
        ['an owner, short of the personal list', OWNER, 3],
        ['the person themselves', MATE, 4],
        ['a member who sees everyone\'s workload, within the projects and sprints they can open', SEES_EVERYONE, 1],
    ])('counts the open tasks, by task count, for %s', async (_who, uid, tasks) => {
        const data = await run(grid.getWorkloadGrid, uid, { body: { start: '2026-09-20', end: '2026-09-20', userIds: [MATE], unit: 'count' } });
        expect(data.users.find((row) => row.userId === MATE).totalLoad).toBe(tasks);
    });
});

describe('time off in capacity and the workload grid', () => {
    const OFF = '2026-09-03';
    beforeEach(() => {
        mockDb.seed(SCHEMA_TYPE.PTO_ENTRIES, { userId: MATE, status: 'approved', deletedStatusKey: 0, startDate: new Date(`${OFF}T00:00:00.000Z`), endDate: new Date(`${OFF}T00:00:00.000Z`), hoursPerDay: 8, reason: 'Dentist' });
    });
    const planRow = async (uid) => (await run(capacity.getCapacityPlan, uid, { query: { from: '2026-09-01', to: '2026-09-05' } })).users.find((row) => row.userId === MATE);
    const crewMonth = async (uid) => (await run(capacity.getMonthlyCapacity, uid, { query: { from: '2026-09', to: '2026-09' } })).teams.find((team) => team.name === 'Crew').months['2026-09'];
    const offDay = async (uid, unit = 'hours') => (await run(grid.getWorkloadGrid, uid, { body: { start: OFF, end: OFF, userIds: [MATE], unit } })).users.find((row) => row.userId === MATE).days[0];

    it.each([['an owner', OWNER], ['the person themselves', MATE]])('is named as time off to %s', async (_who, uid) => {
        expect(await planRow(uid)).toMatchObject({ ptoHours: 8, unavailableHours: 8, capacityHours: 24 });
        const month = await crewMonth(uid);
        expect(month).toMatchObject({ ptoHours: 8, unavailableHours: 8 });
        expect(month.notes).toEqual([expect.objectContaining({ userId: MATE, kind: 'pto', days: 1 })]);
        expect(await offDay(uid)).toMatchObject({ pto: true, capacityMinutes: 0 });
        expect(await offDay(uid, 'count')).toMatchObject({ pto: true, capacity: 0 });
    });

    it('reaches another member as unavailable time, with the same capacity and no reason', async () => {
        const row = await planRow(SEES_EVERYONE);
        expect(row).toMatchObject({ ptoHours: 0, unavailableHours: 8, capacityHours: 24 });
        const month = await crewMonth(SEES_EVERYONE);
        expect(month).toMatchObject({ ptoHours: 0, unavailableHours: 8, availableHours: (await crewMonth(OWNER)).availableHours });
        expect(month.notes).toEqual([expect.objectContaining({ userId: MATE, kind: 'unavailable', days: 1 })]);
        const day = await offDay(SEES_EVERYONE);
        expect(day).toMatchObject({ pto: false, unavailable: true, capacityMinutes: 0 });
        expect(await offDay(SEES_EVERYONE, 'count')).toMatchObject({ pto: false, unavailable: true, capacity: 0 });
        expect(JSON.stringify([row, month, day])).not.toContain('Dentist');
    });
});

describe('moving planned work', () => {
    const planOf = (userId, task) => mockDb.store[SCHEMA_TYPE.ESTIMATES_TIME].find((row) => row.UserId === userId && row.TaskId === String(task._id));
    const dayOf = (row) => row.Date.toISOString().slice(0, 10);
    const move = (uid, task, extra = {}) => send(grid.moveWorkloadChip, uid, {
        body: { taskId: String(task._id), fromUserId: uid, toUserId: uid, fromDate: DAY, toDate: '2026-09-04', ...extra },
    });

    it('moves a member\'s own plan on a task they can open', async () => {
        const res = await move(SEES_OWN, sharedWork);
        expect(res.statusCode).toBe(200);
        expect(dayOf(planOf(SEES_OWN, sharedWork))).toBe('2026-09-04');
    });

    it('answers 404 for a task in a private sprint the caller is not on, and moves nothing', async () => {
        plan(SEES_OWN, closedDoorWork, 30);
        const res = await move(SEES_OWN, closedDoorWork);
        expect(res.statusCode).toBe(404);
        expect(dayOf(planOf(SEES_OWN, closedDoorWork))).toBe(DAY);
        expect(mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === closedDoorWork._id).DueDate).toBeUndefined();
    });

    it('answers 404 to an owner for a task in a personal list that is someone else\'s', async () => {
        const res = await move(OWNER, errand, { fromUserId: MATE, toUserId: MATE });
        expect(res.statusCode).toBe(404);
        expect(dayOf(planOf(MATE, errand))).toBe(DAY);
    });

    it('moves only the plan of the task and person named, whatever plan id is sent', async () => {
        const res = await move(SEES_OWN, sharedWork, { estimateId: String(planOf(MATE, sharedWork)._id) });
        expect(res.statusCode).toBe(200);
        expect(dayOf(planOf(MATE, sharedWork))).toBe(DAY);
    });
});
