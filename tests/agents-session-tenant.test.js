const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 'owner'), isPrivileged: (r) => r === 'owner' || r === 'admin' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Agents/controller');

const COMPANY = '6f0000000000000000000f01';
const OTHER_COMPANY = '6f0000000000000000000f02';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (over = {}) => ({ headers: { companyid: COMPANY }, params: {}, query: {}, body: {}, uid: 'owner1', ip: '', ...over });
const companiesRead = () => [...new Set(mockDb.calls.map((c) => String(c.companyId)))];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Reviewer', deletedStatusKey: 0 });
});

describe('agents take the company from the verified companyid header', () => {
    it('lists the header company for a normal call', async () => {
        const r = res();
        await ctrl.listAgents(req(), r);

        expect(r.body.status).toBe(true);
        expect(companiesRead()).toEqual([COMPANY]);
    });

    it('ignores a query company when the header names one', async () => {
        const r = res();
        await ctrl.listAgents(req({ query: { companyId: OTHER_COMPANY } }), r);

        expect(companiesRead()).toEqual([COMPANY]);
    });

    it('never falls back to a query company', async () => {
        const r = res();
        await ctrl.listAgents(req({ headers: {}, query: { companyId: OTHER_COMPANY } }), r);

        expect(r.body.status).toBe(false);
        expect(mockDb.calls).toHaveLength(0);
    });
});
