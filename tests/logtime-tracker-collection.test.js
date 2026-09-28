const verified = require('./fixtures/verifiedRequest');
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

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const ENTRY = '6f0000000000000000000e01';
const FOREIGN = 'projects';

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
    Promise.resolve(handler(verified({ headers: { companyid: C }, body, query: {}, params: {}, uid }), r)).catch(reject);
});

const calls = (method) => mockCrud.mock.calls.filter(([, , m]) => m === method);
const typesOf = (method) => calls(method).map(([, { type }]) => type);

beforeEach(() => {
    jest.clearAllMocks();
    stored = { _id: ENTRY, Loggeduser: ME, LogStartTime: 1772442000, trackShots: [] };
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === 'users' && method === 'findOne') return { _id: ME, Employee_Name: 'Session Person' };
        if (type === 'company_users' && method === 'findOne') return { isTrackerUser: 1 };
        if ((type === 'timesheets' || type === FOREIGN) && method === 'findOne') return stored;
        if (method === 'save') return { id: 'new', ...data };
        if (method === 'findOneAndUpdate') return { _id: ENTRY };
        return null;
    });
});

describe.each([
    ['v2', () => timeTrackerStart],
    ['v3', () => timeTrackerStart2],
])('starting the %s tracker writes only time records', (_version, handler) => {
    it.each([
        ['names the time records', { type: 'timesheets' }],
        ['leaves the type out', {}],
    ])('starts a timer when the body %s', async (_label, extra) => {
        const r = await call(handler(), startBody(extra));

        expect(r.body.status).toBe(true);
        expect(typesOf('save')).toEqual(['timesheets']);
    });

    it('writes the timer to the time records whatever type the body names', async () => {
        const r = await call(handler(), startBody({ type: FOREIGN }));

        expect(r.body.status).toBe(true);
        expect(typesOf('save')).toEqual(['timesheets']);
    });
});

describe('stopping the tracker touches only time records', () => {
    it('stops the session\'s own timer as before', async () => {
        const r = await call(endTimeTracker, endBody({ type: 'timesheets' }));

        expect(r.body.status).toBe(true);
        expect(typesOf('findOneAndUpdate')).toEqual(['timesheets']);
        expect(mockHistory).toHaveBeenCalledTimes(1);
    });

    it('never reads or changes another collection whatever type the body names', async () => {
        const r = await call(endTimeTracker, endBody({ type: FOREIGN }));

        expect(r.body.status).toBe(true);
        expect(typesOf('findOne')).not.toContain(FOREIGN);
        expect(typesOf('findOneAndUpdate')).toEqual(['timesheets']);
    });

    it('answers that the entry was not found when the id is unknown, and changes nothing', async () => {
        stored = null;
        const r = await call(endTimeTracker, endBody());

        expect(r.code).toBe(404);
        expect(r.body.status).toBe(false);
        expect(r.body.statusText).toBe('No time entry was found for this timer.');
        expect(calls('findOneAndUpdate')).toHaveLength(0);
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });
});
