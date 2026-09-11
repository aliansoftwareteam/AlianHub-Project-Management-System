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
jest.mock('../Modules/EstimatedTime/aiTaskEstimator', () => ({ estimateAndPersist: jest.fn(), _internal: {} }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const aggregateSheet = require('../Modules/TimeSheet/controller/getTimeSheetByAggregate');
const logDetail = require('../Modules/TimeSheet/controller/logDetailView');
const milestone = require('../Modules/TimeSheet/controller/milestone');
const timeLog = require('../Modules/TimeSheet/controller/timeLog');
const userSheet = require('../Modules/TimeSheet/controller/userTimeSheet');
const projectSheet = require('../Modules/TimeSheet/controller/projectTimeSheet');
const workloadSheet = require('../Modules/TimeSheet/controller/workloadTimeSheet');
const estimates = require('../Modules/EstimatedTime/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const P2 = '6f0000000000000000000b02';
const T1 = '6f0000000000000000000a01';

const LOGS = [
    { Loggeduser: ME, ProjectId: P1, TicketID: T1, LogStartTime: 100, LogEndTime: 160, LogTimeDuration: 60, logAddType: 1 },
    { Loggeduser: OTHER, ProjectId: P1, TicketID: T1, LogStartTime: 100, LogEndTime: 130, LogTimeDuration: 30, logAddType: 1 },
    { Loggeduser: OTHER, ProjectId: P2, TicketID: T1, LogStartTime: 100, LogEndTime: 220, LogTimeDuration: 120, logAddType: 1 },
];
const ESTIMATES = [
    { UserId: ME, userId: ME, ProjectId: P1, TaskId: T1, EstimatedTime: 60 },
    { userId: ME, ProjectId: P1, TaskId: T1, EstimatedTime: 15 },
    { UserId: OTHER, userId: OTHER, ProjectId: P1, TaskId: T1, EstimatedTime: 30 },
    { UserId: OTHER, userId: ME, ProjectId: P1, TaskId: T1, EstimatedTime: 45 },
    { UserId: OTHER, userId: OTHER, ProjectId: P2, TaskId: T1, EstimatedTime: 120 },
];

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};

const call = async (handler, body, uid = ME) => {
    const r = res();
    await handler({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r);
    return r;
};

const sentPipeline = () => {
    expect(mockCrud).toHaveBeenCalledTimes(1);
    return mockCrud.mock.calls[0][1].data[0];
};
const rowsReadBy = (docs) => sentPipeline().filter((stage) => stage.$match).reduce((rows, stage) => rows.filter((d) => matches(d, stage.$match)), docs);
const lookups = (value, found = []) => {
    if (Array.isArray(value)) value.forEach((item) => lookups(item, found));
    else if (value && typeof value === 'object' && value.constructor === Object) {
        Object.entries(value).forEach(([key, inner]) => {
            if (key === '$lookup') found.push(inner);
            lookups(inner, found);
        });
    }
    return found;
};
const isObjectIdOf = (id) => (value) => value instanceof mongoose.Types.ObjectId && String(value) === id;

const grant = (byKey) => evaluatePermission.mockImplementation(async (company, uid, key) => (key in byKey ? byKey[key] : null));

beforeEach(() => {
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([P1]);
});

const tasksJoin = (input) => ({
    $lookup: {
        from: 'tasks',
        let: { taskIdRef: { $convert: { input, to: 'objectId', onError: null } } },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$taskIdRef'] } } }],
        as: 'matchedTasks',
    },
});

const TRACKER_TODAY = [
    { $match: { $and: [{ Loggeduser: { $in: [ME] } }, { ProjectId: { $in: [P1] } }, { LogStartTime: { $gte: 0, $lte: 999 } }, { logAddType: { $in: [0, 1] } }] } },
    { $sort: { TicketID: 1, LogStartTime: -1 } },
    { $group: { _id: '$TicketID', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $addFields: { TaskId: { $toObjectId: '$TicketID' } } },
    {
        $lookup: {
            from: 'tasks',
            localField: 'TaskId',
            foreignField: '_id',
            as: 'taskData',
            pipeline: [
                { $lookup: { from: 'folders', localField: 'folderObjId', foreignField: '_id', as: 'folderArray', pipeline: [{ $project: { name: 1 } }] } },
                { $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 'sprintData', pipeline: [{ $project: { name: 1, folderId: 1 } }] } },
            ],
        },
    },
    { $unwind: '$taskData' },
];

describe('review 635: the tasks join a non-admin sends', () => {
    it('matches the ObjectId ProjectID tasks store, and legacy string ids', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(aggregateSheet.getTimeSheetByAggregate, { queryeta: [{ $match: {} }, tasksJoin('$TicketID'), { $match: { matchedTasks: { $ne: [] } } }] });
        expect(r.code).toBe(200);
        const [joined] = lookups(sentPipeline());
        const { $in: ids } = joined.pipeline[0].$match.ProjectID;
        expect(ids.some(isObjectIdOf(P1))).toBe(true);
        expect(ids).toContain(P1);
    });

    it('accepts the desktop tracker\'s Today query, with folders and sprints limited to visible projects', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(aggregateSheet.getTimeSheetByAggregate, { queryeta: TRACKER_TODAY });
        expect(r.code).toBe(200);
        const [tasks, folders, sprints] = lookups(sentPipeline());
        expect(tasks.from).toBe('tasks');
        expect(tasks.pipeline[0].$match.ProjectID.$in.some(isObjectIdOf(P1))).toBe(true);
        expect([folders.from, sprints.from]).toEqual(['folders', 'sprints']);
        for (const nested of [folders, sprints]) {
            expect(nested.pipeline[0].$match.projectId.$in.some(isObjectIdOf(P1))).toBe(true);
            expect(nested.pipeline.slice(1)).toEqual([{ $project: expect.any(Object) }]);
        }
    });

    it.each([
        ['folders outside a tasks join', [{ $lookup: { from: 'folders', localField: 'x', foreignField: '_id', as: 'f', pipeline: [] } }]],
        ['users inside a tasks join', [{ $lookup: { from: 'tasks', as: 't', pipeline: [{ $lookup: { from: 'users', as: 'u', pipeline: [] } }] } }]],
        ['sprints inside a tasks join without a pipeline', [{ $lookup: { from: 'tasks', as: 't', pipeline: [{ $lookup: { from: 'sprints', localField: 'sprintId', foreignField: '_id', as: 's' } }] } }]],
        ['company_users inside a sprints join', [{ $lookup: { from: 'tasks', as: 't', pipeline: [{ $lookup: { from: 'sprints', as: 's', pipeline: [{ $lookup: { from: 'company_users', as: 'c', pipeline: [] } }] } }] } }]],
    ])('refuses a member %s', async (label, queryeta) => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(aggregateSheet.getTimeSheetByAggregate, { queryeta });
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('still refuses a write hidden in a nested folders join, even for an admin', async () => {
        getRoleType.mockResolvedValue(1);
        const queryeta = [{ $lookup: { from: 'tasks', as: 't', pipeline: [{ $lookup: { from: 'folders', as: 'f', pipeline: [{ $merge: { into: 'company_users' } }] } }] } }];
        const r = await call(aggregateSheet.getTimeSheetByAggregate, { queryeta });
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('review 635: /api/v1/timesheet reads the tracker key its callers use', () => {
    it.each([
        ['tracker Everyone, workload Own', { 'sheet_settings.tracker_timesheet': 2, 'sheet_settings.workload_timesheet': 1 }],
        ['workload Everyone, tracker Own', { 'sheet_settings.tracker_timesheet': 1, 'sheet_settings.workload_timesheet': 2 }],
    ])('lets a member with %s read the team on visible projects', async (label, grants) => {
        getRoleType.mockResolvedValue(3);
        grant(grants);
        await call(aggregateSheet.getTimeSheetByAggregate, { queryeta: [{ $match: { Loggeduser: { $in: [ME, OTHER] } } }] });
        const rows = rowsReadBy(LOGS);
        expect(rows.some((d) => d.Loggeduser === OTHER && d.ProjectId === P1)).toBe(true);
        expect(rows.some((d) => d.ProjectId === P2)).toBe(false);
    });
});

describe('review 635: POST /api/v1/estimatedTime', () => {
    it.each([
        ['$out', [{ $match: {} }, { $out: 'stolen' }]],
        ['$merge', [{ $limit: 1 }, { $project: { roleType: { $literal: 1 } } }, { $merge: { into: 'company_users', on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } }]],
        ['$unionWith', [{ $limit: 1 }, { $unionWith: 'timesheets' }]],
        ['$graphLookup', [{ $graphLookup: { from: 'users', startWith: '$UserId', connectFromField: '_id', connectToField: '_id', as: 'u' } }]],
        ['$function', [{ $project: { x: { $function: { body: 'function(){return 1}', args: [], lang: 'js' } } } }]],
        ['$accumulator', [{ $group: { _id: null, x: { $accumulator: { init: 'function(){}', accumulate: 'function(){}', accumulateArgs: [], merge: 'function(){}', lang: 'js' } } } }]],
        ['$where', [{ $match: { $where: 'true' } }]],
        ['a $merge nested in a $facet', [{ $facet: { a: [{ $merge: { into: 'tasks' } }] } }]],
        ['a $unionWith inside a tasks join', [{ $lookup: { from: 'tasks', as: 't', pipeline: [{ $unionWith: 'users' }] } }]],
        ['a body that is not a pipeline', 'UserId'],
    ])('refuses %s for everyone, an owner included', async (label, queryeta) => {
        for (const roleType of [1, 3]) {
            mockCrud.mockClear();
            getRoleType.mockResolvedValue(roleType);
            grant({});
            const r = await call(estimates.getEstimateByAggregate, { queryeta });
            expect([roleType, r.code]).toEqual([roleType, 400]);
            expect(mockCrud).not.toHaveBeenCalled();
        }
    });

    it('limits a member to their own planned time whatever the body claims', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(estimates.getEstimateByAggregate, { queryeta: [{ $match: { UserId: { $in: [ME, OTHER] } } }] });
        expect(r.code).toBe(200);
        expect(rowsReadBy(ESTIMATES).map((d) => d.EstimatedTime)).toEqual([60]);
    });

    it('counts a legacy row that only carries userId as the member\'s own', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        await call(estimates.getEstimateByAggregate, { queryeta: [{ $match: {} }] });
        expect(rowsReadBy(ESTIMATES).map((d) => d.EstimatedTime).sort((a, b) => a - b)).toEqual([15, 60]);
    });

    it.each([
        ['workload', 'sheet_settings.workload_timesheet'],
        ['project', 'sheet_settings.project_timesheet'],
    ])('lets a member granted Everyone on the %s timesheet read the team on visible projects only', async (label, key) => {
        getRoleType.mockResolvedValue(3);
        grant({ [key]: 2 });
        await call(estimates.getEstimateByAggregate, { queryeta: [{ $match: {} }] });
        const rows = rowsReadBy(ESTIMATES);
        expect(rows.some((d) => d.UserId === OTHER && d.ProjectId === P1)).toBe(true);
        expect(rows.some((d) => d.ProjectId === P2)).toBe(false);
    });

    it('keeps the dashboard estimate card\'s tasks join for a member, cast to ObjectId', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const queryeta = [{ $match: { ProjectId: { $in: [P1] } } }, tasksJoin('$TaskId'), { $match: { matchedTasks: { $ne: [] } } }, { $group: { _id: null, totalEstimatedTime: { $sum: '$EstimatedTime' } } }];
        const r = await call(estimates.getEstimateByAggregate, { queryeta });
        expect(r.code).toBe(200);
        expect(lookups(sentPipeline())[0].pipeline[0].$match.ProjectID.$in.some(isObjectIdOf(P1))).toBe(true);
    });

    it('keeps an admin company-wide', async () => {
        getRoleType.mockResolvedValue(2);
        await call(estimates.getEstimateByAggregate, { queryeta: [{ $match: {} }] });
        expect(rowsReadBy(ESTIMATES)).toHaveLength(ESTIMATES.length);
    });

    it('reads nothing for someone who is not in the company', async () => {
        getRoleType.mockResolvedValue(null);
        visibleProjectIds.mockResolvedValue([]);
        await call(estimates.getEstimateByAggregate, { queryeta: [{ $match: {} }] });
        expect(rowsReadBy(ESTIMATES)).toHaveLength(0);
    });
});

describe('review 635: POST /api/v1/timesheet/logDetail', () => {
    const body = (over = {}) => ({ startDate: 0, endDate: 999, userArray: [OTHER], projectId: [P1, P2], taskId: '', ...over });

    it('limits a member with Own to their own logs whatever userArray names', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(logDetail.getlogDetailTimeSheet, body());
        expect(r.code).toBe(200);
        const rows = rowsReadBy(LOGS);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((d) => d.Loggeduser === ME)).toBe(true);
    });

    it.each([['user', 'sheet_settings.user_timesheet'], ['project', 'sheet_settings.project_timesheet']])(
        'lets a member granted Everyone on the %s timesheet read others on visible projects only',
        async (label, key) => {
            getRoleType.mockResolvedValue(3);
            grant({ [key]: 2 });
            await call(logDetail.getlogDetailTimeSheet, body());
            const rows = rowsReadBy(LOGS);
            expect(rows.some((d) => d.Loggeduser === OTHER && d.ProjectId === P1)).toBe(true);
            expect(rows.some((d) => d.ProjectId === P2)).toBe(false);
        },
    );

    it('treats a task id that is not a string as no task filter', async () => {
        getRoleType.mockResolvedValue(2);
        await call(logDetail.getlogDetailTimeSheet, body({ taskId: { $ne: null } }));
        expect(JSON.stringify(sentPipeline())).not.toContain('$ne');
    });

    it('keeps an admin company-wide', async () => {
        getRoleType.mockResolvedValue(2);
        await call(logDetail.getlogDetailTimeSheet, body());
        expect(rowsReadBy(LOGS).some((d) => d.ProjectId === P2)).toBe(true);
    });
});

describe('review 635: POST /api/v1/timesheet/milestone', () => {
    const body = (projectId) => ({ projectId, startDate: '1970-01-01T00:00:00.000Z', endDate: '2100-01-01T00:00:00.000Z' });

    it('reads nothing for a member on a project they cannot open', async () => {
        getRoleType.mockResolvedValue(3);
        grant({ 'project.project_milestone': true });
        const r = await call(milestone.getTimeSheetForMilestone, body(P2));
        expect(r.code).toBe(200);
        expect(rowsReadBy(LOGS)).toHaveLength(0);
    });

    it('gives a member who can see the project\'s milestones the whole project\'s time', async () => {
        getRoleType.mockResolvedValue(3);
        grant({ 'project.project_milestone': false });
        await call(milestone.getTimeSheetForMilestone, body(P1));
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, 'project.project_milestone', { projectId: P1 });
        expect(rowsReadBy(LOGS).map((d) => d.Loggeduser).sort()).toEqual([ME, OTHER]);
    });

    it('limits a member without milestone access to their own time', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        await call(milestone.getTimeSheetForMilestone, body(P1));
        expect(rowsReadBy(LOGS).map((d) => d.Loggeduser)).toEqual([ME]);
    });

    it('keeps an admin on any project', async () => {
        getRoleType.mockResolvedValue(1);
        await call(milestone.getTimeSheetForMilestone, body(P2));
        expect(rowsReadBy(LOGS)).toHaveLength(1);
    });
});

