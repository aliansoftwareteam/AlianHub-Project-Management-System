/* Task 045 slice 12: the workload grid measures load in hours, story points or open-task count,
   against a per-person capacity kept on the company membership. */
const { matchesLikeMongo, filterOf, oid } = require('./fixtures/storedForms');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 2),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../utils/companyMembers', () => ({ acceptedMemberIds: jest.fn(async (companyId, ids) => ids.map(String)) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const socketEmitter = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const U = require('../Modules/TimeSheet/helpers/workloadUnits');
const grid = require('../Modules/TimeSheet/controller/workloadGrid');
const { cleanViewSettings, DEFAULT_VIEW_SETTINGS } = require('../Modules/Project/helpers/viewSettings');

const C = '6f0000000000000000000c01';
const ANA = '6f0000000000000000000001';
const BEN = '6f0000000000000000000002';
const PROJECT = '6f0000000000000000000b01';
const T_SHARED = '6f0000000000000000000a01';
const T_PLANNED = '6f0000000000000000000a02';
const T_UNPOINTED = '6f0000000000000000000a03';
const T_DONE = '6f0000000000000000000a04';
const T_LATER = '6f0000000000000000000a05';
const T_SPLIT = '6f0000000000000000000a06';

const task = (id, fields) => ({ _id: oid(id), TaskName: id.slice(-3), ProjectID: oid(PROJECT), sprintId: oid('6f0000000000000000000f01'), deletedStatusKey: 0, statusType: 'default', ...fields });

let rows;
beforeEach(() => {
    jest.clearAllMocks();
    rows = {
        [SCHEMA_TYPE.TASKS]: [
            task(T_SHARED, { AssigneeUserId: [ANA, BEN], points: 8, DueDate: new Date('2026-09-02T23:59:59.999Z') }),
            task(T_PLANNED, { AssigneeUserId: [ANA], points: 3, DueDate: new Date('2026-10-20T00:00:00.000Z') }),
            task(T_UNPOINTED, { AssigneeUserId: [BEN], points: null, DueDate: new Date('2026-09-03T10:00:00.000Z') }),
            task(T_DONE, { AssigneeUserId: [ANA], points: 5, statusType: 'close', DueDate: new Date('2026-09-02T10:00:00.000Z') }),
            task(T_LATER, { AssigneeUserId: [ANA], points: 13, DueDate: new Date('2026-12-01T10:00:00.000Z') }),
            task(T_SPLIT, { AssigneeUserId: [ANA, BEN], points: 10, DueDate: new Date('2026-09-04T10:00:00.000Z') }),
        ],
        [SCHEMA_TYPE.ESTIMATES_TIME]: [
            { _id: oid('6f0000000000000000000e01'), UserId: ANA, TaskId: T_PLANNED, ProjectId: PROJECT, Date: new Date('2026-09-01T00:00:00.000Z'), EstimatedTime: 120 },
            { _id: oid('6f0000000000000000000e02'), UserId: ANA, TaskId: T_SPLIT, ProjectId: PROJECT, Date: new Date('2026-10-01T00:00:00.000Z'), EstimatedTime: 90 },
            { _id: oid('6f0000000000000000000e03'), UserId: BEN, TaskId: T_SPLIT, ProjectId: PROJECT, Date: new Date('2026-10-02T00:00:00.000Z'), EstimatedTime: 30 },
        ],
        [SCHEMA_TYPE.COMPANY_USERS]: [
            { _id: oid('6f0000000000000000000d01'), userId: ANA, workloadCapacity: { points: { value: 4, per: 'day' }, count: { value: 1, per: 'day' } } },
            { _id: oid('6f0000000000000000000d02'), userId: BEN },
        ],
    };
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        const list = rows[type] || [];
        if (method === 'aggregate') {
            const [pipeline] = data;
            const matched = list.filter(matchesLikeMongo(pipeline[0].$match));
            const groups = {};
            matched.forEach((r) => {
                const key = `${r.TaskId}|${r.UserId}`;
                groups[key] = groups[key] || { _id: { taskId: r.TaskId, userId: r.UserId }, minutes: 0 };
                groups[key].minutes += r.EstimatedTime;
            });
            return Object.values(groups);
        }
        if (method === 'find') return list.filter(matchesLikeMongo(filterOf(method, data)));
        if (method === 'findOne') return list.find(matchesLikeMongo(filterOf(method, data))) || null;
        if (method === 'findOneAndUpdate') return { ...list.find(matchesLikeMongo(data[0])), ...data[1].$set };
        return { acknowledged: true };
    });
});

