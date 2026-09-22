const { readState } = require('../../e2e/support/fixtures');

/* Follow-up 99: a refused Origin is answered 403, through the real app. Every case here is
 * anonymous and touches no collection, so it is safe beside the rest of the shared workspace. */

const state = readState();
const FOREIGN = 'https://evil.cors99.example';
const HEALTH = '/health';
const MCP = '/mcp';

const call = (route, { origin, method = 'GET', headers = {} } = {}) => fetch(state.baseURL + route, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...headers },
});

describe('a foreign Origin', () => {
    test('is refused with 403 and the app error shape, without CORS headers', async () => {
        const res = await call(HEALTH, { origin: FOREIGN });
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
        expect(await res.json()).toMatchObject({ status: false, statusText: expect.any(String), message: expect.any(String) });
    });

    test('is refused on the mcp transport before any credential is read', async () => {
        const res = await call(MCP, {
            origin: FOREIGN,
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        });
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    test('is refused on preflight', async () => {
        const res = await call(MCP, { origin: FOREIGN, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
        expect(res.status).toBe(403);
        expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
});

describe('the origins the app itself uses', () => {
    test('a request with no Origin still answers normally', async () => {
        const res = await call(HEALTH);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: 'ok' });
    });

    test('the configured web origin still gets its CORS headers', async () => {
        const res = await call(HEALTH, { origin: state.baseURL });
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe(state.baseURL);
    });

    test('its preflight still answers with the allowed methods', async () => {
        const res = await call(MCP, { origin: state.baseURL, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
        expect(res.status).toBeLessThan(300);
        expect(res.headers.get('access-control-allow-origin')).toBe(state.baseURL);
    });

    test('the desktop client origin still works', async () => {
        const res = await call(HEALTH, { origin: 'app://.' });
        expect(res.status).toBe(200);
    });
});
