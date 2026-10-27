process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn(), SendNotificationEmail: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Instance/health', () => ({ ...jest.requireActual('../Modules/Instance/health'), checkDb: async () => ({ ok: true, latencyMs: 1 }) }));
jest.mock('../Modules/Setup/initalizations', () => ({ startInitialization: jest.fn(async () => {}) }));
jest.mock('../Modules/Auth/controller/loginSession', () => ({ finalizeSession: jest.fn((req, res, uid, next, onSuccess) => onSuccess({ uid })) }));
jest.mock('../Modules/Setup/createCompany', () => {
    const actual = jest.requireActual('../Modules/Setup/createCompany');
    const mongoose = require('mongoose');
    return {
        ...actual,
        createFirstCompany: jest.fn(async ({ userId, email, companyName }) => {
            const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
            const companyId = new mongoose.Types.ObjectId().toHexString();
            await MongoDbCrudOpration('global', { type: 'companies', data: { _id: companyId, userId, Cst_CompanyName: companyName } }, 'save');
            await MongoDbCrudOpration(companyId, { type: 'company_users', data: { userId, userEmail: email, roleType: 1, status: 2, isDelete: false } }, 'save');
            await MongoDbCrudOpration('global', { type: 'users', data: [{ _id: userId }, { $push: { AssignCompany: companyId } }] }, 'updateOne');
            return companyId;
        }),
    };
});

const KEY = 'k'.repeat(48);
const DAY = 24 * 60 * 60 * 1000;
const hostingMode = require('../Config/hostingMode');
const { recordAudit } = require('../Modules/Audit/recorder');
const { createFirstCompany } = require('../Modules/Setup/createCompany');
const { isActivationPending } = require('../Modules/Auth/helpers/accountMail');
const { APP_LOCALES } = require('../Modules/Platform/provision');
const platformAudit = require('../Modules/Platform/platformAudit');

const saved = Object.fromEntries(['HOSTING_MODE', 'PLATFORM_API_KEY', 'WEBURL', 'JWT_SECRET', 'CRON_TZ', 'INSTANCE_ID'].map((key) => [key, process.env[key]]));
let server;
let base;

const globalRows = (type) => mockDbFor('global').store[type] || [];
const userByEmail = (email) => globalRows('users').find((row) => row.Employee_Email === email);
const authOf = (id) => globalRows('userAuth').find((row) => String(row._id) === String(id));

beforeAll(async () => {
    Object.assign(process.env, { HOSTING_MODE: 'managed', PLATFORM_API_KEY: KEY, WEBURL: 'https://acme.example.test', JWT_SECRET: 'j'.repeat(64), INSTANCE_ID: 'ins_01jd3kabcdefghijklmnopqr' });
    hostingMode._resetForTests();
    platformAudit._useSinkForTests(async () => {});
    const app = express();
    app.use(express.json());
    require('../Modules/Platform/routes').init(app);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
    server.close();
    Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    hostingMode._resetForTests();
    require('../Config/instanceSettings')._resetForTests();
});

