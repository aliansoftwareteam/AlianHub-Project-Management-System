const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({
    loggedHours: () => 'added', loggedHoursUpdated: () => 'edited', loggedHoursDeleted: () => 'deleted',
}));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/LogTime/controllerV2/tracker', () => ({}));
jest.mock('../Modules/LogTime/controllerV2/capture', () => ({}));
jest.mock('../Modules/LogTime/controllerV2/timelog', () => ({}));
jest.mock('../Modules/LogTime/controllerV2/webTimer', () => ({}));
jest.mock('../common-storage/common-server.js', () => ({ handleMulterStorage: () => ({}) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateRemainingTime } = require('../Modules/LogTime/controllerV2/helpers');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const MEMBER = 'a00000000000000000000003';
const TEAMMATE = 'a00000000000000000000004';
const MEMBER_ROLE = 3;
const ENTRIES_ROUTE = 'GET /api/v1/timesheet/task/:taskId';

const oid = () => new mongoose.Types.ObjectId().toString();

const routes = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require('../Modules/LogTime/routes').init(app);
    require('../Modules/TimeSheet/routes').init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    return res;
};

const run = async (handlers, req) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const call = (route, { uid = MEMBER, params = {}, body = {}, query = {} } = {}) => run(
    routes()[route],
    verified({ uid, params, body, query, headers: { companyid: C } }),
);

const seedRules = (grants = {}) => {
    const parents = {};
    const parentOf = (section) => {
        if (!parents[section]) parents[section] = mockDb.seed(SCHEMA_TYPE.RULES, { key: section, isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
        return parents[section];
    };
    Object.entries(grants).forEach(([path, permission]) => {
        const [section, key] = path.split('.');
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parentOf(section)._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const seedProject = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, {
    _id: oid(), ProjectName: 'Launch', isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER, TEAMMATE], isGlobalPermission: true, deletedStatusKey: 0, ...doc,
});

const seedTask = (project, doc = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(), ProjectID: String(project._id), TaskName: 'Write spec', AssigneeUserId: [TEAMMATE], totalEstimatedTime: 240, deletedStatusKey: 0, ...doc,
});

const at = (iso) => Math.floor(new Date(iso).getTime() / 1000);

const seedEntry = (task, doc = {}) => mockDb.seed(SCHEMA_TYPE.TIMESHEET, {
    _id: new mongoose.Types.ObjectId(),
    TicketID: String(task._id),
    ProjectId: String(task.ProjectID),
    LogStartTime: at('2026-09-21T09:00:00Z'),
    LogEndTime: at('2026-09-21T10:00:00Z'),
    LogTimeDuration: 60,
    LogDescription: 'Work',
    logAddType: 0,
    billable: true,
    ...doc,
});

const approve = (userId, from, to) => mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
    userId, status: 'approved', deletedStatusKey: 0, periodStart: new Date(from), periodEnd: new Date(to),
});

const logBody = (task, overrides = {}) => ({
    logTimeDate: '2026-09-22',
    description: 'Panel entry',
    startLogTime: '09:00',
    endLogTime: '10:30',
    timeDuration: '01:30',
    ticketId: String(task._id),
    projectId: String(task.ProjectID),
    isEdit: false,
    dateFormat: 'DD/MM/YYYY',
    taskName: task.TaskName,
    projectName: 'Launch',
    sprintId: 'sprint-1',
    companyOwnerId: OWNER,
    timeZone: 'UTC',
    billable: false,
    ...overrides,
});

const timesheets = () => mockDb.store[SCHEMA_TYPE.TIMESHEET] || [];

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: TEAMMATE, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    updateRemainingTime.mockClear();
});

