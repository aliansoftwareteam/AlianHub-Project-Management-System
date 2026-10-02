const mongoose = require('mongoose');
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
jest.mock('../Modules/PersonalList/ownership', () => ({ ...jest.requireActual('../Modules/PersonalList/ownership'), othersPersonalListIds: jest.fn(async () => []) }));
jest.mock('../Modules/Agents/privateWork', () => ({
    ...jest.requireActual('../Modules/Agents/privateWork'),
    privateWorkOf: jest.fn(async (companyId, uid) => ({ uid: String(uid), personalLists: ['6f0000000000000000000b09'], directSpaces: ['6f0000000000000000000b08'], myChats: ['6f0000000000000000000a08'], myRuns: [] })),
}));

const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { othersPersonalListIds } = require('../Modules/PersonalList/ownership');
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
    ['/timesheet', aggregateSheet.getTimeSheetByAggregate, 'sheet_settings.tracker_timesheet',
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
        expect(joined.pipeline[0]).toEqual({ $match: { ProjectID: { $in: [new mongoose.Types.ObjectId(P1), P1] } } });
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

    it.each(['users', 'comments', 'company_users', 'timesheets', 'apiTokens', 'webhooks', 'secrets', 'folders', 'sprints'])(
        'an owner or admin joins tasks, and folders and sprints from inside that join: %s at the top is a 400', async (from) => {
            getRoleType.mockResolvedValue(1);
            evaluatePermission.mockResolvedValue(true);
            const r = await call(aggregateSheet.getTimeSheetByAggregate, lookup({ from, pipeline: [], as: 'rows' }));
            expect(r.code).toBe(400);
            expect(mockCrud).not.toHaveBeenCalled();
        });

    describe('an owner\'s or admin\'s join into tasks', () => {
        const PERSONAL_LIST = '6f0000000000000000000b09';
        const DIRECT_SPACE = '6f0000000000000000000b08';
        const joinOf = async (body, at = (pipeline) => pipeline.find((stage) => stage.$lookup).$lookup) => {
            getRoleType.mockResolvedValue(2);
            evaluatePermission.mockResolvedValue(true);
            const r = await call(aggregateSheet.getTimeSheetByAggregate, body);
            expect(r.code).toBe(200);
            return at(mockCrud.mock.calls[0][1].data[0]);
        };
        const reads = (joined, doc) => matches(doc, joined.pipeline[0].$match);

        const TASKS = [
            [{ ProjectID: P1 }, true],
            [{ ProjectID: PERSONAL_LIST }, false],
            [{ ProjectID: new mongoose.Types.ObjectId(PERSONAL_LIST) }, false],
            [{ ProjectID: DIRECT_SPACE, mainChat: true, AssigneeUserId: [OTHER] }, false],
            [{ ProjectID: DIRECT_SPACE, mainChat: true, AssigneeUserId: [ME, OTHER] }, true],
        ];
        it.each([
            ['with a pipeline', { from: 'tasks', let: { t: '$TicketID' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$t'] } } }], as: 't' }],
            ['on a local and a foreign field', { from: 'tasks', localField: 'TicketID', foreignField: '_id', as: 't' }],
        ])('tasks, %s: the join starts by leaving out other people\'s personal lists and chats', async (label, spec) => {
            const joined = await joinOf(lookup(spec));
            TASKS.forEach(([doc, expected]) => expect([doc, reads(joined, doc)]).toEqual([doc, expected]));
            expect(joined.pipeline.slice(1)).toEqual(spec.pipeline || []);
            expect(joined).toMatchObject({ from: 'tasks', as: 't', ...(spec.localField ? { localField: 'TicketID', foreignField: '_id' } : { let: spec.let }) });
        });

        it('is narrowed wherever it sits: inside a facet, and for the folders and sprints joined from inside it', async () => {
            const faceted = await joinOf({ queryeta: [{ $facet: { a: [{ $lookup: { from: 'tasks', localField: 'TicketID', foreignField: '_id', as: 't' } }] } }] },
                (pipeline) => pipeline.find((stage) => stage.$facet).$facet.a[0].$lookup);
            expect(reads(faceted, { ProjectID: PERSONAL_LIST })).toBe(false);

            mockCrud.mockClear();
            othersPersonalListIds.mockResolvedValueOnce([PERSONAL_LIST]);
            const nested = { from: 'tasks', as: 't', pipeline: [{ $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 's' } }] };
            const tasks = await joinOf(lookup(nested));
            const sprints = tasks.pipeline.find((stage) => stage.$lookup).$lookup;
            expect(reads(sprints, { projectId: new mongoose.Types.ObjectId(PERSONAL_LIST) })).toBe(false);
            expect(reads(sprints, { projectId: new mongoose.Types.ObjectId(P1) })).toBe(true);
        });

        it.each([
            ['users inside a tasks join', { from: 'tasks', as: 't', pipeline: [{ $lookup: { from: 'users', as: 'u', pipeline: [] } }] }],
            ['apiTokens inside a facet inside a tasks join', { from: 'tasks', as: 't', pipeline: [{ $facet: { a: [{ $lookup: { from: 'apiTokens', as: 'k', pipeline: [] } }] } }] }],
        ])('refuses %s with 400', async (label, spec) => {
            getRoleType.mockResolvedValue(2);
            evaluatePermission.mockResolvedValue(true);
            const r = await call(aggregateSheet.getTimeSheetByAggregate, lookup(spec));
            expect(r.code).toBe(400);
            expect(mockCrud).not.toHaveBeenCalled();
        });

        it.each([
            ['a pipeline that is not a list of stages', { from: 'tasks', pipeline: { $match: {} }, as: 't' }],
            ['a collection that is not named by a string', { from: { db: 'x', coll: 'tasks' }, pipeline: [], as: 't' }],
        ])('is refused with 400 when it is %s', async (label, spec) => {
            getRoleType.mockResolvedValue(1);
            evaluatePermission.mockResolvedValue(true);
            const r = await call(aggregateSheet.getTimeSheetByAggregate, lookup(spec));
            expect(r.code).toBe(400);
            expect(r.body.message).toMatch(/join/i);
            expect(mockCrud).not.toHaveBeenCalled();
        });
    });
});
