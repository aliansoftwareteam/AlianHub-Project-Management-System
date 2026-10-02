process.env.STORAGE_TYPE = 'server';
const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();
const mockReads = [];

/* The sheets end in date and grouping stages the fake does not run, so an aggregate over time or
 * estimate rows is answered from its leading $match stages alone. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, query, method) => {
        const { SCHEMA_TYPE: types } = require('../Config/schemaType');
        const timeLike = [types.TIMESHEET, types.ESTIMATES_TIME].includes(query.type);
        if (timeLike) mockReads.push({ type: query.type, method, data: query.data });
        if (timeLike && method === 'aggregate') {
            const leading = [];
            for (const stage of query.data[0]) { if (!stage.$match) break; leading.push(stage); }
            return mockDb.crud(companyId, { type: query.type, data: [leading] }, 'aggregate');
        }
        return mockDb.crud(companyId, query, method);
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { resolveSheetScope, scopedTimeMatch, scopedEstimateMatch, SHEET_PERMISSION } = require('../Modules/TimeSheet/helpers/timeScope');
const userSheet = require('../Modules/TimeSheet/controller/userTimeSheet');
const workloadSheet = require('../Modules/TimeSheet/controller/workloadTimeSheet');
const projectSheet = require('../Modules/TimeSheet/controller/projectTimeSheet');
const trackerSheet = require('../Modules/TimeSheet/controller/trackerTimeSheet');
const aggregateSheet = require('../Modules/TimeSheet/controller/getTimeSheetByAggregate');
const timeLog = require('../Modules/TimeSheet/controller/timeLog');
const logDetail = require('../Modules/TimeSheet/controller/logDetailView');
const milestone = require('../Modules/TimeSheet/controller/milestone');
const hours = require('../Modules/TimeSheet/controller/hoursBySource');
const billable = require('../Modules/TimeSheet/controller/billableSummary');
const billing = require('../Modules/TimeSheet/controller/billing');
const taskEntries = require('../Modules/TimeSheet/controller/taskEntries');
const payroll = require('../Modules/TimeSheet/controller/timesheetExport');
const week = require('../Modules/TimeSheet/controller/weekTimesheet');
const variance = require('../Modules/VarianceReport/controller');
const estimates = require('../Modules/EstimatedTime/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const P_OPEN = '6f0000000000000000000b01';
const PL_MEMBER = '6f0000000000000000000b02';
const PL_OWNER = '6f0000000000000000000b03';
const T_OPEN = '6f0000000000000000000a01';
const T_MEMBER = '6f0000000000000000000a02';
const T_OWNER = '6f0000000000000000000a03';

const PRIVILEGED = [['an owner', OWNER], ['an admin', ADMIN]];
const oid = (id) => new mongoose.Types.ObjectId(id);

const times = () => mockDb.store[SCHEMA_TYPE.TIMESHEET];
const names = (rows) => rows.map((row) => row.LogDescription).sort();

const call = async (handler, { uid, body = {}, query = {}, params = {} }) => {
    const res = { code: 200, body: null };
    res.status = (code) => { res.code = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = res.json;
    res.setHeader = () => res;
    mockReads.length = 0;
    await handler(verified({ headers: { companyid: C }, body, query, params, uid }), res);
    return res;
};

/* Every time row the last call could have read: a find by its filter, an aggregate by its leading $match stages. */
const rowsRead = (type = SCHEMA_TYPE.TIMESHEET) => {
    const reads = mockReads.filter((read) => read.type === type);
    expect(reads.length).toBeGreaterThan(0);
    const seen = new Set();
    reads.forEach(({ method, data }) => {
        const filters = method === 'aggregate' ? data[0].filter((stage) => stage.$match).map((stage) => stage.$match) : [data[0]];
        mockDb.store[type].filter((row) => filters.every((filter) => fakeMongo.matches(row, filter))).forEach((row) => seen.add(row));
    });
    return [...seen];
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    mockReads.length = 0;
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...extra });
    project(P_OPEN, 'Open');
    project(PL_MEMBER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
    project(PL_OWNER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: OWNER, AssigneeUserId: [OWNER] });
    const task = (_id, TaskName, ProjectID) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, TaskName, ProjectID, isParentTask: true, deletedStatusKey: 0, totalEstimatedTime: 60 });
    task(T_OPEN, 'Shared work', P_OPEN);
    task(T_MEMBER, 'Private errand', PL_MEMBER);
    task(T_OWNER, 'Owner errand', PL_OWNER);
    const log = (LogDescription, Loggeduser, ProjectId, TicketID, LogTimeDuration) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
        LogDescription, Loggeduser, ProjectId, TicketID, LogTimeDuration, LogStartTime: 500, LogEndTime: 500 + LogTimeDuration * 60, billable: true, logAddType: 1,
    });
    log('member on the open project', MEMBER, P_OPEN, T_OPEN, 30);
    log('member in their personal list', MEMBER, PL_MEMBER, T_MEMBER, 45);
    log('member in their personal list, id stored as an ObjectId', MEMBER, oid(PL_MEMBER), T_MEMBER, 15);
    log('owner on the open project', OWNER, P_OPEN, T_OPEN, 10);
    log('owner in their personal list', OWNER, PL_OWNER, T_OWNER, 20);
    const plan = (note, UserId, ProjectId, TaskId) => mockDb.seed(SCHEMA_TYPE.ESTIMATES_TIME, { note, UserId, ProjectId, TaskId, EstimatedTime: 60, Date: new Date('2026-09-01T00:00:00Z') });
    plan('member plan on the open project', MEMBER, P_OPEN, T_OPEN);
    plan('member plan in their personal list', MEMBER, PL_MEMBER, T_MEMBER);
    plan('owner plan in their personal list', OWNER, PL_OWNER, T_OWNER);
});