describe('adding time from the task panel', () => {
    it('logs a non-assignee member\'s own time on a task they can see, and refreshes the task\'s remaining time', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject());

        const res = await call('POST /api/v2/manualLogtime', { body: logBody(task) });

        expect(res.body).toMatchObject({ status: true });
        expect(timesheets()).toHaveLength(1);
        expect(timesheets()[0]).toMatchObject({ Loggeduser: MEMBER, TicketID: String(task._id), LogTimeDuration: 90, billable: false, logAddType: 0 });
        expect(updateRemainingTime).toHaveBeenCalledWith(C, String(task._id));
    });

    it('refuses a member outside the private project the task lives in, and writes nothing', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject({ AssigneeUserId: [OWNER] }));

        const res = await call('POST /api/v2/manualLogtime', { body: logBody(task) });

        expect(res.statusCode).toBe(404);
        expect(timesheets()).toHaveLength(0);
    });

    it('reads the project off the stored task, not the project id in the body', async () => {
        seedRules({ 'project.private_projects': 1 });
        const hidden = seedTask(seedProject({ AssigneeUserId: [OWNER] }));
        const open = seedProject({ isPrivateSpace: false, AssigneeUserId: [] });

        const res = await call('POST /api/v2/manualLogtime', { body: logBody(hidden, { projectId: String(open._id) }) });

        expect(res.statusCode).toBe(404);
        expect(timesheets()).toHaveLength(0);
    });

    it('refuses deleting an entry on a task the caller cannot see', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject({ AssigneeUserId: [OWNER] }));
        const entry = seedEntry(task, { Loggeduser: MEMBER });

        const res = await call('POST /api/v2/deleteManualLogtime', {
            body: { ...logBody(task), timeSheetId: String(entry._id), timeDuration: 60 },
        });

        expect(res.statusCode).toBe(404);
        expect(timesheets()).toHaveLength(1);
    });

    it('keeps new time out of an approved, locked period', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject());
        approve(MEMBER, '2026-09-21T00:00:00', '2026-09-27T00:00:00');

        const res = await call('POST /api/v2/manualLogtime', { body: logBody(task) });

        expect(res.body).toMatchObject({ status: false, code: 'period_locked' });
        expect(timesheets()).toHaveLength(0);
    });

    it('still refuses logging for someone who is not a member of the company', async () => {
        seedRules({ 'project.private_projects': 1, 'sheet_settings.user_timesheet': 2 });
        const task = seedTask(seedProject());

        const res = await call('POST /api/v2/manualLogtime', { uid: OWNER, body: logBody(task, { userId: oid() }) });

        expect(res.statusCode).toBe(400);
        expect(timesheets()).toHaveLength(0);
    });
});

describe('the task\'s time entries', () => {
    it('shows a member their own entries, the whole task total and the estimate', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject());
        const mine = seedEntry(task, { Loggeduser: MEMBER, LogTimeDuration: 45 });
        seedEntry(task, { Loggeduser: TEAMMATE, LogTimeDuration: 120 });

        const res = await call(ENTRIES_ROUTE, { params: { taskId: String(task._id) } });

        expect(res.body).toMatchObject({ status: true, data: { totalMinutes: 165, mineMinutes: 45, estimateMinutes: 240, seesEveryone: false } });
        expect(res.body.data.entries.map((e) => e._id)).toEqual([String(mine._id)]);
        expect(res.body.data.entries[0]).toMatchObject({ userId: MEMBER, minutes: 45, note: 'Work', billable: true, locked: false, canEdit: true });
    });

    it('marks an entry in an approved period locked and not editable', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject());
        seedEntry(task, { Loggeduser: MEMBER });
        approve(MEMBER, '2026-09-21T00:00:00', '2026-09-27T00:00:00');

        const res = await call(ENTRIES_ROUTE, { params: { taskId: String(task._id) } });

        expect(res.body.data.entries[0]).toMatchObject({ locked: true, canEdit: false });
    });

    it('does not offer to edit a desktop tracker entry', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject());
        seedEntry(task, { Loggeduser: MEMBER, logAddType: 1 });

        const res = await call(ENTRIES_ROUTE, { params: { taskId: String(task._id) } });

        expect(res.body.data.entries[0]).toMatchObject({ source: 'tracker', canEdit: false });
    });

    it('shows everyone\'s entries, newest first, to a caller whose timesheet scope is everyone', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject());
        seedEntry(task, { Loggeduser: MEMBER, LogStartTime: at('2026-09-20T09:00:00Z') });
        const newest = seedEntry(task, { Loggeduser: TEAMMATE, LogStartTime: at('2026-09-23T09:00:00Z') });

        const res = await call(ENTRIES_ROUTE, { uid: OWNER, params: { taskId: String(task._id) } });

        expect(res.body.data.seesEveryone).toBe(true);
        expect(res.body.data.entries.map((e) => e.userId)).toEqual([TEAMMATE, MEMBER]);
        expect(res.body.data.entries[0]).toMatchObject({ _id: String(newest._id), canEdit: true });
    });

    it('answers 404 to a member outside the private project', async () => {
        seedRules({ 'project.private_projects': 1 });
        const task = seedTask(seedProject({ AssigneeUserId: [OWNER] }));
        seedEntry(task, { Loggeduser: OWNER });

        const res = await call(ENTRIES_ROUTE, { params: { taskId: String(task._id) } });

        expect(res.statusCode).toBe(404);
    });

    it('answers 404 for a task the company does not have', async () => {
        const res = await call(ENTRIES_ROUTE, { uid: OWNER, params: { taskId: oid() } });

        expect(res.statusCode).toBe(404);
    });
});
