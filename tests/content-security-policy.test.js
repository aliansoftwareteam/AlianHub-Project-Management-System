const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const csp = require('../Config/contentSecurityPolicy');
const { install } = require('../Config/securityHeaders');

const BETA_HELMET_HEADERS = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'cross-origin',
    'origin-agent-cluster': '?1',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-download-options': 'noopen',
    'x-frame-options': 'SAMEORIGIN',
    'x-permitted-cross-domain-policies': 'none',
    'x-xss-protection': '0',
};
const TRANSPORT_HEADERS = ['accept-ranges', 'cache-control', 'connection', 'content-length', 'content-type', 'date', 'etag', 'keep-alive', 'last-modified'];
const ENFORCED = 'content-security-policy';
const REPORT_ONLY = 'content-security-policy-report-only';
const REPORTING_ENDPOINTS = 'reporting-endpoints';
const OWN_POLICY = "default-src 'none'";
const DIRECTIVES = ['default-src', 'script-src', 'style-src', 'img-src', 'media-src', 'font-src', 'connect-src', 'frame-src', 'worker-src', 'manifest-src',
    'frame-ancestors', 'base-uri', 'form-action', 'object-src', 'report-uri'];

const WASABI = { STORAGE_TYPE: 'wasabi', WASABIENDPOINT: 'https://s3.eu-central-1.wasabisys.com' };
const FIREBASE = { APIKEY: 'AIza-test', PROJECTID: 'push-project' };

let distDir;
const servers = [];

beforeAll(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 's8s12-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><div id="app"></div>');
});

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    fs.rmSync(distDir, { recursive: true, force: true });
});

const serve = async (env) => {
    const app = express();
    app.set('trust proxy', 'loopback');
    install(app, env);
    app.use(express.static(distDir));
    app.get('/api/v2/ping', (req, res) => res.json({ status: true }));
    app.get('/share/own-policy', (req, res) => res.set('Content-Security-Policy', OWN_POLICY).send('<p>shared</p>'));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return (route, headers) => fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers }).then((res) => Object.fromEntries(res.headers));
};

const securityHeaders = (headers) => Object.fromEntries(Object.entries(headers).filter(([name]) => !TRANSPORT_HEADERS.includes(name)));

const parse = (policy) => Object.fromEntries(policy.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
}));

const policyFor = (env) => parse(csp.policyOf({ CSP_MODE: 'enforce', ...env }));

describe('CSP_MODE off', () => {
    it.each([['unset', {}], ['empty', { CSP_MODE: '' }], ['off', { CSP_MODE: 'off' }], ['OFF', { CSP_MODE: ' OFF ' }]])('sends the headers beta sends for the app and for an API route (%s)', async (label, env) => {
        const get = await serve(env);
        expect(securityHeaders(await get('/'))).toEqual(BETA_HELMET_HEADERS);
        expect(securityHeaders(await get('/api/v2/ping'))).toEqual(BETA_HELMET_HEADERS);
    });

    it('still sends no helmet header when HELMET_ENABLED is false', async () => {
        const get = await serve({ HELMET_ENABLED: 'false' });
        expect(securityHeaders(await get('/api/v2/ping'))).toEqual({ 'x-powered-by': 'Express' });
    });

    it('has no middleware of its own', () => {
        expect(csp.middleware({})).toBeNull();
        expect(csp.headerOf({ CSP_MODE: 'off' })).toBeNull();
    });
});

