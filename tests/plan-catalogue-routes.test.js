const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { setMiddlewareV2 } = require('../Config/setMiddleware');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { validatePlanUpdate, validatePlanFilters, PLAN_FIELDS } = require('../Modules/SubscriptionPlan/planRules');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000c01';
const INSTANCE_ADMIN = '6f0000000000000000000a01';
const OWNER = '6f0000000000000000000a02';
const ADMIN = '6f0000000000000000000a03';
const MEMBER = '6f0000000000000000000a04';
const GUEST = '6f0000000000000000000a05';
const FREE = '6f0000000000000000000e01';
const PRO = '6f0000000000000000000e02';
const SEATS = { [INSTANCE_ADMIN]: 1, [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 };

let app;

const globalDb = () => mockDbFor(SCHEMA_TYPE.GOLBAL);
const plans = () => globalDb().store[SCHEMA_TYPE.SUBSCRIPTIONPLAN] || [];
const planOf = (id) => plans().find((row) => String(row._id) === id);
const planCalls = (method) => globalDb().calls.filter((call) => call.type === SCHEMA_TYPE.SUBSCRIPTIONPLAN && (!method || call.method === method));
const snapshot = () => JSON.stringify(plans());

const mintToken = (userId, extra = {}) => {
    const raw = generateToken();
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.API_TOKENS, { userId, tokenHash: hashToken(raw), active: true, scopes: ['read', 'write'], createdAt: new Date(), ...extra });
    return raw;
};

const session = (uid) => () => ({ token: signSession(uid, [COMPANY]) });
const tokenOf = (uid, extra) => () => ({ token: mintToken(uid, extra), companyId: COMPANY });

const REFUSED_WRITERS = [
    ['a workspace owner', session(OWNER), 403],
    ['a workspace admin', session(ADMIN), 403],
    ['a member', session(MEMBER), 403],
    ['a guest', session(GUEST), 403],
    ['the instance admin\'s API token', tokenOf(INSTANCE_ADMIN), 403],
    ['the instance admin\'s agent token', tokenOf(INSTANCE_ADMIN, { agentId: 'agent-1' }), 403],
    ['a member\'s API token', tokenOf(MEMBER), 403],
    ['a caller with no session', () => ({}), 401],
];

const READERS = [
    ['the instance admin', session(INSTANCE_ADMIN)],
    ['a workspace owner', session(OWNER)],
    ['a member', session(MEMBER)],
    ['a guest', session(GUEST)],
    ['an API token', tokenOf(MEMBER)],
    ['an agent token', tokenOf(MEMBER, { agentId: 'agent-1' })],
];

const WRITE_BODIES = [
    ['named fields', { id: PRO, plan: { status: 0 } }],
    ['a filter and an update of its own', { query: [{ planName: 'Pro' }, { $set: { status: 0, 'planDetails.price': 0 } }] }],
];

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareV2(server);
        require('../Modules/SubscriptionPlan/routes').init(server);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    globalDb().seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY });
    Object.entries(SEATS).forEach(([userId, roleType]) => {
        globalDb().seed(SCHEMA_TYPE.USERS, { _id: userId, AssignCompany: [COMPANY], Employee_Email: `${userId}@example.test`, isProductOwner: userId === INSTANCE_ADMIN });
        mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
    globalDb().seed(SCHEMA_TYPE.SUBSCRIPTIONPLAN, { _id: FREE, planName: 'Free', status: 1, isDefaultShow: true, defaultSubscribe: true, planDetails: { price: 0 }, itemPriceArray: [], addonPriceArray: [] });
    globalDb().seed(SCHEMA_TYPE.SUBSCRIPTIONPLAN, { _id: PRO, planName: 'Pro', status: 1, isDefaultShow: true, defaultSubscribe: false, planDetails: { price: 12 }, itemPriceArray: [{ id: 'pro-monthly', price: 12 }], addonPriceArray: [] });
});

