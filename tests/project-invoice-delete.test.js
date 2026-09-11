const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (r) => r === 1 || r === 2 }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const socket = require('../event/socketEventEmitter');
const { removeCache } = require('../utils/commonFunctions');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');
const billing = require('../Modules/Milestone/controller/billing');
const ctrl = require('../Modules/Invoice/controller/projectInvoices');
const routes = require('../Modules/Invoice/routes');

const C = '6f0000000000000000000c01';
const P = '6f0000000000000000000b01';
const OTHER_P = '6f0000000000000000000b02';
const INV = '6f0000000000000000000d01';
const OWNER = '6f0000000000000000000001';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const req = (over = {}) => ({ headers: { companyid: C }, params: { id: INV }, query: { projectId: P }, body: {}, uid: OWNER, ...over });
const seedInvoice = (fields = {}) => mockDb.seed(SCHEMA_TYPE.PROJECT_INVOICES, { _id: INV, ProjectID: P, number: 'INV-2026-001', status: 'draft', totalMinor: 1000, currency: 'USD', deletedStatusKey: 0, ...fields });
const invoiceRow = () => mockDb.store[SCHEMA_TYPE.PROJECT_INVOICES][0];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(1);
});

describe('TIM-06 DELETE /api/v2/invoices/:id', () => {
    it('is registered', () => {
        const app = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        expect(app.delete).toHaveBeenCalledWith('/api/v2/invoices/:id', ctrl.deleteInvoice);
    });

    it('soft-deletes a draft for an owner, clears the cache, emits and audits', async () => {
        seedInvoice();
        const r = res();
        await ctrl.deleteInvoice(req(), r);
        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: true, data: { _id: INV } });
        expect(invoiceRow()).toMatchObject({ deletedStatusKey: 1, updatedBy: OWNER, status: 'draft' });
        expect(removeCache).toHaveBeenCalledWith(`projectInvoices:${P}:${C}`);
        expect(socket.emit).toHaveBeenCalledWith('update', expect.objectContaining({ type: 'delete', module: 'projectInvoice' }));
        expect(recordAuditFromReq).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'billing.invoice.delete', entityId: INV }));
    });

    it('lets an admin delete a draft', async () => {
        getRoleType.mockResolvedValue(2);
        seedInvoice();
        const r = res();
        await ctrl.deleteInvoice(req(), r);
        expect(r.body.status).toBe(true);
    });

    it.each([[3, 'member'], [0, 'guest'], [null, 'outsider']])('refuses a %s (%s) with 403 and keeps the row', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        seedInvoice();
        const r = res();
        await ctrl.deleteInvoice(req(), r);
        expect(r.code).toBe(403);
        expect(invoiceRow().deletedStatusKey).toBe(0);
    });

    it('takes the role from the signed-in user, never the body', async () => {
        seedInvoice();
        const r = res();
        await ctrl.deleteInvoice(req({ uid: undefined, body: { userData: { id: OWNER } } }), r);
        expect(getRoleType).toHaveBeenCalledWith(C, '');
    });

    it.each(['sent', 'paid'])('answers 409 for a %s invoice', async (status) => {
        seedInvoice({ status });
        const r = res();
        await ctrl.deleteInvoice(req(), r);
        expect(r.code).toBe(409);
        expect(invoiceRow().deletedStatusKey).toBe(0);
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it('answers 404 for an invoice on another project', async () => {
        seedInvoice({ ProjectID: OTHER_P });
        const r = res();
        await ctrl.deleteInvoice(req(), r);
        expect(r.code).toBe(404);
        expect(invoiceRow().deletedStatusKey).toBe(0);
    });

    it('answers 404 for an invoice already deleted', async () => {
        seedInvoice({ deletedStatusKey: 1 });
        const r = res();
        await ctrl.deleteInvoice(req(), r);
        expect(r.code).toBe(404);
    });

    it('answers 400 without a valid projectId', async () => {
        seedInvoice();
        const r = res();
        await ctrl.deleteInvoice(req({ query: {} }), r);
        expect(r.code).toBe(400);
    });
});

describe('TIM-06 draft-from-month needs a billing contract', () => {
    const ctx = {
        project: { _id: P },
        contract: { exists: true, currency: 'USD', taxRateBp: 0, paymentTermsDays: 30, invoicePrefix: 'INV' },
        timelogs: [],
    };

    beforeEach(() => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(ctx);
    });

    afterEach(() => jest.restoreAllMocks());

    it('answers 400 when the project has no contract', async () => {
        const r = res();
        await ctrl.draftFromMonth(req({ query: {}, body: { projectId: P, month: '2026-09' } }), r);
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
        expect(r.body.statusText).toMatch(/billing contract/);
        expect(mockDb.store[SCHEMA_TYPE.PROJECT_INVOICES] || []).toHaveLength(0);
    });

    it('still answers 400 when the only contract row is the bare invoice counter', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECT_CONTRACTS, { ProjectID: P, invoiceSeq: 1, deletedStatusKey: 0 });
        const r = res();
        await ctrl.draftFromMonth(req({ query: {}, body: { projectId: P, month: '2026-09' } }), r);
        expect(r.code).toBe(400);
    });

    it('goes on to look for billable time once a contract has been saved', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECT_CONTRACTS, { ProjectID: P, clientName: 'Acme', updatedBy: OWNER, deletedStatusKey: 0 });
        const r = res();
        await ctrl.draftFromMonth(req({ query: {}, body: { projectId: P, month: '2026-09' } }), r);
        expect(r.code).toBe(200);
        expect(r.body.statusText).toMatch(/No billable time/);
    });
});
