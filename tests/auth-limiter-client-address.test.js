const mockDb = require('./fixtures/fakeMongo').create();

/* Mongoose reads an update with no operators as $set; the fake only applies operators. */
const mockAsSet = (q) => {
    const [filter, update, ...rest] = Array.isArray(q.data) ? q.data : [];
    const plain = update && typeof update === 'object' && !Object.keys(update).some((key) => key.startsWith('$'));
    return plain ? { ...q, data: [filter, { $set: update }, ...rest] } : q;
};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, method === 'findOneAndUpdate' ? mockAsSet(q) : q, method),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn((subject, html, to, isHtml, cb) => cb({ status: true })) }));

const express = require('express');
const { trustProxySetting } = require('../Config/trustProxy');
const { limitAccountMailRequests } = require('../Modules/Auth/helpers/accountMail');
const { manageAttempt } = require('../Modules/Auth/controller/loginSession');

const MAX_ATTEMPTS = 3;
let server;
let baseURL;

const startApp = async (trustProxy) => {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.use(express.json());
    app.post('/mail', limitAccountMailRequests, (req, res) => res.json({ status: true }));
    app.post('/login', (req, res, next) => { req.errorMessageObject = { message: 'wrong password' }; next(); }, manageAttempt);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
};

const post = (path, forwardedFor) => fetch(baseURL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ email: 'someone@example.com' }),
});

const statusesFrom = async (path, count, addressOf) => {
    const statuses = [];
    for (let i = 0; i < count; i += 1) statuses.push((await post(path, addressOf(i))).status);
    return statuses;
};

beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = String(MAX_ATTEMPTS);
    for (const type of Object.keys(mockDb.store)) delete mockDb.store[type];
});

afterEach(async () => {
    delete process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS;
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
});

describe('with no trusted proxy', () => {
    beforeEach(() => startApp(false));

    it('blocks mail requests from one client whatever x-forwarded-for says', async () => {
        const statuses = await statusesFrom('/mail', MAX_ATTEMPTS + 1, (i) => `198.51.100.${i + 1}`);
        expect(statuses.slice(0, MAX_ATTEMPTS)).toEqual(Array(MAX_ATTEMPTS).fill(200));
        expect(statuses[MAX_ATTEMPTS]).toBe(429);
    });

    it('blocks failed sign-ins from one client whatever x-forwarded-for says', async () => {
        const statuses = await statusesFrom('/login', MAX_ATTEMPTS + 1, (i) => `198.51.100.${i + 1}`);
        expect(statuses[MAX_ATTEMPTS]).toBe(429);
    });
});

describe('behind a trusted proxy', () => {
    beforeEach(() => startApp('loopback'));

    it('counts each forwarded client on its own', async () => {
        const statuses = await statusesFrom('/mail', MAX_ATTEMPTS + 1, (i) => `198.51.100.${i + 1}`);
        expect(statuses).toEqual(Array(MAX_ATTEMPTS + 1).fill(200));
    });
});

describe('TRUST_PROXY', () => {
    it('trusts only loopback when unset', () => {
        expect(trustProxySetting(undefined)).toBe('loopback');
        expect(trustProxySetting('')).toBe('loopback');
    });

    it('reads true, false and a hop count as what they say', () => {
        expect(trustProxySetting('true')).toBe(true);
        expect(trustProxySetting('false')).toBe(false);
        expect(trustProxySetting(' 2 ')).toBe(2);
    });

    it('passes addresses and subnet names through', () => {
        expect(trustProxySetting('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
    });

    it('gives Express a value it accepts for every documented form', () => {
        for (const raw of ['true', 'false', '1', 'loopback', 'uniquelocal']) {
            expect(() => express().set('trust proxy', trustProxySetting(raw))).not.toThrow();
        }
    });
});