describe('PUT /api/v1/subscription: a plan is changed by an instance admin', () => {
    it('saves the named fields for the instance admin and the list shows them', async () => {
        const { token } = session(INSTANCE_ADMIN)();
        expect((await app.call('GET', '/api/v1/subscription', { token })).body).toHaveLength(2);

        const res = await app.call('PUT', '/api/v1/subscription', { token, body: { id: PRO, plan: { planName: 'Pro Plus', status: 2, isDefaultShow: false, planDetails: { price: 15 }, itemPriceArray: [{ id: 'pro-monthly', price: 15 }] } } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ _id: PRO, planName: 'Pro Plus', status: 2 });
        expect(planOf(PRO)).toMatchObject({ planName: 'Pro Plus', status: 2, isDefaultShow: false, defaultSubscribe: false, planDetails: { price: 15 }, itemPriceArray: [{ id: 'pro-monthly', price: 15 }] });
        expect(planOf(FREE)).toMatchObject({ planName: 'Free', status: 1 });

        const listed = await app.call('GET', '/api/v1/subscription', { token: signSession(MEMBER, [COMPANY]) });
        expect(listed.body.find((plan) => plan._id === PRO).planName).toBe('Pro Plus');
    });

    describe.each(REFUSED_WRITERS)('%s', (label, caller, status) => {
        it.each(WRITE_BODIES)('is refused with %s', async (bodyLabel, body) => {
            const before = snapshot();
            const res = await app.call('PUT', '/api/v1/subscription', { ...caller(), body });
            expect(res.status).toBe(status);
            expect(snapshot()).toBe(before);
            expect(planCalls('findOneAndUpdate')).toEqual([]);
        });
    });

    it.each([
        ['no id', { plan: { status: 0 } }],
        ['an id that is not an id', { id: 'pro', plan: { status: 0 } }],
        ['an id that is an object', { id: { $ne: null }, plan: { status: 0 } }],
        ['no fields', { id: PRO, plan: {} }],
        ['a plan that is not an object', { id: PRO, plan: [{ status: 0 }] }],
        ['a field a plan does not have', { id: PRO, plan: { status: 0, isProductOwner: true } }],
        ['an operator in place of a field', { id: PRO, plan: { $set: { status: 0 } } }],
        ['a dotted field', { id: PRO, plan: { 'planDetails.price': 0 } }],
        ['an operator inside a value', { id: PRO, plan: { planDetails: { $where: 'true' } } }],
        ['an operator inside a list', { id: PRO, plan: { itemPriceArray: [{ $function: {} }] } }],
        ['a name that is not text', { id: PRO, plan: { planName: { $gt: '' } } }],
        ['an empty name', { id: PRO, plan: { planName: '  ' } }],
        ['a status that is not a whole number', { id: PRO, plan: { status: '0' } }],
        ['a flag that is not true or false', { id: PRO, plan: { isDefaultShow: 'yes' } }],
        ['prices that are not a list', { id: PRO, plan: { itemPriceArray: { 0: 'x' } } }],
        ['details that are not an object', { id: PRO, plan: { planDetails: 'free' } }],
        ['a filter and an update of its own', WRITE_BODIES[1][1]],
        ['an extra key beside the plan', { id: PRO, plan: { status: 0 }, options: { upsert: true } }],
    ])('answers the instance admin 400 for %s', async (label, body) => {
        const before = snapshot();
        const res = await app.call('PUT', '/api/v1/subscription', { ...session(INSTANCE_ADMIN)(), body });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
        expect(snapshot()).toBe(before);
        expect(planCalls('findOneAndUpdate')).toEqual([]);
    });

    it('answers 404 for a plan that does not exist and creates nothing', async () => {
        const res = await app.call('PUT', '/api/v1/subscription', { ...session(INSTANCE_ADMIN)(), body: { id: '6f0000000000000000000e99', plan: { planName: 'New' } } });
        expect(res.status).toBe(404);
        expect(plans()).toHaveLength(2);
    });
});

