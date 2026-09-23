process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
const mockHistory = jest.fn(async () => true);
const mockNotify = jest.fn(async () => true);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    evaluatePermission: jest.fn(),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: (...a) => mockHistory(...a) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: (...a) => mockNotify(...a) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({
    loggedHours: () => 'added', loggedHoursUpdated: () => 'edited', loggedHoursDeleted: () => 'deleted',
}));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));
jest.mock('../common-storage/common-wasabi.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));

const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { manualLogTime, deleteManualLogtime } = require('../Modules/LogTime/controllerV2/manualLogtime');
const { timeTrackerStart, timeTrackerStart2, endTimeTracker } = require('../Modules/LogTime/controllerV2/tracker');

/* Owner decision, follow-up 109: a new entry in an approved timesheet period is refused, like
 * edits and deletes. The real lock guard runs against the approvals below. */

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const ENTRY = '6f0000000000000000000e01';
const MEMBER = 3;

const LOCKED_DAY = '2026-03-02';
const OPEN_DAY = '2026-03-10';
const LOCKED_START_SEC = Date.parse(`${LOCKED_DAY}T09:00:00Z`) / 1000;
const OPEN_START_SEC = Date.parse(`${OPEN_DAY}T09:00:00Z`) / 1000;

const localMidnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const approvedPeriod = (userId, from, to) => ({ userId, status: 'approved', deletedStatusKey: 0, periodStart: localMidnight(from), periodEnd: localMidnight(to) });

let approvals;
let stored;

const approvalMatching = (q) => approvals.find((a) => a.userId === q.userId && a.status === q.status && a.deletedStatusKey === q.deletedStatusKey
    && a.periodStart.getTime() <= q.periodStart.$lte.getTime() && a.periodEnd.getTime() >= q.periodEnd.$gte.getTime()) || null;

const logBody = (overrides = {}) => ({
    logTimeDate: LOCKED_DAY,
    description: 'Lock probe',
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: '6f0000000000000000000d01',
    projectId: P1,
    companyId: C,
    userId: ME,
    isEdit: false,
    userName: 'Body Name',
    dateFormat: 'DD/MM/YYYY',
    taskName: 'Task',
    projectName: 'Project',
    sprintId: '6f0000000000000000000a01',
    companyOwnerId: '6f0000000000000000000009',
    timeZone: 'UTC',
    ...overrides,
});
const editBody = (overrides = {}) => logBody({ isEdit: true, timeSheetId: ENTRY, previousLoggedTime: '0:30', ...overrides });
const deleteBody = (overrides = {}) => ({ ...logBody(), timeSheetId: ENTRY, timeDuration: 60, ...overrides });

const startBody = (overrides = {}) => ({
    description: 'Tracker probe', userId: ME, projectId: P1, taskId: '6f0000000000000000000d01', companyId: C, ...overrides,
});
const endBody = (overrides = {}) => ({
    companyId: C, timeSheetId: ENTRY, userId: ME, sprintId: '6f0000000000000000000a01', projectId: P1,
    taskId: '6f0000000000000000000d01', taskName: 'Task', projectName: 'Project', companyOwnerId: '6f0000000000000000000009',
    dateFormat: 'DD-MM-yyyy', timeZone: 'UTC', strokes: [], ...overrides,
});

const call = (handler, body, uid = ME) => new Promise((resolve, reject) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; resolve(r); return r; };
    r.json = r.send;
    Promise.resolve(handler({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r)).catch(reject);
});

const writes = (method) => mockCrud.mock.calls.filter(([, { type }, m]) => m === method && type === 'timesheets');

const expectRefusedAsLocked = (r) => {
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ status: false, code: 'period_locked' });
    expect(r.body.statusText).toMatch(/approved and locked/);
};

beforeEach(() => {
    jest.clearAllMocks();
    approvals = [approvedPeriod(ME, '2026-03-01T12:00:00Z', '2026-03-07T12:00:00Z')];
    stored = { _id: ENTRY, Loggeduser: ME, ProjectId: P1, LogStartTime: OPEN_START_SEC, trackShots: [], startTimeTracker: OPEN_START_SEC };
    visibleProjectIds.mockResolvedValue([P1]);
    getRoleType.mockResolvedValue(MEMBER);
    evaluatePermission.mockResolvedValue(0);
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === 'users' && method === 'findOne') return { _id: ME, Employee_Name: 'Session Person' };
        if (type === 'company_users' && method === 'findOne') return { isTrackerUser: 1 };
        if (type === 'company_users' && method === 'find') return data[0].userId.$in.map((userId) => ({ userId }));
        if (type === 'timesheet_approval' && method === 'findOne') return approvalMatching(data[0]);
        if (type === 'timesheets' && method === 'findOne') return stored;
        if (method === 'save') return { _id: 'new', id: 'new', ...data };
        if (method === 'findOneAndUpdate') return { _id: ENTRY };
        if (method === 'deleteOne') return { deletedCount: 1 };
        return null;
    });
});

