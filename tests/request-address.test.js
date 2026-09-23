const mockStored = { sessions: [], audits: [] };

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/Auth/session.js', () => ({
    insertSessionFun: jest.fn((query, userAgent, ip, cb) => {
        mockStored.sessions.push(ip);
        cb({ status: false });
    }),
}));
jest.mock('../Modules/Auth/controller/authHelpers', () => ({
    sessionRefusalFor: jest.fn(async () => null),
    generateTokenV2Fun: jest.fn(),
    addAndRemoveUserInMongodbNotificationCount: jest.fn(),
    verifyAuth: jest.fn(),
}));
jest.mock('../Modules/Audit/chain', () => ({
    saveAuditRow: jest.fn(async (companyId, entry) => { mockStored.audits.push(entry.ip); }),
    isOn: () => false,
    config: () => ({ on: false, requested: false }),
}));

const express = require('express');
const { finalizeSession } = require('../Modules/Auth/controller/loginSession');
const { finalizeSsoSession } = require('../Modules/SSO/ssoSession');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');

const UID = 'a'.repeat(24);
const COMPANY_ID = 'b'.repeat(24);
const FORWARDED = '203.0.113.7';
const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

let server;
let baseURL;

const startApp = async (trustProxy) => {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.post('/login', (req, res, next) => finalizeSession(req, res, UID, next, () => res.json({ ok: true })), (req, res) => res.json({ ok: false }));
    app.post('/sso', (req, res) => finalizeSsoSession(req, res, UID, '/'));
    app.post('/audit', (req, res) => {
        recordAuditFromReq(req, { action: 'address.test', entityType: 'test' });
        res.json({ ok: true });
    });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
};

const post = (route, forwardedFor) => fetch(baseURL + route, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': forwardedFor, companyid: COMPANY_ID },
});

const waitForAudit = async () => {
    for (let i = 0; i < 50 && mockStored.audits.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    return mockStored.audits[0];
};

beforeEach(() => {
    mockStored.sessions.length = 0;
    mockStored.audits.length = 0;
});

afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
});

describe('with TRUST_PROXY off', () => {
    beforeEach(() => startApp(false));

    it('stores the connecting address on a password sign-in session, not a spoofed header', async () => {
        await post('/login', FORWARDED);
        expect(mockStored.sessions).toHaveLength(1);
        expect(mockStored.sessions[0]).toMatch(LOOPBACK);
    });

    it('stores the connecting address on an SSO session, not a spoofed header', async () => {
        await post('/sso', FORWARDED);
        expect(mockStored.sessions).toHaveLength(1);
        expect(mockStored.sessions[0]).toMatch(LOOPBACK);
    });

    it('stores the connecting address on an audit row, not a spoofed header', async () => {
        await post('/audit', FORWARDED);
        expect(await waitForAudit()).toMatch(LOOPBACK);
    });
});

describe('with TRUST_PROXY=1', () => {
    beforeEach(() => startApp(1));

    const CHAIN = `198.51.100.1, ${FORWARDED}`;

    it('stores the address the proxy forwarded on a session', async () => {
        await post('/login', CHAIN);
        expect(mockStored.sessions).toEqual([FORWARDED]);
    });

    it('stores the address the proxy forwarded on an audit row', async () => {
        await post('/audit', CHAIN);
        expect(await waitForAudit()).toBe(FORWARDED);
    });
});