const call = async (method, route, body, headers = {}) => {
    const platform = route.startsWith('/api/v2/platform') ? { 'x-platform-key': KEY } : {};
    const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', ...platform, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};

const ORDER = {
    provisionId: 'prv_01jdabc',
    owner: { email: 'Maya@Acme.com', firstName: 'Maya', lastName: 'Shah' },
    workspace: { name: 'Acme', teamFocus: 'software' },
    sampleData: true, locale: 'fr', timezone: 'Asia/Kolkata',
};
const tokenOf = (url) => new URL(url.replace('/#/', '/')).searchParams.get('token');

describe('headless provisioning', () => {
    let first;

    it('names every problem with the order at once', async () => {
        const res = await call('POST', '/api/v2/platform/provision', { ...ORDER, provisionId: '', locale: 'xx', timezone: 'Mars/Olympus', owner: { email: 'nope' } });
        expect(res.status).toBe(400);
        expect(Object.keys(res.body.errors).sort()).toEqual(['email', 'firstName', 'lastName', 'locale', 'provisionId', 'timezone']);
    });

    it('creates the owner without a password, activation pending, and the first workspace', async () => {
        const res = await call('POST', '/api/v2/platform/provision', ORDER);
        expect(res.status).toBe(200);
        first = res.body.data;
        expect(first.activationUrl).toMatch(/^https:\/\/acme\.example\.test\/#\/activate\?token=[\w-]{40,}$/);
        expect(new Date(first.activationExpiresAt).getTime() - Date.now()).toBeGreaterThan(7 * DAY - 60000);
        const owner = userByEmail('maya@acme.com');
        expect(owner).toMatchObject({ isProductOwner: true, activationPending: true, isEmailVerified: true, languageCode: 'fr', Time_Zone: 'Asia/Kolkata' });
        expect(String(owner._id)).toBe(first.userId);
        expect(authOf(first.userId).passwordHash).toBeUndefined();
        expect(createFirstCompany).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'Acme', teamFocus: 'software', sampleData: true, userId: first.userId }));
        expect(process.env.CRON_TZ).toBe('Asia/Kolkata');
    });

    it('keeps an activation-pending owner out of every password mail', async () => {
        expect(await isActivationPending('maya@acme.com')).toBe(true);
    });

    it('answers the same order again with the same ids and a fresh link that revokes the last', async () => {
        const again = await call('POST', '/api/v2/platform/provision', ORDER);
        expect(again.status).toBe(200);
        expect(again.body.data).toMatchObject({ userId: first.userId, companyId: first.companyId });
        expect(again.body.data.activationUrl).not.toBe(first.activationUrl);
        expect((await call('POST', '/api/v2/auth/activation/verify', { token: tokenOf(first.activationUrl) })).status).toBe(400);
        first = again.body.data;
        expect(createFirstCompany).toHaveBeenCalledTimes(1);
        expect(globalRows('users')).toHaveLength(1);
    });

    it('refuses another provisionId once provisioned', async () => {
        const res = await call('POST', '/api/v2/platform/provision', { ...ORDER, provisionId: 'prv_other' });
        expect(res.status).toBe(409);
    });

    it('reports the provision in status', async () => {
        const res = await call('GET', '/api/v2/platform/status');
        expect(res.body.data).toMatchObject({ setup: { installed: true, provisionId: 'prv_01jdabc' }, lifecycle: 'active', entitlementsVersion: 0 });
    });

    it('accepts only the languages the web app ships', () => {
        const shipped = fs.readdirSync(path.join(__dirname, '..', 'frontend', 'src', 'locales')).filter((file) => /^[A-Za-z]+\.js$/.test(file) && file !== 'main.js').map((file) => file.replace(/\.js$/, ''));
        expect([...APP_LOCALES].sort()).toEqual(shipped.sort());
    });
});

describe('activation', () => {
    let token;
    beforeAll(async () => {
        token = tokenOf((await call('POST', '/api/v2/platform/owner/activation-link', {})).body.data.activationUrl);
    });

    it('shows who the link is for', async () => {
        const res = await call('POST', '/api/v2/auth/activation/verify', { token });
        expect(res.body.data).toEqual({ email: 'maya@acme.com', firstName: 'Maya', workspace: 'Acme' });
    });

    it('refuses a weak password without using up the link', async () => {
        expect((await call('POST', '/api/v2/auth/activate', { token, password: 'short' })).status).toBe(400);
        expect((await call('POST', '/api/v2/auth/activation/verify', { token })).status).toBe(200);
    });

    it('sets the password, ends activation and signs the owner in, once', async () => {
        const res = await call('POST', '/api/v2/auth/activate', { token, password: 'Str0ng!pass' });
        expect(res.status).toBe(200);
        const owner = userByEmail('maya@acme.com');
        expect(res.body.data.uid).toBe(String(owner._id));
        expect(owner.activationPending).toBeUndefined();
        expect(authOf(owner._id).passwordHash).toEqual(expect.any(String));
        expect(await isActivationPending('maya@acme.com')).toBe(false);
        expect((await call('POST', '/api/v2/auth/activate', { token, password: 'Str0ng!pass' })).body).toMatchObject({ status: false, key: 'expired' });
    });

    it('stops working after 7 days', async () => {
        const link = (await call('POST', '/api/v2/platform/owner/activation-link', { email: 'maya@acme.com' })).body.data;
        const owner = userByEmail('maya@acme.com');
        authOf(owner._id).oneTimeTokens.activation.expiresAt = new Date(Date.now() - 1000);
        expect((await call('POST', '/api/v2/auth/activation/verify', { token: tokenOf(link.activationUrl) })).status).toBe(400);
    });

    it('issues a link only for the owner', async () => {
        const res = await call('POST', '/api/v2/platform/owner/activation-link', { email: 'someone@acme.com' });
        expect(res.status).toBe(400);
    });
});

