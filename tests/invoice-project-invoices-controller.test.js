const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (r) => r === 1 || r === 2 }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { removeCache } = require('../utils/commonFunctions');
const socket = require('../event/socketEventEmitter');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');
const billing = require('../Modules/Milestone/controller/billing');
const ctrl = require('../Modules/Invoice/controller/projectInvoices');

const C = '6f0000000000000000000c01';
const P = '6f0000000000000000000b01';
const OTHER_P = '6f0000000000000000000b02';
const M = '6f0000000000000000000e01';
const M2 = '6f0000000000000000000e02';
const USER = '6f0000000000000000000001';
const USER2 = '6f0000000000000000000002';
const T1 = '6f0000000000000000000f01';
const T2 = '6f0000000000000000000f02';
const L1 = '6f0000000000000000000a01';
const INV = '6f0000000000000000000d01';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const req = (over = {}) => verified({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: USER, ...over });
const run = async (handler, over) => {
    const r = res();
    await handler(req(over), r);
    return r;
};

const invoices = () => mockDb.store[SCHEMA_TYPE.PROJECT_INVOICES] || [];
const invoiceRow = (id = INV) => invoices().find((row) => String(row._id) === id);
const seedInvoice = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECT_INVOICES, {
    _id: INV, ProjectID: P, number: 'INV-2026-001', status: 'draft', currency: 'USD', taxRateBp: 1000, totalMinor: 1100,
    lines: [{ id: 'l1', kind: 'adjustment', label: 'Fee', amountMinor: 1000, taskIds: [], timelogIds: [] }], deletedStatusKey: 0, ...over,
});
const seedContract = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECT_CONTRACTS, {
    ProjectID: P, clientName: 'Acme', updatedBy: USER, deletedStatusKey: 0, ...over,
});
const companies = () => [...new Set(mockDb.calls.map((c) => c.companyId))];
const callsFor = (type, method) => mockDb.calls.filter((c) => c.type === type && (!method || c.method === method));

const contractCtx = (over = {}) => ({
    project: { _id: P },
    contract: { exists: true, clientName: 'Acme', currency: 'USD', currencySymbol: '$', taxLabel: 'VAT', taxRateBp: 1000, paymentTermsDays: 14, invoicePrefix: 'ACM', requireTasksDoneToInvoice: false },
    milestones: [{ id: M, name: 'Launch', amountMinor: 500000, taskIds: [T1, T2], taskCount: 2, doneCount: 2, cancelled: false }],
    paidMilestoneIds: new Set(),
    invoicedMilestoneIds: new Set(),
    timelogs: [],
    ...over,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
    jest.spyOn(billing, 'resolveUserNames').mockResolvedValue(new Map());
});

afterEach(() => jest.restoreAllMocks());

describe('sanitizeLine', () => {
    it('keeps a known kind and falls back to adjustment for anything else', () => {
        expect(ctrl.sanitizeLine({ kind: 'expense' }).kind).toBe('expense');
        expect(ctrl.sanitizeLine({ kind: 'bribe' }).kind).toBe('adjustment');
        expect(ctrl.sanitizeLine({}).kind).toBe('adjustment');
        expect(ctrl.sanitizeLine().kind).toBe('adjustment');
    });

    it('treats a line without a rate as a flat amount, rounded', () => {
        expect(ctrl.sanitizeLine({ amountMinor: 1234.6, qtyMilli: 5000 })).toMatchObject({ qtyMilli: 1000, unitMinor: null, amountMinor: 1235 });
    });

    it('treats a line with a rate as quantity times rate and drops its flat amount', () => {
        expect(ctrl.sanitizeLine({ unitMinor: 5000, qtyMilli: 1500.4, amountMinor: 999 })).toMatchObject({ qtyMilli: 1500, unitMinor: 5000, amountMinor: 0 });
        expect(ctrl.sanitizeLine({ unitMinor: 0, qtyMilli: 2000 })).toMatchObject({ unitMinor: 0, qtyMilli: 2000 });
    });

    it('never lets a quantity or rate go negative', () => {
        expect(ctrl.sanitizeLine({ unitMinor: -5, qtyMilli: -9 })).toMatchObject({ unitMinor: 0, qtyMilli: 0 });
    });

    it('cuts the label and detail to their limits and makes text of anything else', () => {
        const line = ctrl.sanitizeLine({ label: 'x'.repeat(300), detail: 'y'.repeat(400) });
        expect(line.label).toHaveLength(200);
        expect(line.detail).toHaveLength(300);
        expect(ctrl.sanitizeLine({ label: 42 }).label).toBe('42');
        expect(ctrl.sanitizeLine({ label: null }).label).toBe('');
    });

    it('keeps a given id and invents a fresh object id otherwise', () => {
        expect(ctrl.sanitizeLine({ id: 'keep' }).id).toBe('keep');
        expect(ctrl.sanitizeLine({}).id).toMatch(/^[0-9a-f]{24}$/);
        expect(ctrl.sanitizeLine({}).id).not.toBe(ctrl.sanitizeLine({}).id);
    });

    it('keeps only well-formed ids for the milestone, tasks and time logs', () => {
        const line = ctrl.sanitizeLine({ milestoneId: 'nope', taskIds: [T1, 'bad', 7], timelogIds: [L1, '', null] });
        expect(line.milestoneId).toBe('');
        expect(line.taskIds).toEqual([T1]);
        expect(line.timelogIds).toEqual([L1]);
        expect(ctrl.sanitizeLine({ milestoneId: M }).milestoneId).toBe(M);
        expect(ctrl.sanitizeLine({ taskIds: 'x', timelogIds: {} })).toMatchObject({ taskIds: [], timelogIds: [] });
    });

    it('caps the traced tasks at 500 and time logs at 2000', () => {
        expect(ctrl.sanitizeLine({ taskIds: Array(600).fill(T1) }).taskIds).toHaveLength(500);
        expect(ctrl.sanitizeLine({ timelogIds: Array(2100).fill(L1) }).timelogIds).toHaveLength(2000);
    });
});

