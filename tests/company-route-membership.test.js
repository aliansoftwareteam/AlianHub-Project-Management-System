jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { requireLiveCompanyMembership } = require('../Config/jwt');
const ctrl = require('../Modules/Company/controller/updateCompany');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';

const detailsUpdate = { updateObject: { Cst_CompanyName: 'Renamed' } };

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        server.put('/api/v1/admin/company', requireLiveCompanyMembership, ctrl.updateCompany);
        server.put('/api/v1/company-invitation', requireLiveCompanyMembership, ctrl.updateCompany);
        server.get('/api/v1/getEnv', (req, res) => res.json({ status: true, companyId: req.headers.companyid || null }));
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        if (obj.type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return { userId: OWNER, roleType: 1 };
        if (obj.type === SCHEMA_TYPE.USERS) return { _id: OWNER, AssignCompany: [COMPANY] };
        if (method === 'findOneAndUpdate') return { _id: COMPANY };
        return null;
    });
});

const forgetMembership = (companyId) => myCache.del(`membership:${OWNER}:${companyId}`);

describe('requireCompanyAud judges the company the handler will use', () => {
    it('refuses a header company outside the audience even when the body names one inside it', async () => {
        const token = signSession(OWNER, [COMPANY]);
        const res = await app.call('get', '/api/v1/getEnv', { token, companyId: OTHER_COMPANY });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, error: 'You do not have access to this company' });
    });

    it('still accepts a request that names only companies in the audience', async () => {
        const token = signSession(OWNER, [COMPANY]);
        const res = await app.call('get', '/api/v1/getEnv', { token, companyId: COMPANY });
        expect(res.status).toBe(200);
    });
});

describe('the company routes that take the company from the body', () => {
    it.each([
        ['/api/v1/admin/company'],
        ['/api/v1/company-invitation'],
    ])('refuses %s to a caller who is no longer a member', async (path) => {
        const token = signSession(OWNER, [COMPANY]);
        forgetMembership(COMPANY);
        MongoDbCrudOpration.mockImplementation(async (db, obj) => (obj.type === SCHEMA_TYPE.USERS ? null : { userId: OWNER, roleType: 1 }));
        const res = await app.call('put', path, { token, body: { ...detailsUpdate, companyId: COMPANY } });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ error: 'You are no longer a member of this company' });
    });

    it('still refuses a caller who names two of their own companies at once', async () => {
        const token = signSession(OWNER, [COMPANY, OTHER_COMPANY]);
        const res = await app.call('put', '/api/v1/admin/company', { token, companyId: COMPANY, body: { ...detailsUpdate, companyId: OTHER_COMPANY } });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false, message: 'The request names more than one company.' });
    });

    it.each([
        ['/api/v1/admin/company'],
        ['/api/v1/company-invitation'],
    ])('lets a live member through %s to the handler', async (path) => {
        const token = signSession(OWNER, [COMPANY]);
        const res = await app.call('put', path, { token, body: { ...detailsUpdate, companyId: COMPANY } });
        expect(res.status).toBe(200);
    });
});
