process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn(), SendNotificationEmail: jest.fn((subject, html, to, flag, cb) => cb && cb()) }));
jest.mock('../Modules/Users/controller.js', () => ({ updateUserFun: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareWithCV2, setMiddlewareV2 } = require('../Config/setMiddleware');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000c01';
const MEMBER = '6f0000000000000000000a02';

let app;

const globalDb = () => mockDbFor(dbCollections.GLOBAL);
const person = () => (globalDb().store[SCHEMA_TYPE.USERS] || []).find((row) => String(row._id) === MEMBER);

const mintToken = (extra = {}) => {
    const raw = generateToken();
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.API_TOKENS, { userId: MEMBER, tokenHash: hashToken(raw), active: true, scopes: ['read', 'write'], createdAt: new Date(), ...extra });
    return raw;
};

const TOKENS = {
    'their own API token': () => mintToken(),
    'their agent\'s token': () => mintToken({ agentId: 'agent-1' }),
};

const ask = (method, path, token) => app.call(method, path, { token, companyId: COMPANY, body: method === 'GET' ? undefined : {} });

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        const twoFactor = require('../Modules/Auth/controller/twoFactor');
        const loginSession = require('../Modules/Auth/controller/loginSession');
        server.get('/api/v2/auth/2fa/status', twoFactor.twoFaStatus);
        server.post('/api/v2/logout', loginSession.logout);
        server.get('/api/v2/users/sessions', require('../Modules/Users/sessions').listOwnSessions);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    globalDb().seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY });
    globalDb().seed(SCHEMA_TYPE.USERS, { _id: MEMBER, AssignCompany: [COMPANY], Employee_Name: 'Member', isOnline: true });
    globalDb().seed(dbCollections.USER_AUTH, { _id: MEMBER, email: 'member@example.test', twoFactor: { enabled: true } });
    globalDb().seed(dbCollections.SESSIONS, { _id: new mongoose.Types.ObjectId().toString(), userId: MEMBER, ip: '203.0.113.7', info: { browser: 'Firefox' } });
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
});

describe('what an account says about its own sign-in is read in a signed-in session', () => {
    it('tells the signed-in person whether two-step sign-in is on', async () => {
        const res = await ask('GET', '/api/v2/auth/2fa/status', signSession(MEMBER, [COMPANY]));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ enabled: true });
    });

    it('lists the signed-in person\'s devices', async () => {
        const res = await ask('GET', '/api/v2/users/sessions', signSession(MEMBER, [COMPANY]));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({ ip: '203.0.113.7', browser: 'Firefox' });
    });

    it.each(Object.keys(TOKENS))('answers 403 to %s on both, with nothing about the account', async (kind) => {
        const token = TOKENS[kind]();
        for (const path of ['/api/v2/auth/2fa/status', '/api/v2/users/sessions']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await ask('GET', path, token);
            expect(res.status).toBe(403);
            expect(JSON.stringify(res.body)).not.toMatch(/enabled|203\.0\.113\.7|Firefox/);
        }
    });
});

describe('signing out is done in a signed-in session', () => {
    it('signs the person out and shows them as away', async () => {
        const res = await ask('POST', '/api/v2/logout', signSession(MEMBER, [COMPANY]));
        expect(res.status).toBe(200);
        expect(person().isOnline).toBe(false);
    });

    it.each(Object.keys(TOKENS))('answers 403 to %s and leaves the person as they were', async (kind) => {
        const res = await ask('POST', '/api/v2/logout', TOKENS[kind]());
        expect(res.status).toBe(403);
        expect(person().isOnline).toBe(true);
    });
});
