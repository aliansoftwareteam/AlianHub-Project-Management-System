const express = require('express');

const { installCors } = require('../utils/cors.js');
const globalRateLimit = require('../Config/globalRateLimit');

const ALLOWED = 'https://hub.example.test';
const READ = '/api/v2/agents/team';
const WRITE = '/api/v2/tasks/bulk';

const envBefore = { WEBURL: process.env.WEBURL, APIURL: process.env.APIURL, CORS_ORIGINS: process.env.CORS_ORIGINS };
const servers = [];

const serve = async (env) => {
    const app = express();
    installCors(app);
    const installed = globalRateLimit.install(app, env);
    app.get(READ, (req, res) => res.json({ status: true }));
    app.post(WRITE, (req, res) => res.json({ status: true }));
    app.get('/assets/app.js', (req, res) => res.type('js').send(''));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return { installed, baseURL: `http://127.0.0.1:${server.address().port}` };
};

beforeAll(() => {
    process.env.WEBURL = ALLOWED;
    delete process.env.APIURL;
    delete process.env.CORS_ORIGINS;
});

afterAll(async () => {
    Object.entries(envBefore).forEach(([name, value]) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    });
    await Promise.all(servers.map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

describe('the global rate limiter', () => {
    test('allows 1000 requests a minute unless the instance says otherwise', () => {
        expect(globalRateLimit.limitOf({})).toBe(1000);
        expect(globalRateLimit.limitOf({ GLOBAL_RATE_LIMIT_PER_MIN: '250' })).toBe(250);
        expect(globalRateLimit.limitOf({ GLOBAL_RATE_LIMIT_PER_MIN: 'nonsense' })).toBe(1000);
    });

    test.each(['0', 'off', 'false', 'no', 'disabled', ' OFF '])('is not installed when the setting is %p', async (value) => {
        expect(globalRateLimit.limitOf({ GLOBAL_RATE_LIMIT_PER_MIN: value })).toBe(0);
        const { installed, baseURL } = await serve({ GLOBAL_RATE_LIMIT_PER_MIN: value });
        expect(installed).toBe(false);
        expect((await fetch(baseURL + READ)).status).toBe(200);
        expect((await fetch(baseURL + READ)).status).toBe(200);
    });

    test('refuses the request over the limit with 429, Retry-After and the app error shape', async () => {
        const { installed, baseURL } = await serve({ GLOBAL_RATE_LIMIT_PER_MIN: '2' });
        expect(installed).toBe(true);
        expect((await fetch(baseURL + READ)).status).toBe(200);
        expect((await fetch(baseURL + READ)).status).toBe(200);

        const refused = await fetch(baseURL + READ);
        expect(refused.status).toBe(429);
        const seconds = Number(refused.headers.get('retry-after'));
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(60);
        expect(await refused.json()).toEqual({
            status: false,
            code: globalRateLimit.BUSY_CODE,
            statusText: expect.any(String),
            message: expect.any(String),
            retryAfter: seconds,
        });
    });

    test('counts reads and writes from one address in the same bucket', async () => {
        const { baseURL } = await serve({ GLOBAL_RATE_LIMIT_PER_MIN: '2' });
        await fetch(baseURL + READ);
        await fetch(baseURL + READ);
        const write = await fetch(baseURL + WRITE, { method: 'POST' });
        expect(write.status).toBe(429);
        expect(Number(write.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    test('never counts a static asset', async () => {
        const { baseURL } = await serve({ GLOBAL_RATE_LIMIT_PER_MIN: '1' });
        expect((await fetch(`${baseURL}/assets/app.js`)).status).toBe(200);
        expect((await fetch(`${baseURL}/assets/app.js`)).status).toBe(200);
        expect((await fetch(baseURL + READ)).status).toBe(200);
        expect((await fetch(baseURL + READ)).status).toBe(429);
    });

    test('lets a browser on another origin read Retry-After', async () => {
        const { baseURL } = await serve({ GLOBAL_RATE_LIMIT_PER_MIN: '1' });
        await fetch(baseURL + READ, { headers: { Origin: ALLOWED } });
        const refused = await fetch(baseURL + READ, { headers: { Origin: ALLOWED } });
        expect(refused.status).toBe(429);
        expect(refused.headers.get('access-control-allow-origin')).toBe(ALLOWED);
        expect(String(refused.headers.get('access-control-expose-headers')).toLowerCase()).toContain('retry-after');
    });
});
