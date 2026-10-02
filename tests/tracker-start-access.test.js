const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

let mockDb;
const mockProjectTouch = jest.fn();
const mockStartDates = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({ loggedHours: () => '' }));
jest.mock('../Modules/Tasks/helpers/taskListProjects', () => require('./fixtures/taskListRules').taskListHeldEverywhere());
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: (...args) => mockProjectTouch(...args),
    findAndUpdateProjectOrTaskStartDate: (...args) => mockStartDates(...args),
    updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn(), storedFileExists: jest.fn(async () => false) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { timeTrackerStart, timeTrackerStart2 } = require('../Modules/LogTime/controllerV2/tracker');

const C = 'c00000000000000000000001';
const ME = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const oid = () => new mongoose.Types.ObjectId().toString();

const call = (handler, body, uid = ME) => new Promise((resolve, reject) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; resolve(r); return r; };
    r.json = r.send;
    Promise.resolve(handler(verified({ headers: { companyid: C }, body, query: {}, params: {}, uid }), r)).catch(reject);
});

const timers = () => mockDb.store[SCHEMA_TYPE.TIMESHEET] || [];
const taskIn = (projectId, extra = {}) => String(mockDb.seed(SCHEMA_TYPE.TASKS, { _id: oid(), ProjectID: projectId, TaskName: 'Task', deletedStatusKey: 0, ...extra })._id);

let open;
let hidden;

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    [ME, OTHER].forEach((userId) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false, isTrackerUser: 1 });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: 'Person' });
    });
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [OTHER] })._id);
});

describe.each([
    ['v2', () => timeTrackerStart],
    ['v3', () => timeTrackerStart2],
])('the %s tracker starts on a task its person can open', (_version, handler) => {
    it('starts a timer on a task of a project the caller can open', async () => {
        const taskId = taskIn(open);
        const r = await call(handler(), { description: 'Work', projectId: open, taskId, userId: ME });
        expect(r.body.status).toBe(true);
        expect(timers()).toHaveLength(1);
        expect(timers()[0]).toMatchObject({ Loggeduser: ME, ProjectId: open, TicketID: taskId });
    });

    it.each([
        ['a task of a project the caller cannot open', () => ({ projectId: hidden, taskId: taskIn(hidden) })],
        ['a task paired with another project', () => ({ projectId: open, taskId: taskIn(hidden) })],
        ['a hidden project paired with an open task', () => ({ projectId: hidden, taskId: taskIn(open) })],
        ['a task that does not exist', () => ({ projectId: open, taskId: oid() })],
        ['ids that are not ids', () => ({ projectId: { $ne: '' }, taskId: { $ne: '' } })],
    ])('answers 404 for %s and touches nothing', async (_label, named) => {
        const r = await call(handler(), { description: 'Work', userId: ME, ...named() });
        expect(r.code).toBe(404);
        expect(timers()).toHaveLength(0);
        expect(mockProjectTouch).not.toHaveBeenCalled();
        expect(mockStartDates).not.toHaveBeenCalled();
    });
});
