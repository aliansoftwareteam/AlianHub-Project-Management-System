const crypto = require('node:crypto');
const path = require('node:path');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, readState } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const HINT_DOMAIN = 'alianhub.com';
const WORKSPACE_HOST = `abb.${HINT_DOMAIN}`;
const CUSTOM_HOST = 'pm.abb.com';
const FOUR_HUNDRED_DAYS_S = 400 * 24 * 60 * 60;

/* Port 9 (discard) refuses at once, so the entitlements pull at boot fails fast and the defaults apply. */
const managedEnv = () => ({
    HOSTING_MODE: 'managed',
    INSTANCE_ID: `ins_${crypto.randomBytes(12).toString('hex')}`,
    PLATFORM_API_KEY: crypto.randomBytes(32).toString('hex'),
    PLATFORM_PUBLIC_KEY: crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
    PLATFORM_URL: 'https://127.0.0.1:9',
    WEBURL: `https://${WORKSPACE_HOST}`,
});

const setCookieOf = (res, name) => res.headers.getSetCookie().filter((line) => line.startsWith(`${name}=`));

const parsed = (line) => {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const value = decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
    const named = Object.fromEntries(attributes.map((attribute) => {
        const [key, setting = true] = attribute.split('=');
        return [key.toLowerCase(), setting];
    }));
    return { value, attributes: named };
};

const hintOf = (res) => {
    const lines = setCookieOf(res, 'ah_ws');
    expect(lines).toHaveLength(1);
    return parsed(lines[0]);
};

const withServer = (name, env, body) => () => {
    let server;
    beforeAll(async () => {
        server = await startServer({
            mongoUrl: resolveMongoUrl(),
            logFile: path.join(STATE_DIR, `workspace-hint-${name}-server.log`),
            env: { NODE_ENV: 'production', SESSION_COOKIE_HTTPONLY: 'on', WORKSPACE_HINT_DOMAIN: HINT_DOMAIN, ...env() },
        });
    }, BOOT_TIMEOUT_MS);
    afterAll(async () => {
        if (server) await server.stop();
    }, BOOT_TIMEOUT_MS);

    const call = (urlPath, payload, { host, cookie }) => createApiClient({ baseURL: server.baseURL, companyId: state.companyId })
        .post(urlPath, payload, { headers: { 'x-forwarded-host': host, ...(cookie ? { cookie } : {}) } });
    const signIn = (host, { cookie, password = state.password } = {}) => call('/api/v2/auth/login', { email: emailFor('member'), password }, { host, cookie });
    const signOut = async (host, { hint }) => {
        const session = await signIn(host);
        expect(session.status).toBe(200);
        const jar = ['accessToken', 'refreshToken'].map((cookieName) => setCookieOf(session, cookieName)[0].split(';')[0]);
        const out = await call('/api/v2/logout', { id: session.body.uid }, { host, cookie: [...jar, `ah_ws=${hint}`].join('; ') });
        expect(out.status).toBe(200);
        return out;
    };
    body({ signIn, signOut });
};

describe('ah_ws on a managed workspace under the hint domain', withServer('managed', managedEnv, ({ signIn, signOut }) => {
    it('is set on sign-in: the label only, HttpOnly, Secure, Lax, on the parent domain and the whole site', async () => {
        const res = await signIn(WORKSPACE_HOST);
        expect(res.status).toBe(200);
        const { value, attributes } = hintOf(res);
        expect(value).toBe('abb');
        expect(attributes).toEqual({
            'max-age': String(FOUR_HUNDRED_DAYS_S),
            domain: HINT_DOMAIN,
            path: '/',
            expires: expect.any(String),
            httponly: true,
            secure: true,
            samesite: 'Lax',
        });
    });

    it('leaves the session cookies on the workspace host', async () => {
        const res = await signIn(WORKSPACE_HOST);
        for (const name of ['accessToken', 'refreshToken']) {
            expect(parsed(setCookieOf(res, name)[0]).attributes).toMatchObject({ domain: WORKSPACE_HOST, samesite: 'Strict' });
        }
    });

    it('puts the workspace first, keeps four others and drops anything that is not a label', async () => {
        const res = await signIn(WORKSPACE_HOST, { cookie: 'ah_ws=one%2Ctwo%2C<script>%2Cpat%40abb.com%2Cthree%2Cfour%2Cfive' });
        expect(hintOf(res).value).toBe('abb,one,two,three,four');
    });

    it('is not written by a refused sign-in', async () => {
        const res = await signIn(WORKSPACE_HOST, { password: `${state.password}-wrong` });
        expect(res.body.accessToken).toBeUndefined();
        expect(setCookieOf(res, 'ah_ws')).toEqual([]);
    });

    it('loses this workspace on sign-out and keeps the others', async () => {
        const { value, attributes } = hintOf(await signOut(WORKSPACE_HOST, { hint: 'abb%2Cxyz' }));
        expect(value).toBe('xyz');
        expect(attributes).toMatchObject({ domain: HINT_DOMAIN, path: '/', httponly: true, secure: true, samesite: 'Lax' });
    });

    it('is removed on sign-out when no other workspace is left', async () => {
        const { value, attributes } = hintOf(await signOut(WORKSPACE_HOST, { hint: 'abb' }));
        expect(value).toBe('');
        expect(attributes).toMatchObject({ domain: HINT_DOMAIN, path: '/' });
        expect(new Date(attributes.expires).getTime()).toBeLessThan(Date.now());
    });

    it('is neither set nor changed on a custom domain', async () => {
        const res = await signIn(CUSTOM_HOST, { cookie: 'ah_ws=xyz' });
        expect(res.status).toBe(200);
        expect(setCookieOf(res, 'ah_ws')).toEqual([]);
        expect(setCookieOf(await signOut(CUSTOM_HOST, { hint: 'abb%2Cxyz' }), 'ah_ws')).toEqual([]);
    });
}));

describe('ah_ws on a self-hosted server', withServer('self', () => ({}), ({ signIn, signOut }) => {
    it('is never written, even under the hint domain', async () => {
        const res = await signIn(WORKSPACE_HOST);
        expect(res.status).toBe(200);
        expect(setCookieOf(res, 'ah_ws')).toEqual([]);
        expect(setCookieOf(await signOut(WORKSPACE_HOST, { hint: 'abb' }), 'ah_ws')).toEqual([]);
    });
}));
