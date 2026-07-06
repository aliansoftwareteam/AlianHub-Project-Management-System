/**
 * Time-Entry Reminder Delivery — end-to-end (module) test.
 * AlianHub Project Management System
 *
 * Exercises the REAL Modules/TimeSheet/controller/timeReminders.js send path
 * with mocked DB / mail / settings, to prove the daily reminder is delivered
 * ONLY to the company + users saved in the per-company policy.
 */

// ---- Mocks -------------------------------------------------------------
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service', () => ({ SendEmail: jest.fn() }));
jest.mock('../Modules/TimeSheet/helpers/reminderSettings', () => ({ getCompanySettings: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SendEmail } = require('../Modules/service');
const reminderSettings = require('../Modules/TimeSheet/helpers/reminderSettings');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/TimeSheet/controller/timeReminders');

// Per-company fixtures. userId === global users _id (the frontend saves
// company_users.userId, which equals users._id — the value matched here).
const DB = {
    companyA: {
        users: [
            { _id: 'uA1', Employee_Email: 'a1@x.com', Employee_Name: 'Alice One' },
            { _id: 'uA2', Employee_Email: 'a2@x.com', Employee_Name: 'Alan Two' },
            { _id: 'uA3', Employee_Email: 'a3@x.com', Employee_Name: 'Amy Three' },
        ],
        logged: [], // Loggeduser ids that already logged today
    },
    companyB: {
        users: [
            { _id: 'uB1', Employee_Email: 'b1@x.com', Employee_Name: 'Bob One' },
            { _id: 'uB2', Employee_Email: 'b2@x.com', Employee_Name: 'Bea Two' },
        ],
        logged: [],
    },
};

// Route each MongoDbCrudOpration call to the right fixture. `dbArg` is the
// companyId for tenant reads and 'global' for cross-tenant reads.
function wireDb() {
    MongoDbCrudOpration.mockImplementation(async (dbArg, mongoObj, method) => {
        const type = mongoObj && mongoObj.type;
        if (type === SCHEMA_TYPE.TIMESHEET) {
            // loggedUserIdsInWindow(companyId, ...) — tenant-scoped by dbArg.
            const co = DB[dbArg];
            return (co ? co.logged : []).map((id) => ({ Loggeduser: id }));
        }
        if (type === SCHEMA_TYPE.USERS) {
            // users query — scoped by AssignCompany in the filter (data[0]).
            const cid = mongoObj.data[0].AssignCompany;
            return (DB[cid] ? DB[cid].users : []);
        }
        if (type === SCHEMA_TYPE.COMPANIES) {
            // runRemindersForAllCompanies enumerates enabled companies.
            return ENABLED_COMPANY_IDS.map((_id) => ({ _id }));
        }
        return [];
    });
    // SendEmail(subject, html, email, true, cb) — succeed for every send.
    SendEmail.mockImplementation((subject, html, email, _flag, cb) => cb({ status: true }));
}

let ENABLED_COMPANY_IDS = [];

beforeEach(() => {
    jest.clearAllMocks();
    DB.companyA.logged = [];
    DB.companyB.logged = [];
    ENABLED_COMPANY_IDS = [];
    wireDb();
});

const sentEmails = () => SendEmail.mock.calls.map((c) => c[2]); // 3rd arg = email

describe('📧 TIME REMINDERS - delivery scoping', () => {
    test('disabled company sends nothing', async () => {
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: false, userIds: [] });
        const res = await ctrl.sendTimeRemindersForCompany('companyA');
        expect(SendEmail).not.toHaveBeenCalled();
        expect(res).toMatchObject({ reminded: 0, total: 0, skipped: 'disabled' });
    });

    test('enabled but no recipients selected sends nothing', async () => {
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: true, userIds: [] });
        const res = await ctrl.sendTimeRemindersForCompany('companyA');
        expect(SendEmail).not.toHaveBeenCalled();
        expect(res.skipped).toBe('no-recipients');
    });

    test('emails ONLY the selected users in the company', async () => {
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: true, userIds: ['uA1', 'uA3'] });
        const res = await ctrl.sendTimeRemindersForCompany('companyA');
        expect(sentEmails().sort()).toEqual(['a1@x.com', 'a3@x.com']); // uA2 not selected
        expect(res.reminded).toBe(2);
    });

    test('a selected user who already logged today is skipped', async () => {
        DB.companyA.logged = ['uA1']; // Alice logged
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: true, userIds: ['uA1', 'uA3'] });
        const res = await ctrl.sendTimeRemindersForCompany('companyA');
        expect(sentEmails()).toEqual(['a3@x.com']); // only uA3
        expect(res.reminded).toBe(1);
    });

    test('selecting a user id from another company sends nothing (cross-company isolation)', async () => {
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: true, userIds: ['uB1'] });
        const res = await ctrl.sendTimeRemindersForCompany('companyA'); // uB1 not in company A
        expect(SendEmail).not.toHaveBeenCalled();
        expect(res.reminded).toBe(0);
    });

    test('tenant reads are scoped to the target companyId', async () => {
        reminderSettings.getCompanySettings.mockResolvedValue({ enabled: true, userIds: ['uA1'] });
        await ctrl.sendTimeRemindersForCompany('companyA');
        // logged-time read uses the companyId as the DB arg…
        const tsCall = MongoDbCrudOpration.mock.calls.find((c) => c[1].type === SCHEMA_TYPE.TIMESHEET);
        expect(tsCall[0]).toBe('companyA');
        // …and the users read filters by AssignCompany === companyId.
        const userCall = MongoDbCrudOpration.mock.calls.find((c) => c[1].type === SCHEMA_TYPE.USERS);
        expect(userCall[1].data[0].AssignCompany).toBe('companyA');
    });

    test('cron enumerates only enabled companies and applies each policy', async () => {
        ENABLED_COMPANY_IDS = ['companyA', 'companyB'];
        reminderSettings.getCompanySettings.mockImplementation(async (cid) => {
            if (cid === 'companyA') return { enabled: true, userIds: ['uA2'] };
            if (cid === 'companyB') return { enabled: true, userIds: ['uB1', 'uB2'] };
            return { enabled: false, userIds: [] };
        });
        await ctrl.runRemindersForAllCompanies();
        // company enumeration filtered on the enabled flag
        const compCall = MongoDbCrudOpration.mock.calls.find((c) => c[1].type === SCHEMA_TYPE.COMPANIES);
        expect(compCall[1].data[0]).toEqual({ 'timeReminderSettings.enabled': true });
        // exactly the selected users across both companies, nobody else
        expect(sentEmails().sort()).toEqual(['a2@x.com', 'b1@x.com', 'b2@x.com']);
    });
});
