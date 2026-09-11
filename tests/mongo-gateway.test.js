jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));

process.env.JWT_SECRET = 'mongo-gateway-unit-secret';
jest.setTimeout(30000);

const express = require('express');
const jsonwebtoken = require('jsonwebtoken');
const { myCache } = require('../Config/config');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareWithCV2 } = require('../Config/setMiddleware');
const { mongoOperation } = require('../Modules/Auth/controller/mongoOperation');
const {
    GATEWAY_ALLOWLIST, CREDENTIAL_COLLECTIONS, MAX_RESULTS, checkGatewayRequest, stripSecrets,
} = require('../Modules/Auth/controller/mongoGatewayRules');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const USER = '6f0000000000000000000001';

const loggedTimeBody = (overrides = {}) => ({
    dbName: COMPANY,
    collection: dbCollections.TIMESHEET,
    methodName: 'aggregate',
    dataObj: [[{ $match: { TicketID: 'task-1' } }, { $group: { _id: null, total: { $sum: '$LogTimeDuration' } } }]],
    ...overrides,
});

const gatewayCalls = () => mockDb.calls.filter((call) => call.type !== dbCollections.SESSIONS && call.type !== dbCollections.USERS);

const resetStore = () => {
    myCache.flushAll();
    mockDb.calls.length = 0;
    Object.keys(mockDb.store).forEach((type) => { delete mockDb.store[type]; });
    mockDb.seed(dbCollections.USERS, { _id: USER, AssignCompany: COMPANY });
    mockDb.seed(dbCollections.TIMESHEET, { TicketID: 'task-1', LogTimeDuration: 30 });
    mockDb.seed(dbCollections.TIMESHEET, { TicketID: 'task-1', LogTimeDuration: 15 });
    mockDb.seed(dbCollections.TIMESHEET, { TicketID: 'task-2', LogTimeDuration: 99 });
};

const signIn = () => {
    const refreshToken = jsonwebtoken.sign({}, process.env.JWT_SECRET, { expiresIn: '1h' });
    mockDb.seed(dbCollections.SESSIONS, { userId: USER, refreshToken });
    return jsonwebtoken.sign({ uid: USER, refreshToken }, process.env.JWT_SECRET, { audience: COMPANY, expiresIn: '1h' });
};