describe.each([['report', REPORT_ONLY, ENFORCED], ['enforce', ENFORCED, REPORT_ONLY]])('CSP_MODE %s', (mode, sent, absent) => {
    it('sends the policy under the right header, on the app and on API routes, beside every helmet header', async () => {
        const get = await serve({ CSP_MODE: mode });
        for (const route of ['/', '/api/v2/ping']) {
            const headers = await get(route);
            expect(headers[sent]).toBe(csp.policyOf({ CSP_MODE: mode }));
            expect(headers[absent]).toBeUndefined();
            expect(headers).toMatchObject(BETA_HELMET_HEADERS);
        }
    });

    it('names the Reporting API endpoint over https only, because over http Chrome would then send no report at all', async () => {
        const get = await serve({ CSP_MODE: mode });
        const plain = await get('/');
        expect(plain[sent]).toContain('report-uri /api/v2/csp-report');
        expect(plain[sent]).not.toContain('report-to');
        expect(plain[REPORTING_ENDPOINTS]).toBeUndefined();

        const secure = await get('/', { 'x-forwarded-proto': 'https' });
        expect(secure[sent]).toBe(`${plain[sent]}; report-to csp-endpoint`);
        expect(secure[REPORTING_ENDPOINTS]).toBe('csp-endpoint="/api/v2/csp-report"');
        expect((await get('/'))[sent]).toBe(plain[sent]);
    });

    it('reads the mode whatever its case', () => {
        expect(csp.headerOf({ CSP_MODE: ` ${mode.toUpperCase()} ` }).name.toLowerCase()).toBe(sent);
    });

    it('leaves a route that sends its own policy with that policy alone', async () => {
        const get = await serve({ CSP_MODE: mode });
        const headers = await get('/share/own-policy');
        expect(headers[ENFORCED]).toBe(OWN_POLICY);
        expect(headers[REPORT_ONLY]).toBeUndefined();
    });
});

describe('the policy', () => {
    it('names every directive', () => {
        expect(Object.keys(policyFor({})).sort()).toEqual([...DIRECTIVES].sort());
    });

    it('falls back to the app itself and shuts the dangerous doors', () => {
        expect(policyFor({})).toMatchObject({
            'default-src': ["'self'"],
            'object-src': ["'none'"],
            'base-uri': ["'self'"],
            'frame-ancestors': ["'self'"],
            'form-action': ["'self'"],
            'manifest-src': ["'self'"],
            'report-uri': ['/api/v2/csp-report'],
        });
    });

    it.each([['no configuration', {}], ['everything configured', { ...WASABI, ...FIREBASE }]])('never allows eval or inline scripts, and allows inline for styles alone (%s)', (label, env) => {
        const policy = policyFor(env);
        expect(csp.policyOf({ CSP_MODE: 'enforce', ...env })).not.toMatch(/unsafe-eval|wasm-unsafe-eval|unsafe-hashes|strict-dynamic/);
        expect(policy['script-src']).not.toContain("'unsafe-inline'");
        expect(policy['default-src']).toEqual(["'self'"]);
        expect(Object.keys(policy).filter((name) => /^script-src-/.test(name))).toEqual([]);
        expect(Object.entries(policy).filter(([, sources]) => sources.includes("'unsafe-inline'")).map(([name]) => name)).toEqual(['style-src']);
    });

    it('allows scripts from the app and the exact files or folders the four loaders fetch', () => {
        expect(policyFor({})['script-src']).toEqual(["'self'", 'https://accounts.google.com/gsi/client', 'https://apis.google.com/js/api.js', 'https://apis.google.com/_/scs/',
            'https://www.dropbox.com/static/api/2/dropins.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/']);
    });

    it('names every third-party source with the path the app loads, never a bare host', () => {
        const bareHost = /^(https?|wss?):\/\/[^/]+$/;
        const configured = ['https://s3.eu-central-1.wasabisys.com', 'https://*.s3.eu-central-1.wasabisys.com', 'wss://hub.example.com'];
        const bare = Object.entries(policyFor({ ...WASABI, ...FIREBASE, WEBURL: 'https://hub.example.com' }))
            .flatMap(([name, sources]) => sources.filter((source) => bareHost.test(source) && !configured.includes(source)).map((source) => `${name} ${source}`));
        expect(bare).toEqual([]);
    });

    it('uses a scheme or a wildcard only where the inventory justifies one', () => {
        const broad = (sources) => sources.filter((source) => /^[a-z][a-z0-9+.-]*:$/.test(source) || source.includes('*'));
        const found = Object.fromEntries(Object.entries(policyFor(WASABI)).map(([name, sources]) => [name, broad(sources)]).filter(([, sources]) => sources.length));
        expect(found).toEqual({
            'img-src': ['data:', 'blob:', 'https:', 'https://*.s3.eu-central-1.wasabisys.com'],
            'media-src': ['blob:', 'https://*.s3.eu-central-1.wasabisys.com'],
            'font-src': ['data:'],
            'connect-src': ['https://*.s3.eu-central-1.wasabisys.com'],
            'frame-src': ['https:'],
            'worker-src': ['blob:'],
        });
    });
});

