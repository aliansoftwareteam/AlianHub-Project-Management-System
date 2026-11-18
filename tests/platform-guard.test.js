const express = require('express');

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/Platform/controller', () => new Proxy({}, { get: (target, name) => (req, res) => res.send({ status: true, statusText: String(name), platform: req.platform || null }) }));

const KEY = 'k'.repeat(48);
const ROTATED = 'r'.repeat(40);

const hostingMode = require('../Config/hostingMode');
const platformState = require('../Modules/Platform/platformState');
const platformAudit = require('../Modules/Platform/platformAudit');
const guard = require('../Modules/Platform/guard');

const audit = [];
let server;
let base;
const saved = { HOSTING_MODE: process.env.HOSTING_MODE, PLATFORM_API_KEY: process.env.PLATFORM_API_KEY };

const inMode = (mode) => {
    hostingMode._resetForTests();
    if (mode) process.env.HOSTING_MODE = mode; else delete process.env.HOSTING_MODE;
};

beforeAll(async () => {
    process.env.PLATFORM_API_KEY = KEY;
    platformAudit._useSinkForTests(async (row) => { audit.push(row); });
    const app = express();
    app.use(express.json());
    require('../Modules/Platform/routes').init(app);
    app.get('/api/v2/instance/probe', require('../Modules/Instance/guard').requireInstanceAdmin, (req, res) => res.send({ status: true, via: req.instanceAdmin }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
    server.close();
    Object.entries(saved).forEach(([key, value]) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    hostingMode._resetForTests();
    platformState._useStoreForTests(null);
});

beforeEach(() => {
    guard._resetForTests();
    platformState._useStoreForTests(platformState.memoryStore());
    audit.length = 0;
});

const call = async (method, path, headers = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : '{}' });
    return { status: res.status, body: await res.json() };
};

const ROUTES = [
    ['GET', '/api/v2/platform/status'], ['POST', '/api/v2/platform/provision'], ['PUT', '/api/v2/platform/config'],
    ['PUT', '/api/v2/platform/entitlements'], ['GET', '/api/v2/platform/usage'], ['POST', '/api/v2/platform/lifecycle'],
    ['POST', '/api/v2/platform/owner/activation-link'], ['POST', '/api/v2/platform/owner/login-link'], ['POST', '/api/v2/platform/owner/transfer'],
    ['POST', '/api/v2/platform/rotate-key'], ['POST', '/api/v2/platform/support-session'], ['DELETE', '/api/v2/platform/support-session'],
];

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('on a self-hosted instance', () => {
    beforeAll(() => inMode('self'));

    it.each(ROUTES)('%s %s does not exist, even with the key', async (method, path) => {
        expect((await call(method, path, { 'x-platform-key': KEY })).status).toBe(404);
    });

    it('answers the public link routes 404 too', async () => {
        expect((await call('POST', '/api/v2/auth/platform-login')).status).toBe(404);
        expect((await call('POST', '/api/v2/auth/activate')).status).toBe(404);
    });

    it('leaves the platform key without any meaning on the instance routes', async () => {
        const res = await call('GET', '/api/v2/instance/probe', { 'x-platform-key': KEY });
        expect(res.status).toBe(401);
    });
});

describe('on a hosted instance', () => {
    beforeAll(() => inMode('managed'));

    it.each(ROUTES)('%s %s answers with the key and records the request id', async (method, path) => {
        const res = await call(method, path, { 'x-platform-key': KEY, 'x-request-id': 'job_1:step' });
        expect(res.status).toBe(200);
        expect(res.body.platform).toEqual({ requestId: 'job_1:step' });
        await settle();
        expect(audit).toEqual([expect.objectContaining({ ok: true, requestId: 'job_1:step', action: expect.stringMatching(/^platform\./) })]);
    });

    it('refuses a call that came through a proxy, key or not', async () => {
        const res = await call('GET', '/api/v2/platform/status', { 'x-platform-key': KEY, 'x-forwarded-for': '203.0.113.9' });
        expect(res.status).toBe(403);
        await settle();
        expect(audit.map((row) => row.action)).toEqual(['platform.auth_forwarded']);
    });

    it('refuses a missing or wrong key with 401 and audits it', async () => {
        expect((await call('GET', '/api/v2/platform/status')).status).toBe(401);
        expect((await call('GET', '/api/v2/platform/status', { 'x-platform-key': `${KEY}x` })).status).toBe(401);
        await settle();
        expect(audit.map((row) => [row.action, row.ok])).toEqual([['platform.auth_failed', false], ['platform.auth_failed', false]]);
    });

    it('blocks a source for 15 minutes after 10 wrong keys in a minute, the right key included', async () => {
        const req = (key) => ({ method: 'GET', path: '/status', headers: { 'x-platform-key': key }, socket: { remoteAddress: '172.18.0.5' } });
        const start = Date.now();
        for (let i = 0; i < 9; i += 1) expect(await guard.checkPlatformCall(req('wrong'), start + i)).toMatchObject({ status: 401 });
        expect(await guard.checkPlatformCall(req(KEY), start + 9)).toBeNull();
        expect(await guard.checkPlatformCall(req('wrong'), start + 10)).toMatchObject({ status: 401 });
        expect(await guard.checkPlatformCall(req(KEY), start + 11)).toMatchObject({ status: 429 });
        expect(await guard.checkPlatformCall(req(KEY), start + 10 + guard.BLOCK_MS - 1)).toMatchObject({ status: 429 });
        expect(await guard.checkPlatformCall(req(KEY), start + 10 + guard.BLOCK_MS)).toBeNull();
        expect(await guard.checkPlatformCall({ ...req(KEY), socket: { remoteAddress: '172.18.0.6' } }, start + 12)).toBeNull();
        await settle();
        expect(audit.filter((row) => row.action === 'platform.auth_blocked')).toEqual([expect.objectContaining({ summary: '10 failures/min from 172.18.0.5' })]);
    });

    it('spreads failures over more than a minute without blocking', async () => {
        const req = { method: 'GET', path: '/status', headers: { 'x-platform-key': 'wrong' }, socket: { remoteAddress: '172.18.0.7' } };
        const start = Date.now();
        for (let i = 0; i < 20; i += 1) expect(await guard.checkPlatformCall(req, start + i * 7000)).toMatchObject({ status: 401 });
    });

    it('accepts a rotated key for 24 hours beside the env key, then only the env key', async () => {
        const now = Date.now();
        await platformState.writeState('keys', { extraKeys: [{ hash: guard.sha256Hex(ROTATED), expiresAt: new Date(now + 24 * 3600 * 1000) }] });
        guard.forgetRotatedKeys();
        expect(await guard.keyMatches(ROTATED, now)).toBe(true);
        expect(await guard.keyMatches(KEY, now)).toBe(true);
        expect(await guard.keyMatches(ROTATED, now + 24 * 3600 * 1000)).toBe(false);
        expect(await guard.keyMatches('not-it', now)).toBe(false);
    });

    it('lets the platform key into the instance routes as "platform"', async () => {
        const res = await call('GET', '/api/v2/instance/probe', { 'x-platform-key': KEY, 'x-request-id': 'job_2' });
        expect(res).toEqual({ status: 200, body: { status: true, via: 'platform' } });
        await settle();
        expect(audit).toEqual([expect.objectContaining({ action: 'platform.instance', ok: true, requestId: 'job_2', summary: 'GET /api/v2/instance/probe 200' })]);
    });

    it('refuses the platform key on the instance routes through a proxy or when wrong', async () => {
        expect((await call('GET', '/api/v2/instance/probe', { 'x-platform-key': KEY, 'x-forwarded-for': '10.0.0.1' })).status).toBe(403);
        expect((await call('GET', '/api/v2/instance/probe', { 'x-platform-key': 'wrong' })).status).toBe(401);
    });
});
