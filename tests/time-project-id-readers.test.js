/* Task 040 phase 2: a time row's ProjectId is text in older rows and will be an ObjectId in new
   ones until the migration has run everywhere, so every timesheet and estimate reader matches
   both forms for one release. Filters are matched the way MongoDB does. */
const { matchesLikeMongo, filterOf, oid } = require('./fixtures/storedForms');
const verified = require('./fixtures/verifiedRequest');

const mockCrud = jest.fn();
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
jest.mock('../utils/companyMembers', () => ({ acceptedMemberIds: jest.fn(async (companyId, ids) => ids.map(String)) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { scopedTimeMatch, scopedEstimateMatch } = require('../Modules/TimeSheet/helpers/timeScope');
const { buildEstimateWrite } = require('../Modules/EstimatedTime/helpers/estimateWriteScope');
const aggregateSheet = require('../Modules/TimeSheet/controller/getTimeSheetByAggregate');
const logDetail = require('../Modules/TimeSheet/controller/logDetailView');
const milestone = require('../Modules/TimeSheet/controller/milestone');
const timeLog = require('../Modules/TimeSheet/controller/timeLog');
const userSheet = require('../Modules/TimeSheet/controller/userTimeSheet');
const projectSheet = require('../Modules/TimeSheet/controller/projectTimeSheet');
const workloadSheet = require('../Modules/TimeSheet/controller/workloadTimeSheet');
const trackerSheet = require('../Modules/TimeSheet/controller/trackerTimeSheet');
const billableSummary = require('../Modules/TimeSheet/controller/billableSummary');
const billing = require('../Modules/TimeSheet/controller/billing');
const exportCsv = require('../Modules/TimeSheet/controller/timesheetExport');
const week = require('../Modules/TimeSheet/controller/weekTimesheet');
const workloadGrid = require('../Modules/TimeSheet/controller/workloadGrid');
const estimates = require('../Modules/EstimatedTime/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const OTHER_PROJECT = '6f0000000000000000000b02';
const T1 = '6f0000000000000000000a01';
const DAY = new Date('2026-09-02T00:00:00.000Z');
const DAY_SECONDS = DAY.getTime() / 1000;

const NAMES = ['text form', 'ObjectId form', 'other project'];
const rowId = (prefix, name) => oid(`6f00000000000000000${prefix}000${NAMES.indexOf(name) + 1}`);
const logRow = (name, ProjectId) => ({
    _id: rowId('d', name), name, ProjectId,
    Loggeduser: ME, TicketID: T1, LogStartTime: DAY_SECONDS + 3600, LogEndTime: DAY_SECONDS + 7200, LogTimeDuration: 60, logAddType: 1, billable: true,
});
const planRow = (name, ProjectId) => ({
    _id: rowId('e', name), name, ProjectId,
    UserId: ME, userId: ME, TaskId: T1, Date: DAY, EstimatedTime: 60,
});
const ROWS = {
    [SCHEMA_TYPE.TIMESHEET]: [logRow('text form', PROJECT), logRow('ObjectId form', oid(PROJECT)), logRow('other project', oid(OTHER_PROJECT))],
    [SCHEMA_TYPE.ESTIMATES_TIME]: [planRow('text form', PROJECT), planRow('ObjectId form', oid(PROJECT)), planRow('other project', OTHER_PROJECT)],
};
const TIME_TYPES = Object.keys(ROWS);
const BOTH = ['ObjectId form', 'text form'];

const found = (type, filter) => ROWS[type].filter(matchesLikeMongo(filter));
/* The reads that pick rows by project; the week view's running-timer lookup, for one, does not. */
const timeReads = () => mockCrud.mock.calls
    .filter(([, { type, data }, method]) => TIME_TYPES.includes(type) && JSON.stringify(filterOf(method, data)).includes('ProjectId'))
    .map(([, { type, data }, method]) => ({ type, names: found(type, filterOf(method, data)).map((row) => row.name).sort() }));

const asAdmin = () => getRoleType.mockResolvedValue(2);
/* A member the matrix grants "Everyone" still stops at the projects they can open. */
const asMember = () => {
    getRoleType.mockResolvedValue(3);
    evaluatePermission.mockResolvedValue(2);
};

beforeEach(() => {
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([PROJECT]);
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (TIME_TYPES.includes(type)) {
            if (method === 'aggregate') return found(type, filterOf(method, data));
            const rows = found(type, filterOf(method, data));
            return method === 'findOne' ? rows[0] || null : rows;
        }
        return method === 'findOne' ? null : [];
    });
});

const call = async (handler, { body = {}, query = {}, params = {} } = {}) => {
    const r = { code: 200, body: null };
    r.status = (code) => { r.code = code; return r; };
    r.json = (answer) => { r.body = answer; return r; };
    r.send = r.json;
    r.set = () => r;
    r.setHeader = () => r;
    await handler(verified({ headers: { companyid: C }, body, query, params, uid: ME }), r);
    return r;
};

const clientMatch = (match) => [{ $match: { $and: [match] } }, { $group: { _id: null, total: { $sum: '$LogTimeDuration' } } }];

const READERS = [
    ['POST /timesheet/project (projectTimeSheet.js), admin', asAdmin, () => call(projectSheet.getProjectTimeSheet, { body: { filterProjectIds: [PROJECT], filterUserIds: [], projectIds: [PROJECT], startNumber: 0, endNumber: 9e12, timeZone: 'UTC' } })],
    ['POST /timesheet/project (projectTimeSheet.js), member', asMember, () => call(projectSheet.getProjectTimeSheet, { body: { filterProjectIds: [PROJECT], filterUserIds: [], projectIds: [PROJECT, OTHER_PROJECT], startNumber: 0, endNumber: 9e12, timeZone: 'UTC' } })],
    ['the tracker timesheet (trackerTimeSheet.js)', asAdmin, () => call(trackerSheet.getTrackerTimeSheet, { body: { selectedFilter: [{ type: 'Projects', id: PROJECT }], userArray: [], start: 0, end: 9e9 } })],
    ['the user timesheet (userTimeSheet.js)', asAdmin, () => call(userSheet.getUserTimeSheet, { body: { selectedFilter: [{ type: 'Projects', id: PROJECT }], userArray: [], projectArray: [PROJECT], start: 0, end: 9e9, timeZone: 'UTC' } })],
    ['the workload timesheet (workloadTimeSheet.js)', asAdmin, () => call(workloadSheet.getWorkloadTimeSheet, { body: { isFrom: 'workloadview', userArray: [], projectArray: [PROJECT], start: 0, end: 9e9, timeZone: 'UTC' } })],
    ['the time log (timeLog.js), member', asMember, () => call(timeLog.getTimeLogTimeSheet, { body: { taskIds: [{ TicketID: T1 }] } })],
    ['the log detail view (logDetailView.js)', asAdmin, () => call(logDetail.getlogDetailTimeSheet, { body: { projectId: PROJECT, startDate: 0, endDate: 9e9 } })],
    ['the milestone hours (TimeSheet milestone.js)', asAdmin, () => call(milestone.getTimeSheetForMilestone, { body: { projectId: PROJECT, startDate: '2000-01-01', endDate: '2100-01-01' } })],
    ['a client timesheet pipeline (getTimeSheetByAggregate.js), admin', asAdmin, () => call(aggregateSheet.getTimeSheetByAggregate, { body: { queryeta: clientMatch({ ProjectId: { $in: [PROJECT] } }) } })],
    ['a client timesheet pipeline naming one project, admin', asAdmin, () => call(aggregateSheet.getTimeSheetByAggregate, { body: { queryeta: [{ $match: { ProjectId: PROJECT } }] } })],
    ['a client timesheet pipeline (getTimeSheetByAggregate.js), member', asMember, () => call(aggregateSheet.getTimeSheetByAggregate, { body: { queryeta: clientMatch({ Loggeduser: { $in: [ME] } }) } })],
    ['the billable summary (billableSummary.js)', asAdmin, () => call(billableSummary.getBillableSummary, { body: { projectArray: [PROJECT], start: 1, end: 9e9 } })],
    ['the invoice from time (TimeSheet billing.js generateInvoice)', asAdmin, () => call(billing.generateInvoice, { body: { projectArray: [PROJECT], start: 1, end: 9e9 } })],
    ['the payroll CSV (timesheetExport.js)', asAdmin, () => call(exportCsv.exportTimesheetCsv, { body: { projectArray: [PROJECT], start: 1, end: 9e9 } })],
    ['the week timesheet (weekTimesheet.js)', asAdmin, () => call(week.getWeekTimesheet, { query: { start: '2026-09-01', end: '2026-09-07', projectId: PROJECT, timeZone: 'UTC' } })],
    ['the workload grid (workloadGrid.js), logs and plans', asAdmin, () => call(workloadGrid.getWorkloadGrid, { body: { start: '2026-09-01', end: '2026-09-07', userIds: [ME], projectIds: [PROJECT], timeZone: 'UTC' } })],
    ['a client estimate pipeline (getEstimateByAggregate), admin', asAdmin, () => call(estimates.getEstimateByAggregate, { body: { queryeta: [{ $match: { $and: [{ ProjectId: { $in: [PROJECT] }, Date: { dbDate: { $gte: 0, $lte: 9e12 } } }] } }] } })],
    ['a client estimate pipeline (getEstimateByAggregate), member', asMember, () => call(estimates.getEstimateByAggregate, { body: { queryeta: [{ $match: { userId: { $in: [ME] } } }] } })],
    ['GET /estimatedtime/:pid/:tid (EstimatedTime controller getEstimatedTime)', asAdmin, () => call(estimates.getEstimatedTime, { params: { pid: PROJECT, tid: T1 } })],
];

describe('every timesheet and estimate reader matches a project id in the text and the ObjectId form', () => {
    test.each(READERS)('%s', async (_, as, run) => {
        as();
        const r = await run();
        expect(r.code).toBe(200);
        const reads = timeReads();
        expect(reads.length).toBeGreaterThan(0);
        reads.forEach(({ names }) => expect(names).toEqual(BOTH));
    });

    test('the workload grid reads both collections', async () => {
        asAdmin();
        await call(workloadGrid.getWorkloadGrid, { body: { start: '2026-09-01', end: '2026-09-07', userIds: [ME], projectIds: [PROJECT], timeZone: 'UTC' } });
        expect(timeReads().map(({ type }) => type).sort()).toEqual([SCHEMA_TYPE.ESTIMATES_TIME, SCHEMA_TYPE.TIMESHEET].sort());
    });

    test('a client pipeline excluding a project leaves out both of its forms', async () => {
        asAdmin();
        await call(aggregateSheet.getTimeSheetByAggregate, { body: { queryeta: clientMatch({ ProjectId: { $nin: [OTHER_PROJECT] } }) } });
        expect(timeReads()[0].names).toEqual(BOTH);
    });

    test('the project timesheet groups a day of one project once, whatever form its rows hold', async () => {
        asAdmin();
        await call(projectSheet.getProjectTimeSheet, { body: { filterProjectIds: [PROJECT], filterUserIds: [], projectIds: [PROJECT], startNumber: 0, endNumber: 9e12, timeZone: 'UTC' } });
        const [, { data: [pipeline] }] = mockCrud.mock.calls.find(([, { type }]) => type === SCHEMA_TYPE.TIMESHEET);
        const group = pipeline.find((stage) => stage.$group).$group;
        expect(group._id.projectId).toEqual({ $toString: '$ProjectId' });
    });
});

describe('the shared scope filters', () => {
    const member = { uid: ME, roleType: 3, everyone: true, companyWide: false, visible: [PROJECT] };
    const names = (type, filter) => found(type, filter).map((row) => row.name).sort();

    test('scopedTimeMatch, which the tracker screenshot, performance and team readers also use, finds both forms', () => {
        expect(names(SCHEMA_TYPE.TIMESHEET, scopedTimeMatch(member))).toEqual(BOTH);
        expect(names(SCHEMA_TYPE.TIMESHEET, scopedTimeMatch(member, { projectIds: [PROJECT, OTHER_PROJECT] }))).toEqual(BOTH);
        expect(names(SCHEMA_TYPE.TIMESHEET, scopedTimeMatch({ ...member, visible: null, companyWide: true }, { projectIds: [PROJECT] }))).toEqual(BOTH);
    });

    test('scopedEstimateMatch finds both forms', () => {
        expect(names(SCHEMA_TYPE.ESTIMATES_TIME, scopedEstimateMatch(member))).toEqual(BOTH);
    });

    test('a planning save that names its row reaches the row in either form', () => {
        const write = (id) => buildEstimateWrite({ id, userId: ME, taskId: T1, projectId: PROJECT, date: DAY.toISOString(), minutes: 30 }, { ...member, everyone: false });
        const rowsOf = (row) => found(SCHEMA_TYPE.ESTIMATES_TIME, { ...write(String(row._id)).data[0], _id: row._id }).map((r) => r.name);
        expect(rowsOf(ROWS[SCHEMA_TYPE.ESTIMATES_TIME][0])).toEqual(['text form']);
        expect(rowsOf(ROWS[SCHEMA_TYPE.ESTIMATES_TIME][1])).toEqual(['ObjectId form']);
    });
});
