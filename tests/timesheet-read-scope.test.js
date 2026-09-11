const { matches } = require('./fixtures/fakeMongo');

const mockCrud = jest.fn(async () => []);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    evaluatePermission: jest.fn(),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));

const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const userSheet = require('../Modules/TimeSheet/controller/userTimeSheet');
const workloadSheet = require('../Modules/TimeSheet/controller/workloadTimeSheet');
const projectSheet = require('../Modules/TimeSheet/controller/projectTimeSheet');
const trackerSheet = require('../Modules/TimeSheet/controller/trackerTimeSheet');
const aggregateSheet = require('../Modules/TimeSheet/controller/getTimeSheetByAggregate');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const P2 = '6f0000000000000000000b02';

const LOGS = [
    { Loggeduser: ME, ProjectId: P1, LogStartTime: 100, LogEndTime: 160, LogTimeDuration: 60, logAddType: 1 },
    { Loggeduser: OTHER, ProjectId: P1, LogStartTime: 100, LogEndTime: 130, LogTimeDuration: 30, logAddType: 1 },
    { Loggeduser: OTHER, ProjectId: P2, LogStartTime: 100, LogEndTime: 220, LogTimeDuration: 120, logAddType: 1 },
];

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};

const forgedPrivilege = { companyUserDetail: { roleType: 1 } };
const ROUTES = [
    ['/timesheet/user', userSheet.getUserTimeSheet, 'sheet_settings.user_timesheet',
        { selectedFilter: [], userArray: [OTHER], projectArray: [], start: 0, end: 999, timeZone: 'UTC', ...forgedPrivilege }],
    ['/timesheet/workload', workloadSheet.getWorkloadTimeSheet, 'sheet_settings.workload_timesheet',
        { selectedFilter: [], userArray: [OTHER], projectArray: [], start: 0, end: 999, timeZone: 'UTC', ...forgedPrivilege }],
    ['/timesheet/project', projectSheet.getProjectTimeSheet, 'sheet_settings.project_timesheet',
        { filterProjectIds: [], filterUserIds: [OTHER], projectIds: [P1, P2], startNumber: 0, endNumber: 999000, timeZone: 'UTC', projectTimesheetPermission: true, userId: OTHER, ...forgedPrivilege }],
    ['/timesheet/tracker', trackerSheet.getTrackerTimeSheet, 'sheet_settings.tracker_timesheet',
        { selectedFilter: [], userArray: [OTHER], isEveryOne: true, start: 0, end: 999 }],
    ['/timesheet', aggregateSheet.getTimeSheetByAggregate, 'sheet_settings.workload_timesheet',
        { queryeta: [{ $match: {} }, { $group: { _id: '$Loggeduser', totalCount: { $sum: '$LogTimeDuration' } } }] }],
];

const call = async (handler, body, uid = ME) => {
    const r = res();
    await handler({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r);
    return r;
};

const rowsReadBy = () => {
    expect(mockCrud).toHaveBeenCalledTimes(1);
    const pipeline = mockCrud.mock.calls[0][1].data[0];
    return pipeline.filter((stage) => stage.$match).reduce((docs, stage) => docs.filter((d) => matches(d, stage.$match)), LOGS);
};

beforeEach(() => {
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([P1]);
});

describe.each(ROUTES)('16c %s', (route, handler, permissionKey, body) => {
    it('keeps an owner or admin company-wide', async () => {
        getRoleType.mockResolvedValue(2);
        evaluatePermission.mockResolvedValue(true);
        const r = await call(handler, body);
        expect(r.code).toBe(200);
        expect(rowsReadBy().some((d) => d.ProjectId === P2)).toBe(true);
    });

    it.each([[3, 1, 'a member with Own'], [3, null, 'a member with no access'], [0, 1, 'a guest']])(
        'limits roleType %s (permission %s, %s) to their own time whatever the body claims',
        async (roleType, permission) => {
            getRoleType.mockResolvedValue(roleType);
            evaluatePermission.mockResolvedValue(permission);
            const r = await call(handler, body);
            expect(r.code).toBe(200);
            const rows = rowsReadBy();
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.every((d) => d.Loggeduser === ME)).toBe(true);
        },
    );

    it('lets a member granted Everyone read other people only on projects they can open', async () => {
        getRoleType.mockResolvedValue(3);
        evaluatePermission.mockResolvedValue(2);
        await call(handler, body);
        const rows = rowsReadBy();
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, permissionKey);
        expect(rows.some((d) => d.Loggeduser === OTHER && d.ProjectId === P1)).toBe(true);
        expect(rows.some((d) => d.ProjectId === P2)).toBe(false);
    });

    it('reads nothing for someone who is not in the company', async () => {
        getRoleType.mockResolvedValue(null);
        evaluatePermission.mockResolvedValue(null);
        visibleProjectIds.mockResolvedValue([]);
        await call(handler, body);
        expect(rowsReadBy()).toHaveLength(0);
    });
});

describe('16c /timesheet query guard', () => {
    const lookup = (spec) => ({ queryeta: [{ $match: {} }, { $lookup: spec }, { $group: { _id: null } }] });
    const tasksLookup = { from: 'tasks', let: { t: '$TicketID' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$t'] } } }], as: 'matchedTasks' };

    it('limits a member\'s task join to the projects they can open', async () => {
        getRoleType.mockResolvedValue(3);
        evaluatePermission.mockResolvedValue(1);
        const r = await call(aggregateSheet.getTimeSheetByAggregate, lookup(tasksLookup));
        expect(r.code).toBe(200);
        const joined = mockCrud.mock.calls[0][1].data[0].find((stage) => stage.$lookup).$lookup;
        expect(joined.pipeline[0]).toEqual({ $match: { ProjectID: { $in: [P1] } } });
        expect(joined.pipeline.slice(1)).toEqual(tasksLookup.pipeline);
    });

    it.each([
        ['a join to another collection', lookup({ from: 'users', localField: 'Loggeduser', foreignField: '_id', as: 'u' })],
        ['a task join without a pipeline', lookup({ from: 'tasks', localField: 'TicketID', foreignField: '_id', as: 't' })],
        ['a join hidden in a facet', { queryeta: [{ $facet: { a: [{ $lookup: { from: 'company_users', pipeline: [], as: 'x' } }] } }] }],
    ])('refuses a member %s with 400', async (label, body) => {
        getRoleType.mockResolvedValue(3);
        evaluatePermission.mockResolvedValue(2);
        const r = await call(aggregateSheet.getTimeSheetByAggregate, body);
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it.each([
        ['a write stage', { queryeta: [{ $match: {} }, { $out: 'stolen' }] }],
        ['a merge stage', { queryeta: [{ $merge: { into: 'tasks' } }] }],
        ['a union', { queryeta: [{ $unionWith: 'users' }] }],
        ['server-side JavaScript', { queryeta: [{ $match: { $where: 'true' } }] }],
        ['a body that is not a pipeline', { queryeta: 'Loggeduser' }],
        ['a missing pipeline', {}],
    ])('refuses even an admin %s with 400', async (label, body) => {
        getRoleType.mockResolvedValue(1);
        evaluatePermission.mockResolvedValue(true);
        const r = await call(aggregateSheet.getTimeSheetByAggregate, body);
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('lets an admin join any collection in the company database', async () => {
        getRoleType.mockResolvedValue(1);
        evaluatePermission.mockResolvedValue(true);
        const r = await call(aggregateSheet.getTimeSheetByAggregate, lookup({ from: 'users', localField: 'Loggeduser', foreignField: '_id', as: 'u' }));
        expect(r.code).toBe(200);
    });
});