const HIDDEN = ['member in their personal list', 'member in their personal list, id stored as an ObjectId'];
const OWNER_SEES = ['member on the open project', 'owner in their personal list', 'owner on the open project'];
const ADMIN_SEES = ['member on the open project', 'owner on the open project'];
const seenBy = (uid) => (uid === OWNER ? OWNER_SEES : ADMIN_SEES);

describe.each(PRIVILEGED)('the time scope of %s', (_who, uid) => {
    const read = async (filters) => {
        const scope = await resolveSheetScope(C, uid, SHEET_PERMISSION.user);
        return names(times().filter((row) => fakeMongo.matches(row, scopedTimeMatch(scope, filters))));
    };

    it('stays company-wide, short of the time someone else logged in their personal list', async () => {
        expect(await read()).toEqual(seenBy(uid));
    });

    it('finds nothing when asked for that personal list by project', async () => {
        expect(await read({ projectIds: [PL_MEMBER] })).toEqual([]);
        expect(await read({ projectIds: [PL_MEMBER, P_OPEN] })).toEqual(['member on the open project', 'owner on the open project']);
    });

    it('finds that person\'s other time when asked for them by name', async () => {
        expect(await read({ userIds: [MEMBER] })).toEqual(['member on the open project']);
    });

    it('applies the same to planned hours', async () => {
        const scope = await resolveSheetScope(C, uid, SHEET_PERMISSION.user);
        const plans = mockDb.store[SCHEMA_TYPE.ESTIMATES_TIME].filter((row) => fakeMongo.matches(row, scopedEstimateMatch(scope))).map((row) => row.note).sort();
        expect(plans).toEqual(uid === OWNER ? ['member plan on the open project', 'owner plan in their personal list'] : ['member plan on the open project']);
    });
});

describe('the time scope of a member', () => {
    it('still holds their own time in their own personal list', async () => {
        const scope = await resolveSheetScope(C, MEMBER, SHEET_PERMISSION.user);
        expect(names(times().filter((row) => fakeMongo.matches(row, scopedTimeMatch(scope))))).toEqual(['member in their personal list', 'member in their personal list, id stored as an ObjectId', 'member on the open project']);
    });
});

