/* Task 040 phase 2: a time log's and a time plan's ProjectId are stored as ObjectIds, whichever form
   the writer passed. Every stored form here is read from what Mongoose hands the driver under the
   real timesheet and estimated_time schemas; the handlers' own database calls are only recorded. */
const mongoose = require('mongoose');
const verified = require('./fixtures/verifiedRequest');

process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 2), evaluatePermission: jest.fn(async () => 2), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => []) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({ loggedHours: () => 'added', loggedHoursUpdated: () => 'edited', loggedHoursDeleted: () => 'deleted' }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn() }));
jest.mock('../Modules/Users/controller', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ updateSprintFun: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateSprintCount: jest.fn() }));
jest.mock('../Modules/Comments/controller', () => ({ updateCommentCollection: jest.fn(), addCommentCollection: jest.fn() }));
jest.mock('../Modules/serviceFunction', () => ({}));
jest.mock('../common-storage/common-server.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn(), handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../common-storage/common-wasabi.js', () => ({ handleFileUploadForTrackerSS: jest.fn(), handleuploadMainFileForbase64Thumbnail: jest.fn(), handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
// Which task a timer may start on has its own suite (tracker-start-and-timelog-access); these cases are about the timer row.
jest.mock('../Modules/LogTime/controllerV2/sessionUser', () => ({ ...jest.requireActual('../Modules/LogTime/controllerV2/sessionUser'), trackedTask: jest.fn(async () => ({})) }));

const { timeSheetSchema, estimatedTimeSchema } = require('../utils/mongo-handler/createSchema');
const { realModelStore, isObjectId } = require('./fixtures/realModelStore');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { manualLogTime } = require('../Modules/LogTime/controllerV2/manualLogtime');
const { timeTrackerStart, timeTrackerStart2 } = require('../Modules/LogTime/controllerV2/tracker');
const { buildEstimateWrite } = require('../Modules/EstimatedTime/helpers/estimateWriteScope');
const taskMove = require('../Modules/Tasks/helpers/mongo_helper');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const TASK = '6f0000000000000000000d01';
const ENTRY = '6f0000000000000000000e01';
const OPEN_DAY = '2026-03-10';
const oid = (id) => new mongoose.Types.ObjectId(id);

const STORES = {
    [SCHEMA_TYPE.TIMESHEET]: realModelStore(SCHEMA_TYPE.TIMESHEET, timeSheetSchema),
    [SCHEMA_TYPE.ESTIMATES_TIME]: realModelStore(SCHEMA_TYPE.ESTIMATES_TIME, estimatedTimeSchema),
};

const logDoc = (extra = {}) => ({ LogDescription: 'Work', Loggeduser: ME, TicketID: TASK, LogStartTime: 1, LogEndTime: 2, LogTimeDuration: 1, ProjectId: PROJECT, ...extra });
const planDoc = (extra = {}) => ({ UserId: ME, userId: ME, TaskId: TASK, Date: new Date('2026-09-02T00:00:00Z'), EstimatedTime: 60, ProjectId: PROJECT, ...extra });
const DOCS = { [SCHEMA_TYPE.TIMESHEET]: logDoc, [SCHEMA_TYPE.ESTIMATES_TIME]: planDoc };

/* The written parts of a driver call only: a filter is sent as written and is checked on its own. */
const writtenParts = ({ op, args }) => {
    if (op === 'insertOne') return [args[0]];
    if (op === 'insertMany') return args[0];
    if (op === 'bulkWrite') return args[0].map((item) => (item.insertOne ? item.insertOne.document : (item.updateOne || item.updateMany).update));
    return [args[1]];
};
const storedProjectIds = async (type, method, data) => {
    const { writes, error } = await STORES[type].driverWrites(method, data);
    expect(error).toBeNull();
    return writes.flatMap(writtenParts).map((part) => (part.$set ? part.$set.ProjectId : part.ProjectId)).filter((value) => value !== undefined);
};
const expectObjectIdsOf = (stored, id = PROJECT) => {
    expect(stored.length).toBeGreaterThan(0);
    stored.forEach((value) => {
        expect(isObjectId(value)).toBe(true);
        expect(String(value)).toBe(id);
    });
};

describe.each([SCHEMA_TYPE.TIMESHEET, SCHEMA_TYPE.ESTIMATES_TIME])('the %s schema stores the project id as an ObjectId', (type) => {
    const doc = DOCS[type];

    test.each([
        ['save', 'save', () => doc()],
        ['insertMany', 'insertMany', () => [[doc()]]],
        ['updateOne with $set', 'updateOne', () => [{ _id: ENTRY }, { $set: { ProjectId: PROJECT } }]],
        ['updateOne with a bare update', 'updateOne', () => [{ _id: ENTRY }, { ProjectId: PROJECT }]],
        ['updateMany', 'updateMany', () => [{ ProjectId: PROJECT }, { $set: { ProjectId: PROJECT } }]],
        ['findOneAndUpdate with an upsert', 'findOneAndUpdate', () => [{ _id: ENTRY }, { $set: { ProjectId: PROJECT } }, { new: true, upsert: true }]],
        ['bulkWrite', 'bulkWrite', () => [[{ insertOne: { document: doc() } }, { updateOne: { filter: { _id: ENTRY }, update: { $set: { ProjectId: PROJECT } } } }]]],
    ])('%s converts a text id', async (_, method, data) => {
        expectObjectIdsOf(await storedProjectIds(type, method, data()));
    });

    test('an id that is already an ObjectId is stored as it is', async () => {
        expectObjectIdsOf(await storedProjectIds(type, 'save', doc({ ProjectId: oid(PROJECT) })));
    });

    test('a value that is not an id is stored as sent', async () => {
        expect(await storedProjectIds(type, 'save', doc({ ProjectId: 'firebase-project' }))).toEqual(['firebase-project']);
    });

    test('a filter is sent as written, so a read still matches either form', async () => {
        const { writes, error } = await STORES[type].driverWrites('find', [{ ProjectId: { $in: [PROJECT, oid(PROJECT)] } }]);
        expect(error).toBeNull();
        const [text, id] = writes[0].args[0].ProjectId.$in;
        expect(text).toBe(PROJECT);
        expect(isObjectId(id)).toBe(true);
    });
});

describe('every writer of a time project id stores an ObjectId through the schema', () => {
    const call = (handler, body) => new Promise((resolve, reject) => {
        const r = { code: 200, body: null };
        r.status = (c) => { r.code = c; return r; };
        r.send = (b) => { r.body = b; resolve(r); return r; };
        r.json = r.send;
        Promise.resolve(handler(verified({ headers: { companyid: C }, body, query: {}, params: {}, uid: ME }), r)).catch(reject);
    });
    const recorded = (type, methods) => mockCrud.mock.calls
        .filter(([, q, method]) => q.type === type && methods.includes(method))
        .map(([, { data }, method]) => ({ method, data }));
    const replayed = async (type, methods) => {
        const writes = recorded(type, methods);
        expect(writes.length).toBeGreaterThan(0);
        return (await Promise.all(writes.map(({ method, data }) => storedProjectIds(type, method, data)))).flat();
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
            if (type === SCHEMA_TYPE.USERS && method === 'findOne') return { _id: ME, Employee_Name: 'Session Person' };
            if (type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return { isTrackerUser: 1 };
            if (type === SCHEMA_TYPE.TIMESHEET && method === 'findOne') return { _id: ENTRY, Loggeduser: ME, ProjectId: PROJECT, LogStartTime: Date.parse(`${OPEN_DAY}T09:00:00Z`) / 1000 };
            if (method === 'save') return { _id: 'new', id: 'new', ...data };
            if (method === 'findOneAndUpdate') return { _id: ENTRY };
            if (method === 'updateMany') return { modifiedCount: 1 };
            return null;
        });
    });

    const logBody = (extra = {}) => ({
        logTimeDate: OPEN_DAY, description: 'Work', startLogTime: '09:00', endLogTime: '10:00', timeDuration: '1:00', ticketId: TASK,
        projectId: PROJECT, userId: ME, isEdit: false, timeZone: 'UTC', sprintId: '6f0000000000000000000a01', companyId: C, userName: 'Body Name',
        dateFormat: 'DD/MM/YYYY', taskName: 'Task', projectName: 'Project', companyOwnerId: '6f0000000000000000000009', ...extra,
    });

    test('a manual time entry (manualLogtime.js save)', async () => {
        const r = await call(manualLogTime, logBody());
        expect(r.body).toMatchObject({ status: true });
        expectObjectIdsOf(await replayed(SCHEMA_TYPE.TIMESHEET, ['save']));
    });

    test('an edited manual time entry (manualLogtime.js $set)', async () => {
        const r = await call(manualLogTime, logBody({ isEdit: true, timeSheetId: ENTRY, previousLoggedTime: '0:30' }));
        expect(r.body).toMatchObject({ status: true });
        expectObjectIdsOf(await replayed(SCHEMA_TYPE.TIMESHEET, ['findOneAndUpdate']));
    });

    test.each([
        ['v2 (tracker.js timeTrackerStart)', timeTrackerStart],
        ['v3 (tracker.js timeTrackerStart2)', timeTrackerStart2],
    ])('a desktop tracker timer, %s', async (_, handler) => {
        const r = await call(handler, { description: 'Tracker', userId: ME, projectId: PROJECT, taskId: TASK });
        expect(r.body.status).toBe(true);
        expectObjectIdsOf(await replayed(SCHEMA_TYPE.TIMESHEET, ['save']));
    });

    test.each([
        ['a first plan for the day (upsert)', undefined],
        ['a plan named by id', ENTRY],
    ])('a planning save, %s (estimateWriteScope.js)', async (_, id) => {
        const { data } = buildEstimateWrite({ id, userId: ME, taskId: TASK, projectId: PROJECT, date: '2026-09-02T00:00:00.000Z', minutes: 30 }, { uid: ME, everyone: true, visible: null });
        expectObjectIdsOf(await storedProjectIds(SCHEMA_TYPE.ESTIMATES_TIME, 'findOneAndUpdate', data));
    });

    test.each([
        ['time logs (mongo_helper.js updateTimesheetCollection)', 'updateTimesheetCollection', SCHEMA_TYPE.TIMESHEET],
        ['time plans (mongo_helper.js updateEstimatedTimeCollection)', 'updateEstimatedTimeCollection', SCHEMA_TYPE.ESTIMATES_TIME],
    ])('a task moved to another project takes its %s along', async (_, writer, type) => {
        const NEW_PROJECT = '6f0000000000000000000b02';
        await taskMove[writer](C, { _id: TASK }, { id: NEW_PROJECT }, TASK);
        expectObjectIdsOf(await replayed(type, ['updateMany']), NEW_PROJECT);
    });
});
