jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service', () => ({ SendEmail: jest.fn() }));
jest.mock('../Modules/TimeSheet/helpers/reminderSettings', () => ({ getCompanySettings: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SendEmail } = require('../Modules/service');
const reminderSettings = require('../Modules/TimeSheet/helpers/reminderSettings');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/TimeSheet/controller/timeReminders');

const C = 'c00000000000000000000001';
const USER = { _id: 'u1', Employee_Email: 'ana@example.test', Employee_Name: 'Ana' };

/* Local dates, as the reminder reads the day. 2026-09-02 is a Wednesday and 2026-09-05 a Saturday. */
const WEDNESDAY = new Date(2026, 8, 2, 17);
const SATURDAY = new Date(2026, 8, 5, 17);

let company;

beforeEach(() => {
    jest.clearAllMocks();
    myCache.flushAll();
    company = { _id: C };
    reminderSettings.getCompanySettings.mockResolvedValue({ enabled: true, userIds: ['u1'] });
    MongoDbCrudOpration.mockImplementation(async (db, query) => {
        if (query.type === SCHEMA_TYPE.COMPANIES) return [company];
        if (query.type === SCHEMA_TYPE.USERS) return [USER];
        return [];
    });
    SendEmail.mockImplementation((subject, html, email, flag, done) => done({ status: true }));
});

const sent = () => SendEmail.mock.calls.map((args) => args[2]);

describe('the "log your time" reminder goes out on the company\'s working days only', () => {
    it('is sent on a weekday to a company that never chose a week', async () => {
        const result = await ctrl.sendTimeRemindersForCompany(C, WEDNESDAY);
        expect(sent()).toEqual([USER.Employee_Email]);
        expect(result.reminded).toBe(1);
    });

    it('is not sent on Saturday to a company that never chose a week', async () => {
        const result = await ctrl.sendTimeRemindersForCompany(C, SATURDAY);
        expect(sent()).toEqual([]);
        expect(result).toMatchObject({ reminded: 0, total: 0, skipped: 'non-working-day' });
    });

    it('is sent on Saturday to a Friday-to-Sunday company', async () => {
        company.workingDays = [0, 5, 6];
        await ctrl.sendTimeRemindersForCompany(C, SATURDAY);
        expect(sent()).toEqual([USER.Employee_Email]);
    });

    it('is not sent on Wednesday to a Friday-to-Sunday company', async () => {
        company.workingDays = [0, 5, 6];
        const result = await ctrl.sendTimeRemindersForCompany(C, WEDNESDAY);
        expect(sent()).toEqual([]);
        expect(result.skipped).toBe('non-working-day');
    });

    it('stays off for a company that has not turned the reminder on, whatever the day', async () => {
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: false, userIds: [] });
        expect((await ctrl.sendTimeRemindersForCompany(C, WEDNESDAY)).skipped).toBe('disabled');
    });
});