const SHEETS = [
    ['/timesheet/user', userSheet.getUserTimeSheet, { selectedFilter: [], userArray: [], projectArray: [], start: 0, end: 999, timeZone: 'UTC' }],
    ['/timesheet/user for one person', userSheet.getUserTimeSheet, { selectedFilter: [{ type: 'Users' }], userArray: [MEMBER], projectArray: [], start: 0, end: 999, timeZone: 'UTC' }],
    ['/timesheet/user for one project', userSheet.getUserTimeSheet, { selectedFilter: [{ type: 'Projects' }], userArray: [], projectArray: [PL_MEMBER], start: 0, end: 999, timeZone: 'UTC' }],
    ['/timesheet/workload', workloadSheet.getWorkloadTimeSheet, { selectedFilter: [], userArray: [], projectArray: [], start: 0, end: 999, timeZone: 'UTC' }],
    ['/timesheet/project', projectSheet.getProjectTimeSheet, { filterProjectIds: [], filterUserIds: [], projectIds: [P_OPEN, PL_MEMBER], startNumber: 0, endNumber: 999000, timeZone: 'UTC' }],
    ['/timesheet/project filtered to the list', projectSheet.getProjectTimeSheet, { filterProjectIds: [PL_MEMBER], filterUserIds: [], projectIds: [PL_MEMBER], startNumber: 0, endNumber: 999000, timeZone: 'UTC' }],
    ['/timesheet/tracker', trackerSheet.getTrackerTimeSheet, { selectedFilter: [], userArray: [], isEveryOne: true, start: 0, end: 999 }],
    ['/timesheet', aggregateSheet.getTimeSheetByAggregate, { queryeta: [{ $match: {} }, { $group: { _id: '$Loggeduser', total: { $sum: '$LogTimeDuration' } } }] }],
    ['/timesheet asking for the list', aggregateSheet.getTimeSheetByAggregate, { queryeta: [{ $match: { ProjectId: PL_MEMBER } }] }],
    ['the time log', timeLog.getTimeLogTimeSheet, { taskIds: [{ TicketID: T_OPEN }, { TicketID: T_MEMBER }, { TicketID: T_OWNER }], usersFilterIDsArray: [] }],
    ['the log detail view', logDetail.getlogDetailTimeSheet, { startDate: 0, endDate: 999, userArray: [], projectId: [] }],
    ['the log detail view of the list', logDetail.getlogDetailTimeSheet, { startDate: 0, endDate: 999, userArray: [], projectId: PL_MEMBER }],
    ['the milestone totals of the list', milestone.getTimeSheetForMilestone, { startDate: '1970-01-01T00:00:00Z', endDate: '1970-01-02T00:00:00Z', projectId: PL_MEMBER }],
    ['the billable summary', billable.getBillableSummary, { start: 1, end: 999 }],
    ['the billable summary of the list', billable.getBillableSummary, { start: 1, end: 999, projectArray: [PL_MEMBER] }],
    ['the invoice', billing.generateInvoice, { start: 1, end: 999 }],
    ['the invoice of the list', billing.generateInvoice, { start: 1, end: 999, projectArray: [PL_MEMBER] }],
];

describe.each(PRIVILEGED)('the time %s reads', (_who, uid) => {
    it.each(SHEETS)('%s leaves out what someone else logged in their personal list', async (_route, handler, body) => {
        await call(handler, { uid, body });
        const read = names(rowsRead());
        HIDDEN.forEach((name) => expect(read).not.toContain(name));
    });

    it.each(SHEETS.filter(([route]) => !/list|one person|one project/.test(route)))('%s still holds the rest of the company', async (_route, handler, body) => {
        await call(handler, { uid, body });
        expect(names(rowsRead())).toEqual(expect.arrayContaining(['member on the open project', 'owner on the open project']));
    });

    it('hours by source counts the rest', async () => {
        const res = await call(hours.getHoursBySource, { uid, query: { start: 1, end: 999 } });
        expect(res.body.data).toMatchObject({ entryCount: seenBy(uid).length, scope: 'company' });
    });

    it('the billable summary totals the rest', async () => {
        const res = await call(billable.getBillableSummary, { uid, body: { start: 1, end: 999 } });
        expect(res.body.data.totalMinutes).toBe(uid === OWNER ? 60 : 40);
    });

    it('the variance summary leaves the personal list and its task out', async () => {
        const res = await call(variance.getVarianceSummary, { uid, query: { from: '1970-01-01', to: '1970-01-02' } });
        expect(res.body.status).toBe(true);
        expect(JSON.stringify(res.body.data)).not.toContain('Private errand');
        expect(JSON.stringify(res.body.data)).not.toContain(PL_MEMBER);
        expect(JSON.stringify(res.body.data)).toContain('Shared work');
    });

    it('the variance report does not open the personal list', async () => {
        const res = await call(variance.getVarianceReport, { uid, query: { projectId: PL_MEMBER } });
        expect(res.code).toBe(403);
        expect((await call(variance.getVarianceReport, { uid, query: { projectId: P_OPEN } })).body.data.tasks.map((t) => t.name)).toEqual(['Shared work']);
    });

    it('a task\'s time entries show only their own on a task in that personal list', async () => {
        const res = await call(taskEntries.getTaskEntries, { uid, params: { taskId: T_MEMBER }, query: { taskId: T_MEMBER } });
        expect(JSON.stringify(res.body)).not.toContain(MEMBER);
    });

    it('planned hours of a task in that personal list are not read', async () => {
        const res = await call(estimates.getEstimatedTime, { uid, params: { pid: PL_MEMBER, tid: T_MEMBER } });
        expect(res.body).toEqual([]);
        expect((await call(estimates.getEstimatedTime, { uid, params: { pid: P_OPEN, tid: T_OPEN } })).body.map((row) => row.note)).toEqual(['member plan on the open project']);
    });

    it('the raw planned-hours query leaves the personal list out', async () => {
        await call(estimates.getEstimateByAggregate, { uid, body: { queryeta: [{ $match: {} }] } });
        expect(rowsRead(SCHEMA_TYPE.ESTIMATES_TIME).map((row) => row.note)).not.toContain('member plan in their personal list');
    });
});