describe('review 635: POST /api/v1/timesheet/timelog', () => {
    const taskIds = [{ TicketID: T1 }];

    it.each([
        ['a $unionWith passed as facet', { facet: { $unionWith: 'timesheets' } }],
        ['a $merge passed as facet', { facet: { $merge: { into: 'company_users' } } }],
        ['a stage that is not the one the parameter names', { group: { $lookup: { from: 'users', localField: 'Loggeduser', foreignField: '_id', as: 'u' } } }],
        ['a parameter with two stages', { sort: { $sort: { LogStartTime: 1 }, $out: 'x' } }],
        ['a join to another collection inside a facet', { facet: { $facet: { a: [{ $lookup: { from: 'users', as: 'u', pipeline: [] } }] } } }],
    ])('refuses %s with 400', async (label, extra) => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(timeLog.getTimeLogTimeSheet, { taskIds, ...extra });
        expect(r.code).toBe(400);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a write stage even for an admin', async () => {
        getRoleType.mockResolvedValue(1);
        const r = await call(timeLog.getTimeLogTimeSheet, { taskIds, addFields: { $out: 'stolen' } });
        expect(r.code).toBe(400);
    });

    it('runs the named stages after a match limited to the member', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(timeLog.getTimeLogTimeSheet, {
            taskIds,
            usersFilterIDsArray: [OTHER],
            sort: { $sort: { LogStartTime: -1 } },
            group: { $group: { _id: '$Loggeduser', total: { $sum: '$LogTimeDuration' } } },
        });
        expect(r.code).toBe(200);
        expect(sentPipeline().slice(1)).toEqual([{ $sort: { LogStartTime: -1 } }, { $group: { _id: '$Loggeduser', total: { $sum: '$LogTimeDuration' } } }]);
        expect(rowsReadBy(LOGS).map((d) => d.Loggeduser)).toEqual([ME]);
    });

    it('answers a body without taskIds instead of throwing', async () => {
        getRoleType.mockResolvedValue(3);
        grant({});
        const r = await call(timeLog.getTimeLogTimeSheet, {});
        expect(r.code).toBe(200);
    });
});

