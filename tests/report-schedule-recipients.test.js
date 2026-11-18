const verified = require('./fixtures/verifiedRequest');
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
const { schema } = require('../utils/mongo-handler/schema');
const { SendEmail } = require('../Modules/service');
const schedules = require('../Modules/ScheduledReports/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ADMIN = '100000000000000000000002';
const MEMBER = '100000000000000000000003';
const COLLEAGUE = '100000000000000000000005';
const LEFT = '100000000000000000000006';

const R = SCHEMA_TYPE.SAVED_REPORTS;
const S = SCHEMA_TYPE.REPORT_SCHEDULES;
const U = SCHEMA_TYPE.COMPANY_USERS;
const MEMBER_MAIL = 'member@ours.example';
const COLLEAGUE_MAIL = 'colleague@ours.example';
const LEFT_MAIL = 'left@ours.example';
const OUTSIDE_MAIL = 'someone@elsewhere.example';
const config = { source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters: {} };

const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    await handler(verified({ headers: { companyid: COMPANY }, uid, body, params, query: {} }), r);
    return r;
};
const sentTo = () => SendEmail.mock.calls.map((args) => args[2]);
const stored = (id) => mockDb.store[S].find((row) => String(row._id) === String(id));

let memberReport;
let adminReport;
beforeEach(() => {
    [R, S, U, SCHEMA_TYPE.TASKS].forEach((t) => { mockDb.store[t] = []; });
    Object.keys(mockRoles).forEach((uid) => delete mockRoles[uid]);
    Object.assign(mockRoles, { [ADMIN]: 2, [MEMBER]: 3, [COLLEAGUE]: 3 });
    SendEmail.mockClear();
    mockDb.seed(U, { userId: ADMIN, roleType: 2, status: 2, isDelete: false, userEmail: 'admin@ours.example' });
    mockDb.seed(U, { userId: MEMBER, roleType: 3, status: 2, isDelete: false, userEmail: MEMBER_MAIL });
    mockDb.seed(U, { userId: COLLEAGUE, roleType: 3, status: 2, isDelete: false, userEmail: 'Colleague@Ours.example' });
    mockDb.seed(U, { userId: LEFT, roleType: 3, status: 3, isDelete: true, userEmail: LEFT_MAIL });
    memberReport = mockDb.seed(R, { name: 'Member report', ...config, createdBy: MEMBER, deletedStatusKey: 0 });
    adminReport = mockDb.seed(R, { name: 'Admin report', ...config, createdBy: ADMIN, deletedStatusKey: 0 });
});

const create = (uid, report, recipients) => call(schedules.createSchedule, uid, { body: { savedReportId: report._id, recipients, active: false } });

describe('who a scheduled report can be sent to', () => {
    it('takes the addresses of people who hold a seat, from a member', async () => {
        const r = await create(MEMBER, memberReport, [MEMBER_MAIL, COLLEAGUE_MAIL]);

        expect(r.code).toBe(201);
        expect(r.body.data.recipients).toEqual([MEMBER_MAIL, COLLEAGUE_MAIL]);
        expect(r.body.data.recipientsBy).toBe(MEMBER);
    });

    it.each([
        ['an address outside the workspace', OUTSIDE_MAIL],
        ['the address of someone who left', LEFT_MAIL],
    ])('answers 400 to a member naming %s, and stores nothing', async (name, address) => {
        const r = await create(MEMBER, memberReport, [MEMBER_MAIL, address]);

        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
        expect(mockDb.store[S]).toHaveLength(0);
    });

    it('answers 400 to a member changing the recipients to an outside address', async () => {
        const made = await create(MEMBER, memberReport, [MEMBER_MAIL]);
        const r = await call(schedules.updateSchedule, MEMBER, { params: { id: made.body.data._id }, body: { recipients: [OUTSIDE_MAIL] } });

        expect(r.code).toBe(400);
        expect(stored(made.body.data._id).recipients).toEqual([MEMBER_MAIL]);
    });

    it('lets an owner or admin name an outside address, and records who set the recipients', async () => {
        const made = await create(ADMIN, adminReport, [OUTSIDE_MAIL]);
        expect(made.code).toBe(201);
        expect(made.body.data.recipientsBy).toBe(ADMIN);

        const memberOwned = await create(MEMBER, memberReport, [MEMBER_MAIL]);
        const changed = await call(schedules.updateSchedule, ADMIN, { params: { id: memberOwned.body.data._id }, body: { recipients: [OUTSIDE_MAIL] } });
        expect(changed.code).toBe(200);
        expect(stored(memberOwned.body.data._id)).toMatchObject({ recipients: [OUTSIDE_MAIL], recipientsBy: ADMIN });
    });

    it('declares the field that records who set the recipients', () => {
        expect(schema.reportSchedules.recipientsBy).toBeDefined();
    });
});

describe('who a scheduled report is sent to when it runs', () => {
    const scheduleOf = (doc) => mockDb.seed(S, { savedReportId: memberReport._id, cadence: 'weekly', active: true, deletedStatusKey: 0, ...doc });

    it('leaves out an address that is no longer a member\'s, on a schedule a member set', async () => {
        const schedule = scheduleOf({ recipients: [MEMBER_MAIL, LEFT_MAIL, OUTSIDE_MAIL], createdBy: MEMBER });
        const r = await call(schedules.runScheduleNow, MEMBER, { params: { id: schedule._id } });

        expect(r.body.data.sent).toBe(true);
        expect(sentTo()).toEqual([[MEMBER_MAIL]]);
    });

    it('sends nothing when no recipient is left', async () => {
        const schedule = scheduleOf({ recipients: [OUTSIDE_MAIL], createdBy: MEMBER });
        const r = await call(schedules.runScheduleNow, MEMBER, { params: { id: schedule._id } });

        expect(r.body.data.sent).toBe(false);
        expect(SendEmail).not.toHaveBeenCalled();
    });

    it('keeps the outside addresses an owner or admin set, while they are one', async () => {
        const schedule = scheduleOf({ savedReportId: adminReport._id, recipients: [OUTSIDE_MAIL], createdBy: MEMBER, recipientsBy: ADMIN });
        await schedules.runDueForCompany(COMPANY, new Date());
        expect(sentTo()).toEqual([[OUTSIDE_MAIL]]);

        SendEmail.mockClear();
        mockRoles[ADMIN] = 3;
        const r = await call(schedules.runScheduleNow, MEMBER, { params: { id: schedule._id } });
        expect(r.body.data.sent).toBe(false);
        expect(SendEmail).not.toHaveBeenCalled();
    });
});
