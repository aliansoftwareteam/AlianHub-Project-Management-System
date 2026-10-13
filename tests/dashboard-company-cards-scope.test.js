const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { seedTaskListRules } = require('./fixtures/taskListRules');
const dashboard = require('../Modules/UserDashboard/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const P_OPEN = '6f0000000000000000000b01';
const P_OTHER = '6f0000000000000000000b04';
const PL_MEMBER = '6f0000000000000000000b02';
const PL_OWNER = '6f0000000000000000000b03';
const T_OPEN = '6f0000000000000000000a01';
const T_MEMBER = '6f0000000000000000000a02';
const T_OWNER = '6f0000000000000000000a03';
const T_TRASHED = '6f0000000000000000000a05';
const T_OTHER = '6f0000000000000000000a06';

const PRIVILEGED = [['an owner', OWNER], ['an admin', ADMIN]];
const WINDOW = { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-09-03T00:00:00Z' };
const LOGGED_AT = Date.parse('2026-09-02T09:00:00Z') / 1000;

const card = async (handler, uid, body = {}) => {
    const res = { code: 200, body: null };
    res.status = (code) => { res.code = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await handler({ headers: { companyid: C }, uid, body: { ...WINDOW, ...body }, query: {}, params: {} }, res);
    expect(res.code).toBe(200);
    return res.body.data;
};
const text = (data) => JSON.stringify(data);

const log = (Loggeduser, TicketID, ProjectId, LogTimeDuration, extra = {}) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
    Loggeduser, TicketID, ProjectId, LogTimeDuration, LogStartTime: LOGGED_AT, billable: true, ...extra,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    seedTaskListRules(mockDb);
    [[OWNER, 1, 'Olive Owner'], [ADMIN, 2, 'Adam Admin'], [MEMBER, 3, 'Mia Member']].forEach(([userId, roleType, Employee_Name]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name, isActive: true, AssignCompany: C });
    });
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active', ...extra });
    project(P_OPEN, 'Open');
    project(P_OTHER, 'Other');
    project(PL_MEMBER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
    project(PL_OWNER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: OWNER, AssigneeUserId: [OWNER] });
    const task = (_id, TaskName, ProjectID, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        _id, TaskName, TaskKey: TaskName.slice(0, 3), ProjectID, AssigneeUserId: [MEMBER], statusKey: 1, statusType: 'active', TaskType: 'Task', isParentTask: true, deletedStatusKey: 0, ...extra,
    });
    task(T_OPEN, 'Shared work', P_OPEN);
    task(T_MEMBER, 'Private errand', PL_MEMBER);
    task(T_OWNER, 'Owner errand', PL_OWNER, { AssigneeUserId: [OWNER] });
    task(T_TRASHED, 'Trashed work', P_OPEN, { deletedStatusKey: 1 });
    task(T_OTHER, 'Other project work', P_OTHER, { statusKey: 2 });
    log(MEMBER, T_OPEN, P_OPEN, 60);
    log(MEMBER, T_MEMBER, PL_MEMBER, 45, { LogDescription: 'private memo', startTimeTracker: Math.floor(Date.now() / 1000) });
    log(OWNER, T_OWNER, PL_OWNER, 20);
    log(MEMBER, T_TRASHED, P_OPEN, 5);
    log(MEMBER, T_OTHER, P_OTHER, 7);
});

const minutesOf = (data, uid) => data.teams.flatMap((team) => team.buckets || team.users || [])
    .flatMap((entry) => (entry.users || [entry]))
    .filter((user) => user.userId === uid)
    .reduce((sum, user) => sum + (user.minutes || user.loggedMinutes || 0), 0);

