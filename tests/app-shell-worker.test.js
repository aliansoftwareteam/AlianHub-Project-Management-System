const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const express = require('express');

const shellWorker = require('../Config/appShellWorker');
const securityHeaders = require('../Config/securityHeaders');
const csp = require('../Config/contentSecurityPolicy');
const rules = require('../frontend/src/serviceWorker/rules');

const ROOT = path.resolve(__dirname, '..');
const BUILT_WORKER = 'const SHELL = {"version":"build-1","hashed":[],"plain":["/index.html"]};';

let distDir;
let emptyDir;
const servers = [];

beforeAll(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-shell-dist-'));
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-shell-empty-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><div id="app"></div>');
    fs.writeFileSync(path.join(distDir, 'sw.js'), BUILT_WORKER);
    fs.mkdirSync(path.join(distDir, 'js'));
    fs.writeFileSync(path.join(distDir, 'js', 'app.19d59917.js'), 'console.log(1)');
});

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
});

const serve = async (env = {}, dir = distDir) => {
    const app = express();
    securityHeaders.install(app, env);
    shellWorker.install(app, dir, env);
    app.use(express.static(dir));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return async (route) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
        return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
    };
};

describe('GET /sw.js', () => {
    it('serves the worker of the build, checked against the server on every load, for the whole site', async () => {
        const get = await serve();
        const res = await get('/sw.js');
        expect(res.status).toBe(200);
        expect(res.body).toBe(BUILT_WORKER);
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers['service-worker-allowed']).toBe('/');
        expect(res.headers['content-type']).toMatch(/^text\/javascript/);
    });

    it('sends the instance\'s content security policy with it, since a worker runs under the policy it was served with', async () => {
        const get = await serve({ CSP_MODE: 'enforce' });
        const res = await get('/sw.js');
        expect(res.headers['content-security-policy']).toBe(csp.policyOf({ CSP_MODE: 'enforce' }));
    });

    it('is a 404 when the build has no worker, as on a checkout that was never built', async () => {
        const get = await serve({}, emptyDir);
        expect((await get('/sw.js')).status).toBe(404);
    });

    it('leaves the other files of the build to the static handler', async () => {
        const get = await serve();
        const res = await get('/js/app.19d59917.js');
        expect(res.status).toBe(200);
        expect(res.headers['service-worker-allowed']).toBeUndefined();
    });

    it('is registered ahead of the static handler in index.js', () => {
        const source = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
        const worker = source.indexOf("require('./Config/appShellWorker').install(");
        expect(worker).toBeGreaterThan(-1);
        expect(worker).toBeLessThan(source.indexOf('app.use(express.static('));
        expect(worker).toBeGreaterThan(source.indexOf("require('./Config/securityHeaders').install(app)"));
    });
});

describe('APP_SHELL_WORKER=off', () => {
    it.each(['off', 'OFF', ' false ', '0', 'no', 'disabled'])('reads %j as withdrawn', (value) => {
        expect(shellWorker.isWithdrawn({ APP_SHELL_WORKER: value })).toBe(true);
    });

    it.each([undefined, '', 'on', 'true', '1'])('reads %j as in service', (value) => {
        expect(shellWorker.isWithdrawn({ APP_SHELL_WORKER: value })).toBe(false);
    });

    it('answers /sw.js with the withdrawal worker, with the same headers, whether or not a build exists', async () => {
        for (const dir of [distDir, emptyDir]) {
            const get = await serve({ APP_SHELL_WORKER: 'off' }, dir);
            const res = await get('/sw.js');
            expect(res.status).toBe(200);
            expect(res.body).toBe(shellWorker.WITHDRAWAL_WORKER);
            expect(res.headers['cache-control']).toBe('no-cache');
            expect(res.headers['content-type']).toMatch(/^text\/javascript/);
        }
    });

    it('follows the setting on each request, without a rebuild', async () => {
        const env = {};
        const get = await serve(env);
        expect((await get('/sw.js')).body).toBe(BUILT_WORKER);
        env.APP_SHELL_WORKER = 'off';
        expect((await get('/sw.js')).body).toBe(shellWorker.WITHDRAWAL_WORKER);
    });

    describe('the withdrawal worker', () => {
        const run = async () => {
            const listeners = {};
            const held = new Set(['ah-shell-build-1', 'ah-runtime-v1', 'anything-else']);
            const scope = {
                skipWaiting: jest.fn(),
                registration: { unregister: jest.fn().mockResolvedValue(true) },
                addEventListener: (type, handler) => { listeners[type] = handler; },
            };
            vm.runInContext(shellWorker.WITHDRAWAL_WORKER, vm.createContext({ self: scope, caches: { keys: async () => [...held], delete: async (name) => held.delete(name) } }));
            listeners.install({});
            const waited = [];
            listeners.activate({ waitUntil: (promise) => waited.push(promise) });
            await Promise.all(waited);
            return { listeners, held, scope };
        };

        it('takes over at once, deletes every cache and unregisters itself', async () => {
            const { held, scope } = await run();
            expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
            expect([...held]).toEqual([]);
            expect(scope.registration.unregister).toHaveBeenCalledTimes(1);
        });

        it('handles no request and no message', async () => {
            const { listeners } = await run();
            expect(Object.keys(listeners).sort()).toEqual(['activate', 'install']);
        });
    });
});

describe('the content security policy the worker and the manifest fall under', () => {
    const policy = csp.buildDirectives({});

    it('lets workers and the manifest come from the app itself, and adds no other origin for either', () => {
        expect(policy['worker-src']).toEqual(["'self'", 'blob:']);
        expect(policy['manifest-src']).toEqual(["'self'"]);
    });

    it('lets the worker fetch the files of the build, which are on the app\'s own origin', () => {
        expect(policy['connect-src']).toContain("'self'");
    });
});

describe('paths the server answers itself', () => {
    const walk = (dir, out = []) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, out);
            else if (entry.name.endsWith('.js')) out.push(full);
        }
        return out;
    };
    const ROUTE = /\b(?:app|router)\.(?:get|post|put|patch|delete|all|use)\(\s*['"`]\/([^/'"`\s:*(]+)/g;
    const served = () => {
        const segments = new Set();
        for (const file of [path.join(ROOT, 'index.js'), ...walk(path.join(ROOT, 'Modules')), ...walk(path.join(ROOT, 'Config'))]) {
            for (const match of fs.readFileSync(file, 'utf8').matchAll(ROUTE)) segments.add(match[1].toLowerCase());
        }
        return [...segments].sort();
    };

    it('are found by the scan', () => {
        expect(served()).toEqual(expect.arrayContaining(['api', 'share', 'form', 'oauth', 'health', 'version']));
    });

    it('are all on the list of paths the worker never handles, so a new server-rendered page is covered when it is added', () => {
        expect(served().filter((segment) => !rules.RESERVED_SEGMENTS.includes(segment))).toEqual([]);
    });

    it('include everything the SPA fallback reserves', () => {
        const { RESERVED } = require('../Config/spaFallback');
        for (const sample of ['/api/x', '/mcp', '/mcp/x', '/scim/x', '/socket.io/x', '/health', '/version']) {
            expect(RESERVED.test(sample)).toBe(true);
            expect(rules.routeFor({ method: 'GET', url: `https://hub.example.com${sample}`, mode: 'navigate', headers: {} }, { origin: 'https://hub.example.com', precached: new Set() })).toBe(rules.ROUTE.NETWORK);
        }
    });
});
