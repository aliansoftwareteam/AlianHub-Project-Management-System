const fs = require('fs');
const path = require('path');
const express = require('express');

const csp = require('../Config/contentSecurityPolicy');
const { install } = require('../Config/securityHeaders');

const PAGE = '/pickers/google-drive';
const SCRIPT = '/pickers/google-drive.js';
const ENFORCED = 'content-security-policy';
const REPORT_ONLY = 'content-security-policy-report-only';
const STATIC_DIR = path.join(__dirname, '..', 'Modules', 'Pickers', 'static');

const servers = [];

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

const serve = async (env) => {
    const app = express();
    install(app, env);
    require('../Modules/Pickers/init').init(app, env);
    app.get('/', (req, res) => res.send('<!doctype html><div id="app"></div>'));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return async (route, headers = {}) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers });
        return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text(), cookies: res.headers.getSetCookie() };
    };
};

const parse = (policy) => Object.fromEntries(String(policy).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
}));

const PICKER_DIRECTIVES = {
    'default-src': ["'none'"],
    'script-src': ["'self'", 'https://apis.google.com/js/api.js', 'https://apis.google.com/_/scs/', "'unsafe-eval'"],
    'style-src': ["'unsafe-inline'"],
    'frame-src': ['https://docs.google.com/'],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'base-uri': ["'none'"],
    'object-src': ["'none'"],
};

describe.each([['off', {}], ['report', { CSP_MODE: 'report' }], ['enforce', { CSP_MODE: 'enforce' }]])('the Drive picker page with CSP_MODE %s', (mode, env) => {
    it('is served with its own enforced policy and no report-only policy', async () => {
        const res = await (await serve(env))(PAGE);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^text\/html/);
        expect(res.headers[REPORT_ONLY]).toBeUndefined();
        const { 'report-uri': reportUri, ...directives } = parse(res.headers[ENFORCED]);
        expect(directives).toEqual(PICKER_DIRECTIVES);
        expect(reportUri).toEqual(mode === 'off' ? undefined : ['/api/v2/csp-report']);
        expect(res.headers[ENFORCED]).toBe(csp.drivePickerPolicy(env));
    });

    it('cannot be framed, is never cached and keeps the opener relationship', async () => {
        const res = await (await serve(env))(PAGE);
        expect(parse(res.headers[ENFORCED])['frame-ancestors']).toEqual(["'none'"]);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('needs no session and sets no cookie', async () => {
        const get = await serve(env);
        for (const route of [PAGE, SCRIPT]) {
            const anonymous = await get(route);
            expect(anonymous.status).toBe(200);
            expect(anonymous.cookies).toEqual([]);
            const withCookie = await get(route, { cookie: 'accessToken=abc; refreshToken=def' });
            expect(withCookie.cookies).toEqual([]);
            expect(withCookie.body).toBe(anonymous.body);
        }
    });

    it('serves its script as a script, never cached', async () => {
        const res = await (await serve(env))(SCRIPT);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/^application\/javascript/);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toBe(fs.readFileSync(path.join(STATIC_DIR, 'google-drive.js'), 'utf8'));
    });
});

describe('the Drive picker page itself', () => {
    const html = () => fs.readFileSync(path.join(STATIC_DIR, 'google-drive.html'), 'utf8');
    const script = () => fs.readFileSync(path.join(STATIC_DIR, 'google-drive.js'), 'utf8');

    it('loads its one script from a file and has no inline script or handler', () => {
        const scripts = html().match(/<script\b[^>]*>/gi) || [];
        expect(scripts).toEqual([`<script src="${SCRIPT}">`]);
        expect(html()).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
        expect(html()).not.toMatch(/\son[a-z]+\s*=/i);
    });

    it('carries no app bundle', () => {
        expect(html()).not.toMatch(/\/js\/(app|chunk-vendors)|\.css"/);
    });

    it('never reads cookies or browser storage', () => {
        expect(script()).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/);
    });

    it('loads the Google script its policy names, and nothing else from outside', () => {
        const hosts = script().match(/https:\/\/[^'"`\s]+/g) || [];
        expect(hosts).toEqual(['https://apis.google.com/js/api.js']);
        expect(csp.drivePickerPolicy({})).toContain(hosts[0]);
    });

});

describe('the app policy once the picker has its own page', () => {
    it.each(['report', 'enforce'])('still has no eval and no Google picker script in %s mode', async (mode) => {
        const res = await (await serve({ CSP_MODE: mode }))('/');
        const policy = res.headers[mode === 'report' ? REPORT_ONLY : ENFORCED];
        expect(policy).toBe(csp.policyOf({ CSP_MODE: mode }));
        expect(policy).not.toMatch(/unsafe-eval/);
        expect(policy).not.toContain('apis.google.com');
        expect(policy).not.toContain('docs.google.com');
    });

    it('keeps the picker hosts out of every app directive, however the instance is configured', () => {
        const policy = csp.policyOf({ CSP_MODE: 'enforce', STORAGE_TYPE: 'wasabi', APIKEY: 'AIza-test', WEBURL: 'https://hub.example.com' });
        expect(policy).not.toMatch(/apis\.google\.com|docs\.google\.com|unsafe-eval/);
    });
});
