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
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { signSession, startApp } = require('./fixtures/sessionApp');
const { scopeCompanyPipeline, allowedCompanyIds, companyUpdateKind } = require('../Modules/Company/helpers/companyAccessRules');
const ctrl = require('../Modules/Company/controller/updateCompany');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const OUTSIDER = '6f0000000000000000000005';
const ROLE_OF = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

const ACTIVE = 2;
const PENDING = 1;
const CANCELLED = 3;

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter((call) => call[2] === method);

const matchesFilter = (row, filter) => Object.entries(filter).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && '$ne' in expected) return row[field] !== expected.$ne;
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(row[field]);
    return row[field] === expected;
});

let app;
let seats;

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        server.post('/api/v1/admin/company', ctrl.getCompany);
        server.post('/api/v1/admin/company/find', ctrl.getCompanyByAggregate);
        server.put('/api/v1/company', ctrl.updateCompany);
        server.put('/api/v1/admin/company', ctrl.updateCompany);
        server.put('/api/v1/company-invitation', ctrl.updateCompany);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    seats = { [COMPANY]: Object.entries(ROLE_OF).map(([userId, roleType]) => ({ userId, roleType, status: ACTIVE, isDelete: false })) };
    getRoleType.mockReset();
    // Deliberately looser than the real lookup, which reads an active seat only: the handler must
    // refuse a removed or pending caller on the seat it reads itself, not on the role cache.
    getRoleType.mockImplementation(async (companyId, uid) => {
        const row = (seats[companyId] || []).find((seat) => seat.userId === uid);
        return row ? row.roleType : null;
    });
    evaluatePermission.mockReset();
    evaluatePermission.mockImplementation(async () => null);
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => {
        const filter = (obj.data && obj.data[0]) || {};
        if (obj.type === SCHEMA_TYPE.USERS && obj.data[1] === 'isProductOwner') return { isProductOwner: String(filter._id) === OWNER };
        if (obj.type === SCHEMA_TYPE.USERS) return { AssignCompany: String(filter._id) === OWNER ? [COMPANY, OTHER_COMPANY] : [COMPANY] };
        if (obj.type === SCHEMA_TYPE.COMPANY_USERS && method === 'findOne') return (seats[db] || []).find((seat) => matchesFilter(seat, filter)) || null;
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

describe('companyUpdateKind', () => {
    it('recognises the project type swap in both directions', () => {
        expect(companyUpdateKind(SWAP_TO_PRIVATE)).toBe('projectType');
        expect(companyUpdateKind({ key: '$inc', updateObject: { 'projectCount.publicCount': 1, 'projectCount.privateCount': -1 } })).toBe('projectType');
    });

    it('recognises the seat releases the members page sends', () => {
        expect(companyUpdateKind(SEAT_RELEASE)).toBe('seatRelease');
        expect(companyUpdateKind(TRACKER_SEAT_RELEASE)).toBe('seatRelease');
    });

    it.each([
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
        expect(companyUpdateKind(body)).toBe(null);
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

const OWNER_CLAIM = { updateObject: { objId: { userId: OWNER } }, companyId: COMPANY };
const COMPANY_DETAILS_FORM = {
    updateObject: {
        Cst_profileImage: 'companyIcon/logo.png',
        Cst_CompanyName: 'Acme',
        Cst_Phone: '5550100',
        Cst_Country: 'India',
        Cst_DialCode: { name: 'India', dialCode: '+91', code: 'IN' },
        Cst_State: 'Gujarat',
        Cst_City: 'Surat',
        Cst_LogTimeDays: '8',
        trackerEstimateLimit: true,
        Cst_countryCode: 'IN',
        Cst_stateCode: 'GJ',
        updatedAt: '2026-09-11T00:00:00.000Z',
    },
};
const REFUSED_WRITES = [
    ['the plan', { updateObject: { planFeature: { planName: 'enterPrise', users: null } } }],
    ['a plan limit', { updateObject: { 'planFeature.users': 1000 } }],
    ['the subscription', { updateObject: { isFree: false, subscriptionData: { users: 500 }, SubcriptionId: 'sub_1' } }],
    ['the billing customer', { updateObject: { customerId: 'cus_1', billingDetails: { email: 'billing@example.test' } } }],
    ['the payment state', { updateObject: { isPaymentFailed: false, paymentFailed_error_text: '' } }],
    ['the renewal date', { updateObject: { subscriptionRenewalDate: 4102444800, isPlanShchedule: false } }],
    ['the disabled flags', { updateObject: { isDisable: false, isInactive: false } }],
    ['the seat allowance', { updateObject: { availableUser: 999, totalData: { users: 999 } } }],
    ['the storage size', { updateObject: { bucketSize: 0 } }],
    ['the seat count', { updateObject: { companyData: [{ users: 1 }] } }],
    ['a seat count jump', { key: '$inc', updateObject: { 'companyData.$[elementIndex].users': -50 }, arrayFilters: SEAT_RELEASE.arrayFilters }],
    ['the tracker seats', { updateObject: { trackerUsers: 0 } }],
    ['the project counts', { updateObject: { projectCount: { projectCount: 0, privateCount: 0, publicCount: 0 } } }],
    ['the AI usage', { key: '$inc', updateObject: { aiTotalRequestedCount: -100000 } }],
    ['the company owner as a plain field', { updateObject: { userId: OWNER } }],
    ['a plan field removal', { key: '$unset', updateObject: { planFeature: '' } }],
    ['a detail next to a plan field', { updateObject: { Cst_CompanyName: 'Acme', availableUser: 999 } }],
    ['a detail with array filters', { ...COMPANY_DETAILS_FORM, arrayFilters: [{ 'x.y': 1 }] }],
    ['a nested detail path', { updateObject: { 'Cst_DialCode.code': 'US' } }],
    ['the owner claim with a seat reset', { updateObject: { objId: { userId: OWNER }, companyData: [{ users: 1 }] } }],
];

describe('companyUpdateKind for owners and admins', () => {
    it('recognises the company details form, with or without an explicit $set', () => {
        expect(companyUpdateKind(COMPANY_DETAILS_FORM)).toBe('details');
        expect(companyUpdateKind({ key: '$set', updateObject: { Cst_CompanyName: 'Acme' } })).toBe('details');
    });

    it('recognises the owner claim the invitation page sends', () => {
        expect(companyUpdateKind(OWNER_CLAIM)).toBe('ownerClaim');
    });

    it.each(REFUSED_WRITES)('does not recognise a write to %s', (label, body) => {
        expect(companyUpdateKind(body)).toBe(null);
    });
});

describe('PUT company update never takes server-controlled fields', () => {
    const put = (path, uid, body) => app.call('PUT', path, { token: signSession(uid, [COMPANY]), companyId: COMPANY, body });

    describe.each([['owner', OWNER], ['admin', ADMIN]])('as the %s', (role, uid) => {
        it.each(REFUSED_WRITES)('refuses writing %s', async (label, body) => {
            const res = await put('/api/v1/company', uid, body);
            expect(res.status).toBe(403);
            expect(res.body).toEqual({ status: false, message: expect.any(String) });
            expect(callsOf('findOneAndUpdate')).toHaveLength(0);
        });

        it('saves the company details form', async () => {
            const res = await put('/api/v1/company', uid, COMPANY_DETAILS_FORM);
            expect(res.status).toBe(200);
            expect(callsOf('findOneAndUpdate')[0][1].data[1]).toEqual({ $set: COMPANY_DETAILS_FORM.updateObject });
        });

        it('releases a seat and switches a project between private and public', async () => {
            expect((await put('/api/v1/company', uid, SEAT_RELEASE)).status).toBe(200);
            expect((await put('/api/v1/company', uid, TRACKER_SEAT_RELEASE)).status).toBe(200);
            expect((await put('/api/v1/company', uid, SWAP_TO_PRIVATE)).status).toBe(200);
        });
    });

    it.each(['/api/v1/company', '/api/v1/admin/company', '/api/v1/company-invitation'])('refuses the owner changing the plan through %s', async (path) => {
        const res = await put(path, OWNER, { updateObject: { planFeature: { users: null } } });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });
});

describe('PUT /api/v1/company-invitation owner claim', () => {
    const put = (uid, body) => app.call('PUT', '/api/v1/company-invitation', { token: signSession(uid, [COMPANY]), body });

    it('records the invited owner on the company without touching the seat count', async () => {
        const res = await put(OWNER, OWNER_CLAIM);
        expect(res.status).toBe(200);
        const [filter, update] = callsOf('findOneAndUpdate')[0][1].data;
        expect(filter).toEqual({ _id: COMPANY });
        expect(update).toEqual({ $set: { userId: new mongoose.Types.ObjectId(OWNER) } });
    });

    it('refuses an admin claiming the company', async () => {
        const res = await put(ADMIN, { ...OWNER_CLAIM, updateObject: { objId: { userId: ADMIN } } });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('refuses an owner recording someone else', async () => {
        const res = await put(OWNER, { ...OWNER_CLAIM, updateObject: { objId: { userId: ADMIN } } });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });
});

describe('PUT company update needs a live seat in the company it writes', () => {
    const REMOVED_ADMIN = '6f0000000000000000000006';
    const PENDING_ADMIN = '6f0000000000000000000007';
    const PENDING_OWNER = '6f0000000000000000000008';
    const REMOVED_OWNER = '6f000000000000000000000a';
    const CANCELLED_OWNER = '6f000000000000000000000b';
    const EVERY_KIND = [['the details', RENAME], ['a seat release', SEAT_RELEASE], ['a tracker seat release', TRACKER_SEAT_RELEASE], ['a project type swap', SWAP_TO_PRIVATE]];
    const put = (path, uid, { audience = [COMPANY], header = COMPANY, body }) => app.call('PUT', path, { token: signSession(uid, audience), companyId: header, body });
    const claimFor = (uid) => ({ updateObject: { objId: { userId: uid } }, companyId: COMPANY });

    beforeEach(() => {
        seats[COMPANY].push(
            { userId: REMOVED_ADMIN, roleType: 2, status: ACTIVE, isDelete: true },
            { userId: PENDING_ADMIN, roleType: 2, status: PENDING, isDelete: false },
            { userId: PENDING_OWNER, roleType: 1, status: PENDING, isDelete: false },
            { userId: REMOVED_OWNER, roleType: 1, status: ACTIVE, isDelete: true },
            { userId: CANCELLED_OWNER, roleType: 1, status: CANCELLED, isDelete: true },
        );
    });

    it('refuses a removed admin signed into another company who names this one in the header', async () => {
        const res = await put('/api/v1/admin/company', REMOVED_ADMIN, { audience: [OTHER_COMPANY], body: { companyId: OTHER_COMPANY, ...RENAME } });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it.each(EVERY_KIND)('refuses a removed admin whose token still names the company sending %s', async (label, body) => {
        const res = await put('/api/v1/admin/company', REMOVED_ADMIN, { body });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it.each(EVERY_KIND)('refuses a pending invitee sending %s', async (label, body) => {
        const res = await put('/api/v1/admin/company', PENDING_ADMIN, { body });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it.each([
        ['header and body companyId', '', { companyId: OTHER_COMPANY }],
        ['header and body CompanyId', '', { CompanyId: OTHER_COMPANY }],
        ['header and query', `?companyId=${OTHER_COMPANY}`, {}],
    ])('refuses a request whose %s name different companies', async (label, query, named) => {
        const res = await put(`/api/v1/admin/company${query}`, ADMIN, { audience: [COMPANY, OTHER_COMPANY], body: { ...named, ...RENAME } });
        expect(res.status).toBe(403);
        expect(res.body.status).toBe(false);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('accepts a header and body that name the same company', async () => {
        const res = await put('/api/v1/admin/company', ADMIN, { body: { companyId: COMPANY, ...RENAME } });
        expect(res.status).toBe(200);
        expect(callsOf('findOneAndUpdate')[0][1].data[0]).toEqual({ _id: COMPANY });
    });

    it('lets an invited owner whose row is still pending record themselves', async () => {
        const res = await app.call('PUT', '/api/v1/company-invitation', { token: signSession(PENDING_OWNER, [COMPANY]), body: claimFor(PENDING_OWNER) });
        expect(res.status).toBe(200);
        expect(callsOf('findOneAndUpdate')[0][1].data[1]).toEqual({ $set: { userId: new mongoose.Types.ObjectId(PENDING_OWNER) } });
    });

    it.each([['removed', REMOVED_OWNER], ['cancelled', CANCELLED_OWNER]])('refuses a %s owner recording themselves', async (label, uid) => {
        const res = await app.call('PUT', '/api/v1/company-invitation', { token: signSession(uid, [COMPANY]), body: claimFor(uid) });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('refuses a pending invitee claiming the company for someone else', async () => {
        const res = await app.call('PUT', '/api/v1/company-invitation', { token: signSession(PENDING_OWNER, [COMPANY]), body: claimFor(OWNER) });
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });
});
