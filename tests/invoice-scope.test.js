const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn(), recordAudit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Instance/guard', () => ({ requireInstanceAdmin: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { requireInstanceAdmin } = require('../Modules/Instance/guard');
const billing = require('../Modules/Milestone/controller/billing');
const findCtrl = require('../Modules/Invoice/controller');
const ctrl = require('../Modules/Invoice/controller/projectInvoices');
const routes = require('../Modules/Invoice/routes');

const C = '6f0000000000000000000c01';
const P = '6f0000000000000000000b01';
const M = '6f0000000000000000000e01';
const OWNER = '6f0000000000000000000001';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const req = (over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: OWNER, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(1);
});

describe('16a POST /api/v1/invoice/find', () => {
    it('is only reachable through the instance admin guard', () => {
        const app = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
        routes.init(app);
        expect(app.post).toHaveBeenCalledWith('/api/v1/invoice/find', requireInstanceAdmin, findCtrl.getInvoice);
    });
});

describe('16d draft-from-milestone needs a billing contract', () => {
    const ctx = {
        project: { _id: P },
        contract: { exists: true, currency: 'USD', taxRateBp: 0, paymentTermsDays: 30, invoicePrefix: 'INV' },
        milestones: [{ id: M, name: 'Launch', amountMinor: 500000, taskIds: [], taskCount: 0, doneCount: 0, cancelled: false }],
        paidMilestoneIds: new Set(),
        invoicedMilestoneIds: new Set(),
        timelogs: [],
    };
    const draft = async () => {
        const r = res();
        await ctrl.draftFromMilestone(req({ body: { projectId: P, milestoneId: M } }), r);
        return r;
    };

    beforeEach(() => {
        jest.spyOn(billing, 'buildBillingContext').mockResolvedValue(ctx);
    });

    afterEach(() => jest.restoreAllMocks());

    it('answers 400 when the project has no contract', async () => {
        const r = await draft();
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
        expect(r.body.statusText).toMatch(/billing contract/);
        expect(mockDb.store[SCHEMA_TYPE.PROJECT_INVOICES] || []).toHaveLength(0);
    });

    it('still answers 400 when the only contract row is the bare invoice counter', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECT_CONTRACTS, { ProjectID: P, invoiceSeq: 1, deletedStatusKey: 0 });
        const r = await draft();
        expect(r.code).toBe(400);
        expect(mockDb.store[SCHEMA_TYPE.PROJECT_INVOICES] || []).toHaveLength(0);
    });

    it('drafts the invoice once a contract has been saved', async () => {
        mockDb.seed(SCHEMA_TYPE.PROJECT_CONTRACTS, { ProjectID: P, clientName: 'Acme', updatedBy: OWNER, deletedStatusKey: 0 });
        const r = await draft();
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(mockDb.store[SCHEMA_TYPE.PROJECT_INVOICES]).toHaveLength(1);
    });
});
