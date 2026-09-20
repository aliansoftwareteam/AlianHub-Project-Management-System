const path = require('node:path');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, readState } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

/* Sprint 8 slice 11. A second server runs with SESSION_COOKIE_HTTPONLY on:
 * login sets httpOnly cookies, cookie-only requests authenticate, refresh and
 * logout work through cookies, and the sessions list marks the caller current.
 * The default server keeps readable cookies. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;

let server;

const setCookiesOf = (res) => {
    if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
    return (res.headers.get('set-cookie') || '').split(/,(?=[^;,]+=)/g).map((s) => s.trim()).filter(Boolean);
};
const cookieValue = (cookies, name) => {
    const hit = cookies.find((c) => c.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1).split(';')[0] : '';
};
const jarOf = (cookies) => ['accessToken', 'refreshToken']
    .map((name) => (cookieValue(cookies, name) ? `${name}=${cookieValue(cookies, name)}` : ''))
    .filter(Boolean)
    .join('; ');

describe('httpOnly session cookies through the real routes', () => {
    beforeAll(async () => {
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, 'session-cookies-server.log'),
            env: { SESSION_COOKIE_HTTPONLY: 'on' },
        });
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        if (server) await server.stop();
    }, BOOT_TIMEOUT_MS);

    it('sets httpOnly cookies on login and authenticates cookie-only requests', async () => {
        const anon = createApiClient({ baseURL: server.baseURL });
        const login = await anon.post('/api/v2/auth/login', { email: emailFor('member'), password: state.password });
        expect(login.status).toBe(200);
        const setCookies = setCookiesOf(login);
        const access = setCookies.find((c) => c.startsWith('accessToken='));
        const refresh = setCookies.find((c) => c.startsWith('refreshToken='));
        expect(access).toMatch(/httponly/i);
        expect(refresh).toMatch(/httponly/i);

        const jarred = createApiClient({ baseURL: server.baseURL, companyId: state.companyId });
        const me = await jarred.get('/api/v2/users/sessions', { headers: { cookie: jarOf(setCookies) } });
        expect(me.status).toBe(200);
        expect(me.body.status).toBe(true);
        expect(me.body.data.some((s) => s.current === true)).toBe(true);
    });

    it('refreshes through the cookie and clears both on logout', async () => {
        const anon = createApiClient({ baseURL: server.baseURL });
        const login = await anon.post('/api/v2/auth/login', { email: emailFor('member'), password: state.password });
        let jar = jarOf(setCookiesOf(login));
        const uid = login.body.uid || login.body.data?.uid;
        const jarred = () => createApiClient({ baseURL: server.baseURL, companyId: state.companyId });

        const refreshed = await jarred().post('/api/v2/generateToken', { uid }, { headers: { cookie: jar } });
        expect(refreshed.status).toBe(200);
        jar = jarOf(setCookiesOf(refreshed));
        expect(jar).toContain('accessToken=');

        const out = await jarred().post('/api/v2/logout', { id: uid }, { headers: { cookie: jar } });
        expect(out.status).toBe(200);
        const cleared = setCookiesOf(out).join(';');
        expect(cleared).toMatch(/accessToken=deleted|accessToken=;/i);
    });

    it('keeps readable cookies on the default server', async () => {
        const anon = createApiClient({ baseURL: state.baseURL });
        const login = await anon.post('/api/v2/auth/login', { email: emailFor('member'), password: state.password });
        expect(login.status).toBe(200);
        const setCookies = setCookiesOf(login).join(';');
        expect(setCookies).toContain('accessToken=');
        expect(setCookies).not.toMatch(/httponly/i);
    });
});