describe('a new manual entry in an approved period', () => {
    it('is refused like an edit, and nothing is written, logged or notified', async () => {
        const r = await call(manualLogTime, logBody());

        expectRefusedAsLocked(r);
        expect(writes('save')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('is checked against the person the time is for, not the caller', async () => {
        evaluatePermission.mockImplementation(async (_c, _u, key) => (key === 'sheet_settings.user_timesheet' ? 2 : 0));
        approvals = [approvedPeriod(OTHER, '2026-03-01T12:00:00Z', '2026-03-07T12:00:00Z')];

        expectRefusedAsLocked(await call(manualLogTime, logBody({ userId: OTHER })));
        expect(writes('save')).toHaveLength(0);

        const own = await call(manualLogTime, logBody());
        expect(own.body.status).toBe(true);
        expect(writes('save')).toHaveLength(1);
    });

    it('is still logged on a day outside the approved period', async () => {
        const r = await call(manualLogTime, logBody({ logTimeDate: OPEN_DAY }));

        expect(r.body.status).toBe(true);
        expect(writes('save')).toHaveLength(1);
        expect(writes('save')[0][1].data.Loggeduser).toBe(ME);
    });

    it('is still logged when the period is only submitted, not approved', async () => {
        approvals[0].status = 'submitted';
        const r = await call(manualLogTime, logBody());

        expect(r.body.status).toBe(true);
        expect(writes('save')).toHaveLength(1);
    });
});

describe('edits and deletes keep their lock behaviour', () => {
    it('edits an entry on an open day', async () => {
        const r = await call(manualLogTime, editBody({ logTimeDate: OPEN_DAY }));

        expect(r.body.status).toBe(true);
        expect(writes('findOneAndUpdate')).toHaveLength(1);
    });

    it('refuses to edit an entry in the approved period with the edit message', async () => {
        stored.LogStartTime = LOCKED_START_SEC;
        const r = await call(manualLogTime, editBody());

        expect(r.body).toMatchObject({ status: false, statusText: expect.stringMatching(/can't be edited/) });
        expect(writes('findOneAndUpdate')).toHaveLength(0);
    });

    it('deletes an entry on an open day and refuses one in the approved period', async () => {
        expect((await call(deleteManualLogtime, deleteBody())).body.status).toBe(true);
        stored.LogStartTime = LOCKED_START_SEC;
        const r = await call(deleteManualLogtime, deleteBody());

        expect(r.body).toMatchObject({ status: false, statusText: expect.stringMatching(/can't be deleted/) });
        expect(writes('deleteOne')).toHaveLength(1);
    });
});

describe('the desktop tracker', () => {
    const lockToday = () => {
        const now = Date.now();
        approvals = [approvedPeriod(ME, now - 86400000, now + 86400000)];
    };

    it.each([
        ['v2', () => timeTrackerStart],
        ['v3', () => timeTrackerStart2],
    ])('refuses to start a %s timer on a day in an approved period', async (_v, handler) => {
        lockToday();
        const r = await call(handler(), startBody());

        expectRefusedAsLocked(r);
        expect(writes('save')).toHaveLength(0);
    });

    it('refuses a v3 start back-dated into an approved period', async () => {
        const r = await call(timeTrackerStart2, startBody({ considerActionTime: true, actionTime: LOCKED_START_SEC }));

        expectRefusedAsLocked(r);
        expect(writes('save')).toHaveLength(0);
    });

    it.each([
        ['v2', () => timeTrackerStart, {}],
        ['v3', () => timeTrackerStart2, {}],
        ['v3 back-dated', () => timeTrackerStart2, { considerActionTime: true, actionTime: OPEN_START_SEC }],
    ])('still starts a %s timer on an open day', async (_v, handler, extra) => {
        const r = await call(handler(), startBody(extra));

        expect(r.body.status).toBe(true);
        expect(writes('save')).toHaveLength(1);
    });

    it('refuses to stop a timer whose start day is in an approved period, leaving it unchanged', async () => {
        stored.LogStartTime = LOCKED_START_SEC;
        stored.startTimeTracker = LOCKED_START_SEC;
        const r = await call(endTimeTracker, endBody());

        expectRefusedAsLocked(r);
        expect(writes('findOneAndUpdate')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('stops a timer started on an open day', async () => {
        const r = await call(endTimeTracker, endBody());

        expect(r.body.status).toBe(true);
        expect(writes('findOneAndUpdate')).toHaveLength(1);
    });
});