describe('sign-in links', () => {
    const loginToken = async () => tokenOf((await call('POST', '/api/v2/platform/owner/login-link', {})).body.data.loginUrl);

    it('signs the owner in once and audits it in their workspaces', async () => {
        const token = await loginToken();
        const res = await call('POST', '/api/v2/auth/platform-login', { token });
        expect(res.status).toBe(200);
        expect(recordAudit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'platform.owner_login', actorId: res.body.data.uid }));
        expect((await call('POST', '/api/v2/auth/platform-login', { token })).status).toBe(400);
    });

    it('stops working after 60 seconds', async () => {
        const token = await loginToken();
        const owner = userByEmail('maya@acme.com');
        expect(new Date(authOf(owner._id).oneTimeTokens.login.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60000);
        authOf(owner._id).oneTimeTokens.login.expiresAt = new Date(Date.now() - 1);
        expect((await call('POST', '/api/v2/auth/platform-login', { token })).status).toBe(400);
    });

    it('sends a two-factor account to the normal sign-in with its address', async () => {
        const owner = userByEmail('maya@acme.com');
        authOf(owner._id).twoFactor = { enabled: true };
        try {
            const link = (await call('POST', '/api/v2/platform/owner/login-link', {})).body.data;
            expect(link.twoFactor).toBe(true);
            const res = await call('POST', '/api/v2/auth/platform-login', { token: tokenOf(link.loginUrl) });
            expect(res).toEqual({ status: 409, body: expect.objectContaining({ twoFactorRequired: true, email: 'maya@acme.com' }) });
        } finally {
            delete authOf(owner._id).twoFactor;
        }
    });
});

describe('moving ownership', () => {
    it('refuses someone who holds no active seat', async () => {
        mockDbFor('global').seed('users', { Employee_Email: 'ravi@acme.com', Employee_Name: 'Ravi', AssignCompany: [] });
        const res = await call('POST', '/api/v2/platform/owner/transfer', { toEmail: 'ravi@acme.com' });
        expect(res).toMatchObject({ status: 400, body: { code: 'not_member' } });
    });

    it('moves it to an active member and audits both sides', async () => {
        const owner = userByEmail('maya@acme.com');
        const companyId = owner.AssignCompany[0];
        const ravi = userByEmail('ravi@acme.com');
        ravi.AssignCompany = [companyId];
        mockDbFor(companyId).seed('company_users', { userId: String(ravi._id), userEmail: 'ravi@acme.com', roleType: 3, status: 2, isDelete: false });
        const res = await call('POST', '/api/v2/platform/owner/transfer', { toEmail: 'Ravi@acme.com' });
        expect(res.body.data).toEqual({ userId: String(ravi._id), previousUserId: String(owner._id), changed: true });
        expect(userByEmail('ravi@acme.com').isProductOwner).toBe(true);
        expect(userByEmail('maya@acme.com').isProductOwner).toBe(false);
        expect(recordAudit.mock.calls.filter(([, entry]) => entry.action === 'platform.owner_transferred')).toHaveLength(2);
    });
});