describe('what a member reads is unchanged', () => {
    it('their own sheet holds their time in their personal list', async () => {
        await call(userSheet.getUserTimeSheet, { uid: MEMBER, body: { selectedFilter: [], userArray: [], projectArray: [], start: 0, end: 999, timeZone: 'UTC' } });
        expect(names(rowsRead())).toEqual(['member in their personal list', 'member in their personal list, id stored as an ObjectId', 'member on the open project']);
    });

    it('their billable summary counts it', async () => {
        const res = await call(billable.getBillableSummary, { uid: MEMBER, body: { start: 1, end: 999 } });
        expect(res.body.data).toMatchObject({ totalMinutes: 90, scope: 'self' });
    });
});

const MEMBER_ROWS = ['member in their personal list', 'member in their personal list, id stored as an ObjectId', 'member on the open project'];
const DAY = { start: '1970-01-01', end: '1970-01-01' };

describe('the payroll export holds the rows the user timesheet shows the caller', () => {
    const exported = async (uid, body) => {
        const res = await call(payroll.exportTimesheetCsv, { uid, body: { start: 1, end: 999, ...body } });
        expect(res.code).toBe(200);
        return { read: names(rowsRead()), csv: res.body };
    };

    it.each([
        ['naming no one', {}],
        ['naming someone else', { userArray: [OWNER] }],
        ['naming everyone', { userArray: [OWNER, ADMIN, MEMBER] }],
        ['naming a project', { projectArray: [P_OPEN], userArray: [OWNER] }],
    ])('a member, %s, exports their own time', async (_label, body) => {
        const { read, csv } = await exported(MEMBER, body);
        expect(read).toEqual(body.projectArray ? ['member on the open project'] : MEMBER_ROWS);
        expect(csv).not.toContain('owner on the open project');
        expect(csv).not.toContain('owner in their personal list');
    });

    it.each(PRIVILEGED)('%s exports the company, short of what someone else logged in their personal list', async (_who, uid) => {
        expect((await exported(uid, {})).read).toEqual(seenBy(uid));
        expect((await exported(uid, { userArray: [MEMBER] })).read).toEqual(['member on the open project']);
        expect((await exported(uid, { projectArray: [PL_MEMBER] })).read).toEqual([]);
        expect((await exported(uid, { projectArray: [PL_MEMBER] })).csv).not.toContain('Personal');
    });
});

describe('a week of time', () => {
    const weekOf = async (uid, query) => {
        const res = await call(week.getWeekTimesheet, { uid, query: { ...DAY, ...query } });
        expect(res.code).toBe(200);
        return { read: names(rowsRead()), body: JSON.stringify(res.body) };
    };

    it.each(PRIVILEGED)('read by %s for someone else leaves out their personal list', async (_who, uid) => {
        const all = await weekOf(uid, { userId: MEMBER });
        expect(all.read).toEqual(['member on the open project']);
        expect(all.body).toContain('Shared work');
        expect(all.body).not.toContain('Private errand');
        expect(all.body).not.toContain(PL_MEMBER);

        const named = await weekOf(uid, { userId: MEMBER, projectId: PL_MEMBER });
        expect(named.read).toEqual([]);
        expect(named.body).not.toContain('Private errand');
    });

    it('read by a member is their own, their personal list included, whoever they name', async () => {
        const own = await weekOf(MEMBER, { userId: OWNER });
        expect(own.read).toEqual(MEMBER_ROWS);
        expect(own.body).toContain('Private errand');
        expect((await weekOf(MEMBER, { projectId: PL_MEMBER })).read).toEqual(MEMBER_ROWS.slice(0, 2));
    });

    it('read by an owner for themselves holds their own personal list', async () => {
        expect((await weekOf(OWNER, {})).read).toEqual(['owner in their personal list', 'owner on the open project']);
    });
});
