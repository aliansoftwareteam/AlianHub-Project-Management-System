process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
const mockLocked = jest.fn(async () => false);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({
    loggedHours: () => 'added', loggedHoursUpdated: () => 'edited', loggedHoursDeleted: () => 'deleted',
}));
jest.mock('../Modules/TimesheetApproval/helpers/lockGuard', () => ({ isPeriodLocked: (...a) => mockLocked(...a), PERIOD_LOCKED: 'period_locked' }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));
jest.mock('../common-storage/common-wasabi.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));

const { manualLogTime } = require('../Modules/LogTime/controllerV2/manualLogtime');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const ENTRY = '6f0000000000000000000e01';
const OPEN_DAY = '2026-03-02';
const OTHER_OPEN_DAY = '2026-03-03';
const APPROVED_DAY = '2026-03-09';
const APPROVED_FROM = new Date('2026-03-09T00:00:00Z');

const editBody = (logTimeDate) => ({
    logTimeDate,
    description: 'Move probe',
    startLogTime: '09:00',
    endLogTime: '10:00',
    timeDuration: '1:00',
    ticketId: '6f0000000000000000000d01',
    projectId: '6f0000000000000000000b01',
    companyId: C,
    userId: ME,
    isEdit: true,
    timeSheetId: ENTRY,
    previousLoggedTime: '1:00',
    userName: 'Body Name',
    dateFormat: 'DD/MM/YYYY',
    taskName: 'Task',
    projectName: 'Project',
    sprintId: '6f0000000000000000000a01',
    companyOwnerId: '6f0000000000000000000009',
    timeZone: 'UTC',
});

const call = (body) => new Promise((resolve, reject) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; resolve(r); return r; };
    r.json = r.send;
    Promise.resolve(manualLogTime({ headers: { companyid: C }, body, query: {}, params: {}, uid: ME }, r)).catch(reject);
});

const updates = () => mockCrud.mock.calls.filter(([, , m]) => m === 'findOneAndUpdate');

beforeEach(() => {
    jest.clearAllMocks();
    mockLocked.mockImplementation(async ({ date }) => date >= APPROVED_FROM);
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === 'users' && method === 'findOne') return { _id: ME, Employee_Name: 'Session Person' };
        if (type === 'timesheets' && method === 'findOne') {
            return { _id: ENTRY, Loggeduser: ME, ProjectId: '6f0000000000000000000b01', LogStartTime: Date.parse(`${OPEN_DAY}T09:00:00Z`) / 1000 };
        }
        if (method === 'findOneAndUpdate') return { _id: ENTRY, ...data[1].$set };
        return null;
    });
});

describe('editing a manual entry', () => {
    it('refuses moving an entry from an open day into an approved day', async () => {
        const r = await call(editBody(APPROVED_DAY));

        expect(r.body).toMatchObject({ status: false, code: 'period_locked' });
        expect(updates()).toHaveLength(0);
    });

    it('still moves an entry between open days', async () => {
        const r = await call(editBody(OTHER_OPEN_DAY));

        expect(r.body.status).toBe(true);
        expect(updates()).toHaveLength(1);
    });
});
