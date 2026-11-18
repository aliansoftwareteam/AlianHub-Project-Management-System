const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const week = require('../Modules/TimeSheet/controller/weekTimesheet');
const grid = require('../Modules/TimeSheet/controller/workloadGrid');
const approval = require('../Modules/TimesheetApproval/controller');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const PROJECT = 'b00000000000000000000001';
const OTHER_PROJECT = 'b00000000000000000000002';
const FRI_TO_SUN = [0, 5, 6];

/* 2026-09-07 is a Monday, so the range ends on Sunday the 13th. */
const RANGE = { start: '2026-09-07', end: '2026-09-13', timeZone: 'UTC' };
const WEEKDAYS_OFF = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
const WEEKEND_OFF = ['2026-09-12', '2026-09-13'];

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    return res;
};

const call = async (handler, extra) => {
    const res = response();
    await handler({ uid: OWNER, aud: C, headers: { companyid: C }, params: {}, query: {}, body: {}, ...extra }, res);
    return res.body.data;
};

const seedCompany = (fields = {}) => mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C, Cst_CompanyName: 'Acme', ...fields });
const offDays = (days) => days.filter((day) => day.weekend).map((day) => day.date);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Weekend shift', workingDays: FRI_TO_SUN });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: OTHER_PROJECT, ProjectName: 'Office hours' });
});

describe('GET /api/v1/timesheet/week counts capacity in the working week', () => {
    const sheet = (query = {}) => call(week.getWeekTimesheet, { query: { ...RANGE, ...query } });

    it('keeps Monday to Friday for a company that never chose a week', async () => {
        seedCompany();
        const data = await sheet();
        expect(offDays(data.days)).toEqual(WEEKEND_OFF);
        expect(data.totals.capacityMinutes).toBe(5 * 480);
        expect(data.workingDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('a Friday-to-Sunday company has capacity on Friday, Saturday and Sunday only', async () => {
        seedCompany({ workingDays: FRI_TO_SUN });
        const data = await sheet();
        expect(offDays(data.days)).toEqual(WEEKDAYS_OFF);
        expect(data.days.map((day) => day.capacityMinutes)).toEqual([0, 0, 0, 0, 480, 480, 480]);
        expect(data.totals.capacityMinutes).toBe(3 * 480);
        expect(data.workingDays).toEqual(FRI_TO_SUN);
    });

    it('a sheet narrowed to one project uses that project\'s week', async () => {
        seedCompany();
        expect(offDays((await sheet({ projectId: PROJECT })).days)).toEqual(WEEKDAYS_OFF);
        expect(offDays((await sheet({ projectId: OTHER_PROJECT })).days)).toEqual(WEEKEND_OFF);
    });
});

describe('POST /api/v1/timesheet/workload-grid counts capacity in the working week', () => {
    const load = async (body = {}) => {
        const data = await call(grid.getWorkloadGrid, { body: { ...RANGE, userIds: [OWNER], ...body } });
        return { ...data, person: data.users[0] };
    };

    it('keeps Monday to Friday for a company that never chose a week', async () => {
        seedCompany();
        const data = await load();
        expect(offDays(data.person.days)).toEqual(WEEKEND_OFF);
        expect(data.person.capacityMinutes).toBe(5 * 480);
        expect(data.workingDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('a Friday-to-Sunday company marks Monday to Thursday as days off, for the grid to hide', async () => {
        seedCompany({ workingDays: FRI_TO_SUN });
        const data = await load();
        expect(offDays(data.person.days)).toEqual(WEEKDAYS_OFF);
        expect(data.person.capacityMinutes).toBe(3 * 480);
        expect(data.workingDays).toEqual(FRI_TO_SUN);
    });

    it('a grid narrowed to one project uses that project\'s week', async () => {
        seedCompany();
        const data = await load({ projectIds: [PROJECT] });
        expect(offDays(data.person.days)).toEqual(WEEKDAYS_OFF);
        expect(data.workingDays).toEqual(FRI_TO_SUN);
    });

    it('a grid over several projects uses the company\'s week', async () => {
        seedCompany();
        const data = await load({ projectIds: [PROJECT, OTHER_PROJECT] });
        expect(offDays(data.person.days)).toEqual(WEEKEND_OFF);
        expect(data.workingDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('spreads a weekly points capacity over the working days of the week', async () => {
        seedCompany({ workingDays: FRI_TO_SUN });
        const data = await load({ unit: 'points' });
        expect(offDays(data.person.days)).toEqual(WEEKDAYS_OFF);
        expect(data.person.days.map((day) => day.capacity)).toEqual([0, 0, 0, 0, 3.33, 3.33, 3.33]);
    });

    it('keeps a weekly points capacity at a fifth a day in the default week', async () => {
        seedCompany();
        const data = await load({ unit: 'points' });
        expect(data.person.days.map((day) => day.capacity)).toEqual([2, 2, 2, 2, 2, 0, 0]);
    });
});

describe('GET /api/v2/timesheet-approval/queue measures the week against the company\'s working days', () => {
    /* Noon stamps and a Saturday-only week keep the count the same in every time zone: the handler trims the period in local time. */
    const seedSubmitted = () => mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
        userId: OWNER, status: 'submitted', deletedStatusKey: 0, submittedAt: new Date('2026-09-14T09:00:00Z'),
        periodStart: new Date('2026-09-07T12:00:00Z'), periodEnd: new Date('2026-09-13T12:00:00Z'),
    });
    const queue = async () => (await call(approval.listQueue, { query: {} }))[0].capacityMinutes;

    it('counts one working day for a Saturday-only company', async () => {
        seedCompany({ workingDays: [6] });
        seedSubmitted();
        expect(await queue()).toBe(480);
    });

    it('counts the weekdays for a company that never chose a week', async () => {
        seedCompany();
        seedSubmitted();
        expect(await queue()).toBeGreaterThanOrEqual(5 * 480);
    });
});
