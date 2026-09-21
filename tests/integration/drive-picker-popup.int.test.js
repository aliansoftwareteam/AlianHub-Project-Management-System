const path = require('node:path');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { readState } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const csp = require('../../Config/contentSecurityPolicy');

/* Sprint 8 (task 031): the Google Drive picker runs in its own page with its own policy, through the real app. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const PAGE = '/pickers/google-drive';
const SCRIPT = '/pickers/google-drive.js';
const ENFORCED = 'content-security-policy';
const REPORT_ONLY = 'content-security-policy-report-only';

const get = async (baseURL, route, headers) => {
    const res = await fetch(baseURL + route, { headers });
    return { status: res.status, headers: Object.fromEntries(res.headers), cookies: res.headers.getSetCookie(), body: await res.text() };
};

const startWith = (label, env) => startServer({ mongoUrl: resolveMongoUrl(), logFile: path.join(STATE_DIR, `drive-picker-${label}-server.log`), env });

describe('CSP_MODE unset, the harness server', () => {
    it('serves the picker page with its own policy, without a session', async () => {
        const res = await get(state.baseURL, PAGE);
        expect(res.status).toBe(200);
        expect(res.headers[ENFORCED]).toBe(csp.drivePickerPolicy({}));
        expect(res.headers[REPORT_ONLY]).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.cookies).toEqual([]);
        expect(res.body).toContain(`<script src="${SCRIPT}">`);
    });

    it('does not hand the picker page to the app shell', async () => {
        const res = await get(state.baseURL, PAGE);
        expect(res.body).not.toContain('<div id="app">');
    });
});

describe.each([['report', REPORT_ONLY], ['enforce', ENFORCED]])('CSP_MODE=%s', (mode, appHeader) => {
    let server;

    beforeAll(async () => { server = await startWith(mode, { CSP_MODE: mode }); }, BOOT_TIMEOUT_MS);
    afterAll(async () => { if (server) await server.stop(); }, BOOT_TIMEOUT_MS);

    it('sends the picker page its own enforced policy in place of the app policy', async () => {
        const res = await get(server.baseURL, PAGE);
        expect(res.status).toBe(200);
        expect(res.headers[ENFORCED]).toBe(csp.drivePickerPolicy({ CSP_MODE: mode }));
        expect(res.headers[REPORT_ONLY]).toBeUndefined();
        expect(res.headers[ENFORCED]).toContain("'unsafe-eval'");
        expect(res.headers[ENFORCED]).toContain("frame-ancestors 'none'");
        expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
        expect(res.headers['cache-control']).toBe('no-store');
    });

    it('needs no session cookie and sets none', async () => {
        const anonymous = await get(server.baseURL, PAGE);
        const withCookie = await get(server.baseURL, PAGE, { cookie: 'accessToken=abc; refreshToken=def' });
        expect(anonymous.cookies).toEqual([]);
        expect(withCookie.cookies).toEqual([]);
        expect((await get(server.baseURL, SCRIPT)).status).toBe(200);
    });

    it('keeps eval and the picker hosts out of the app policy', async () => {
        const res = await get(server.baseURL, '/');
        expect(res.headers[appHeader]).toBeDefined();
        expect(res.headers[appHeader]).not.toMatch(/unsafe-eval|apis\.google\.com|docs\.google\.com/);
    });
});