describe('review 635: timeZone reaches $dateToString only as a zone name or offset', () => {
    const evil = { $function: { body: 'function(){while(true){}}', args: [], lang: 'js' } };

    it.each([
        ['Asia/Kolkata', 'Asia/Kolkata'],
        ['America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
        ['UTC', 'UTC'],
        ['+05:30', '+05:30'],
        ['-04:00', '-04:00'],
        ['Bad/Zone', 'UTC'],
        ['+5', 'UTC'],
        ['', 'UTC'],
        [undefined, 'UTC'],
        [evil, 'UTC'],
        [['Asia/Kolkata'], 'UTC'],
    ])('reads %p as %p', (input, expected) => {
        const { safeTimeZone } = require('../Modules/TimeSheet/helpers/timeScope');
        expect(safeTimeZone(input)).toBe(expected);
    });

    it.each([
        ['/timesheet/user', userSheet.getUserTimeSheet, { selectedFilter: [], userArray: [], projectArray: [], start: 0, end: 999, timeZone: evil }],
        ['/timesheet/workload', workloadSheet.getWorkloadTimeSheet, { selectedFilter: [], userArray: [], projectArray: [], start: 0, end: 999, timeZone: evil }],
        ['/timesheet/project', projectSheet.getProjectTimeSheet, { filterProjectIds: [], filterUserIds: [], projectIds: [P1], startNumber: 0, endNumber: 999000, timeZone: evil }],
    ])('%s sends UTC instead of an expression', async (route, handler, body) => {
        getRoleType.mockResolvedValue(3);
        grant({});
        await call(handler, body);
        const added = sentPipeline().find((stage) => stage.$addFields).$addFields;
        expect(added.convertedToDate.$dateToString.timezone).toBe('UTC');
    });
});