describe('priceInvoice', () => {
    it('derives every total from the lines', () => {
        const priced = ctrl.priceInvoice([
            { kind: 'adjustment', amountMinor: 1000, unitMinor: null },
            { kind: 'time', qtyMilli: 1500, unitMinor: 4000 },
        ], 1000);
        expect(priced.lines.map((l) => l.amountMinor)).toEqual([1000, 6000]);
        expect(priced).toMatchObject({ subtotalMinor: 7000, taxMinor: 700, totalMinor: 7700 });
    });

    it('prices no lines at zero', () => {
        expect(ctrl.priceInvoice([], 1000)).toMatchObject({ lines: [], subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
    });
});

describe('listInvoices', () => {
    it('returns the live invoices of the project, newest first, read in the caller company', async () => {
        seedInvoice({ _id: INV, issuedDate: new Date('2026-01-01') });
        seedInvoice({ _id: '6f0000000000000000000d02', issuedDate: new Date('2026-02-01') });
        seedInvoice({ _id: '6f0000000000000000000d03', ProjectID: OTHER_P });
        seedInvoice({ _id: '6f0000000000000000000d04', deletedStatusKey: 1 });

        const r = await run(ctrl.listInvoices, { query: { projectId: P } });

        expect(r.body.status).toBe(true);
        expect(r.body.data.map((d) => String(d._id))).toEqual(['6f0000000000000000000d02', INV]);
        const [call] = callsFor(SCHEMA_TYPE.PROJECT_INVOICES, 'find');
        expect(call.companyId).toBe(C);
        expect(String(call.data[0].ProjectID)).toBe(P);
        expect(call.data[0].deletedStatusKey).toBe(0);
        expect(call.data[2]).toEqual({ sort: { issuedDate: -1, createdAt: -1 } });
    });

    it('answers an empty list for a project with no invoices', async () => {
        const r = await run(ctrl.listInvoices, { query: { projectId: P } });
        expect(r.body).toEqual({ status: true, statusText: 'OK', data: [] });
    });

    it.each([[undefined], [''], ['abc'], ['6f0000000000000000000b0']])('refuses projectId %p without a query', async (projectId) => {
        const r = await run(ctrl.listInvoices, { query: { projectId } });
        expect(r.body).toEqual({ status: false, statusText: 'A valid projectId is required.' });
        expect(mockDb.calls).toHaveLength(0);
    });

    it('refuses a request with no query at all', async () => {
        const r = await run(ctrl.listInvoices, { query: undefined });
        expect(r.body.status).toBe(false);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('refuses a guest the money and reads nothing', async () => {
        getRoleType.mockResolvedValue(0);
        seedInvoice();
        const r = await run(ctrl.listInvoices, { query: { projectId: P } });
        expect(r.body).toEqual({ status: false, statusText: 'Guests can only see the client view of this project.' });
        expect(mockDb.calls).toHaveLength(0);
        expect(getRoleType).toHaveBeenCalledWith(C, USER);
    });

    it('answers 403 when the token does not hold the company, and reads nothing', async () => {
        const r = await run(ctrl.listInvoices, { query: { projectId: P }, aud: undefined });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('answers 403 when the query names a different company than the header', async () => {
        const r = await run(ctrl.listInvoices, { query: { projectId: P, companyId: '6f0000000000000000000c02' } });
        expect(r.code).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('answers the error text when the read fails', async () => {
        mockDb.crud.mockRejectedValueOnce(new Error('db down'));
        const r = await run(ctrl.listInvoices, { query: { projectId: P } });
        expect(r.body).toEqual({ status: false, statusText: 'db down' });
    });
});

describe('getInvoice', () => {
    it('returns the invoice with the tasks and time logs behind its lines', async () => {
        seedInvoice({ lines: [
            { id: 'a', taskIds: [T1, T2], timelogIds: [L1] },
            { id: 'b', taskIds: [T1], timelogIds: [] },
        ] });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T1, TaskKey: 'AP-1', TaskName: 'Build', statusType: 'close' });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T2, TaskKey: 'AP-2', TaskName: 'Ship', statusType: 'open' });
        mockDb.seed(SCHEMA_TYPE.TIMESHEET, { _id: L1, TicketID: T1, Loggeduser: USER2, LogTimeDuration: 90, LogStartTime: 1770000000, LogDescription: 'z'.repeat(300) });
        billing.resolveUserNames.mockResolvedValue(new Map([[USER2, 'Bea']]));

        const r = await run(ctrl.getInvoice, { params: { id: INV } });

        expect(r.body.status).toBe(true);
        expect(String(r.body.data.invoice._id)).toBe(INV);
        expect(r.body.data.trace.tasks).toEqual([
            { _id: T1, key: 'AP-1', name: 'Build', done: true },
            { _id: T2, key: 'AP-2', name: 'Ship', done: false },
        ]);
        expect(r.body.data.trace.timelogs).toEqual([
            { _id: L1, taskId: T1, userName: 'Bea', minutes: 90, at: 1770000000, note: 'z'.repeat(200) },
        ]);
        expect(billing.resolveUserNames).toHaveBeenCalledWith(C, [USER2]);
        expect(companies()).toEqual([C]);
    });

    it('asks for each task once even when several lines name it', async () => {
        seedInvoice({ lines: [{ id: 'a', taskIds: [T1] }, { id: 'b', taskIds: [T1] }] });
        await run(ctrl.getInvoice, { params: { id: INV } });
        const [taskCall] = callsFor(SCHEMA_TYPE.TASKS, 'find');
        expect(taskCall.data[0]).toEqual({ _id: { $in: [T1] } });
    });

    it('does not query tasks or time logs for an invoice whose lines name none', async () => {
        seedInvoice({ lines: [{ id: 'a', taskIds: [], timelogIds: [] }] });
        const r = await run(ctrl.getInvoice, { params: { id: INV } });
        expect(r.body.data.trace).toEqual({ tasks: [], timelogs: [] });
        expect(callsFor(SCHEMA_TYPE.TASKS)).toHaveLength(0);
        expect(callsFor(SCHEMA_TYPE.TIMESHEET)).toHaveLength(0);
    });

    it('answers "not found" for an unknown or deleted invoice', async () => {
        seedInvoice({ deletedStatusKey: 1 });
        expect((await run(ctrl.getInvoice, { params: { id: INV } })).body).toEqual({ status: false, statusText: 'Invoice not found.' });
        expect((await run(ctrl.getInvoice, { params: { id: '6f0000000000000000000dff' } })).body.statusText).toBe('Invoice not found.');
    });

    it.each([[''], ['xyz'], [undefined]])('refuses id %p before reading', async (id) => {
        const r = await run(ctrl.getInvoice, { params: { id } });
        expect(r.body).toEqual({ status: false, statusText: 'A valid invoice id is required.' });
        expect(mockDb.calls).toHaveLength(0);
    });

    it('refuses a guest and reads nothing', async () => {
        getRoleType.mockResolvedValue(0);
        seedInvoice();
        const r = await run(ctrl.getInvoice, { params: { id: INV } });
        expect(r.body.statusText).toMatch(/Guests/);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('answers 403 when the token does not hold the company', async () => {
        const r = await run(ctrl.getInvoice, { params: { id: INV }, aud: undefined });
        expect(r.code).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('draftFromMilestone', () => {
    const draft = (over = {}) => run(ctrl.draftFromMilestone, { body: { projectId: P, milestoneId: M }, ...over });

    beforeEach(() => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx());
        seedContract();
    });

    it('drafts an invoice with one line for the milestone, priced with tax and due after the payment terms', async () => {
        const r = await draft();

        expect(r.body).toMatchObject({ status: true, statusText: 'Draft invoice created.' });
        const row = invoices()[0];
        expect(String(row.ProjectID)).toBe(P);
        expect(row).toMatchObject({
            status: 'draft', source: 'milestone', clientName: 'Acme', currency: 'USD', currencySymbol: '$',
            taxLabel: 'VAT', taxRateBp: 1000, subtotalMinor: 500000, taxMinor: 50000, totalMinor: 550000, createdBy: USER,
        });
        expect(row.lines).toHaveLength(1);
        expect(row.lines[0]).toMatchObject({ kind: 'milestone', label: 'Launch', detail: '2 tasks', amountMinor: 500000, milestoneId: M, taskIds: [T1, T2] });
        expect(row.dueDate.getTime() - row.issuedDate.getTime()).toBe(14 * 86400000);
        expect(row.number).toBe(`ACM-${new Date().getUTCFullYear()}-001`);
    });

    it('numbers successive drafts in sequence on the project contract', async () => {
        await draft();
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx({ milestones: [{ id: M2, name: 'Next', amountMinor: 100, taskIds: [], taskCount: 0, doneCount: 0, cancelled: false }] }));
        await draft({ body: { projectId: P, milestoneId: M2 } });
        expect(invoices().map((i) => i.number.slice(-3))).toEqual(['001', '002']);
    });

    it('reads and writes everything in the caller company, and clears that company cache', async () => {
        await draft();
        expect(companies()).toEqual([C]);
        expect(billing.buildBillingContext).toHaveBeenCalledWith(C, P);
        expect(removeCache).toHaveBeenCalledWith(`projectInvoices:${P}:${C}`);
        const counter = callsFor(SCHEMA_TYPE.PROJECT_CONTRACTS, 'findOneAndUpdate')[0];
        expect(String(counter.data[0].ProjectID)).toBe(P);
        expect(counter.data[1]).toEqual({ $inc: { invoiceSeq: 1 } });
    });

    it('tells listeners and the audit trail about the new draft', async () => {
        await draft();
        expect(socket.emit).toHaveBeenCalledWith('update', expect.objectContaining({ type: 'add', module: 'projectInvoice' }));
        expect(recordAuditFromReq).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            action: 'billing.invoice.draft', entityType: 'project_invoice',
            meta: expect.objectContaining({ projectId: P, source: 'milestone', totalMinor: 550000, currency: 'USD', lineCount: 1 }),
        }));
    });

    it.each([
        ['no ids', {}],
        ['no milestone', { projectId: P }],
        ['no project', { milestoneId: M }],
        ['a bad project', { projectId: 'x', milestoneId: M }],
        ['a bad milestone', { projectId: P, milestoneId: 'x' }],
    ])('refuses %s before reading anything', async (label, body) => {
        const r = await draft({ body });
        expect(r.body).toEqual({ status: false, statusText: 'A valid projectId and milestoneId are required.' });
        expect(mockDb.calls).toHaveLength(0);
        expect(invoices()).toHaveLength(0);
    });

    it('refuses a request with no body', async () => {
        const r = await draft({ body: undefined });
        expect(r.body.status).toBe(false);
        expect(invoices()).toHaveLength(0);
    });

    it('answers "Project not found" when the project has no billing context', async () => {
        billing.buildBillingContext.mockResolvedValue(null);
        const r = await draft();
        expect(r.body).toEqual({ status: false, statusText: 'Project not found.' });
        expect(invoices()).toHaveLength(0);
    });

    it('answers "Milestone not found" for a milestone of another project', async () => {
        const r = await draft({ body: { projectId: P, milestoneId: M2 } });
        expect(r.body).toEqual({ status: false, statusText: 'Milestone not found on this project.' });
        expect(invoices()).toHaveLength(0);
    });

    it('refuses a cancelled milestone', async () => {
        billing.buildBillingContext.mockResolvedValue(contractCtx({ milestones: [{ id: M, name: 'Launch', amountMinor: 1, taskIds: [], taskCount: 0, doneCount: 0, cancelled: true }] }));
        const r = await draft();
        expect(r.body.statusText).toBe('A cancelled milestone cannot be invoiced.');
        expect(invoices()).toHaveLength(0);
    });

    it.each([['paidMilestoneIds'], ['invoicedMilestoneIds']])('refuses a milestone already in %s', async (key) => {
        billing.buildBillingContext.mockResolvedValue(contractCtx({ [key]: new Set([M]) }));
        const r = await draft();
        expect(r.body.statusText).toBe('This milestone is already on an issued invoice.');
        expect(invoices()).toHaveLength(0);
    });

    it('refuses open tasks when the contract requires them done, and counts them', async () => {
        const ctx = contractCtx();
        ctx.contract.requireTasksDoneToInvoice = true;
        ctx.milestones[0].doneCount = 1;
        billing.buildBillingContext.mockResolvedValue(ctx);
        const r = await draft();
        expect(r.body.status).toBe(false);
        expect(r.body.statusText).toMatch(/^1 task\(s\) in this milestone are still open/);
        expect(invoices()).toHaveLength(0);
    });

    it('lets open tasks through when the contract does not require them done', async () => {
        const ctx = contractCtx();
        ctx.milestones[0].doneCount = 0;
        billing.buildBillingContext.mockResolvedValue(ctx);
        expect((await draft()).body.status).toBe(true);
    });

    it('lets a milestone with no tasks through even when tasks are required done', async () => {
        const ctx = contractCtx({ milestones: [{ id: M, name: 'Launch', amountMinor: 100, taskIds: [], taskCount: 0, doneCount: 0, cancelled: false }] });
        ctx.contract.requireTasksDoneToInvoice = true;
        billing.buildBillingContext.mockResolvedValue(ctx);
        expect((await draft()).body.status).toBe(true);
    });

    it('refuses a guest and writes nothing', async () => {
        getRoleType.mockResolvedValue(0);
        const r = await draft();
        expect(r.body.statusText).toMatch(/Guests/);
        expect(billing.buildBillingContext).not.toHaveBeenCalled();
        expect(invoices()).toHaveLength(0);
    });

    it('answers 403 when the token does not hold the company, and writes nothing', async () => {
        const r = await draft({ aud: undefined });
        expect(r.code).toBe(403);
        expect(invoices()).toHaveLength(0);
        expect(billing.buildBillingContext).not.toHaveBeenCalled();
    });

    it('answers the error text and sends no event when saving fails', async () => {
        const original = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (company, obj, method) => {
            if (method === 'save') throw new Error('save failed');
            return original(company, obj, method);
        });
        const r = await draft();
        mockDb.crud.mockImplementation(original);
        expect(r.body).toEqual({ status: false, statusText: 'save failed' });
        expect(socket.emit).not.toHaveBeenCalled();
        expect(recordAuditFromReq).not.toHaveBeenCalled();
    });
});

describe('draftFromMonth', () => {
    const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);
    const log = (over) => ({ _id: L1, Loggeduser: USER, TicketID: T1, LogStartTime: ts('2026-09-10T10:00:00Z'), LogTimeDuration: 90, ...over });
    const draft = (month = '2026-09') => run(ctrl.draftFromMonth, { body: { projectId: P, month } });

    beforeEach(() => {
        seedContract();
        mockDb.seed(SCHEMA_TYPE.BILLING_RATES, { scope: 'user', refId: USER, rate: 100, deletedStatusKey: 0 });
        billing.resolveUserNames.mockResolvedValue(new Map([[USER, 'Ana'], [USER2, 'Bea']]));
    });

    it('drafts one line per person from their billable minutes at their own rate', async () => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx({ timelogs: [
            log({ _id: L1, LogTimeDuration: 60 }),
            log({ _id: '6f0000000000000000000a02', LogTimeDuration: 30, TicketID: T2 }),
            log({ _id: '6f0000000000000000000a03', Loggeduser: USER2, LogTimeDuration: 120 }),
        ] }));

        const r = await draft();

        expect(r.body.status).toBe(true);
        const row = invoices()[0];
        expect(row).toMatchObject({ source: 'month', status: 'draft', createdBy: USER });
        expect(row.periodStart).toEqual(new Date(Date.UTC(2026, 8, 1)));
        expect(row.periodEnd).toEqual(new Date(Date.UTC(2026, 9, 0, 23, 59, 59, 999)));
        const ana = row.lines.find((l) => l.label === 'Ana · 2026-09');
        const bea = row.lines.find((l) => l.label === 'Bea · 2026-09');
        expect(ana).toMatchObject({ kind: 'time', qtyMilli: 1500, unitMinor: 10000, amountMinor: 15000, taskIds: [T1, T2], timelogIds: [L1, '6f0000000000000000000a02'] });
        expect(ana.detail).toBe('1.50h across 2 task(s)');
        expect(bea).toMatchObject({ qtyMilli: 2000, unitMinor: 0, amountMinor: 0 });
        expect(row.subtotalMinor).toBe(15000);
        expect(row.totalMinor).toBe(16500);
    });

    it('leaves out non-billable, out-of-month and zero-minute entries', async () => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx({ timelogs: [
            log({ _id: L1 }),
            log({ _id: '6f0000000000000000000a02', billable: false }),
            log({ _id: '6f0000000000000000000a03', LogStartTime: ts('2026-08-31T23:59:59Z') }),
            log({ _id: '6f0000000000000000000a04', LogStartTime: ts('2026-10-01T00:00:00Z') }),
            log({ _id: '6f0000000000000000000a05', LogTimeDuration: 0 }),
        ] }));
        await draft();
        expect(invoices()[0].lines).toHaveLength(1);
        expect(invoices()[0].lines[0].timelogIds).toEqual([L1]);
    });

    it('answers that nothing is billable, and drafts nothing, when the month has no billable time', async () => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx({ timelogs: [log({ billable: false })] }));
        const r = await draft('2026-09');
        expect(r.body).toEqual({ status: false, statusText: 'No billable time logged on this project in 2026-09.' });
        expect(invoices()).toHaveLength(0);
    });

    it('reads rates and writes the draft in the caller company only', async () => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx({ timelogs: [log()] }));
        await draft();
        expect(companies()).toEqual([C]);
        expect(billing.resolveUserNames).toHaveBeenCalledWith(C, [USER]);
        expect(callsFor(SCHEMA_TYPE.BILLING_RATES, 'find')[0].companyId).toBe(C);
        expect(removeCache).toHaveBeenCalledWith(`projectInvoices:${P}:${C}`);
    });

    it('labels a person with no known name as Unassigned', async () => {
        billing.resolveUserNames.mockResolvedValue(new Map());
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(contractCtx({ timelogs: [log()] }));
        await draft();
        expect(invoices()[0].lines[0].label).toBe('Unassigned · 2026-09');
    });

    it.each([[undefined], [''], ['bad']])('refuses projectId %p', async (projectId) => {
        const r = await run(ctrl.draftFromMonth, { body: { projectId, month: '2026-09' } });
        expect(r.body).toEqual({ status: false, statusText: 'A valid projectId is required.' });
        expect(mockDb.calls).toHaveLength(0);
    });

    it('answers "Project not found" when the project has no billing context', async () => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(null);
        const r = await draft();
        expect(r.body).toEqual({ status: false, statusText: 'Project not found.' });
    });

    it('refuses a guest and writes nothing', async () => {
        getRoleType.mockResolvedValue(0);
        const r = await draft();
        expect(r.body.statusText).toMatch(/Guests/);
        expect(invoices()).toHaveLength(0);
    });

    it('answers 403 when the token does not hold the company', async () => {
        const r = await run(ctrl.draftFromMonth, { body: { projectId: P, month: '2026-09' }, aud: undefined });
        expect(r.code).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('updateInvoice', () => {
    const put = (body, over = {}) => run(ctrl.updateInvoice, { params: { id: INV }, body, ...over });

    it('replaces the lines and recomputes every total from them, whatever the client says', async () => {
        seedInvoice();
        const r = await put({ lines: [{ kind: 'expense', label: 'Travel', amountMinor: 2000 }, { kind: 'time', label: 'Hours', qtyMilli: 2000, unitMinor: 500 }], subtotalMinor: 1, totalMinor: 1, taxMinor: 0 });

        expect(r.body).toMatchObject({ status: true, statusText: 'Invoice saved.' });
        expect(invoiceRow()).toMatchObject({ subtotalMinor: 3000, taxMinor: 300, totalMinor: 3300, taxRateBp: 1000, updatedBy: USER });
        expect(invoiceRow().lines.map((l) => l.amountMinor)).toEqual([2000, 1000]);
    });

    it('keeps the stored lines and tax rate when the body sends neither', async () => {
        seedInvoice();
        await put({ notes: 'hello' });
        expect(invoiceRow()).toMatchObject({ notes: 'hello', taxRateBp: 1000, subtotalMinor: 1000, totalMinor: 1100 });
        expect(invoiceRow().lines).toHaveLength(1);
    });

    it('applies a new tax rate to the stored lines, rounding it to a whole basis point', async () => {
        seedInvoice();
        await put({ taxRateBp: 2000.4 });
        expect(invoiceRow()).toMatchObject({ taxRateBp: 2000, taxMinor: 200, totalMinor: 1200 });
    });

    it('treats a negative or unreadable tax rate as zero', async () => {
        seedInvoice();
        await put({ taxRateBp: -5 });
        expect(invoiceRow().taxRateBp).toBe(0);
        await put({ taxRateBp: 'abc' });
        expect(invoiceRow().taxRateBp).toBe(0);
    });

    it('refuses a tax rate above 100% and changes nothing', async () => {
        seedInvoice();
        const r = await put({ taxRateBp: 10001 });
        expect(r.body).toEqual({ status: false, statusText: 'A tax rate above 100% is not a tax rate.' });
        expect(invoiceRow().taxRateBp).toBe(1000);
        expect(callsFor(SCHEMA_TYPE.PROJECT_INVOICES, 'findOneAndUpdate')).toHaveLength(0);
    });

    it('accepts exactly 100%', async () => {
        seedInvoice();
        expect((await put({ taxRateBp: 10000 })).body.status).toBe(true);
    });

    it('cuts the tax label and notes to their limits', async () => {
        seedInvoice();
        await put({ taxLabel: 'T'.repeat(60), notes: 'n'.repeat(3000) });
        expect(invoiceRow().taxLabel).toHaveLength(40);
        expect(invoiceRow().notes).toHaveLength(2000);
    });

    it('sets a new due date and keeps the old one when the date is unreadable', async () => {
        const old = new Date('2026-05-01T00:00:00Z');
        seedInvoice({ dueDate: old });
        await put({ dueDate: '2026-06-15T00:00:00Z' });
        expect(invoiceRow().dueDate).toEqual(new Date('2026-06-15T00:00:00Z'));
        await put({ dueDate: 'next tuesday-ish' });
        expect(invoiceRow().dueDate).toEqual(new Date('2026-06-15T00:00:00Z'));
    });

    it('writes to the invoice id in the caller company, then clears the cache of that project and company', async () => {
        seedInvoice();
        await put({ notes: 'x' });
        const [write] = callsFor(SCHEMA_TYPE.PROJECT_INVOICES, 'findOneAndUpdate');
        expect(write.companyId).toBe(C);
        expect(write.data[0]).toEqual({ _id: INV });
        expect(companies()).toEqual([C]);
        expect(removeCache).toHaveBeenCalledWith(`projectInvoices:${P}:${C}`);
        expect(socket.emit).toHaveBeenCalledWith('update', expect.objectContaining({ type: 'update', module: 'projectInvoice' }));
    });

    it('audits the change with the old and new totals', async () => {
        seedInvoice();
        await put({ lines: [{ kind: 'adjustment', amountMinor: 5000 }] });
        expect(recordAuditFromReq).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            action: 'billing.invoice.update', entityId: INV, entityName: 'INV-2026-001',
            meta: { projectId: P, fromTotalMinor: 1100, toTotalMinor: 5500, currency: 'USD' },
        }));
    });

    it.each(['sent', 'paid'])('refuses to edit a %s invoice', async (status) => {
        seedInvoice({ status });
        const r = await put({ notes: 'late edit' });
        expect(r.body).toEqual({ status: false, statusText: 'This invoice has already been issued. Raise a new one instead.' });
        expect(invoiceRow().notes).toBeUndefined();
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it('answers "not found" for an unknown or deleted invoice', async () => {
        seedInvoice({ deletedStatusKey: 1 });
        expect((await put({})).body).toEqual({ status: false, statusText: 'Invoice not found.' });
    });

    it('answers a failure and writes nothing when lines is not a list', async () => {
        seedInvoice();
        const r = await put({ lines: 'abc' });
        expect(r.body.status).toBe(false);
        expect(callsFor(SCHEMA_TYPE.PROJECT_INVOICES, 'findOneAndUpdate')).toHaveLength(0);
        expect(invoiceRow().lines).toHaveLength(1);
    });

    it.each([[''], ['nope'], [undefined]])('refuses id %p before reading', async (id) => {
        const r = await run(ctrl.updateInvoice, { params: { id }, body: {} });
        expect(r.body).toEqual({ status: false, statusText: 'A valid invoice id is required.' });
        expect(mockDb.calls).toHaveLength(0);
    });

    it('refuses a guest and changes nothing', async () => {
        getRoleType.mockResolvedValue(0);
        seedInvoice();
        const r = await put({ notes: 'x' });
        expect(r.body.statusText).toMatch(/Guests/);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('answers 403 when the token does not hold the company', async () => {
        seedInvoice();
        const r = await put({ notes: 'x' }, { aud: undefined });
        expect(r.code).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe.each([
    ['sendInvoice', 'sent', 'draft', 'Invoice sent.', 'sentAt'],
    ['markInvoicePaid', 'paid', 'sent', 'Invoice marked paid.', 'paidAt'],
])('%s', (name, target, from, text, stamp) => {
    const go = (over = {}) => run(ctrl[name], { params: { id: INV }, ...over });

    it(`moves a ${from} invoice to ${target}, stamping who and when`, async () => {
        seedInvoice({ status: from });
        const r = await go();
        expect(r.body).toMatchObject({ status: true, statusText: text });
        expect(invoiceRow()).toMatchObject({ status: target, updatedBy: USER });
        expect(invoiceRow()[stamp]).toBeInstanceOf(Date);
    });

    it('writes to that invoice in the caller company, clears the cache, emits and audits', async () => {
        seedInvoice({ status: from, lines: [{ id: 'a', milestoneId: M }, { id: 'b', milestoneId: '' }] });
        await go();
        const [write] = callsFor(SCHEMA_TYPE.PROJECT_INVOICES, 'findOneAndUpdate');
        expect(write.companyId).toBe(C);
        expect(write.data[0]).toEqual({ _id: INV });
        expect(companies()).toEqual([C]);
        expect(removeCache).toHaveBeenCalledWith(`projectInvoices:${P}:${C}`);
        expect(socket.emit).toHaveBeenCalledWith('update', expect.objectContaining({ type: 'update', module: 'projectInvoice' }));
        expect(recordAuditFromReq).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            action: `billing.invoice.${target}`,
            meta: { projectId: P, totalMinor: 1100, currency: 'USD', milestoneIds: [M] },
        }));
    });

    it(`refuses an invoice that is already ${target}`, async () => {
        seedInvoice({ status: target });
        const r = await go();
        expect(r.body).toEqual({ status: false, statusText: `This invoice is already ${target}.` });
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it('answers "not found" for an unknown or deleted invoice', async () => {
        seedInvoice({ status: from, deletedStatusKey: 1 });
        expect((await go()).body).toEqual({ status: false, statusText: 'Invoice not found.' });
    });

    it.each([[''], ['nope'], [undefined]])('refuses id %p before reading', async (id) => {
        const r = await run(ctrl[name], { params: { id } });
        expect(r.body).toEqual({ status: false, statusText: 'A valid invoice id is required.' });
        expect(mockDb.calls).toHaveLength(0);
    });

    it('refuses a guest and changes nothing', async () => {
        getRoleType.mockResolvedValue(0);
        seedInvoice({ status: from });
        const r = await go();
        expect(r.body.statusText).toMatch(/Guests/);
        expect(mockDb.calls).toHaveLength(0);
        expect(invoiceRow().status).toBe(from);
    });

    it('answers 403 when the token does not hold the company', async () => {
        seedInvoice({ status: from });
        const r = await go({ aud: undefined });
        expect(r.code).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });

    it('answers the error text when the write fails', async () => {
        seedInvoice({ status: from });
        const original = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (company, obj, method) => {
            if (method === 'findOneAndUpdate') throw new Error('write failed');
            return original(company, obj, method);
        });
        const r = await go();
        mockDb.crud.mockImplementation(original);
        expect(r.body).toEqual({ status: false, statusText: 'write failed' });
        expect(socket.emit).not.toHaveBeenCalled();
    });
});

describe('invoice status order', () => {
    it('refuses to send a sent or paid invoice and says only a draft can be sent', async () => {
        seedInvoice({ status: 'paid' });
        expect((await run(ctrl.sendInvoice, { params: { id: INV } })).body.statusText).toBe('Only a draft can be sent.');
    });

    it('refuses to mark a draft paid before it is sent', async () => {
        seedInvoice({ status: 'draft' });
        const r = await run(ctrl.markInvoicePaid, { params: { id: INV } });
        expect(r.body).toEqual({ status: false, statusText: 'Send the invoice before marking it paid.' });
        expect(invoiceRow().status).toBe('draft');
    });

    it('refuses to send a draft with no lines', async () => {
        seedInvoice({ lines: [] });
        const r = await run(ctrl.sendInvoice, { params: { id: INV } });
        expect(r.body).toEqual({ status: false, statusText: 'An invoice with no lines cannot be sent.' });
        expect(invoiceRow().status).toBe('draft');
    });

    it('takes a draft through sent to paid', async () => {
        seedInvoice();
        await run(ctrl.sendInvoice, { params: { id: INV } });
        await run(ctrl.markInvoicePaid, { params: { id: INV } });
        expect(invoiceRow().status).toBe('paid');
    });
});
