process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const express = require('express');
const mongoose = require('mongoose');
const { create } = require('./fixtures/fakeMongo');

const mockDbs = {};
const mockDbFor = (name) => (mockDbs[name] = mockDbs[name] || create());

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (db, query, method) => mockDbFor(String(db)).crud(db, query, method) }));
jest.mock('../Modules/service.js', () => ({ SendEmail: jest.fn(), SendNotificationEmail: jest.fn() }));
jest.mock('../Modules/Audit/chain', () => ({ saveAuditRow: jest.fn(async () => {}), isOn: () => false, config: () => ({}) }));
jest.mock('../Modules/Auth/controller/loginSession', () => ({ finalizeSession: jest.fn((req, res, uid, next, onSuccess) => onSuccess({ uid })) }));

const KEY = 'k'.repeat(48);
const HOUR = 60 * 60 * 1000;
const hostingMode = require('../Config/hostingMode');
const chain = require('../Modules/Audit/chain');
const platformAudit = require('../Modules/Platform/platformAudit');
const instanceSocket = require('../socket/controller/instanceSocket');
const lifecycle = require('../Modules/Platform/lifecycle');
const support = require('../Modules/Platform/supportSession');
const usage = require('../Modules/Platform/usage');
const { publicConfig } = require('../Config/instanceSettings');

const saved = Object.fromEntries(['HOSTING_MODE', 'PLATFORM_API_KEY', 'WEBURL', 'JWT_SECRET', 'RESEND_API_KEY', 'S3_PREFIX'].map((key) => [key, process.env[key]]));
const audit = [];
const everyone = { emit: jest.fn() };
let server;
let base;

const globalRows = (type) => mockDbFor('global').store[type] || [];
const companies = [new mongoose.Types.ObjectId().toHexString(), new mongoose.Types.ObjectId().toHexString()];

beforeAll(async () => {
    Object.assign(process.env, { HOSTING_MODE: 'managed', PLATFORM_API_KEY: KEY, WEBURL: 'https://acme.example.test', JWT_SECRET: 'j'.repeat(64) });
    hostingMode._resetForTests();
    platformAudit._useSinkForTests(async (row) => { audit.push(row); });
    instanceSocket.attach(everyone);
    companies.forEach((companyId, i) => mockDbFor('global').seed('companies', { _id: companyId, Cst_CompanyName: `W${i}` }));
    const owner = mockDbFor('global').seed('users', { Employee_Email: 'maya@acme.test', isProductOwner: true, AssignCompany: companies });
    companies.forEach((companyId) => mockDbFor(companyId).seed('company_users', { userId: String(owner._id), userEmail: 'maya@acme.test', roleType: 1, status: 2, isDelete: false }));
    const app = express();
    app.use(express.json());
    require('../Modules/Platform/routes').init(app);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
    server.close();
    support._resetForTests();
    instanceSocket.attach(null);
    Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    hostingMode._resetForTests();
    require('../Config/instanceSettings')._resetForTests();
});

