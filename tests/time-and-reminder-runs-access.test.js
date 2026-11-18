const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
const mockProcessDue = jest.fn(async () => ({ processed: 0 }));
const mockSendEmail = jest.fn((subject, html, email, flag, cb) => cb({ status: true }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/service', () => ({ SendEmail: (...args) => mockSendEmail(...args) }));
jest.mock('../Modules/GeneralReminders/helper', () => ({ processDueForCompany: (...args) => mockProcessDue(...args), runGeneralRemindersForAllCompanies: jest.fn() }));
jest.mock('../Modules/GeneralReminders/queue', () => ({ enqueue: jest.fn(async () => ({})), dequeue: jest.fn(async () => ({})) }));
jest.mock('../Modules/TimeSheet/helpers/reminderSettings', () => ({ getCompanySettings: jest.fn(async () => ({ enabled: true, userIds: ['a00000000000000000000003'] })) }));
jest.mock('../Modules/Company/helpers/companyWeek', () => ({ companyWorkingDays: jest.fn(async () => [0, 1, 2, 3, 4, 5, 6]) }));
jest.mock('../Modules/PersonalList/ownership', () => ({ othersPersonalListIds: jest.fn(async () => []) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const timeReminders = require('../Modules/TimeSheet/controller/timeReminders');
const timesheetExport = require('../Modules/TimeSheet/controller/timesheetExport');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const OTHER = 'a00000000000000000000004';
const GUEST = 'a00000000000000000000005';
const oid = () => new mongoose.Types.ObjectId().toString();

const call = async (handlers, { uid = MEMBER, body = {} } = {}) => {
    const res = { statusCode: 200, body: undefined, headers: {} };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    res.send = res.json;
    res.setHeader = (name, value) => { res.headers[name] = value; };
    const req = verified({ uid, params: {}, body, query: {}, headers: { companyid: C } });
    for (const handler of [].concat(handlers)) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    return res;
};

const routed = {};
require('../Modules/GeneralReminders/routes').init(new Proxy({}, { get: (target, method) => (path, ...handlers) => { routed[`${String(method).toUpperCase()} ${path}`] = handlers; } }));
const RUN_DUE = routed['POST /api/v1/general-reminders/run-due'];

let open;
let hidden;

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    mockDb = fakeMongo.create();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [OTHER, 3], [GUEST, 4]].forEach(([userId, roleType]) => {
        mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
        mockDb.seed(SCHEMA_TYPE.USERS, { _id: userId, Employee_Name: `Person ${userId.slice(-1)}`, Employee_Email: `${userId}@example.test`, AssignCompany: [C] });
    });
    open = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Launch', isPrivateSpace: false, AssigneeUserId: [] })._id);
    hidden = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Board', isPrivateSpace: true, AssigneeUserId: [OTHER] })._id);
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: MEMBER, ProjectId: open, LogStartTime: 100, LogTimeDuration: 60, LogDescription: 'mine in launch' });
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: OTHER, ProjectId: open, LogStartTime: 110, LogTimeDuration: 60, LogDescription: 'theirs in launch' });
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: OTHER, ProjectId: hidden, LogStartTime: 120, LogTimeDuration: 60, LogDescription: 'theirs in board' });
});

describe('running every due reminder of the workspace is for owners and admins', () => {
    it.each([['the owner', OWNER], ['an admin', ADMIN]])('runs them for %s', async (_label, uid) => {
        const res = await call(RUN_DUE, { uid });
        expect(res.body).toMatchObject({ status: true });
        expect(mockProcessDue).toHaveBeenCalledWith(C);
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('answers 403 to %s', async (_label, uid) => {
        const res = await call(RUN_DUE, { uid });
        expect(res.statusCode).toBe(403);
        expect(mockProcessDue).not.toHaveBeenCalled();
    });
});

describe('sending the time reminders of the workspace is for owners and admins', () => {
    it.each([['the owner', OWNER], ['an admin', ADMIN]])('sends them for %s', async (_label, uid) => {
        const res = await call(timeReminders.triggerReminders, { uid });
        expect(res.body).toMatchObject({ status: true });
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('answers 403 to %s, mails nobody and names nobody', async (_label, uid) => {
        mockDb.store[SCHEMA_TYPE.TIMESHEET].length = 0;
        const res = await call(timeReminders.triggerReminders, { uid });
        expect(res.statusCode).toBe(403);
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(JSON.stringify(res.body)).not.toMatch(/example\.test/);
    });
});

describe('the time export holds what its reader may see on the timesheet', () => {
    const rowsOf = (res) => String(res.body).split('\n').slice(1).filter(Boolean);

    it('gives the owner every row asked for', async () => {
        const res = await call(timesheetExport.exportTimesheetCsv, { uid: OWNER });
        expect(rowsOf(res)).toHaveLength(3);
    });

    it.each([
        ['no filter', () => ({})],
        ['another person', () => ({ userArray: [OTHER] })],
        ['everyone', () => ({ userArray: [OWNER, MEMBER, OTHER] })],
        ['a project they cannot open', () => ({ projectArray: [hidden] })],
    ])('gives a member their own time only when the request names %s', async (_label, bodyOf) => {
        const res = await call(timesheetExport.exportTimesheetCsv, { body: bodyOf() });
        const text = String(res.body);
        expect(text).not.toMatch(/theirs in/);
        expect(text).not.toMatch(/Board/);
    });

    it('still gives a member their own rows', async () => {
        const res = await call(timesheetExport.exportTimesheetCsv, { body: { userArray: [MEMBER], projectArray: [open] } });
        expect(rowsOf(res)).toHaveLength(1);
        expect(String(res.body)).toMatch(/mine in launch/);
    });
});