const call = async (handler, body, uid = ANA) => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (answer) => { r.body = answer; return r; };
    await handler(verified({ headers: { companyid: C }, body, query: {}, params: {}, uid }), r);
    return r;
};
const WEEK = { start: '2026-08-31', end: '2026-09-06', userIds: [ANA, BEN], projectIds: [PROJECT], timeZone: 'UTC' };
const userOf = (r, uid) => r.body.data.users.find((u) => u.userId === uid);
const dayOf = (user, date) => user.days.find((d) => d.date === date);

describe('the unit and capacity rules', () => {
    test('an unknown unit is read as hours', () => {
        expect(U.unitOf('points')).toBe('points');
        expect(U.unitOf('count')).toBe('count');
        expect(U.unitOf('weeks')).toBe('hours');
        expect(U.unitOf(undefined)).toBe('hours');
    });

    test('capacity falls back to the defaults per unit', () => {
        expect(U.capacityOf(undefined)).toEqual(U.DEFAULT_CAPACITY);
        expect(U.capacityOf({ points: { value: 6, per: 'day' } })).toEqual({ points: { value: 6, per: 'day' }, count: U.DEFAULT_CAPACITY.count });
        expect(U.capacityOf({ points: { value: -1, per: 'year' } }).points).toEqual(U.DEFAULT_CAPACITY.points);
    });

    test('a capacity write names what is wrong with it', () => {
        expect(U.capacityProblem({ points: { value: 20, per: 'week' }, count: { value: 2, per: 'day' } })).toBeNull();
        expect(U.capacityProblem({ points: { value: 'lots', per: 'week' } })).toMatch(/points/);
        expect(U.capacityProblem({ count: { value: 3, per: 'month' } })).toMatch(/count/);
        expect(U.capacityProblem({ hours: { value: 3, per: 'day' } })).toMatch(/hours/);
        expect(U.capacityProblem([])).not.toBeNull();
    });

    test('a weekly capacity is spread over the working days', () => {
        expect(U.perDayAmount({ value: 10, per: 'week' }, 5)).toBe(2);
        expect(U.perDayAmount({ value: 3, per: 'day' }, 5)).toBe(3);
        expect(U.perDayAmount({ value: 10, per: 'week' }, 0)).toBe(2);
    });

    test('points split by planned hours, or evenly when nobody planned any', () => {
        expect(U.pointShares({ points: 8, AssigneeUserId: [ANA, BEN] }, {})).toEqual({ [ANA]: 4, [BEN]: 4 });
        expect(U.pointShares({ points: 10, AssigneeUserId: [ANA, BEN] }, { [ANA]: 90, [BEN]: 30 })).toEqual({ [ANA]: 7.5, [BEN]: 2.5 });
        expect(U.pointShares({ points: null, AssigneeUserId: [ANA] }, {})).toEqual({ [ANA]: 0 });
    });
});

