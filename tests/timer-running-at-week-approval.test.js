const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();
const mockRoles = {};
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, userId) => mockRoles[userId]),
    evaluatePermission: jest.fn(async () => 0),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => []) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({
    loggedHours: () => 'added', loggedHoursUpdated: () => 'edited', loggedHoursDeleted: () => 'deleted',
}));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));
jest.mock('../common-storage/common-wasabi.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));
// Which task a timer may start on has its own suite (tracker-start-and-timelog-access); these cases are about the timer row.
jest.mock('../Modules/LogTime/controllerV2/sessionUser', () => ({ ...jest.requireActual('../Modules/LogTime/controllerV2/sessionUser'), trackedTask: jest.fn(async () => ({})) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const approval = require('../Modules/TimesheetApproval/controller');
const { manualLogTime } = require('../Modules/LogTime/controllerV2/manualLogtime');
const { timeTrackerStart, endTimeTracker } = require('../Modules/LogTime/controllerV2/tracker');
const { canStartTimer, trimTimer } = require('../Modules/LogTime/controllerV2/webTimer');

/* The approval, the lock guard and the timer handlers are the real ones; only the database is a stand-in. */

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const TASK = '6f0000000000000000000d01';
const SPRINT = '6f0000000000000000000a01';
const DAY_MS = 86400000;

const call = (handler, uid, { body = {}, params = {} } = {}) => new Promise((resolve, reject) => {
    const res = { code: 200, body: null };
    res.status = (code) => { res.code = code; return res; };
    res.send = (sent) => { res.body = sent; resolve(res); return res; };
    res.json = res.send;
    Promise.resolve(handler(verified({ headers: { companyid: C }, uid, query: {}, body, params }), res)).catch(reject);
});

const sessions = () => mockDb.store[SCHEMA_TYPE.TIMESHEET] || [];
const timeWrites = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.TIMESHEET && c.method !== 'findOne' && c.method !== 'find');

const startTracker = async () => {
    const res = await call(timeTrackerStart, ME, { body: { description: 'Deep work', projectId: P1, taskId: TASK } });
    expect(res.body.status).toBe(true);
    return sessions()[sessions().length - 1];
};
const stopTracker = (session) => call(endTimeTracker, ME, {
    body: {
        timeSheetId: session._id, sprintId: SPRINT, projectId: P1, taskId: TASK, taskName: 'Task', projectName: 'Project',
        companyOwnerId: ADMIN, dateFormat: 'DD-MM-yyyy', timeZone: 'UTC', strokes: [],
    },
});

/* One day either side of today, so the week covers "now" in whatever zone the suite runs. */
const approveThisWeek = async () => {
    const submitted = await call(approval.submitTimesheet, ME, {
        body: { periodStart: new Date(Date.now() - DAY_MS), periodEnd: new Date(Date.now() + DAY_MS) },
    });
    expect(submitted.body.status).toBe(true);
    const id = String(submitted.body.data._id);
    const approved = await call(approval.reviewTimesheet, ADMIN, { body: { action: 'approve' }, params: { id } });
    expect(approved.body.data.status).toBe('approved');
    return id;
};
const reopenWeek = (id) => call(approval.reviewTimesheet, ADMIN, { body: { action: 'reopen' }, params: { id } });

const today = () => new Date().toISOString().slice(0, 10);
const webTimerLog = () => call(manualLogTime, ME, {
    body: {
        logTimeDate: today(), description: 'Timer', startLogTime: '12:00', endLogTime: '12:25', timeDuration: '00:25',
        ticketId: TASK, projectId: P1, userId: ME, isEdit: false, dateFormat: 'DD/MM/YYYY', taskName: 'Task',
        projectName: 'Project', sprintId: SPRINT, companyOwnerId: ADMIN, timeZone: 'UTC',
    },
});

const expectRefusedAsLocked = (res) => {
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ status: false, code: 'period_locked' });
    expect(res.body.statusText).toMatch(/approved and locked/);
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.assign(mockRoles, { [ME]: 3, [ADMIN]: 2 });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ME, Employee_Name: 'Tara Tracker' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ADMIN, Employee_Name: 'Asha Admin' });
});

describe('a tracker timer that is running when its week is approved', () => {
    it('is not stopped while the week is approved: it stays running, untouched', async () => {
        const session = await startTracker();
        const asStarted = { ...session };
        await approveThisWeek();
        mockDb.calls.length = 0;

        expectRefusedAsLocked(await stopTracker(session));
        expect(timeWrites()).toHaveLength(0);
        expect(sessions()[0]).toEqual(asStarted);
        expect(sessions()[0].startTimeTracker).toBe(asStarted.LogStartTime);
    });

    it('is stopped with all of its time once the week is reopened', async () => {
        const session = await startTracker();
        sessions()[0].LogStartTime -= 90 * 60;
        const week = await approveThisWeek();
        expectRefusedAsLocked(await stopTracker(session));

        await reopenWeek(week);
        const res = await stopTracker(session);

        expect(res.body.status).toBe(true);
        expect(sessions()[0].LogTimeDuration).toBe(90);
        expect(sessions()[0].startTimeTracker).toBeUndefined();
    });

    it('is not trimmed either, and the refusal carries the code the web app reads', async () => {
        const session = await startTracker();
        await approveThisWeek();
        mockDb.calls.length = 0;

        expectRefusedAsLocked(await call(trimTimer, ME, { body: { timeSheetId: session._id, minutes: 30 } }));
        expect(timeWrites()).toHaveLength(0);
        expect(sessions()[0].startTimeTracker).toBeDefined();
    });
});

describe('a web timer that is running when its week is approved', () => {
    it('could start before the approval, and its time is refused after it with nothing written', async () => {
        expect((await call(canStartTimer, ME)).body.status).toBe(true);
        await approveThisWeek();
        mockDb.calls.length = 0;

        expectRefusedAsLocked(await webTimerLog());
        expect(timeWrites()).toHaveLength(0);
        expect(sessions()).toHaveLength(0);
    });

    it('is logged in full once the week is reopened', async () => {
        const week = await approveThisWeek();
        expectRefusedAsLocked(await webTimerLog());

        await reopenWeek(week);
        const res = await webTimerLog();

        expect(res.body.status).toBe(true);
        expect(sessions()).toHaveLength(1);
        expect(sessions()[0]).toMatchObject({ Loggeduser: ME, TicketID: TASK, LogTimeDuration: 25 });
    });
});
