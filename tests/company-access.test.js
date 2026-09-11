jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { scopeCompanyPipeline, allowedCompanyIds } = require('../Modules/Company/helpers/companyAccessRules');
const ctrl = require('../Modules/Company/controller/updateCompany');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const GUEST = '6f0000000000000000000004';

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === method);

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareV2(server);
        server.post('/api/v1/admin/company', ctrl.getCompany);
        server.post('/api/v1/admin/company/find', ctrl.getCompanyByAggregate);
        server.put('/api/v1/admin/company', ctrl.updateCompany);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        const filter = (obj.data && obj.data[0]) || {};
        if (obj.type === SCHEMA_TYPE.USERS && obj.data[1] === 'isProductOwner') return { isProductOwner: String(filter._id) === OWNER };
        if (obj.type === SCHEMA_TYPE.USERS) return { AssignCompany: String(filter._id) === OWNER ? [COMPANY, OTHER_COMPANY] : [COMPANY] };
        if (method === 'find') return filter._id ? filter._id.$in.map((id) => ({ _id: String(id) })) : [{ _id: COMPANY }, { _id: OTHER_COMPANY }];
        if (method === 'aggregate') return [];
        return null;
    });
});

describe('companyAccessRules', () => {
    it('keeps only the caller\'s own company ids', () => {
        expect(allowedCompanyIds([COMPANY, OTHER_COMPANY, COMPANY], [COMPANY])).toEqual([COMPANY]);
    });

    it.each([
        [[{ $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } }]],
        [[{ $unionWith: 'users' }]],
        [[{ $match: { $where: 'true' } }]],
        [[{ $project: { x: { $function: { body: 'function(){}', args: [], lang: 'js' } } } }]],
        [[{ $match: {}, $limit: 1 }]],
    ])('refuses the pipeline %j', (pipeline) => {
        expect(scopeCompanyPipeline(pipeline, []).ok).toBe(false);
    });
});

describe('ACC-06 POST /api/v1/admin/company', () => {
    it('refuses an anonymous caller', async () => {
        const res = await app.call('POST', '/api/v1/admin/company', { body: { fetchAllCompany: true } });
        expect(res.status).toBe(401);
    });

    it('refuses a guest listing every company', async () => {
        const res = await app.call('POST', '/api/v1/admin/company', { token: signSession(GUEST, [COMPANY]), body: { fetchAllCompany: true, companyIds: [] } });
        expect(res.status).toBe(403);
        expect(callsOf('find')).toHaveLength(0);
    });

    it('returns a member only their own companies', async () => {
        const res = await app.call('POST', '/api/v1/admin/company', { token: signSession(GUEST, [COMPANY]), body: { companyIds: [COMPANY, OTHER_COMPANY] } });
        expect(res.status).toBe(200);
        expect(res.body.map((company) => company._id)).toEqual([COMPANY]);
    });

    it('lets the instance owner list every company', async () => {
        const res = await app.call('POST', '/api/v1/admin/company', { token: signSession(OWNER, [COMPANY]), body: { fetchAllCompany: true, companyIds: [] } });
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
    });
});

describe('ACC-06 POST /api/v1/admin/company/find', () => {
    it('pins a member\'s pipeline to their own companies', async () => {
        const findQuery = [{ $match: { _id: { objId: { $in: [COMPANY] } } } }];
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(GUEST, [COMPANY]), body: { findQuery } });
        expect(res.status).toBe(200);
        const pipeline = callsOf('aggregate')[0][1].data[0];
        expect(pipeline[0]).toEqual({ $match: { _id: { $in: [new mongoose.Types.ObjectId(COMPANY)] } } });
        expect(pipeline).toHaveLength(2);
    });

    it('refuses a member joining another collection', async () => {
        const findQuery = [{ $lookup: { from: 'users', pipeline: [], as: 'users' } }];
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(GUEST, [COMPANY]), body: { findQuery } });
        expect(res.status).toBe(403);
        expect(callsOf('aggregate')).toHaveLength(0);
    });

    it('leaves the instance owner\'s pipeline unscoped', async () => {
        const findQuery = [{ $match: {} }];
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(OWNER, [COMPANY]), body: { findQuery } });
        expect(res.status).toBe(200);
        expect(callsOf('aggregate')[0][1].data[0]).toEqual([findQuery]);
    });
});

describe('PUT /api/v1/admin/company', () => {
    it('refuses an update that names no company', async () => {
        const res = await app.call('PUT', '/api/v1/admin/company', { token: signSession(GUEST, [COMPANY]), body: { updateObject: { Cst_CompanyName: 'x' } } });
        expect(res.status).toBe(400);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });
});