describe('POST /api/v1/mongoOpration', () => {
    let server;
    let baseURL;

    beforeAll(async () => {
        const app = express();
        app.use(express.json());
        setMiddlewareWithCV2(app);
        app.post('/api/v1/mongoOpration', mongoOperation);
        await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        baseURL = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));
    beforeEach(resetStore);

    const post = async (body, headers = {}) => {
        const res = await fetch(`${baseURL}/api/v1/mongoOpration`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
    };
    const asMember = (body, headers = {}) => post(body, { authorization: `Bearer ${signIn()}`, companyid: COMPANY, ...headers });

    describe('without a session', () => {
        it('refuses the ACC-01 repro that counted userAuth with 401', async () => {
            const res = await post({ dbName: 'global', collection: dbCollections.USER_AUTH, methodName: 'countDocuments', dataObj: [{}] });
            expect(res.status).toBe(401);
            expect(res.body.status).toBe(false);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it('refuses the ACC-01 repro that listed every user email with 401', async () => {
            const res = await post({ dbName: 'global', collection: dbCollections.USERS, methodName: 'find', dataObj: [{}, { Employee_Email: 1 }] });
            expect(res.status).toBe(401);
            expect(JSON.stringify(res.body)).not.toMatch(/Employee_Email/);
        });

        it('refuses a caller that only names a company with 401', async () => {
            const res = await post(loggedTimeBody(), { companyid: COMPANY });
            expect(res.status).toBe(401);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it('refuses a forged bearer token with 401', async () => {
            const res = await post(loggedTimeBody(), { companyid: COMPANY, authorization: 'Bearer not-a-jwt' });
            expect(res.status).toBe(401);
        });
    });

    describe('another company', () => {
        it('refuses a session whose company header is not one of its companies', async () => {
            const res = await asMember(loggedTimeBody({ dbName: OTHER_COMPANY }), { companyid: OTHER_COMPANY });
            expect(res.status).toBe(401);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it('refuses a dbName naming another company with 403', async () => {
            const res = await asMember(loggedTimeBody({ dbName: OTHER_COMPANY }));
            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({ status: false, statusText: 'Forbidden' });
            expect(res.body.message).toMatch(/own company/);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it('refuses a body companyId naming another company with 403', async () => {
            const res = await asMember(loggedTimeBody({ companyId: OTHER_COMPANY }));
            expect(res.status).toBe(403);
            expect(gatewayCalls()).toHaveLength(0);
        });
    });

    describe('refusals for a signed-in member', () => {
        it.each([
            ['global', dbCollections.USER_AUTH],
            ['global', dbCollections.SESSIONS],
            [COMPANY, dbCollections.API_TOKENS],
            [COMPANY, dbCollections.INTEGRATION_CONNECTIONS],
        ])('refuses the credential collection %s/%s', async (dbName, collection) => {
            const res = await asMember({ dbName, collection, methodName: 'countDocuments', dataObj: [{}] });
            expect(res.status).toBe(403);
            expect(res.body.message).toMatch(/credentials/);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it('refuses the global users collection', async () => {
            const res = await asMember({ dbName: 'global', collection: dbCollections.USERS, methodName: 'find', dataObj: [{}, { Employee_Email: 1 }] });
            expect(res.status).toBe(403);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it.each(['deleteMany', 'updateMany', 'find', 'drop', 'findOneAndUpdate'])('refuses %s on an allowlisted collection', async (methodName) => {
            const res = await asMember(loggedTimeBody({ methodName, dataObj: [{}] }));
            expect(res.status).toBe(403);
            expect(res.body.message).toMatch(/not allowed/);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it('refuses a collection that is not allowlisted', async () => {
            const res = await asMember(loggedTimeBody({ collection: dbCollections.TASKS }));
            expect(res.status).toBe(403);
        });

        it('refuses mapReduce', async () => {
            const res = await asMember(loggedTimeBody({ methodName: 'mapReduce' }));
            expect(res.status).toBe(403);
            expect(res.body.message).toMatch(/mapReduce/);
        });

        it('refuses $where', async () => {
            const res = await asMember(loggedTimeBody({ dataObj: [[{ $match: { $where: 'sleep(5000) || true' } }]] }));
            expect(res.status).toBe(403);
            expect(res.body.message).toMatch(/\$where/);
            expect(gatewayCalls()).toHaveLength(0);
        });

        it.each([
            [{ $group: { _id: null, total: { $accumulator: { init: 'function(){}' } } } }, '$accumulator'],
            [{ $match: { $expr: { $function: { body: 'function(){return true}', args: [], lang: 'js' } } } }, '$function'],
        ])('refuses server-side evaluation nested in a stage', async (stage, operator) => {
            const res = await asMember(loggedTimeBody({ dataObj: [[stage]] }));
            expect(res.status).toBe(403);
            expect(res.body.message).toContain(operator);
        });

        it.each(['$lookup', '$unionWith', '$out', '$merge'])('refuses the %s stage', async (stageName) => {
            const res = await asMember(loggedTimeBody({ dataObj: [[{ [stageName]: { from: dbCollections.USER_AUTH } }]] }));
            expect(res.status).toBe(403);
            expect(gatewayCalls()).toHaveLength(0);
        });
    });

    describe('the task panel logged-time caller', () => {
        it('still sums the logged minutes of one task', async () => {
            const res = await asMember(loggedTimeBody());
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true, statusText: 'OK', data: [{ _id: null, total: 45 }] });
        });

        it('runs in the session company database and caps the result size', async () => {
            await asMember(loggedTimeBody());
            const [call] = gatewayCalls();
            expect(call).toMatchObject({ companyId: COMPANY, type: dbCollections.TIMESHEET, method: 'aggregate' });
            expect(call.data[0][call.data[0].length - 1]).toEqual({ $limit: MAX_RESULTS });
        });
    });
});

describe('mongoOperation', () => {
    beforeEach(resetStore);

    const call = async (body, { uid = USER, companyId = COMPANY } = {}) => {
        const res = { statusCode: 200, body: undefined };
        res.status = jest.fn((code) => { res.statusCode = code; return res; });
        res.json = jest.fn((payload) => { res.body = payload; return res; });
        await mongoOperation({ body, headers: { companyid: companyId }, uid }, res);
        return res;
    };

    it('answers 401 when no session populated req.uid', async () => {
        const res = await call(loggedTimeBody(), { uid: null });
        expect(res.statusCode).toBe(401);
        expect(gatewayCalls()).toHaveLength(0);
    });

    it('strips password hashes, web tokens and secrets from what it returns', async () => {
        mockDb.crud.mockImplementationOnce(async () => [{
            _id: null,
            total: 1,
            password: '$2b$10$hash',
            webTokens: ['token'],
            nested: { refreshToken: 'r', clientSecret: 's', apiKey: 'k', keep: 'yes' },
            rows: [{ accessToken: 'a', name: 'kept' }],
        }]);
        const res = await call(loggedTimeBody());
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([{ _id: null, total: 1, nested: { keep: 'yes' }, rows: [{ name: 'kept' }] }]);
    });

    it('does not echo a database error back to the caller', async () => {
        mockDb.crud.mockImplementationOnce(async () => { throw new Error('connection string mongodb://user:pw@host'); });
        const res = await call(loggedTimeBody());
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/mongodb:\/\//);
    });
});

describe('gateway rules', () => {
    it('keeps the allowlist frozen', () => {
        expect(Object.isFrozen(GATEWAY_ALLOWLIST)).toBe(true);
        expect(Object.isFrozen(GATEWAY_ALLOWLIST.company)).toBe(true);
        expect(Object.isFrozen(GATEWAY_ALLOWLIST.company[dbCollections.TIMESHEET].aggregate.stages)).toBe(true);
        expect(Object.isFrozen(CREDENTIAL_COLLECTIONS)).toBe(true);
    });

    it('grants nothing in the global database', () => {
        expect(Object.keys(GATEWAY_ALLOWLIST.global)).toEqual([]);
    });

    it('never allowlists a credential collection', () => {
        const allowlisted = [...Object.keys(GATEWAY_ALLOWLIST.company), ...Object.keys(GATEWAY_ALLOWLIST.global)];
        expect(allowlisted.filter((name) => CREDENTIAL_COLLECTIONS.includes(name))).toEqual([]);
    });

    it('refuses a prototype key in a filter', () => {
        const body = loggedTimeBody({ dataObj: JSON.parse('[[{"$match":{"__proto__":{"x":1}}}]]') });
        expect(checkGatewayRequest(body, { companyId: COMPANY })).toMatchObject({ ok: false, statusCode: 403 });
    });

    it('refuses aggregate options beyond the pipeline', () => {
        const body = loggedTimeBody({ dataObj: [[{ $match: {} }], { allowDiskUse: true }] });
        expect(checkGatewayRequest(body, { companyId: COMPANY })).toMatchObject({ ok: false, statusCode: 400 });
    });

    it('strips secrets through nested arrays and leaves plain values alone', () => {
        expect(stripSecrets([{ a: 1, twoFactorSecret: 'x', list: [{ passwordHash: 'y', b: 2 }] }, 3, null]))
            .toEqual([{ a: 1, list: [{ b: 2 }] }, 3, null]);
    });
});
