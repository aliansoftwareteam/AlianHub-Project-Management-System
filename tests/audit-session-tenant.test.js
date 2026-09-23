const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Audit/controller');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');

const C = '6f00000000000000000000c1';
const OTHER_COMPANY = '6f00000000000000000000c2';
const OWNER = '6f0000000000000000000001';

const res = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.write = () => true;
    r.end = () => {};
    return r;
};

const call = async (handler, { query = {}, headers = { companyid: C }, aud = C, params = {} } = {}) => {
    const r = res();
    await handler({ uid: OWNER, aud, headers, query, params, body: {}, ip: '' }, r);
    return r;
};

const companiesUsed = () => [...new Set(mockDb.calls.map((c) => String(c.companyId)))];

const auditRows = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.AUDIT_LOGS && c.method === 'save');
const settle = async () => {
    for (let i = 0; i < 20 && !auditRows().length; i += 1) await new Promise(setImmediate);
};
const ENTRY = { action: 'member.update', entityType: 'member', entityId: 'm1' };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
});

describe.each([
    ['listAuditLogs', () => ctrl.listAuditLogs],
    ['exportAuditCsv', () => ctrl.exportAuditCsv],
])('%s takes the company from the verified request', (name, handler) => {
    it('reads the header company for a normal call', async () => {
        const r = await call(handler());

        expect(r.code).toBe(200);
        expect(companiesUsed()).toEqual([C]);
    });

    it('refuses a query naming another company and reads nothing', async () => {
        const r = await call(handler(), { query: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(r.body.statusText).not.toBe('Owner/admin only.');
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('undoAuditLog takes the company from the verified request', () => {
    it('refuses a query naming another company before looking the row up', async () => {
        const r = await call(ctrl.undoAuditLog, { query: { companyId: OTHER_COMPANY }, params: { id: '6f0000000000000000000a01' } });

        expect(r.code).toBe(403);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('recordAuditFromReq writes the row to the verified company', () => {
    it('records a signed-in request under the header company', async () => {
        recordAuditFromReq({ uid: OWNER, aud: C, headers: { companyid: C }, body: {} }, ENTRY);
        await settle();

        expect(auditRows().map((c) => String(c.companyId))).toEqual([C]);
    });

    it('records a SCIM request under the company its token was issued for, not one the body names', async () => {
        recordAuditFromReq({ scimCompanyId: C, headers: {}, body: { companyId: OTHER_COMPANY } }, ENTRY);
        await settle();

        expect(auditRows().map((c) => String(c.companyId))).toEqual([C]);
    });

    it('records nothing for a session whose body names a company outside its audience', async () => {
        recordAuditFromReq({ uid: OWNER, aud: C, headers: {}, body: { companyId: OTHER_COMPANY } }, ENTRY);
        await settle();

        expect(auditRows()).toHaveLength(0);
    });

    it('still records an instance admin key script that names the company in the body', async () => {
        recordAuditFromReq({ headers: {}, body: { companyId: C } }, ENTRY);
        await settle();

        expect(auditRows().map((c) => String(c.companyId))).toEqual([C]);
    });
});
