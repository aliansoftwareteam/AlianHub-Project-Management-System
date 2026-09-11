jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({}));
jest.mock('../Config/permissionGuard', () => ({
    ...jest.requireActual('../Config/permissionGuard'),
    getRoleType: jest.fn(async () => null),
    evaluatePermission: jest.fn(async () => null),
}));

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { scopeCompanyPipeline, allowedCompanyIds, memberCompanyUpdate } = require('../Modules/Company/helpers/companyAccessRules');
const ctrl = require('../Modules/Company/controller/updateCompany');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const OUTSIDER = '6f0000000000000000000005';
const ROLE_OF = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === method);

let app;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareV2(server);
        server.post('/api/v1/admin/company', ctrl.getCompany);
        server.post('/api/v1/admin/company/find', ctrl.getCompanyByAggregate);
        server.put('/api/v1/admin/company', ctrl.updateCompany);
        server.put('/api/v1/company-invitation', ctrl.updateCompany);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    getRoleType.mockReset();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid in ROLE_OF ? ROLE_OF[uid] : null));
    evaluatePermission.mockReset();
    evaluatePermission.mockImplementation(async () => null);
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        const filter = (obj.data && obj.data[0]) || {};
        if (obj.type === SCHEMA_TYPE.USERS && obj.data[1] === 'isProductOwner') return { isProductOwner: String(filter._id) === OWNER };
        if (obj.type === SCHEMA_TYPE.USERS) return { AssignCompany: String(filter._id) === OWNER ? [COMPANY, OTHER_COMPANY] : [COMPANY] };
        if (method === 'find') return filter._id ? filter._id.$in.map((id) => ({ _id: String(id) })) : [{ _id: COMPANY }, { _id: OTHER_COMPANY }];
        if (method === 'aggregate') return [];
        if (method === 'findOneAndUpdate') return { _id: COMPANY };
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

const SWAP_TO_PRIVATE = { key: '$inc', updateObject: { 'projectCount.privateCount': 1, 'projectCount.publicCount': -1 } };
const SEAT_RELEASE = { key: '$inc', updateObject: { 'companyData.$[elementIndex].users': -1 }, arrayFilters: [{ 'elementIndex.users': { $exists: true } }] };
const TRACKER_SEAT_RELEASE = { key: '$inc', updateObject: { trackerUsers: -1 } };
const RENAME = { updateObject: { Cst_CompanyName: 'Taken over' } };

describe('memberCompanyUpdate', () => {
    it('recognises the project type swap in both directions', () => {
        expect(memberCompanyUpdate(SWAP_TO_PRIVATE)).toBe('projectType');
        expect(memberCompanyUpdate({ key: '$inc', updateObject: { 'projectCount.publicCount': 1, 'projectCount.privateCount': -1 } })).toBe('projectType');
    });

    it('recognises the seat releases the members page sends', () => {
        expect(memberCompanyUpdate(SEAT_RELEASE)).toBe('seatRelease');
        expect(memberCompanyUpdate(TRACKER_SEAT_RELEASE)).toBe('seatRelease');
    });

    it.each([
        [RENAME],
        [{ key: '$set', updateObject: SWAP_TO_PRIVATE.updateObject }],
        [{ key: '$inc', updateObject: { 'projectCount.privateCount': 5, 'projectCount.publicCount': -5 } }],
        [{ key: '$inc', updateObject: { 'projectCount.privateCount': 1, 'projectCount.publicCount': 1 } }],
        [{ key: '$inc', updateObject: { 'projectCount.privateCount': 1 } }],
        [{ key: '$inc', updateObject: { ...SWAP_TO_PRIVATE.updateObject, planId: 1 } }],
        [{ ...SWAP_TO_PRIVATE, arrayFilters: [{ x: 1 }] }],
        [{ key: '$inc', updateObject: { 'companyData.$[elementIndex].users': 1 }, arrayFilters: SEAT_RELEASE.arrayFilters }],
        [{ key: '$inc', updateObject: SEAT_RELEASE.updateObject, arrayFilters: [{ 'elementIndex.users': { $gt: 0 } }] }],
        [{ key: '$inc', updateObject: { trackerUsers: -10 } }],
        [{ key: '$inc', updateObject: { 'projectCount.privateCount': '1', 'projectCount.publicCount': '-1' } }],
    ])('rejects %j', (body) => {
        expect(memberCompanyUpdate(body)).toBe(null);
    });
});

describe('PUT company update is for owners and admins', () => {
    const put = (path, uid, body) => app.call('PUT', path, { token: signSession(uid, [COMPANY]), companyId: COMPANY, body });

    it.each(['/api/v1/admin/company', '/api/v1/company-invitation'])('refuses a member renaming the company through %s', async (path) => {
        const res = await put(path, MEMBER, RENAME);
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ status: false, message: expect.any(String) });
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('refuses a guest and a caller outside the company', async () => {
        expect((await put('/api/v1/admin/company', GUEST, RENAME)).status).toBe(403);
        expect((await put('/api/v1/admin/company', OUTSIDER, SWAP_TO_PRIVATE)).status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it.each([[OWNER], [ADMIN]])('lets %s rename the company', async (uid) => {
        const res = await put('/api/v1/admin/company', uid, RENAME);
        expect(res.status).toBe(200);
        expect(callsOf('findOneAndUpdate')[0][1].data[1]).toEqual({ $set: RENAME.updateObject });
    });

    it('lets a member swap a project between private and public', async () => {
        const res = await put('/api/v1/admin/company', MEMBER, SWAP_TO_PRIVATE);
        expect(res.status).toBe(200);
        expect(callsOf('findOneAndUpdate')[0][1].data[1]).toEqual({ $inc: SWAP_TO_PRIVATE.updateObject });
    });

    it('lets a member who manages the member list release a seat', async () => {
        evaluatePermission.mockImplementation(async (companyId, uid, key) => (key === 'settings.settings_member_list' ? true : null));
        expect((await put('/api/v1/admin/company', MEMBER, SEAT_RELEASE)).status).toBe(200);
        expect((await put('/api/v1/admin/company', MEMBER, TRACKER_SEAT_RELEASE)).status).toBe(200);
        expect(evaluatePermission).toHaveBeenCalledWith(COMPANY, MEMBER, 'settings.settings_member_list');
    });

    it('refuses a seat release from a member without member-list write access', async () => {
        evaluatePermission.mockImplementation(async () => false);
        const res = await put('/api/v1/admin/company', MEMBER, SEAT_RELEASE);
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });
});
