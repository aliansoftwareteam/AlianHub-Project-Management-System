process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
const mockHistory = jest.fn(async () => true);
const mockNotify = jest.fn(async () => true);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: (...a) => mockHistory(...a) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: (...a) => mockNotify(...a) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({ loggedHours: (o) => `added by ${o.userName}` }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));
jest.mock('../common-storage/common-wasabi.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn() }));

const { timeTrackerStart, timeTrackerStart2, endTimeTracker } = require('../Modules/LogTime/controllerV2/tracker');
const { getTimelog } = require('../Modules/LogTime/controllerV2/timelog');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const ENTRY = '6f0000000000000000000e01';
const SESSION_NAME = 'Session Person';

let stored;

const startBody = (overrides = {}) => ({
    description: 'Tracker probe',
    userId: ME,
    projectId: '6f0000000000000000000b01',
    taskId: '6f0000000000000000000d01',
    companyId: C,
    ...overrides,
});

const endBody = (overrides = {}) => ({
    companyId: C,
    timeSheetId: ENTRY,
    userName: 'Body Name',
    userId: ME,
    sprintId: '6f0000000000000000000a01',
    projectId: '6f0000000000000000000b01',
    taskId: '6f0000000000000000000d01',
    taskName: 'Task',
    projectName: 'Project',
    companyOwnerId: '6f0000000000000000000009',
    dateFormat: 'DD-MM-yyyy',
    timeZone: 'UTC',
    strokes: [],
    ...overrides,
});

const call = (handler, body, uid = ME) => new Promise((resolve, reject) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; resolve(r); return r; };
    r.json = r.send;
    Promise.resolve(handler({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r)).catch(reject);
});

const calls = (method) => mockCrud.mock.calls.filter(([, , m]) => m === method);
const touchedCompanies = () => [...new Set(mockCrud.mock.calls.filter(([, { type }]) => type !== 'users').map(([companyId]) => companyId))];

beforeEach(() => {
    jest.clearAllMocks();
    stored = { _id: ENTRY, Loggeduser: ME, LogStartTime: 1772442000, trackShots: [] };
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === 'users' && method === 'findOne') return { _id: ME, Employee_Name: SESSION_NAME };
        if (type === 'company_users' && method === 'findOne') return { isTrackerUser: 1 };
        if (type === 'timesheets' && method === 'findOne') return stored;
        if (type === 'timesheets' && method === 'find') return [];
        if (method === 'save') return { id: 'new', ...data };
        if (method === 'findOneAndUpdate') return { _id: ENTRY };
        return null;
    });
});

describe.each([
    ['v2', () => timeTrackerStart],
    ['v3', () => timeTrackerStart2],
])('starting the %s tracker records the signed-in user', (_version, handler) => {
    it('starts the session\'s own timer as before', async () => {
        const r = await call(handler(), startBody());

        expect(r.body.status).toBe(true);
        expect(calls('save')[0][1].data.Loggeduser).toBe(ME);
        expect(touchedCompanies()).toEqual([C]);
    });

    it('starts the session\'s timer when the body leaves the user out', async () => {
        const body = startBody();
        delete body.userId;
        const r = await call(handler(), body);

        expect(r.body.status).toBe(true);
        expect(calls('save')[0][1].data.Loggeduser).toBe(ME);
    });

    it('refuses a body that names another user and writes nothing', async () => {
        const r = await call(handler(), startBody({ userId: OTHER }));

        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(calls('save')).toHaveLength(0);
    });

    it('refuses a body that names another company and writes nothing', async () => {
        const r = await call(handler(), startBody({ companyId: OTHER_COMPANY }));

        expect(r.code).toBe(403);
        expect(calls('save')).toHaveLength(0);
    });

    it('refuses a request without a signed-in user', async () => {
        const r = await call(handler(), startBody(), null);

        expect(r.code).toBe(401);
        expect(calls('save')).toHaveLength(0);
    });
});

describe('ending the tracker records the signed-in user', () => {
    it('ends the session\'s own timer, naming the session in history and notification', async () => {
        const r = await call(endTimeTracker, endBody());

        expect(r.body.status).toBe(true);
        expect(calls('findOneAndUpdate')).toHaveLength(1);
        expect(mockHistory.mock.calls[0][5]).toMatchObject({ id: ME });
        expect(mockHistory.mock.calls[0][4].message).toContain(SESSION_NAME);
        expect(mockHistory.mock.calls[0][4].message).not.toContain('Body Name');
        expect(mockNotify.mock.calls[0][0].userData).toMatchObject({ id: ME });
        expect(touchedCompanies()).toEqual([C]);
    });

    it('ends the session\'s timer when the body leaves the user out', async () => {
        const body = endBody();
        delete body.userId;
        delete body.userName;
        const r = await call(endTimeTracker, body);

        expect(r.body.status).toBe(true);
        expect(mockHistory.mock.calls[0][5]).toMatchObject({ id: ME });
    });

    it('refuses a body that names another user and changes nothing', async () => {
        const r = await call(endTimeTracker, endBody({ userId: OTHER }));

        expect(r.code).toBe(403);
        expect(calls('findOneAndUpdate')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('refuses to end a timer that belongs to another user', async () => {
        stored.Loggeduser = OTHER;
        const r = await call(endTimeTracker, endBody());

        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(calls('findOneAndUpdate')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('refuses a body that names another company and changes nothing', async () => {
        const r = await call(endTimeTracker, endBody({ companyId: OTHER_COMPANY }));

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('the tracker time log lists the signed-in user\'s entries', () => {
    const queriedUser = () => calls('find')[0][1].data[0].Loggeduser;

    it('lists the session\'s own entries as before', async () => {
        const r = await call(getTimelog, { companyId: C, userId: ME });

        expect(r.body.status).toBe(true);
        expect(JSON.stringify(queriedUser())).toContain(ME);
        expect(touchedCompanies()).toEqual([C]);
    });

    it('lists the session\'s entries when the body leaves the user out', async () => {
        const r = await call(getTimelog, { companyId: C });

        expect(r.body.status).toBe(true);
        expect(JSON.stringify(queriedUser())).toContain(ME);
    });

    it.each([
        ['another user', OTHER],
        ['a list that includes another user', [ME, OTHER]],
    ])('refuses a body that names %s and reads nothing', async (_label, userId) => {
        const r = await call(getTimelog, { companyId: C, userId });

        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(calls('find')).toHaveLength(0);
    });
});
