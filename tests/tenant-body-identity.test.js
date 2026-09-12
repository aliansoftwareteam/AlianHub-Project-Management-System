process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockCrud = jest.fn(async () => []);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 2),
    evaluatePermission: jest.fn(async () => true),
    isPrivileged: (r) => r === 1 || r === 2,
    isWritable: () => true,
}));

const MINE = '6f0000000000000000000a01';
const THEIRS = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const OID = '6f0000000000000000000b01';

const portfolio = require('../Modules/Portfolio/controller');
const variance = require('../Modules/VarianceReport/controller');
const capacity = require('../Modules/CapacityPlanning/controller');
const customReports = require('../Modules/CustomReports/controller');
const scheduledReports = require('../Modules/ScheduledReports/controller');
const projectDashboard = require('../Modules/ProjectDashboard/controller');
const pto = require('../Modules/Pto/controller');
const approval = require('../Modules/TimesheetApproval/controller');
const weekTimesheet = require('../Modules/TimeSheet/controller/weekTimesheet');
const hoursBySource = require('../Modules/TimeSheet/controller/hoursBySource');
const billableSummary = require('../Modules/TimeSheet/controller/billableSummary');
const timesheetBilling = require('../Modules/TimeSheet/controller/billing');
const timesheetExport = require('../Modules/TimeSheet/controller/timesheetExport');
const timeReminders = require('../Modules/TimeSheet/controller/timeReminders');
const workloadGrid = require('../Modules/TimeSheet/controller/workloadGrid');
const webTimer = require('../Modules/LogTime/controllerV2/webTimer');
const milestoneBilling = require('../Modules/Milestone/controller/billing');
const wipLimit = require('../Modules/projectSetting/wipLimit');
const projectInvoices = require('../Modules/Invoice/controller/projectInvoices');

// One handler per file cleaned in this pass. Every one of these used to take the company from
// `req.body.companyId` whenever the header was missing, and to prefer it over the header on
// some of them, so a member of one company could read or write another company's data.
const ROUTES = [
    ['POST /api/v1/portfolio', portfolio.createPortfolio],
    ['GET /api/v1/portfolio', portfolio.listPortfolios],
    ['GET /api/v1/reports/variance', variance.getVarianceReport],
    ['GET /api/v1/reports/variance/summary', variance.getVarianceSummary],
    ['GET /api/v1/capacity', capacity.getCapacityPlan],
    ['GET /api/v1/capacity/monthly', capacity.getMonthlyCapacity],
    ['POST /api/v1/reports/run', customReports.runReport],
    ['GET /api/v1/reports', customReports.listReports],
    ['GET /api/v1/report-schedules', scheduledReports.listSchedules],
    ['POST /api/v1/report-schedules', scheduledReports.createSchedule],
    ['GET /api/v1/project-dashboard/:projectId', projectDashboard.getProjectDashboard],
    ['POST /api/v1/pto', pto.createPto],
    ['GET /api/v1/pto', pto.listPto],
    ['POST /api/v2/timesheet-approval/submit', approval.submitTimesheet],
    ['GET /api/v2/timesheet-approval/pending', approval.listPending],
    ['POST /api/v2/timesheet-approval/:id/review', approval.reviewTimesheet],
    ['GET /api/v1/timesheet/week', weekTimesheet.getWeekTimesheet],
    ['POST /api/v1/timesheet/week/billable', weekTimesheet.setEntriesBillable],
    ['GET /api/v1/timesheet/hours-by-source', hoursBySource.getHoursBySource],
    ['POST /api/v1/timesheet/billable-summary', billableSummary.getBillableSummary],
    ['POST /api/v1/timesheet/rates', timesheetBilling.setRate],
    ['POST /api/v1/timesheet/invoice', timesheetBilling.generateInvoice],
    ['POST /api/v1/timesheet/export', timesheetExport.exportTimesheetCsv],
    ['POST /api/v1/timesheet/send-reminders', timeReminders.triggerReminders],
    ['GET /api/v1/timesheet/workload-grid', workloadGrid.getWorkloadGrid],
    ['POST /api/v1/timesheet/workload-grid/move', workloadGrid.moveWorkloadChip],
    ['GET /api/v2/timetracker/running', webTimer.listRunningTimers],
    ['POST /api/v2/timetracker/trim', webTimer.trimTimer],
    ['GET /api/v2/billing/contract', milestoneBilling.getBillingContract],
    ['POST /api/v2/billing/milestone', milestoneBilling.createBillingMilestone],
    ['POST /api/v1/projectSetting/taskStatus/wipLimit', wipLimit.setWipLimit],
    ['GET /api/v2/invoices', projectInvoices.listInvoices],
    ['POST /api/v2/invoices/draft/milestone', projectInvoices.draftFromMilestone],
    ['DELETE /api/v2/invoices/:id', projectInvoices.deleteInvoice],
    ['POST /api/v2/invoices/:id/send', projectInvoices.sendInvoice],
];

const res = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.set = (o) => { Object.assign(r.headers, o); return r; };
    r.end = () => r;
    return r;
};

const call = (handler, req) => {
    const r = res();
    return Promise.resolve(handler({
        query: {}, params: { id: OID, projectId: OID }, uid: ME, aud: MINE, ...req,
    }, r)).then(() => r);
};

const reachedCompanies = () => mockCrud.mock.calls.map((c) => String(c[0]));

beforeEach(() => jest.clearAllMocks());

describe.each(ROUTES)('14 %s takes the company from the session', (route, handler) => {
    it('refuses a body that names a company other than the header', async () => {
        const r = await call(handler, {
            headers: { companyid: MINE },
            body: { companyId: THEIRS, projectId: OID, statusKey: 'todo', name: 'x', scope: 'default', rate: 1 },
        });
        expect(r.code).toBe(403);
        expect(reachedCompanies()).not.toContain(THEIRS);
    });

    it('refuses a body-only company outside the caller audience', async () => {
        const r = await call(handler, {
            headers: {},
            body: { companyId: THEIRS, projectId: OID, statusKey: 'todo', name: 'x', scope: 'default', rate: 1 },
        });
        expect(r.code).toBe(403);
        expect(reachedCompanies()).not.toContain(THEIRS);
    });

    it('refuses a query-only company outside the caller audience', async () => {
        const r = await call(handler, { headers: {}, body: {}, query: { companyId: THEIRS } });
        expect(r.code).toBe(403);
        expect(reachedCompanies()).not.toContain(THEIRS);
    });
});

describe('14 the actor is the signed-in user, never a body-supplied one', () => {
    const { getRoleType } = require('../Config/permissionGuard');

    it('looks a timesheet reviewer up by req.uid', async () => {
        await call(approval.reviewTimesheet, {
            headers: { companyid: MINE },
            body: { action: 'approve', userData: { id: THEIRS } },
        });
        expect(getRoleType).toHaveBeenCalledWith(MINE, ME);
    });

    it('looks a billing caller up by req.uid', async () => {
        await call(milestoneBilling.getBillingContract, {
            headers: { companyid: MINE },
            query: { projectId: OID },
            body: { userData: { id: THEIRS } },
        });
        expect(getRoleType).toHaveBeenCalledWith(MINE, ME);
    });
});
