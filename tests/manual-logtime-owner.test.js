process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
const mockHistory = jest.fn(async () => true);
const mockNotify = jest.fn(async () => true);
const mockLocked = jest.fn(async () => false);

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
jest.mock('../Modules/TimesheetApproval/helpers/lockGuard', () => ({ isPeriodLocked: (...a) => mockLocked(...a) }));
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

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const P2 = '6f0000000000000000000b02';
const ENTRY = '6f0000000000000000000e01';
const MEMBER = 3;
const ADMIN = 2;
const SESSION_NAME = 'Session Person';

let stored;

const logBody = (overrides = {}) => ({
    logTimeDate: '2026-03-02',
    description: 'Owner probe',
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

const call = (handler, body, uid = ME) => new Promise((resolve, reject) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; resolve(r); return r; };
    r.json = r.send;
    Promise.resolve(handler({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r)).catch(reject);
});

const writes = (method) => mockCrud.mock.calls.filter(([, , m]) => m === method);
const savedOwner = () => writes('save')[0][1].data.Loggeduser;
const updatedOwner = () => writes('findOneAndUpdate')[0][1].data[1].$set.Loggeduser;
const historyActor = () => mockHistory.mock.calls[0][5];
const historyMessage = () => mockHistory.mock.calls[0][4].message;
const notifiedActor = () => mockNotify.mock.calls[0][0].userData;

const asMember = ({ scoped = false } = {}) => {
    getRoleType.mockResolvedValue(MEMBER);
    evaluatePermission.mockImplementation(async (_c, _u, key) => (scoped && key === 'sheet_settings.user_timesheet' ? 2 : 0));
};

beforeEach(() => {
    jest.clearAllMocks();
    stored = { _id: ENTRY, Loggeduser: OTHER, ProjectId: P1, LogStartTime: 1772442000 };
    visibleProjectIds.mockResolvedValue([P1]);
    asMember();
    mockLocked.mockResolvedValue(false);
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === 'users' && method === 'findOne') return { _id: ME, Employee_Name: SESSION_NAME };
        if (type === 'timesheets' && method === 'findOne') return stored;
        if (method === 'save') return { _id: 'new', ...data };
        if (method === 'findOneAndUpdate') return { _id: ENTRY, ...data[1].$set };
        if (method === 'deleteOne') return { deletedCount: 1 };
        return null;
    });
});