describe('POST /api/v1/timesheet/workload-grid with a unit', () => {
    test('hours stay the default and echo the unit', async () => {
        const r = await call(grid.getWorkloadGrid, WEEK);
        expect(r.code).toBe(200);
        expect(r.body.data.unit).toBe('hours');
        expect(mockCrud.mock.calls.some(([, { type }]) => type === SCHEMA_TYPE.COMPANY_USERS)).toBe(false);
    });

    test('points sum each person\'s share of open tasks, on the due day or the planned day', async () => {
        const r = await call(grid.getWorkloadGrid, { ...WEEK, unit: 'points' });
        expect(r.code).toBe(200);
        expect(r.body.data.unit).toBe('points');
        const ana = userOf(r, ANA);
        const ben = userOf(r, BEN);
        expect(dayOf(ana, '2026-09-02').load).toBe(4);
        expect(dayOf(ben, '2026-09-02').load).toBe(4);
        expect(dayOf(ana, '2026-09-01').load).toBe(3);
        expect(dayOf(ana, '2026-09-04').load).toBe(7.5);
        expect(dayOf(ben, '2026-09-04').load).toBe(2.5);
        expect(ana.totalLoad).toBe(14.5);
        expect(ana.days.flatMap((d) => d.chips).map((c) => c.taskId)).not.toContain(T_DONE);
        expect(ana.days.flatMap((d) => d.chips).map((c) => c.taskId)).not.toContain(T_LATER);
    });

    test('tasks without points count as 0 and are reported', async () => {
        const r = await call(grid.getWorkloadGrid, { ...WEEK, unit: 'points' });
        const ben = userOf(r, BEN);
        expect(dayOf(ben, '2026-09-03').load).toBe(0);
        expect(dayOf(ben, '2026-09-03').chips.map((c) => c.taskId)).toEqual([T_UNPOINTED]);
        expect(ben.unpointed).toBe(1);
        expect(userOf(r, ANA).unpointed).toBe(0);
        expect(r.body.data.unpointed).toBe(1);
    });

    test('capacity comes from the membership, in the unit, and flags an over-full day', async () => {
        const r = await call(grid.getWorkloadGrid, { ...WEEK, unit: 'points' });
        const ana = userOf(r, ANA);
        const ben = userOf(r, BEN);
        expect(ana.capacityRule).toEqual({ value: 4, per: 'day' });
        expect(dayOf(ana, '2026-09-04').capacity).toBe(4);
        expect(dayOf(ana, '2026-09-04').over).toBe(true);
        expect(dayOf(ana, '2026-09-02').over).toBe(false);
        expect(dayOf(ana, '2026-09-05').capacity).toBe(0);
        expect(ben.capacityRule).toEqual(U.DEFAULT_CAPACITY.points);
        expect(dayOf(ben, '2026-09-02').capacity).toBe(U.DEFAULT_CAPACITY.points.value / 5);
    });

    test('count counts each open task once per person', async () => {
        const r = await call(grid.getWorkloadGrid, { ...WEEK, unit: 'count' });
        expect(r.body.data.unit).toBe('count');
        const ana = userOf(r, ANA);
        const ben = userOf(r, BEN);
        expect(ana.totalLoad).toBe(3);
        expect(ben.totalLoad).toBe(3);
        expect(dayOf(ana, '2026-09-02').over).toBe(false);
        expect(ana.capacityRule).toEqual({ value: 1, per: 'day' });
        expect(ana.utilizationPct).toBe(60);
    });

    test('an unknown unit falls back to hours', async () => {
        const r = await call(grid.getWorkloadGrid, { ...WEEK, unit: 'bananas' });
        expect(r.body.data.unit).toBe('hours');
    });
});

describe('PUT /api/v1/timesheet/workload-capacity', () => {
    const CAP = { points: { value: 12, per: 'week' }, count: { value: 2, per: 'day' } };

    test('saves the caller\'s own capacity on their membership in the session company', async () => {
        const r = await call(grid.saveWorkloadCapacity, CAP);
        expect(r.code).toBe(200);
        expect(r.body.data).toEqual(CAP);
        const write = mockCrud.mock.calls.find(([, { type }, method]) => type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOneAndUpdate');
        expect(write[0]).toBe(C);
        expect(write[1].data[0]).toEqual({ userId: ANA, isDelete: { $ne: true } });
        expect(write[1].data[1]).toEqual({ $set: { workloadCapacity: CAP } });
        expect(removeCache).toHaveBeenCalledWith(`company_users:${C}`);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'companyUsers', updatedFields: { workloadCapacity: CAP } }));
    });

    test('refuses a malformed capacity without writing', async () => {
        const r = await call(grid.saveWorkloadCapacity, { points: { value: -3, per: 'week' } });
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('the saved view keeps the workload unit', () => {
    test('defaults to hours and drops an unknown unit', () => {
        expect(DEFAULT_VIEW_SETTINGS.workloadUnit).toBe('hours');
        expect(cleanViewSettings({ workloadUnit: 'points' }).workloadUnit).toBe('points');
        expect(cleanViewSettings({ workloadUnit: 'count' }).workloadUnit).toBe('count');
        expect(cleanViewSettings({ workloadUnit: 'furlongs' }).workloadUnit).toBe('hours');
    });
});