describe('the plan list is read by a fixed query', () => {
    it.each(READERS)('answers %s the whole list', async (label, caller) => {
        for (const [method, path, body] of [['GET', '/api/v1/subscription'], ['POST', '/api/v1/subscription/find', {}], ['POST', '/api/v1/subscription/find']]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await app.call(method, path, { ...caller(), body });
            expect(res.status).toBe(200);
            expect(res.body.map((plan) => plan.planName).sort()).toEqual(['Free', 'Pro']);
        }
        const one = await app.call('GET', `/api/v1/subscription/${PRO}`, caller());
        expect(one.status).toBe(200);
        expect(one.body.planName).toBe('Pro');
    });

    it('refuses a caller with no session', async () => {
        expect((await app.call('GET', '/api/v1/subscription')).status).toBe(401);
        expect((await app.call('POST', '/api/v1/subscription/find', { body: {} })).status).toBe(401);
        expect((await app.call('GET', `/api/v1/subscription/${PRO}`)).status).toBe(401);
        expect(planCalls()).toEqual([]);
    });

    it.each([
        [{ planName: 'Pro' }, ['Pro']],
        [{ defaultSubscribe: true }, ['Free']],
        [{ status: 1, isDefaultShow: true }, ['Free', 'Pro']],
        [{ status: 7 }, []],
    ])('narrows the list by the filters %j', async (filters, names) => {
        const res = await app.call('POST', '/api/v1/subscription/find', { ...session(MEMBER)(), body: { filters } });
        expect(res.status).toBe(200);
        expect(res.body.map((plan) => plan.planName).sort()).toEqual(names);
    });

    it.each([
        ['a plain match', { query: [{ $match: {} }] }],
        ['a join', { query: [{ $lookup: { from: SCHEMA_TYPE.USERS, pipeline: [], as: 'people' } }] }],
        ['a join by field', { query: [{ $lookup: { from: SCHEMA_TYPE.USERS, localField: 'x', foreignField: 'x', as: 'people' } }] }],
        ['a union', { query: [{ $unionWith: { coll: SCHEMA_TYPE.USERS } }] }],
        ['a graph walk', { query: [{ $graphLookup: { from: SCHEMA_TYPE.USERS, startWith: '$_id', connectFromField: '_id', connectToField: '_id', as: 'people' } }] }],
        ['server-side code in a match', { query: [{ $match: { $where: 'true' } }] }],
        ['server-side code in a projection', { query: [{ $project: { x: { $function: { body: 'function(){}', args: [], lang: 'js' } } } }] }],
        ['an accumulator', { query: [{ $group: { _id: null, x: { $accumulator: {} } } }] }],
        ['a write stage', { query: [{ $out: 'plansCopy' }] }],
        ['a merge stage', { query: [{ $merge: { into: SCHEMA_TYPE.SUBSCRIPTIONPLAN } }] }],
        ['a facet', { query: [{ $facet: { all: [] } }] }],
        ['a pipeline under another name', { findQuery: [{ $match: {} }] }],
        ['a filter that is an operator', { filters: { planName: { $ne: null } } }],
        ['a filter on a field that is not offered', { filters: { planDetails: {} } }],
        ['an operator as a filter', { filters: { $where: 'true' } }],
        ['filters that are a list', { filters: [{ planName: 'Pro' }] }],
        ['a status filter that is text', { filters: { status: '1' } }],
    ])('refuses %s with 400 for every caller', async (label, body) => {
        for (const [, caller] of READERS) {
            // eslint-disable-next-line no-await-in-loop
            const res = await app.call('POST', '/api/v1/subscription/find', { ...caller(), body });
            expect(res.status).toBe(400);
            expect(JSON.stringify(res.body)).not.toContain('example.test');
        }
        expect(planCalls('aggregate')).toEqual([]);
    });

    it('answers 400 for a plan id that is not an id', async () => {
        const res = await app.call('GET', '/api/v1/subscription/not-an-id', session(MEMBER)());
        expect(res.status).toBe(400);
        expect(planCalls('findOne')).toEqual([]);
    });
});

describe('planRules', () => {
    it('builds the update from the named fields only', () => {
        expect(validatePlanUpdate({ id: PRO, plan: { planName: ' Team ', status: 3 } })).toEqual({ ok: true, id: PRO, fields: { planName: 'Team', status: 3 } });
        expect(PLAN_FIELDS.sort()).toEqual(['addonPriceArray', 'defaultSubscribe', 'isDefaultShow', 'itemPriceArray', 'planDetails', 'planName', 'status']);
    });

    it('reads no filters as the whole list', () => {
        expect(validatePlanFilters(undefined)).toEqual({ ok: true, filters: {} });
        expect(validatePlanFilters({})).toEqual({ ok: true, filters: {} });
        expect(validatePlanFilters({ filters: {} })).toEqual({ ok: true, filters: {} });
    });
});