describe('hosts that come from configuration', () => {
    it('adds the object storage endpoint and its bucket subdomains when files live in object storage', () => {
        const policy = policyFor(WASABI);
        for (const name of ['img-src', 'media-src', 'connect-src']) {
            expect(policy[name]).toEqual(expect.arrayContaining(['https://s3.eu-central-1.wasabisys.com', 'https://*.s3.eu-central-1.wasabisys.com']));
        }
    });

    it('falls back to the default Wasabi endpoint, the one the storage client uses', () => {
        expect(policyFor({ STORAGE_TYPE: 'wasabi' })['connect-src']).toEqual(expect.arrayContaining(['https://s3.wasabisys.com', 'https://*.s3.wasabisys.com']));
        expect(policyFor({})['connect-src']).toEqual(expect.arrayContaining(['https://s3.wasabisys.com']));
    });

    it('keeps an http endpoint with its port, for a MinIO on the local network', () => {
        expect(policyFor({ STORAGE_TYPE: 'wasabi', WASABIENDPOINT: 'http://minio.internal:9000/' })['connect-src']).toEqual(expect.arrayContaining(['http://minio.internal:9000', 'http://*.minio.internal:9000']));
    });

    it('names no storage host when files live on the server', () => {
        expect(csp.policyOf({ CSP_MODE: 'enforce', STORAGE_TYPE: 'server', WASABIENDPOINT: 'https://s3.eu-central-1.wasabisys.com' })).not.toContain('eu-central-1');
    });

    it('allows the websocket of the configured web and API origins beside the page itself', () => {
        const connect = policyFor({ WEBURL: 'https://hub.example.com', APIURL: 'http://127.0.0.1:4000/' })['connect-src'];
        expect(connect).toEqual(expect.arrayContaining(["'self'", 'wss://hub.example.com', 'ws://127.0.0.1:4000']));
    });

    it('adds the Firebase hosts only when push is configured', () => {
        const hosts = ['https://firebaseinstallations.googleapis.com/v1/', 'https://fcmregistrations.googleapis.com/v1/'];
        expect(policyFor(FIREBASE)['connect-src']).toEqual(expect.arrayContaining(hosts));
        expect(policyFor(FIREBASE)['script-src']).toContain('https://www.gstatic.com/firebasejs/');
        expect(csp.policyOf({ CSP_MODE: 'enforce' })).not.toMatch(/firebase|gstatic\.com\/firebasejs/);
        expect(csp.policyOf({ CSP_MODE: 'enforce', APIKEY: 'placeholder' })).not.toMatch(/firebaseinstallations/);
    });

    it('always names the sign-in providers, which the console switches on without a restart', () => {
        const policy = policyFor({});
        expect(policy['connect-src']).toEqual(expect.arrayContaining(['https://api.github.com/user', 'https://api.github.com/user/emails', 'https://gitlab.com/api/v4/user', 'https://accounts.google.com/gsi/']));
        expect(policy['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com/css2', 'https://accounts.google.com/gsi/style']);
        expect(policy['font-src']).toEqual(["'self'", 'data:', 'https://fonts.gstatic.com/s/']);
    });

    it('drops a configured URL that is not one instead of writing it into the header', () => {
        const env = { CSP_MODE: 'enforce', WEBURL: 'not a url', STORAGE_TYPE: 'wasabi', WASABIENDPOINT: "https://x';script-src *" };
        expect(() => csp.policyOf(env)).not.toThrow();
        expect(csp.policyOf(env)).not.toMatch(/script-src \*|x'|not a url/);
    });

    it('reads the restart-only settings once the server is up, because saved instance settings are applied after the middleware is registered', async () => {
        const env = { CSP_MODE: 'report', STORAGE_TYPE: 'server' };
        const get = await serve(env);
        Object.assign(env, WASABI);
        expect((await get('/'))[REPORT_ONLY]).toContain('https://*.s3.eu-central-1.wasabisys.com');
        env.WASABIENDPOINT = 'https://later.example.com';
        env.APIKEY = 'AIza-later';
        const later = (await get('/'))[REPORT_ONLY];
        expect(later).not.toContain('later.example.com');
        expect(later).not.toContain('firebaseinstallations');
    });

    it('follows WEBURL and APIURL when the console changes them, without a restart', async () => {
        const env = { CSP_MODE: 'enforce', WEBURL: 'https://old.example.com', APIURL: 'https://old.example.com/' };
        const get = await serve(env);
        expect((await get('/'))[ENFORCED]).toContain('wss://old.example.com');
        env.WEBURL = 'https://new.example.com';
        env.APIURL = 'https://api.new.example.com/';
        const after = (await get('/'))[ENFORCED];
        expect(after).toContain('wss://new.example.com');
        expect(after).toContain('wss://api.new.example.com');
        expect(after).not.toContain('old.example.com');
    });

    it('gives the console the policy the server is sending, from the same cache', async () => {
        const env = { CSP_MODE: 'report', WEBURL: 'https://card.example.com', STORAGE_TYPE: 'server' };
        const get = await serve(env);
        const sent = (await get('/'))[REPORT_ONLY];
        Object.assign(env, WASABI);
        expect(csp.sentPolicy(env)).toBe(sent);
        env.WEBURL = 'https://card2.example.com';
        const next = (await get('/'))[REPORT_ONLY];
        expect(csp.sentPolicy(env)).toBe(next);
        expect(csp.sentPolicy(env, { reportingApi: true })).toBe(`${next}; report-to csp-endpoint`);
    });

    it('gives the console the policy it would send while the mode is off', () => {
        const env = { CSP_MODE: 'off', WEBURL: 'https://off.example.com' };
        expect(csp.sentPolicy(env)).toBe(csp.policyOf(env));
    });

    it('never takes a host from the request', async () => {
        const get = await serve({ CSP_MODE: 'enforce' });
        const headers = await get('/', { 'x-forwarded-host': 'evil.example', origin: 'https://evil.example', referer: 'https://evil.example/' });
        expect(headers[ENFORCED]).toBe(csp.policyOf({ CSP_MODE: 'enforce' }));
        expect(headers[ENFORCED]).not.toContain('evil.example');
    });
});

describe('CSP_EXTRA_<DIRECTIVE>', () => {
    it('adds hosts to the directive it names', () => {
        const policy = policyFor({ CSP_EXTRA_IMG_SRC: 'https://cdn.example.com', CSP_EXTRA_FRAME_ANCESTORS: ' https://intranet.example.com   https://*.portal.example.com:8443 ', CSP_EXTRA_CONNECT_SRC: 'wss://push.example.com' });
        expect(policy['img-src']).toContain('https://cdn.example.com');
        expect(policy['frame-ancestors']).toEqual(["'self'", 'https://intranet.example.com', 'https://*.portal.example.com:8443']);
        expect(policy['connect-src']).toContain('wss://push.example.com');
    });

    it('covers every directive that lists hosts', () => {
        expect(Object.keys(csp.EXTRA_ENV).sort()).toEqual(['connect-src', 'font-src', 'form-action', 'frame-ancestors', 'frame-src', 'img-src', 'media-src', 'script-src', 'style-src', 'worker-src']);
        for (const [directive, key] of Object.entries(csp.EXTRA_ENV)) {
            expect(key).toBe(`CSP_EXTRA_${directive.toUpperCase().replace(/-/g, '_')}`);
            expect(policyFor({ [key]: 'https://extra.example.com' })[directive]).toContain('https://extra.example.com');
        }
    });

    it.each([
        ['a quote', "'unsafe-inline'"],
        ["'unsafe-eval'", "'unsafe-eval'"],
        ['unsafe-eval without its quotes', 'unsafe-eval'],
        ['a semicolon', 'https://cdn.example.com; script-src *'],
        ['a comma', 'https://a.example.com,https://b.example.com'],
        ['a bare wildcard', '*'],
        ['a scheme on its own', 'https:'],
        ['a data: source', 'data:'],
        ['a nonce', "'nonce-abc'"],
        ['a line break', 'https://cdn.example.com\nX-Injected: 1'],
        ['a wildcard inside the host', 'https://cdn.*.example.com'],
    ])('refuses %s when the server starts, and says which variable', (label, value) => {
        const env = { CSP_MODE: 'report', CSP_EXTRA_SCRIPT_SRC: value };
        expect(() => install(express(), env)).toThrow(/CSP_EXTRA_SCRIPT_SRC/);
        expect(() => csp.policyOf(env)).toThrow(/CSP_EXTRA_SCRIPT_SRC/);
    });

    it.each([
        ['CSP_EXTRA_IMG_SRC', 'https://*.com', 'a wildcard over a whole top-level domain'],
        ['CSP_EXTRA_CONNECT_SRC', 'wss://*.io', 'a wildcard over a whole top-level domain'],
        ['CSP_EXTRA_FRAME_SRC', 'https://*.co.uk', 'a wildcard over a public suffix'],
        ['CSP_EXTRA_MEDIA_SRC', 'https://*.com.au:8443', 'a wildcard over a public suffix'],
        ['CSP_EXTRA_IMG_SRC', 'https://*.github.io', 'a wildcard over shared hosting'],
        ['CSP_EXTRA_FRAME_ANCESTORS', 'https://*.herokuapp.com', 'a wildcard over shared hosting'],
        ['CSP_EXTRA_SCRIPT_SRC', 'http://cdn.example.com', 'plain http in a script directive'],
        ['CSP_EXTRA_WORKER_SRC', 'http://cdn.example.com/w.js', 'plain http in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://lh3.googleusercontent.com', 'a user-content host in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://*.googleusercontent.com', 'a user-content host in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://raw.githubusercontent.com/org/repo/', 'a user-content host in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://gist.githubusercontent.com', 'a user-content host in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://someone.github.io/lib.js', 'a user-content host in a script directive'],
        ['CSP_EXTRA_WORKER_SRC', 'https://cdn.jsdelivr.net', 'a whole package CDN in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://cdn.jsdelivr.net/', 'a whole package CDN in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://unpkg.com', 'a whole package CDN in a script directive'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://unpkg.com/', 'a whole package CDN in a script directive'],
    ])('refuses %s=%s (%s)', (key, value) => {
        expect(() => csp.policyOf({ CSP_MODE: 'report', [key]: value })).toThrow(new RegExp(key));
    });

    it.each([
        ['CSP_EXTRA_IMG_SRC', 'https://*.example.com'],
        ['CSP_EXTRA_IMG_SRC', 'http://cdn.example.com'],
        ['CSP_EXTRA_IMG_SRC', 'https://lh3.googleusercontent.com'],
        ['CSP_EXTRA_FRAME_SRC', 'https://someone.github.io'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://*.cdn.example.com'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/'],
        ['CSP_EXTRA_SCRIPT_SRC', 'https://unpkg.com/htmx.org@2.0.0/dist/htmx.min.js'],
        ['CSP_EXTRA_CONNECT_SRC', 'https://*.example.co.uk'],
    ])('accepts %s=%s', (key, value) => {
        expect(() => csp.policyOf({ CSP_MODE: 'report', [key]: value })).not.toThrow();
    });

    it('refuses a bad extra even while the policy is off, so turning it on later cannot fail', () => {
        expect(() => install(express(), { CSP_EXTRA_IMG_SRC: "'unsafe-eval'" })).toThrow(/CSP_EXTRA_IMG_SRC/);
    });

    it('refuses a mode it does not know instead of reading it as off', () => {
        expect(() => install(express(), { CSP_MODE: 'enforced' })).toThrow(/CSP_MODE.*off, report or enforce/);
    });
});
