const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Audit/controller');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const ENTITY = '6f0000000000000000000e01';

const seedRows = (count, extra = {}) => {
    for (let i = 0; i < count; i += 1) {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', entityType: 'member', entityId: ENTITY, actorName: 'Olivia Owner', createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)), meta: {}, ...extra });
    }
};

const exportCsv = async (query, uid = OWNER) => {
    const chunks = [];
    const res = { code: 200, headers: {} };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { chunks.push(String(b)); return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.write = (b) => { chunks.push(String(b)); return true; };
    res.end = (b) => { if (b) chunks.push(String(b)); res.ended = true; };
    await ctrl.exportAuditCsv({ uid, headers: { companyid: CID }, query, body: {} }, res);
    return { ...res, text: chunks.join('') };
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    delete process.env.AUDIT_EXPORT_MAX_ROWS;
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3 });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
});

describe('INS-08 audit CSV export', () => {
    it('exports every row of the filter, not only the first 100', async () => {
        seedRows(101);
        seedRows(5, { entityId: '6f0000000000000000000e02' });
        const out = await exportCsv({ entityId: ENTITY });
        expect(out.headers['Content-Type']).toContain('text/csv');
        expect(out.text.split('\n')).toHaveLength(102);
        expect(out.text.split('\n')[0]).toBe('time,actorType,actor,agent,run,event,entity,reason,cost_usd,undone_at');
    });

    it('pages past a thousand rows', async () => {
        seedRows(2345);
        const out = await exportCsv({});
        expect(out.text.split('\n')).toHaveLength(2346);
    });

    it('stops at the cap and says so in a last row', async () => {
        process.env.AUDIT_EXPORT_MAX_ROWS = '250';
        seedRows(300);
        const lines = (await exportCsv({})).text.split('\n');
        expect(lines).toHaveLength(252);
        expect(lines[251]).toMatch(/truncated at 250 rows/i);
    });

    it('never raises the cap above 100,000', () => {
        process.env.AUDIT_EXPORT_MAX_ROWS = '5000000';
        expect(ctrl.auditExportCap()).toBe(100000);
    });

    it('refuses a member', async () => {
        expect((await exportCsv({}, MEMBER)).code).toBe(403);
    });
});

describe('INS-09 audit actor and CSV cells', () => {
    it('records the signed-in actor, not a name from the request body', async () => {
        recordAuditFromReq(
            { uid: OWNER, headers: { companyid: CID }, body: { userData: { id: MEMBER, name: '=HYPERLINK("http://example.invalid","Rahul")' } } },
            { action: 'member.update', entityType: 'member', entityId: ENTITY },
        );
        for (let i = 0; i < 20 && !(mockDb.store[SCHEMA_TYPE.AUDIT_LOGS] || []).length; i += 1) await new Promise(setImmediate);
        const [row] = mockDb.store[SCHEMA_TYPE.AUDIT_LOGS];
        expect(row).toMatchObject({ actorId: OWNER, actorName: 'Olivia Owner' });
    });

    it('neutralises a formula in an exported cell', async () => {
        seedRows(1, { actorName: '=HYPERLINK("http://example.invalid","Rahul")', entityName: '@SUM(A1)' });
        const { text } = await exportCsv({ entityId: ENTITY });
        expect(text).not.toMatch(/(^|,)"?[=+\-@]/m);
        expect(text).toContain(`"'=HYPERLINK(""http://example.invalid"",""Rahul"")"`);
        expect(text).toContain(`'@SUM(A1)`);
    });
});
