process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn(), SendNotificationEmail: jest.fn((subject, html, to, flag, cb) => cb && cb()) }));
jest.mock('../Modules/Users/controller.js', () => ({ updateUserFun: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ createNotificationsBody: jest.fn(async () => ({})) }));
jest.mock('../Modules/Company/helpers/companyWeek', () => ({ companyWeekendDays: jest.fn(async () => [0, 6]) }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { setMiddlewareWithCV2, setMiddlewareV2 } = require('../Config/setMiddleware');
const { generateToken, hashToken } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { signSession, startApp } = require('./fixtures/sessionApp');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a02';
const OTHER = '6f0000000000000000000a03';
const SEATS = { [OWNER]: 1, [MEMBER]: 3, [OTHER]: 3 };

let app;

const globalDb = () => mockDbFor(dbCollections.GLOBAL);
const authRow = (uid) => (globalDb().store[dbCollections.USER_AUTH] || []).find((row) => String(row._id) === uid);
const sessionRows = (uid) => (globalDb().store[dbCollections.SESSIONS] || []).filter((row) => String(row.userId) === uid);
const timeOff = () => mockDbFor(COMPANY).store[SCHEMA_TYPE.PTO_ENTRIES] || [];

const mintToken = (userId, extra = {}) => {
    const raw = generateToken();
    mockDbFor(COMPANY).seed(SCHEMA_TYPE.API_TOKENS, { userId, tokenHash: hashToken(raw), active: true, scopes: ['read', 'write'], createdAt: new Date(), ...extra });
    return raw;
};

const TOKENS = {
    'their own API token': (uid) => mintToken(uid),
    'their agent\'s token': (uid) => mintToken(uid, { agentId: 'agent-1' }),
};

const post = (path, token, body = {}) => app.call('POST', path, { token, companyId: COMPANY, body });

beforeAll(async () => {
    app = await startApp((server) => {
        setMiddlewareWithCV2(server);
        setMiddlewareV2(server);
        const twoFactor = require('../Modules/Auth/controller/twoFactor');
        const password = require('../Modules/Auth/controller/password');
        const sessions = require('../Modules/Auth/session');
        server.post('/api/v2/auth/2fa/setup', twoFactor.twoFaSetup);
        server.post('/api/v2/auth/2fa/verify', twoFactor.twoFaVerify);
        server.post('/api/v2/auth/2fa/disable', twoFactor.twoFaDisable);
        server.patch('/api/v2/auth/:id/change-password', password.changePassword);
        server.delete('/api/v2/session/delete', sessions.deleteAllSession);
        server.delete('/api/v2/session/delete/:id', sessions.deleteUserSpecificSession);
        server.delete('/api/v2/users/sessions/:sessionId', require('../Modules/Users/sessions').deleteOwnSession);
        require('../Modules/Pto/routes').init(server);
    });
});
afterAll(() => app.close());

beforeEach(() => {
    myCache.flushAll();
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    globalDb().seed(SCHEMA_TYPE.COMPANIES, { _id: COMPANY });
    Object.entries(SEATS).forEach(([userId, roleType]) => {
        globalDb().seed(SCHEMA_TYPE.USERS, { _id: userId, AssignCompany: [COMPANY], Employee_Name: `User ${userId.slice(-2)}` });
        globalDb().seed(dbCollections.USER_AUTH, { _id: userId, email: `${userId}@example.test` });
        globalDb().seed(dbCollections.SESSIONS, { _id: new mongoose.Types.ObjectId().toString(), userId, info: {} });
        mockDbFor(COMPANY).seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false });
    });
});

describe('two-step sign-in is set up and turned off in a signed-in session', () => {
    it('starts the set-up for the signed-in person', async () => {
        const res = await post('/api/v2/auth/2fa/setup', signSession(MEMBER, [COMPANY]));
        expect(res.status).toBe(200);
        expect(res.body.data.secret).toEqual(expect.any(String));
        expect(authRow(MEMBER).twoFactor.pendingSecretEnc).toEqual(expect.any(String));
    });

    it.each(Object.keys(TOKENS))('answers 403 to %s on every step and leaves the account as it was', async (kind) => {
        const token = TOKENS[kind](MEMBER);
        for (const step of ['setup', 'verify', 'disable']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await post(`/api/v2/auth/2fa/${step}`, token, { code: '000000' });
            expect(res.status).toBe(403);
            expect(JSON.stringify(res.body)).not.toMatch(/secret|otpauth/i);
        }
        expect(authRow(MEMBER).twoFactor).toBeUndefined();
    });
});

