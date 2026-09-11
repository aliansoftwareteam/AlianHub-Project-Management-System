const mockDb = require('./fixtures/fakeMongo').create();

const mockRoles = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));
jest.mock('../Modules/service', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { SendEmail } = require('../Modules/service');
const reports = require('../Modules/CustomReports/controller');
const schedules = require('../Modules/ScheduledReports/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '100000000000000000000001';
const ADMIN = '100000000000000000000002';
const MEMBER = '100000000000000000000003';
const GUEST = '100000000000000000000004';
Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 });

const R = SCHEMA_TYPE.SAVED_REPORTS;
const S = SCHEMA_TYPE.REPORT_SCHEDULES;
const UNKNOWN = 'abcdefabcdefabcdefabcdef';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: COMPANY }, uid, body, params, query: {} }, r);
    return r;
};
const refused = (r) => r.code >= 400 && r.body.status === false;
const config = { source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters: {} };
const revenue = { source: 'timelogs', dimension: 'person', metric: 'revenue', chartType: 'bar', filters: {} };

let adminReport;
let memberReport;
let adminSchedule;
beforeEach(() => {
    [R, S, SCHEMA_TYPE.TASKS, SCHEMA_TYPE.TIMESHEET, SCHEMA_TYPE.BILLING_RATES].forEach((t) => { mockDb.store[t] = []; });
    SendEmail.mockClear();
    adminReport = mockDb.seed(R, { name: 'Admin report', ...config, createdBy: ADMIN, deletedStatusKey: 0 });
    memberReport = mockDb.seed(R, { name: 'Member report', ...config, createdBy: MEMBER, deletedStatusKey: 0 });
    adminSchedule = mockDb.seed(S, { savedReportId: adminReport._id, cadence: 'weekly', recipients: ['boss@example.com'], active: false, createdBy: ADMIN, deletedStatusKey: 0 });
});
const find = (type, id) => mockDb.store[type].find((d) => d._id === id);

describe('REP-02 saved reports are bound to their creator', () => {
    it('refuses a guest editing an admin\'s report', async () => {
        const r = await call(reports.updateReport, GUEST, { params: { id: adminReport._id }, body: { name: 'renamed by guest', ...config } });
        expect(refused(r)).toBe(true);
        expect(find(R, adminReport._id).name).toBe('Admin report');
    });

    it('refuses a member deleting, duplicating or reloading someone else\'s report', async () => {
        expect(refused(await call(reports.deleteReport, MEMBER, { params: { id: adminReport._id } }))).toBe(true);
        expect(refused(await call(reports.duplicateReport, MEMBER, { params: { id: adminReport._id } }))).toBe(true);
        expect(refused(await call(reports.getReportResult, MEMBER, { params: { id: adminReport._id } }))).toBe(true);
        expect(find(R, adminReport._id).deletedStatusKey).toBe(0);
        expect(mockDb.store[R]).toHaveLength(2);
    });

    it('lists only the member\'s own reports, and every report for an admin', async () => {
        const mine = await call(reports.listReports, MEMBER);
        expect(mine.body.data.map((x) => x._id)).toEqual([memberReport._id]);
        const all = await call(reports.listReports, ADMIN);
        expect(all.body.data).toHaveLength(2);
    });

    it('lets the creator edit and delete their own report', async () => {
        const upd = await call(reports.updateReport, MEMBER, { params: { id: memberReport._id }, body: { name: 'Renamed', ...config } });
        expect(upd.code).toBe(200);
        expect(find(R, memberReport._id).name).toBe('Renamed');
        const del = await call(reports.deleteReport, MEMBER, { params: { id: memberReport._id } });
        expect(del.code).toBe(200);
        expect(find(R, memberReport._id).deletedStatusKey).toBe(1);
    });

    it('lets an owner or admin manage a member\'s report', async () => {
        const upd = await call(reports.updateReport, OWNER, { params: { id: memberReport._id }, body: { name: 'By owner', ...config } });
        expect(upd.code).toBe(200);
        const del = await call(reports.deleteReport, ADMIN, { params: { id: memberReport._id } });
        expect(del.code).toBe(200);
    });

    it('records the session user as creator, never a body-supplied one', async () => {
        const r = await call(reports.createReport, MEMBER, { body: { name: 'Mine', ...config, createdBy: ADMIN } });
        expect(r.code).toBe(201);
        expect(find(R, r.body.data._id).createdBy).toBe(MEMBER);
    });
});