describe.each(PRIVILEGED)('the company-wide cards, for %s', (_who, uid) => {
    it('the employee workload report names no task or work note from someone else\'s personal list', async () => {
        const data = await card(dashboard.getEmployeeWorkloadReport, uid);
        expect(text(data)).toContain('Shared work');
        expect(text(data)).not.toContain('Private errand');
        expect(text(data)).not.toContain('private memo');
    });

    it('the team breakdown by task type leaves that time out', async () => {
        const data = await card(dashboard.getTeamTaskTypeBreakdown, uid, { dimension: 'type' });
        expect(minutesOf(data, MEMBER)).toBe(67);
    });

    it('the team breakdown by billable time leaves that time out', async () => {
        const data = await card(dashboard.getTeamTaskTypeBreakdown, uid, { dimension: 'billable' });
        expect(minutesOf(data, MEMBER)).toBe(72);
        const narrowed = await card(dashboard.getTeamTaskTypeBreakdown, uid, { dimension: 'billable', projectIds: [PL_MEMBER, P_OPEN] });
        expect(minutesOf(narrowed, MEMBER)).toBe(65);
    });

    it('logged against estimate names no task from that personal list', async () => {
        const data = await card(dashboard.getTeamLoggedVsEta, uid);
        expect(text(data)).toContain('Shared work');
        expect(text(data)).not.toContain('Private errand');
        expect(minutesOf(data, MEMBER)).toBe(67);
    });

    it('the running-projects metric does not count that personal list', async () => {
        const data = await card(dashboard.getProjectProgressMetric, uid, { metric: 'running_projects', includeProjects: true });
        expect(data.projects.map((p) => p._id)).not.toContain(PL_MEMBER);
        expect(data.count).toBe(uid === OWNER ? 3 : 2);
    });

    it('the live-work metric shows no tracker running in that personal list', async () => {
        const data = await card(dashboard.getProjectProgressMetric, uid, { metric: 'live_work' });
        expect(text(data)).not.toContain('private memo');
        expect(text(data)).not.toContain(T_MEMBER);
    });

    it('the users-by-category metric does not count a task there', async () => {
        const data = await card(dashboard.getProjectProgressMetric, uid, { metric: 'users_by_category', categoryMap: { Work: ['Task'] } });
        expect(data.rows.find((row) => row.userId === MEMBER).total).toBe(2);
    });

    it('the utilisation summary does not count that personal list as worked on', async () => {
        const data = await card(dashboard.getProjectUtilizationSummary, uid);
        expect(data.workingProjects).toBe(uid === OWNER ? 3 : 2);
    });
});

describe('a member\'s own cards are unchanged', () => {
    it('their workload report holds the task in their own personal list', async () => {
        const data = await card(dashboard.getEmployeeWorkloadReport, MEMBER);
        expect(text(data)).toContain('Private errand');
        expect(text(data)).toContain('Shared work');
    });
});

describe('the task match a card sends can only narrow the workload report', () => {
    const names = (data) => data.employees.flatMap((employee) => employee.tasks.map((t) => t.TaskName)).sort();

    it.each([
        ['the deleted flag', { deletedStatusKey: { $in: [0, 1] } }, 'Trashed work', { projectIds: [P_OPEN], projectMode: 'include' }],
        ['the card\'s project selection', { ProjectID: { $exists: true } }, 'Other project work', { projectIds: [P_OPEN], projectMode: 'include' }],
        ['the card\'s status selection', { statusKey: { $exists: true } }, 'Other project work', { statusKeys: [1] }],
        ['the tasks the people in the report worked on', { _id: { $exists: true }, deletedStatusKey: 1 }, 'Trashed work', {}],
    ])('a key that would replace %s is ignored', async (_what, taskMatch, leaked, config) => {
        const data = await card(dashboard.getEmployeeWorkloadReport, MEMBER, { ...config, taskMatch });
        expect(names(data)).not.toContain(leaked);
    });

    it('a key that would lift the personal-list rule is ignored for an owner', async () => {
        const data = await card(dashboard.getEmployeeWorkloadReport, OWNER, { taskMatch: { $nor: [] } });
        expect(names(data)).not.toContain('Private errand');
    });

    it('its $and and $or clauses still narrow the report', async () => {
        const data = await card(dashboard.getEmployeeWorkloadReport, MEMBER, { taskMatch: { $and: [{ TaskName: 'Shared work' }] } });
        expect(names(data)).toEqual(['Shared work']);
        const either = await card(dashboard.getEmployeeWorkloadReport, MEMBER, { taskMatch: { $or: [{ TaskName: 'Shared work' }, { TaskName: 'Other project work' }] } });
        expect(names(either)).toEqual(['Other project work', 'Shared work']);
    });
});