describe('a password is changed in a signed-in session', () => {
    it('reads the request of the signed-in person', async () => {
        const res = await app.call('PATCH', `/api/v2/auth/${MEMBER}/change-password`, { token: signSession(MEMBER, [COMPANY]), companyId: COMPANY, body: {} });
        expect(res.status).toBe(400);
    });

    it.each(Object.keys(TOKENS))('answers 403 to %s', async (kind) => {
        const res = await app.call('PATCH', `/api/v2/auth/${MEMBER}/change-password`, {
            token: TOKENS[kind](MEMBER), companyId: COMPANY, body: { oldPassword: 'Old-password-1', newPassword: 'New-password-2' },
        });
        expect(res.status).toBe(403);
    });
});

describe('sessions are ended in a signed-in session', () => {
    it('signs the person out everywhere when they ask in a session', async () => {
        const res = await app.call('DELETE', '/api/v2/session/delete', { token: signSession(MEMBER, [COMPANY]), companyId: COMPANY });
        expect(res.status).toBe(200);
        expect(sessionRows(MEMBER)).toHaveLength(0);
    });

    it.each(Object.keys(TOKENS))('answers 403 to %s and keeps the sessions', async (kind) => {
        const own = await app.call('DELETE', '/api/v2/session/delete', { token: TOKENS[kind](MEMBER), companyId: COMPANY });
        expect(own.status).toBe(403);
        const someone = await app.call('DELETE', `/api/v2/session/delete/${MEMBER}`, { token: TOKENS[kind](OWNER), companyId: COMPANY });
        expect(someone.status).toBe(403);
        expect(sessionRows(MEMBER)).toHaveLength(1);
    });

    it.each(Object.keys(TOKENS))('answers 403 to %s ending one device, and lets the person do it in a session', async (kind) => {
        const device = String(sessionRows(MEMBER)[0]._id);
        const byToken = await app.call('DELETE', `/api/v2/users/sessions/${device}`, { token: TOKENS[kind](MEMBER), companyId: COMPANY });
        expect(byToken.status).toBe(403);
        expect(sessionRows(MEMBER)).toHaveLength(1);
        const bySession = await app.call('DELETE', `/api/v2/users/sessions/${device}`, { token: signSession(MEMBER, [COMPANY]), companyId: COMPANY });
        expect(bySession.status).toBe(200);
        expect(sessionRows(MEMBER)).toHaveLength(0);
    });

    it('lets the owner end a member\'s sessions from a session', async () => {
        const res = await app.call('DELETE', `/api/v2/session/delete/${MEMBER}`, { token: signSession(OWNER, [COMPANY]), companyId: COMPANY });
        expect(res.status).toBe(200);
        expect(sessionRows(MEMBER)).toHaveLength(0);
    });
});

describe('time off is decided in a signed-in session', () => {
    const days = { startDate: '2026-11-02', endDate: '2026-11-03', type: 'casual' };

    it('lets an owner record approved time off for a member from a session', async () => {
        const res = await post('/api/v1/pto', signSession(OWNER, [COMPANY]), { ...days, userId: MEMBER, status: 'approved' });
        expect(res.status).toBe(201);
        expect(timeOff()[0]).toMatchObject({ userId: MEMBER, status: 'approved', approvedBy: OWNER });
    });

    it.each([
        ['approved time off for a member', { userId: MEMBER, status: 'approved' }],
        ['a request in a member\'s name', { userId: MEMBER }],
        ['their own time off as approved', { status: 'approved' }],
    ])('answers 403 to an owner\'s API token recording %s', async (_label, extra) => {
        const res = await post('/api/v1/pto', mintToken(OWNER), { ...days, ...extra });
        expect(res.status).toBe(403);
        expect(timeOff()).toHaveLength(0);
    });

    it('keeps a member\'s API token to a request of their own, to be decided later', async () => {
        const res = await post('/api/v1/pto', mintToken(MEMBER), { ...days, userId: OTHER, status: 'approved' });
        expect(res.status).toBe(201);
        expect(timeOff()[0]).toMatchObject({ userId: MEMBER, status: 'pending' });
    });

    it('lets an owner\'s API token ask for the owner\'s own time off', async () => {
        const res = await post('/api/v1/pto', mintToken(OWNER), days);
        expect(res.status).toBe(201);
        expect(timeOff()[0]).toMatchObject({ userId: OWNER, status: 'pending' });
    });
});