describe('REP-02 schedules are bound to their creator', () => {
    it('refuses a guest changing an admin\'s schedule recipients', async () => {
        const r = await call(schedules.updateSchedule, GUEST, { params: { id: adminSchedule._id }, body: { recipients: ['attacker@example.com'] } });
        expect(refused(r)).toBe(true);
        expect(find(S, adminSchedule._id).recipients).toEqual(['boss@example.com']);
    });

    it('refuses a member deleting or running someone else\'s schedule', async () => {
        expect(refused(await call(schedules.deleteSchedule, MEMBER, { params: { id: adminSchedule._id } }))).toBe(true);
        expect(refused(await call(schedules.runScheduleNow, MEMBER, { params: { id: adminSchedule._id } }))).toBe(true);
        expect(find(S, adminSchedule._id).deletedStatusKey).toBe(0);
        expect(SendEmail).not.toHaveBeenCalled();
    });

    it('refuses a member scheduling a report they cannot manage', async () => {
        const r = await call(schedules.createSchedule, MEMBER, { body: { savedReportId: adminReport._id, recipients: ['me@example.com'], active: false } });
        expect(refused(r)).toBe(true);
        expect(mockDb.store[S]).toHaveLength(1);
    });

    it('refuses a member processing every due schedule in the company', async () => {
        expect(refused(await call(schedules.triggerDue, MEMBER))).toBe(true);
        expect((await call(schedules.triggerDue, OWNER)).code).toBe(200);
    });

    it('lists only the member\'s own schedules', async () => {
        const created = await call(schedules.createSchedule, MEMBER, { body: { savedReportId: memberReport._id, recipients: ['me@example.com'], active: false } });
        expect(created.code).toBe(201);
        expect(find(S, created.body.data._id).createdBy).toBe(MEMBER);
        const mine = await call(schedules.listSchedules, MEMBER);
        expect(mine.body.data.map((x) => String(x._id))).toEqual([created.body.data._id]);
        expect((await call(schedules.listSchedules, ADMIN)).body.data).toHaveLength(2);
    });

    it('lets the creator and an owner change a schedule', async () => {
        const own = await call(schedules.updateSchedule, ADMIN, { params: { id: adminSchedule._id }, body: { recipients: ['team@example.com'] } });
        expect(own.code).toBe(200);
        expect(find(S, adminSchedule._id).recipients).toEqual(['team@example.com']);
        const owner = await call(schedules.updateSchedule, OWNER, { params: { id: adminSchedule._id }, body: { active: true } });
        expect(owner.code).toBe(200);
    });

    it('answers 400 for a malformed schedule id and 404 for an unknown one', async () => {
        expect((await call(schedules.updateSchedule, OWNER, { params: { id: 'nope' }, body: { active: true } })).code).toBe(400);
        expect((await call(schedules.deleteSchedule, OWNER, { params: { id: UNKNOWN } })).code).toBe(404);
    });
});

describe('REP-06 the revenue metric is owner and admin only', () => {
    it('refuses a member or guest previewing revenue', async () => {
        for (const uid of [MEMBER, GUEST]) {
            // eslint-disable-next-line no-await-in-loop
            const r = await call(reports.runReport, uid, { body: revenue });
            expect(r.code).toBe(403);
            expect(r.body.restricted).toBe(true);
            expect(r.body.data).toBeUndefined();
        }
    });

    it('refuses a member saving or reloading a report built on revenue', async () => {
        expect((await call(reports.createReport, MEMBER, { body: { name: 'Money', ...revenue } })).code).toBe(403);
        const legacy = mockDb.seed(R, { name: 'Old money', ...revenue, createdBy: MEMBER, deletedStatusKey: 0 });
        const reload = await call(reports.getReportResult, MEMBER, { params: { id: legacy._id } });
        expect(reload.code).toBe(403);
        expect(reload.body.restricted).toBe(true);
    });

    it('still lets a member run the non-financial metrics', async () => {
        const r = await call(reports.runReport, MEMBER, { body: config });
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
    });

    it('lets an owner and an admin run revenue', async () => {
        expect((await call(reports.runReport, OWNER, { body: revenue })).code).toBe(200);
        expect((await call(reports.runReport, ADMIN, { body: revenue })).code).toBe(200);
    });

    it('does not email revenue from a report whose creator may not see it', async () => {
        const legacy = mockDb.seed(R, { name: 'Old money', ...revenue, createdBy: MEMBER, deletedStatusKey: 0 });
        const sched = mockDb.seed(S, { savedReportId: legacy._id, cadence: 'weekly', recipients: ['x@example.com'], active: false, createdBy: MEMBER, deletedStatusKey: 0 });
        const r = await call(schedules.runScheduleNow, OWNER, { params: { id: sched._id } });
        expect(r.body.data.sent).toBe(false);
        expect(r.body.data.reason).toBe('restricted');
        expect(SendEmail).not.toHaveBeenCalled();
    });
});

describe('REP-07 report ids', () => {
    it('answers 400 for a malformed id instead of a raw 500', async () => {
        for (const handler of [reports.getReportResult, reports.updateReport, reports.deleteReport, reports.duplicateReport]) {
            // eslint-disable-next-line no-await-in-loop
            const r = await call(handler, OWNER, { params: { id: 'not-an-id' }, body: config });
            expect(r.code).toBe(400);
            expect(r.body.statusText).not.toMatch(/24 character hex/);
        }
    });

    it('answers 404 when deleting an unknown but well-formed id', async () => {
        const r = await call(reports.deleteReport, OWNER, { params: { id: UNKNOWN } });
        expect(r.code).toBe(404);
        expect(r.body.status).toBe(false);
    });
});
