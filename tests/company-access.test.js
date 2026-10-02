jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
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
const { scopeCompanyPipeline, allowedCompanyIds, companyUpdateKind, memberCompanyView, COMPANY_MEMBER_FIELDS } = require('../Modules/Company/helpers/companyAccessRules');
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

    /* getCompanyDataFun keeps hydrated company documents in node-cache, which clones them on the way in and out. */
    it('reads the member fields off a cached company document', () => {
        const NodeCache = require('node-cache');
        const { companies } = require('../utils/mongo-handler/createSchema');
        const Company = mongoose.models.CompanyAccessProbe || mongoose.model('CompanyAccessProbe', companies);
        const cache = new NodeCache();
        cache.set('company', Company.hydrate({ _id: new mongoose.Types.ObjectId(COMPANY), Cst_CompanyName: 'Acme', planFeature: { ai: true }, billingDetails: { card: 'x' }, SubcriptionId: 'sub_1' }));
        const view = JSON.parse(JSON.stringify(memberCompanyView(cache.get('company'))));
        expect(view).toEqual(expect.objectContaining({ _id: COMPANY, Cst_CompanyName: 'Acme', planFeature: { ai: true } }));
        expect(Object.keys(view).filter((field) => !COMPANY_MEMBER_FIELDS.includes(field))).toEqual([]);
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

    describe('the fields of a company row', () => {
        const ROW = { _id: COMPANY, Cst_CompanyName: 'Acme', planFeature: { ai: true }, workingDays: [1, 2, 3, 4, 5], billingDetails: { card: 'x' },
            aiProviderKeys: { openai: 'sec_1' }, SubcriptionId: 'sub_1', customerId: 'cus_1', agentMonthlyBudgetUsd: 50 };
        const readAs = async (uid) => {
            const answer = MongoDbCrudOpration.getMockImplementation();
            MongoDbCrudOpration.mockImplementation(async (db, obj, method) => (obj.type === SCHEMA_TYPE.COMPANIES && method === 'find' ? [ROW] : answer(db, obj, method)));
            const res = await app.call('POST', '/api/v1/admin/company', { token: signSession(uid, [COMPANY]), body: { companyIds: [COMPANY] } });
            expect(res.status).toBe(200);
            return res.body[0];
        };

        it.each([['a guest', GUEST], ['a member', MEMBER]])('are, for %s, the ones the web app reads', async (label, uid) => {
            expect(await readAs(uid)).toEqual({ _id: COMPANY, Cst_CompanyName: 'Acme', planFeature: { ai: true }, workingDays: [1, 2, 3, 4, 5] });
        });

        it('are all of them for a company admin', async () => {
            expect(await readAs(ADMIN)).toEqual(ROW);
        });

        /* The handler as the route runs it once the caller is known: a token and an agent come with more than a session does. */
        const handled = async (handler, caller, body) => {
            const answer = MongoDbCrudOpration.getMockImplementation();
            MongoDbCrudOpration.mockImplementation(async (db, obj, method) => (obj.type === SCHEMA_TYPE.COMPANIES && method === 'find' ? [ROW] : answer(db, obj, method)));
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; } };
            await handler({ headers: { companyid: COMPANY }, body, ...caller }, res);
            expect(res.statusCode).toBe(200);
            return res.body;
        };
        const NOT_A_SESSION = [
            ['a personal token', { apiToken: { _id: 'token-1', name: 'A script' } }],
            ['a token created for an agent', { apiToken: { _id: 'token-2', kind: 'agent', name: 'Claude' } }],
            ['an agent run', { agentRun: { _id: 'run-1', agentId: 'agent-1' } }],
            ['a call over MCP', { apiToken: { _id: 'token-3', name: 'Claude' }, mcp: true }],
        ];
        const HOLDERS = [['an owner', OWNER], ['an admin', ADMIN]];

        it.each(NOT_A_SESSION.flatMap(([how, caller]) => HOLDERS.map(([who, uid]) => [how, who, { uid, ...caller }])))('are, through %s of %s, the ones the web app reads', async (how, who, caller) => {
            expect(await handled(ctrl.getCompany, caller, { companyIds: [COMPANY] })).toEqual([{ _id: COMPANY, Cst_CompanyName: 'Acme', planFeature: { ai: true }, workingDays: [1, 2, 3, 4, 5] }]);
        });

        it.each(NOT_A_SESSION.flatMap(([how, caller]) => HOLDERS.map(([who, uid]) => [how, who, { uid, ...caller }])))('start, through %s of %s, from the ones the web app reads whatever the pipeline projects', async (how, who, caller) => {
            await handled(ctrl.getCompanyByAggregate, caller, { findQuery: [{ $match: {} }, { $project: { billingDetails: 1, aiProviderKeys: 1 } }] });

            const pipeline = callsOf('aggregate')[0][1].data[0];
            expect(pipeline[0].$match._id.$in.map(String)).toContain(COMPANY);
            const [limitedTo, memberRow] = pipeline[1].$replaceWith.$cond;
            expect(limitedTo.$in[1].map(String)).toEqual(pipeline[0].$match._id.$in.map(String));
            expect(Object.keys(memberRow)).toEqual([...COMPANY_MEMBER_FIELDS]);
        });

        it.each(NOT_A_SESSION)('are not every company\'s through %s of the instance owner', async (how, caller) => {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; } };
            await ctrl.getCompany({ headers: { companyid: COMPANY }, body: { fetchAllCompany: true, companyIds: [] }, uid: OWNER, ...caller }, res);

            expect(res.statusCode).toBe(403);
            expect(callsOf('find')).toHaveLength(0);
        });
    });

    it('returns nothing for a company whose seat is gone while the account still lists it', async () => {
        seats[COMPANY] = seats[COMPANY].filter((seat) => seat.userId !== GUEST);
        const res = await app.call('POST', '/api/v1/admin/company', { token: signSession(GUEST, []), body: { companyIds: [COMPANY] } });
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
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
        expect(pipeline).toHaveLength(3);
    });

    it.each([['a guest', GUEST], ['a member', MEMBER]])('starts %s from the member fields of the company, whatever the pipeline projects', async (label, uid) => {
        const findQuery = [{ $match: {} }, { $project: { billingDetails: 1, aiProviderKeys: 1, SubcriptionId: 1 } }];
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(uid, [COMPANY]), body: { findQuery } });
        expect(res.status).toBe(200);
        const pipeline = callsOf('aggregate')[0][1].data[0];
        const [limitedTo, memberRow, otherwise] = pipeline[1].$replaceWith.$cond;
        expect(limitedTo).toEqual({ $in: ['$_id', [new mongoose.Types.ObjectId(COMPANY)]] });
        expect(Object.keys(memberRow)).toEqual([...COMPANY_MEMBER_FIELDS]);
        expect(Object.keys(memberRow)).not.toEqual(expect.arrayContaining(['billingDetails']));
        expect(otherwise).toBe('$$ROOT');
        expect(pipeline.slice(2)).toEqual(findQuery);
    });

    it('gives a company admin the whole row of their company', async () => {
        const findQuery = [{ $match: {} }];
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(ADMIN, [COMPANY]), body: { findQuery } });
        expect(res.status).toBe(200);
        expect(callsOf('aggregate')[0][1].data[0]).toEqual([{ $match: { _id: { $in: [new mongoose.Types.ObjectId(COMPANY)] } } }, ...findQuery]);
    });

    it.each([
        ['$graphLookup', [{ $graphLookup: { from: 'users', startWith: '$userId', connectFromField: '_id', connectToField: '_id', as: 'u' } }]],
        ['$out', [{ $match: {} }, { $out: 'copy' }]],
        ['$merge', [{ $merge: { into: 'copy' } }]],
        ['$unionWith', [{ $unionWith: 'users' }]],
        ['a $where inside $and', [{ $match: { $and: [{ $where: 'true' }] } }]],
        ['a $function inside $expr', [{ $match: { $expr: { $function: { body: 'function(){return true}', args: [], lang: 'js' } } } }]],
        ['an $accumulator inside $addFields', [{ $addFields: { x: [{ $accumulator: {} }] } }]],
        ['$facet', [{ $facet: { a: [{ $lookup: { from: 'users', pipeline: [], as: 'u' } }] } }]],
    ])('refuses a member %s', async (label, findQuery) => {
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(MEMBER, [COMPANY]), body: { findQuery } });
        expect(res.status).toBe(403);
        expect(callsOf('aggregate')).toHaveLength(0);
    });

    it('pins the pipeline to no company once the member\'s seat is gone', async () => {
        seats[COMPANY] = seats[COMPANY].filter((seat) => seat.userId !== GUEST);
        const findQuery = [{ $match: {} }];
        const res = await app.call('POST', '/api/v1/admin/company/find', { token: signSession(GUEST, []), body: { findQuery } });
        expect(res.status).toBe(200);
        expect(callsOf('aggregate')[0][1].data[0][0]).toEqual({ $match: { _id: { $in: [] } } });
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
    it.each([
        [SWAP_TO_PRIVATE],
        [{ key: '$inc', updateObject: { 'projectCount.publicCount': 1, 'projectCount.privateCount': -1 } }],
        [SEAT_RELEASE],
        [TRACKER_SEAT_RELEASE],
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

    it('refuses a member moving the project type counts', async () => {
        const res = await put('/api/v1/admin/company', MEMBER, SWAP_TO_PRIVATE);
        expect(res.status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
    });

    it('refuses a member who manages the member list moving the seat counts', async () => {
        evaluatePermission.mockImplementation(async (companyId, uid, key) => (key === 'settings.settings_member_list' ? true : null));
        expect((await put('/api/v1/admin/company', MEMBER, SEAT_RELEASE)).status).toBe(403);
        expect((await put('/api/v1/admin/company', MEMBER, TRACKER_SEAT_RELEASE)).status).toBe(403);
        expect(callsOf('findOneAndUpdate')).toHaveLength(0);
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

        it('leaves the seat and project type counts to the server', async () => {
            expect((await put('/api/v1/company', uid, SEAT_RELEASE)).status).toBe(403);
            expect((await put('/api/v1/company', uid, TRACKER_SEAT_RELEASE)).status).toBe(403);
            expect((await put('/api/v1/company', uid, SWAP_TO_PRIVATE)).status).toBe(403);
            expect(callsOf('findOneAndUpdate')).toHaveLength(0);
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

describe('PUT company details with optional phone, state and city', () => {
    const put = (body) => app.call('PUT', '/api/v1/company', { token: signSession(OWNER, [COMPANY]), companyId: COMPANY, body });
    const details = (fields) => ({ updateObject: { ...COMPANY_DETAILS_FORM.updateObject, ...fields } });
    const written = () => callsOf('findOneAndUpdate')[0][1].data[1].$set;

    it('saves the form with phone, state and city empty', async () => {
        const res = await put(details({ Cst_Phone: '', Cst_State: '', Cst_City: '' }));
        expect(res.status).toBe(200);
        expect(written()).toMatchObject({ Cst_Phone: '', Cst_State: '', Cst_City: '' });
    });

    it('saves the form without phone, state and city at all', async () => {
        const { Cst_Phone, Cst_State, Cst_City, ...rest } = COMPANY_DETAILS_FORM.updateObject;
        const res = await put({ updateObject: rest });
        expect(res.status).toBe(200);
        expect(written()).toEqual(rest);
    });

    it('clears the setup wizard placeholder phone when the form sends it back', async () => {
        const res = await put(details({ Cst_Phone: 'N/A' }));
        expect(res.status).toBe(200);
        expect(written().Cst_Phone).toBe('');
    });

    it.each([['letters', 'call me'], ['too short', '123'], ['too long', '1234567890123456'], ['not a string', 5550100]])(
        'refuses a phone that is %s',
        async (label, phone) => {
            const res = await put(details({ Cst_Phone: phone }));
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ status: false, message: expect.any(String) });
            expect(callsOf('findOneAndUpdate')).toHaveLength(0);
        }
    );
});