describe('manual log time records the signed-in user', () => {
    it('logs a person\'s own time as before', async () => {
        const r = await call(manualLogTime, logBody());

        expect(r.body.status).toBe(true);
        expect(savedOwner()).toBe(ME);
        expect(historyActor()).toMatchObject({ id: ME });
        expect(notifiedActor()).toMatchObject({ id: ME });
    });

    it('logs the session\'s own time when the body leaves the person out', async () => {
        const body = logBody();
        delete body.userId;
        const r = await call(manualLogTime, body);

        expect(r.body.status).toBe(true);
        expect(savedOwner()).toBe(ME);
    });

    it('refuses another person\'s time for a caller without the timesheet scope and writes nothing', async () => {
        const r = await call(manualLogTime, logBody({ userId: OTHER }));

        expect(r.body.status).toBe(false);
        expect(r.code).toBe(403);
        expect(writes('save')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('logs another person\'s time for a caller whose timesheet scope is everyone, naming the session in history and notification', async () => {
        asMember({ scoped: true });
        const r = await call(manualLogTime, logBody({ userId: OTHER }));

        expect(r.body.status).toBe(true);
        expect(savedOwner()).toBe(OTHER);
        expect(historyActor()).toMatchObject({ id: ME });
        expect(notifiedActor()).toMatchObject({ id: ME });
        expect(historyMessage()).toContain(SESSION_NAME);
        expect(historyMessage()).not.toContain('Body Name');
    });

    it('logs another person\'s time for an admin', async () => {
        getRoleType.mockResolvedValue(ADMIN);
        const r = await call(manualLogTime, logBody({ userId: OTHER, projectId: P2 }));

        expect(r.body.status).toBe(true);
        expect(savedOwner()).toBe(OTHER);
        expect(historyActor()).toMatchObject({ id: ME });
    });

    it('refuses another person\'s time on a project outside the scoped caller\'s projects', async () => {
        asMember({ scoped: true });
        const r = await call(manualLogTime, logBody({ userId: OTHER, projectId: P2 }));

        expect(r.body.status).toBe(false);
        expect(writes('save')).toHaveLength(0);
    });
});

describe('editing a manual entry', () => {
    it('edits the session\'s own entry', async () => {
        stored.Loggeduser = ME;
        const r = await call(manualLogTime, editBody());

        expect(r.body.status).toBe(true);
        expect(updatedOwner()).toBe(ME);
        expect(historyActor()).toMatchObject({ id: ME });
        expect(notifiedActor()).toMatchObject({ id: ME });
    });

    it('refuses to edit another person\'s entry without the timesheet scope', async () => {
        const r = await call(manualLogTime, editBody({ userId: ME }));

        expect(r.body.status).toBe(false);
        expect(writes('findOneAndUpdate')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('refuses to move an own entry to another person without the timesheet scope', async () => {
        stored.Loggeduser = ME;
        const r = await call(manualLogTime, editBody({ userId: OTHER }));

        expect(r.body.status).toBe(false);
        expect(writes('findOneAndUpdate')).toHaveLength(0);
    });

    it('edits another person\'s entry with the scope, keeping them as its owner and naming the session', async () => {
        asMember({ scoped: true });
        const r = await call(manualLogTime, editBody({ userId: OTHER }));

        expect(r.body.status).toBe(true);
        expect(updatedOwner()).toBe(OTHER);
        expect(historyActor()).toMatchObject({ id: ME });
        expect(notifiedActor()).toMatchObject({ id: ME });
    });

    it('keeps the stored owner when a scoped caller edits without naming a person', async () => {
        asMember({ scoped: true });
        const body = editBody();
        delete body.userId;
        const r = await call(manualLogTime, body);

        expect(r.body.status).toBe(true);
        expect(updatedOwner()).toBe(OTHER);
    });

    it('checks the approved-period lock against the stored entry\'s owner', async () => {
        asMember({ scoped: true });
        mockLocked.mockImplementation(async ({ userId }) => userId === OTHER);
        const r = await call(manualLogTime, editBody({ userId: OTHER }));

        expect(r.body.status).toBe(false);
        expect(mockLocked).toHaveBeenCalledWith(expect.objectContaining({ userId: OTHER }));
        expect(writes('findOneAndUpdate')).toHaveLength(0);
    });

    it('falls back to the resolved owner for the lock when the stored entry has none', async () => {
        stored.Loggeduser = undefined;
        const body = editBody();
        delete body.userId;
        await call(manualLogTime, body);

        expect(mockLocked).toHaveBeenCalledWith(expect.objectContaining({ userId: ME }));
    });
});

describe('deleting a manual entry', () => {
    it('deletes the session\'s own entry and names the session', async () => {
        stored.Loggeduser = ME;
        const r = await call(deleteManualLogtime, deleteBody());

        expect(r.body.status).toBe(true);
        expect(writes('deleteOne')).toHaveLength(1);
        expect(historyActor()).toMatchObject({ id: ME });
        expect(notifiedActor()).toMatchObject({ id: ME });
    });

    it('refuses to delete another person\'s entry without the timesheet scope', async () => {
        const r = await call(deleteManualLogtime, deleteBody({ userId: ME }));

        expect(r.body.status).toBe(false);
        expect(writes('deleteOne')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('deletes another person\'s entry with the scope and names the session, whatever the body says', async () => {
        asMember({ scoped: true });
        const r = await call(deleteManualLogtime, deleteBody({ userId: OTHER }));

        expect(r.body.status).toBe(true);
        expect(writes('deleteOne')).toHaveLength(1);
        expect(historyActor()).toMatchObject({ id: ME });
        expect(notifiedActor()).toMatchObject({ id: ME });
        expect(historyMessage()).toContain(SESSION_NAME);
    });

    it('checks the approved-period lock against the stored entry\'s owner, not the body', async () => {
        asMember({ scoped: true });
        mockLocked.mockImplementation(async ({ userId }) => userId === OTHER);
        const r = await call(deleteManualLogtime, deleteBody({ userId: ME }));

        expect(r.body.status).toBe(false);
        expect(mockLocked).toHaveBeenCalledWith(expect.objectContaining({ userId: OTHER }));
        expect(writes('deleteOne')).toHaveLength(0);
    });

    it('falls back to the resolved owner for the lock when the stored entry has none', async () => {
        stored.Loggeduser = undefined;
        const body = deleteBody();
        delete body.userId;
        await call(deleteManualLogtime, body);

        expect(mockLocked).toHaveBeenCalledWith(expect.objectContaining({ userId: ME }));
    });
});
