const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['p1']) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const hours = require('../Modules/TimeSheet/controller/hoursBySource');
const billable = require('../Modules/TimeSheet/controller/billableSummary');
const rates = require('../Modules/TimeSheet/controller/billing');
const variance = require('../Modules/VarianceReport/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const T1 = '6f0000000000000000000a01';
const T2 = '6f0000000000000000000a02';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const req = (over = {}) => ({ headers: { companyid: C }, query: {}, body: {}, params: {}, uid: ME, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue(['p1']);
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: ME, ProjectId: 'p1', TicketID: T1, LogTimeDuration: 60, LogStartTime: 100, billable: true });
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: OTHER, ProjectId: 'p2', TicketID: T2, LogTimeDuration: 120, LogStartTime: 100, billable: false });
    mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: OTHER, ProjectId: 'p1', TicketID: T1, LogTimeDuration: 30, LogStartTime: 100, billable: true });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T1, TaskName: 'Mine', ProjectID: 'p1', sprintId: 's1', isParentTask: true, deletedStatusKey: 0, totalEstimatedTime: 60 });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T2, TaskName: 'Theirs', ProjectID: 'p2', sprintId: 's1', isParentTask: true, deletedStatusKey: 0, totalEstimatedTime: 60 });
    mockDb.seed(SCHEMA_TYPE.BILLING_RATES, { scope: 'default', refId: '', rate: 120, currency: 'USD', deletedStatusKey: 0 });
});

describe('TIM-04 hours-by-source', () => {
    it('gives an owner or admin the company-wide count', async () => {
        getRoleType.mockResolvedValue(2);
        const r = res();
        await hours.getHoursBySource(req({ query: { start: 1, end: 999 } }), r);
        expect(r.body.data).toMatchObject({ entryCount: 3, scope: 'company' });
    });

    it.each([[3, 'member'], [0, 'guest'], [null, 'non-member']])('limits a %s (%s) to their own entries', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        const r = res();
        await hours.getHoursBySource(req({ query: { start: 1, end: 999 } }), r);
        expect(r.body.data).toMatchObject({ entryCount: 1, scope: 'self' });
    });

    it('counts nothing when the request carries no signed-in user', async () => {
        getRoleType.mockResolvedValue(null);
        const r = res();
        await hours.getHoursBySource(req({ uid: undefined }), r);
        expect(r.body.data.entryCount).toBe(0);
    });
});

describe('TIM-04 billable-summary', () => {
    it('ignores the userArray a member sends and reports only their own time', async () => {
        getRoleType.mockResolvedValue(3);
        const r = res();
        await billable.getBillableSummary(req({ body: { userArray: [OTHER] } }), r);
        expect(r.body.data).toMatchObject({ totalMinutes: 60, billableMinutes: 60, nonBillableMinutes: 0, scope: 'self' });
    });

    it('honours the userArray for an admin', async () => {
        getRoleType.mockResolvedValue(2);
        const r = res();
        await billable.getBillableSummary(req({ body: { userArray: [OTHER] } }), r);
        expect(r.body.data).toMatchObject({ totalMinutes: 150, nonBillableMinutes: 120, scope: 'company' });
    });
});

describe('TIM-04 variance report', () => {
    it('refuses a member a project they cannot see', async () => {
        getRoleType.mockResolvedValue(3);
        const r = res();
        await variance.getVarianceReport(req({ query: { projectId: 'p2' } }), r);
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
    });

    it('lets a member read a project they can see', async () => {
        getRoleType.mockResolvedValue(3);
        const r = res();
        await variance.getVarianceReport(req({ query: { projectId: 'p1' } }), r);
        expect(r.body.status).toBe(true);
        expect(r.body.data.tasks.map((t) => t.name)).toEqual(['Mine']);
    });

    it('keeps a sprint report to the projects a member can see', async () => {
        getRoleType.mockResolvedValue(0);
        const r = res();
        await variance.getVarianceReport(req({ query: { sprintId: 's1' } }), r);
        expect(r.body.data.tasks.map((t) => t.name)).toEqual(['Mine']);
    });

    it('shows an admin any project without consulting visibility', async () => {
        getRoleType.mockResolvedValue(1);
        const r = res();
        await variance.getVarianceReport(req({ query: { projectId: 'p2' } }), r);
        expect(r.body.data.tasks.map((t) => t.name)).toEqual(['Theirs']);
        expect(visibleProjectIds).not.toHaveBeenCalled();
    });
});

describe('TIM-04 variance summary', () => {
    const window = { from: '1970-01-01', to: '1970-01-02' };

    it('rolls up only the caller\'s own logs for a member', async () => {
        getRoleType.mockResolvedValue(3);
        const r = res();
        await variance.getVarianceSummary(req({ query: window }), r);
        expect(r.body.data.scope).toBe('self');
        expect(r.body.data.byPerson.map((p) => p.key)).toEqual([ME]);
        expect(r.body.data.totals.totalActual).toBe(60);
    });

    it('rolls up every person for an admin', async () => {
        getRoleType.mockResolvedValue(2);
        const r = res();
        await variance.getVarianceSummary(req({ query: window }), r);
        expect(r.body.data.scope).toBe('company');
        expect(r.body.data.byPerson.map((p) => p.key).sort()).toEqual([ME, OTHER].sort());
    });
});

describe('TIM-04 money figures are for owners and admins', () => {
    it('returns no rates to a member', async () => {
        getRoleType.mockResolvedValue(3);
        const r = res();
        await rates.listRates(req(), r);
        expect(r.body).toMatchObject({ status: true, data: [], restricted: true });
    });

    it('lists rates for an owner', async () => {
        getRoleType.mockResolvedValue(1);
        const r = res();
        await rates.listRates(req(), r);
        expect(r.body.data).toHaveLength(1);
        expect(r.body.restricted).toBeUndefined();
    });

    it('refuses a member setting a rate and writes nothing', async () => {
        getRoleType.mockResolvedValue(3);
        const r = res();
        await rates.setRate(req({ body: { scope: 'default', rate: 1 } }), r);
        expect(r.code).toBe(403);
        expect(mockDb.store[SCHEMA_TYPE.BILLING_RATES][0].rate).toBe(120);
    });

    it('computes no invoice amounts for a guest', async () => {
        getRoleType.mockResolvedValue(0);
        const r = res();
        await rates.generateInvoice(req({ body: { start: 1, end: 999 } }), r);
        expect(r.body).toMatchObject({ status: true, data: null, restricted: true });
    });
});
