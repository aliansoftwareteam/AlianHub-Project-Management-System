const express = require('express');

const { installCors } = require('../utils/cors.js');
const { errorHandler } = require('../Config/errorHandler.js');

const ALLOWED = 'https://hub.example.test';
const FOREIGN = 'https://evil.example.test';
const ROUTE = '/api/v2/ping';

let server;
let baseURL;
let handlerCalls;
const envBefore = { WEBURL: process.env.WEBURL, APIURL: process.env.APIURL, CORS_ORIGINS: process.env.CORS_ORIGINS };

beforeAll(async () => {
    process.env.WEBURL = ALLOWED;
    delete process.env.APIURL;
    delete process.env.CORS_ORIGINS;
    const app = express();
    installCors(app);
    app.get(ROUTE, (req, res) => {
        handlerCalls += 1;
        res.json({ status: true });
    });
    app.use(errorHandler());
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    Object.entries(envBefore).forEach(([name, value]) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    });
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
});

beforeEach(() => { handlerCalls = 0; });

const call = (headers = {}, init = {}) => fetch(baseURL + ROUTE, { headers, ...init });
const preflight = (origin) => call({ Origin: origin, 'Access-Control-Request-Method': 'GET' }, { method: 'OPTIONS' });

describe('a refused Origin', () => {
    test('is answered 403 in the app error shape, with no CORS headers', async () => {
        const res = await call({ Origin: FOREIGN });
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
        expect(await res.json()).toMatchObject({ status: false, statusText: expect.any(String), message: expect.any(String) });
        expect(handlerCalls).toBe(0);
    });

    test('is refused on preflight too', async () => {
        const res = await preflight(FOREIGN);
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
});

describe('an accepted Origin', () => {
    test('a request with no Origin still works', async () => {
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: true });
        expect(handlerCalls).toBe(1);
    });

    test('the allow-listed origin still gets its CORS headers', async () => {
        const res = await call({ Origin: ALLOWED });
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
        expect(handlerCalls).toBe(1);
    });

    test('its preflight still answers with the allowed methods', async () => {
        const res = await preflight(ALLOWED);
        expect(res.status).toBeLessThan(300);
        expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
        expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    });

    test.each(['app://.', 'file://', 'null'])('the desktop client origin %s still works', async (origin) => {
        const res = await call({ Origin: origin });
        expect(res.status).toBe(200);
        expect(handlerCalls).toBe(1);
    });
});