beforeEach(() => {
    audit.length = 0;
    everyone.emit.mockClear();
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const call = async (method, route, body, headers = { 'x-platform-key': KEY }) => {
    const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};

describe('lifecycle', () => {
    it('accepts only the four instance states', async () => {
        expect((await call('POST', '/api/v2/platform/lifecycle', { state: 'cancelled' })).status).toBe(400);
        expect((await call('POST', '/api/v2/platform/lifecycle', { state: 'past_due', graceUntil: 'soon' })).status).toBe(400);
    });

    it('stores the state, keeps it in memory, tells every open browser and audits from -> to', async () => {
        const res = await call('POST', '/api/v2/platform/lifecycle', { state: 'read_only', reason: 'payment_failed', message: 'Payment failed: update your card.', graceUntil: '2026-11-09T00:00:00Z' });
        expect(res.body).toMatchObject({ status: true, data: { state: 'read_only', previous: 'active' } });
        expect(lifecycle.lifecycle()).toBe('read_only');
        expect(globalRows('platform_state').find((row) => row._id === 'lifecycle')).toMatchObject({ state: 'read_only', previous: 'active', reason: 'payment_failed' });
        expect(everyone.emit).toHaveBeenCalledWith('INSTANCE_LIFECYCLE_CHANGED', expect.objectContaining({ state: 'read_only', message: 'Payment failed: update your card.' }));
        expect(publicConfig().hosting.lifecycle).toBe('read_only');
        await settle();
        expect(audit).toEqual([expect.objectContaining({ action: 'platform.lifecycle', ok: true, summary: 'active -> read_only (payment_failed)' })]);
    });

    it('treats the same state again as a retry', async () => {
        const res = await call('POST', '/api/v2/platform/lifecycle', { state: 'read_only' });
        expect(res.body).toMatchObject({ statusText: 'Lifecycle unchanged.', data: { state: 'read_only', previous: 'read_only' } });
        await call('POST', '/api/v2/platform/lifecycle', { state: 'active' });
        expect(lifecycle.lifecycle()).toBe('active');
    });

    it('reads the stored state back at boot', async () => {
        lifecycle._resetForTests();
        await lifecycle.loadLifecycle();
        expect(lifecycle.lifecycleState()).toMatchObject({ state: 'active' });
    });
});

describe('config push', () => {
    it('applies platform keys and audits their names only', async () => {
        const res = await call('PUT', '/api/v2/platform/config', { values: { RESEND_API_KEY: 're_secret_value', S3_PREFIX: 'ins_01/' } });
        expect(res.status).toBe(200);
        expect(res.body.data.applied.sort()).toEqual(['RESEND_API_KEY', 'S3_PREFIX']);
        expect(process.env.RESEND_API_KEY).toBe('re_secret_value');
        await settle();
        expect(audit[0].summary).toMatch(/RESEND_API_KEY, S3_PREFIX/);
        expect(JSON.stringify(audit)).not.toMatch(/re_secret_value/);
    });

    it('refuses a key the customer owns and a key that does not exist, applying nothing', async () => {
        const res = await call('PUT', '/api/v2/platform/config', { values: { AI_API_KEY: 'sk-x', NOT_A_SETTING: '1', S3_PREFIX: 'other/' } });
        expect(res).toMatchObject({ status: 400, body: { errors: { AI_API_KEY: 'not_platform', NOT_A_SETTING: 'unknown' } } });
        expect(process.env.S3_PREFIX).toBe('ins_01/');
    });
});

describe('key rotation', () => {
    it('wants a long key, then accepts it beside the env key', async () => {
        expect((await call('POST', '/api/v2/platform/rotate-key', { newKey: 'short' })).status).toBe(400);
        const res = await call('POST', '/api/v2/platform/rotate-key', { newKey: 'n'.repeat(40) });
        expect(res.body.data.rotated).toBe(true);
        expect((await call('GET', '/api/v2/platform/usage', undefined, { 'x-platform-key': 'n'.repeat(40) })).status).toBe(200);
        expect((await call('GET', '/api/v2/platform/usage')).status).toBe(200);
        expect(JSON.stringify(globalRows('platform_state'))).not.toMatch(/nnnnnnnn/);
    });
});

describe('a support session', () => {
    let session;
    const until = () => new Date(Date.now() + 2 * HOUR).toISOString();
    const tokenOf = (url) => new URL(url.replace('/#/', '/')).searchParams.get('token');

    it('lasts at most 24 hours', async () => {
        const res = await call('POST', '/api/v2/platform/support-session', { staffEmail: 'ravi@alianhub.com', staffName: 'Ravi K.', expiresAt: new Date(Date.now() + 25 * HOUR).toISOString() });
        expect(res).toMatchObject({ status: 400, body: { errors: { expiresAt: 'too_far' } } });
    });

    it('gives a flagged support account an admin seat in every workspace and a one-time link', async () => {
        const res = await call('POST', '/api/v2/platform/support-session', { staffEmail: 'ravi@alianhub.com', staffName: 'Ravi K.', expiresAt: until() });
        expect(res.status).toBe(200);
        session = res.body.data;
        expect(session.loginUrl).toMatch(/^https:\/\/acme\.example\.test\/#\/platform-login\?token=/);
        const account = globalRows('users').find((row) => row.Employee_Email === 'support@alianhub.com');
        expect(account).toMatchObject({ isSupportUser: true, Employee_Name: 'AlianHub Support', AssignCompany: companies });
        expect(account.isProductOwner).toBeUndefined();
        companies.forEach((companyId) => expect(mockDbFor(companyId).store.company_users.find((row) => row.userId === session.userId)).toMatchObject({ roleType: 2, status: 2, isSupportUser: true }));
        expect(everyone.emit).toHaveBeenCalledWith('INSTANCE_SUPPORT_ACCESS_CHANGED', expect.objectContaining({ active: true }));
        expect(support.supportAccess()).toMatchObject({ active: true, staffName: 'Ravi K.' });
    });

    it('never counts as a seat', async () => {
        usage._resetForTests();
        expect((await usage.buildUsage()).seats.active).toBe(1);
    });

    it('signs in the support account, never the owner, and every audit row names the staff member', async () => {
        const res = await call('POST', '/api/v2/auth/platform-login', { token: tokenOf(session.loginUrl) }, {});
        expect(res.body.data.uid).toBe(session.userId);
        require('../Modules/Audit/recorder').recordAudit(companies[0], { actorId: session.userId, actorName: 'AlianHub Support', action: 'task.update' });
        const rows = chain.saveAuditRow.mock.calls.map(([, entry]) => entry).filter((entry) => entry.actorId === session.userId);
        expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(['platform.support_login', 'task.update']));
        expect(rows.every((row) => row.actorName === 'AlianHub Support (Ravi K.)')).toBe(true);
    });

    it('loses every seat and session when the time passes', async () => {
        mockDbFor('global').seed('sessions', { userId: session.userId });
        expect(await support.expireDueSupportSession(Date.now() + 3 * HOUR)).toEqual({ ended: true, reason: 'expired' });
        companies.forEach((companyId) => expect(mockDbFor(companyId).store.company_users.filter((row) => row.userId === session.userId)).toEqual([]));
        expect(globalRows('sessions').filter((row) => row.userId === session.userId)).toEqual([]);
        expect(globalRows('users').find((row) => row.Employee_Email === 'support@alianhub.com').AssignCompany).toEqual([]);
        expect(everyone.emit).toHaveBeenCalledWith('INSTANCE_SUPPORT_ACCESS_CHANGED', { active: false });
        expect(support.supportAccess().active).toBe(false);
        expect(support.supportActorLabel(session.userId)).toBeNull();
    });

    it('refuses a support link once the session is over, and can be ended early', async () => {
        const again = (await call('POST', '/api/v2/platform/support-session', { staffEmail: 'ravi@alianhub.com', staffName: 'Ravi K.', expiresAt: until() })).body.data;
        expect((await call('DELETE', '/api/v2/platform/support-session')).body.data).toEqual({ ended: true, reason: 'revoked' });
        const link = await require('../Modules/Platform/ownerLinks').signInLink(again.userId);
        expect((await call('POST', '/api/v2/auth/platform-login', { token: tokenOf(link.loginUrl) }, {})).status).toBe(403);
    });
});
