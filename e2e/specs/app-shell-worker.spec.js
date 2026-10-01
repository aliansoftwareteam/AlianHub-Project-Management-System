const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { test, expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONT = path.join(ROOT, 'frontend');
const webpack = require(path.join(FRONT, 'node_modules', 'webpack'));
const HtmlWebpackPlugin = require(path.join(FRONT, 'node_modules', 'html-webpack-plugin'));
const { ShellWorkerPlugin } = require(path.join(FRONT, 'shellWorkerPlugin.js'));
const shellWorker = require(path.join(ROOT, 'Config', 'appShellWorker'));
const securityHeaders = require(path.join(ROOT, 'Config', 'securityHeaders'));

/* The worker's whole life in a real browser, against a page of a few lines that registers it with the
 * app's own registration code. It needs neither the app's build nor its server, so it can also say
 * what a second and a third build do, and what withdrawing the worker does. */

const REGISTRATION = path.join(FRONT, 'src', 'serviceWorker', 'registration.js');
const ICON = path.join(FRONT, 'public', 'icons', 'icon-192.png');
const IMAGE = '/img/mark.0a1b2c3d.png';

let workDir;
let dist;
let server;
let origin;
const env = { CSP_MODE: 'enforce' };

class PublicFiles {
    apply(compiler) {
        const { Compilation, sources } = compiler.webpack;
        compiler.hooks.thisCompilation.tap('PublicFiles', (compilation) => {
            compilation.hooks.processAssets.tap({ name: 'PublicFiles', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
                compilation.emitAsset('manifest.webmanifest', new sources.RawSource('{"name":"shell"}'));
                compilation.emitAsset('icons/icon-192.png', new sources.RawSource(fs.readFileSync(ICON)));
                compilation.emitAsset(IMAGE.slice(1), new sources.RawSource(fs.readFileSync(ICON)), { immutable: true });
            });
        });
    }
}

const build = (number) => new Promise((resolve, reject) => {
    const src = path.join(workDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>shell</title></head><body><div id="app"></div></body></html>');
    fs.writeFileSync(path.join(src, 'lazy.js'), `export const lazy = 'lazy chunk of build ${number}';`);
    fs.writeFileSync(path.join(src, 'login.js'), `export const signIn = 'sign-in page of build ${number}';`);
    fs.writeFileSync(path.join(src, 'main.js'), `
import { registerShellWorker, updateReady, applyUpdate, dropWorkerRuntimeCaches } from ${JSON.stringify(REGISTRATION)};
window.shell = { updateReady, applyUpdate, dropWorkerRuntimeCaches, build: ${number} };
document.getElementById('app').textContent = 'build ${number}';
window.loadLazy = () => import('./lazy.js').then((module) => module.lazy);
window.loadSignIn = () => import(/* webpackChunkName: "login" */ './login.js').then((module) => module.signIn);
window.registered = registerShellWorker(window, { production: true }).then((registration) => { window.shellRegistration = registration; return Boolean(registration); });
`);
    fs.rmSync(dist, { recursive: true, force: true });
    webpack({
        mode: 'production',
        context: src,
        entry: { app: './main.js' },
        output: { path: dist, filename: 'js/[name].[contenthash:8].js', chunkFilename: 'js/[name].[contenthash:8].js', publicPath: '/' },
        resolve: { modules: [path.join(FRONT, 'node_modules')] },
        performance: false,
        plugins: [new HtmlWebpackPlugin({ template: path.join(src, 'index.html'), filename: 'index.html' }), new PublicFiles(), new ShellWorkerPlugin({ firstPaintChunks: ['login'] })],
    }, (error, stats) => (error || stats.hasErrors() ? reject(error || new Error(stats.toString('errors-only'))) : resolve()));
});

test.beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-shell-e2e-'));
    dist = path.join(workDir, 'dist');
    await build(1);

    const app = express();
    let pings = 0;
    let shares = 0;
    securityHeaders.install(app, env);
    shellWorker.install(app, dist, env);
    app.use(express.static(dist));
    app.get('/api/v2/ping', (req, res) => res.json({ n: ++pings }));
    app.get('/share/:token', (req, res) => res.send(`<!doctype html><title>shared</title><p id="n">${++shares}</p>`));
    server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => { server.close(resolve); });
    }
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

const held = (page) => page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
    }
    return out;
});
const cacheNames = async (page) => Object.keys(await held(page)).sort();
const buildCaches = async (page) => (await cacheNames(page)).filter((name) => name.startsWith('ah-shell-'));
const shown = (page) => page.locator('#app').textContent();
const ping = (page) => page.evaluate(() => fetch('/api/v2/ping').then((res) => res.json()).then((body) => body.n));

test('the worker installs, keeps other files on first use, stays out of what is not the build, survives no network, updates on request and can be withdrawn', async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    const violations = [];
    page.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });

    await test.step('first visit: what a first paint needs is held and no more, and the open tab is left alone', async () => {
        await page.goto(`${origin}/`);
        await expect(page.locator('#app')).toHaveText('build 1');
        expect(await page.evaluate(() => window.registered.then(() => navigator.serviceWorker.ready).then((registration) => registration.active.scriptURL))).toBe(`${origin}/sw.js`);
        expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBe(null);

        const caches = await held(page);
        const [name] = Object.keys(caches).filter((cache) => cache.startsWith('ah-shell-'));
        expect(await buildCaches(page)).toHaveLength(1);
        expect(caches['ah-runtime-v1'] || []).toEqual([]);
        expect(name).toMatch(/^ah-shell-[0-9a-f]{16}$/);
        expect(caches[name].filter((file) => /^\/js\/(app|login)\.[0-9a-f]{8}\.js$/.test(file))).toHaveLength(2);
        expect(caches[name].filter((file) => file.startsWith('/js/'))).toHaveLength(2);
        expect(caches[name]).toEqual(expect.arrayContaining(['/index.html', '/manifest.webmanifest', '/icons/icon-192.png']));
        expect(caches[name].filter((file) => /^\/img\/|\.map$|sw\.js$/.test(file))).toEqual([]);
    });

    await test.step('under the worker: API calls and server-rendered pages still come from the server', async () => {
        await page.reload();
        expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
        const first = await ping(page);
        expect(await ping(page)).toBe(first + 1);

        const shared = await context.newPage();
        await shared.goto(`${origin}/share/abc`);
        const before = Number(await shared.locator('#n').textContent());
        await shared.reload();
        expect(Number(await shared.locator('#n').textContent())).toBe(before + 1);
        await shared.close();

        await page.evaluate((src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = src; }), IMAGE);
        expect(await page.evaluate(() => window.loadLazy())).toBe('lazy chunk of build 1');
        await expect.poll(async () => ((await held(page))['ah-runtime-v1'] || []).map((file) => file.replace(/\.[0-9a-f]{8}\./, '.*.'))).toEqual([IMAGE.replace(/\.[0-9a-f]{8}\./, '.*.'), expect.stringMatching(/^\/js\/\d+\.\*\.js$/)]);
        expect(Object.values(await held(page)).flat().filter((file) => /^\/(api|share)/.test(file))).toEqual([]);
    });

    await test.step('no network: the shell, a chunk used before and the sign-in chunk never used open; the API fails; a server-rendered page is not replaced by the shell', async () => {
        await context.setOffline(true);
        await page.reload();
        await expect(page.locator('#app')).toHaveText('build 1');
        expect(await page.evaluate(() => window.loadLazy())).toBe('lazy chunk of build 1');
        expect(await page.evaluate(() => window.loadSignIn())).toBe('sign-in page of build 1');
        expect(await page.evaluate(() => fetch('/api/v2/ping').then(() => 'answered', () => 'failed'))).toBe('failed');

        const shared = await context.newPage();
        await expect(shared.goto(`${origin}/share/abc`)).rejects.toThrow();
        await shared.close();
        await context.setOffline(false);
        await page.reload();
    });

    await test.step('sign-out message: runtime caches go, the build stays', async () => {
        await page.evaluate(() => window.shell.dropWorkerRuntimeCaches());
        await expect.poll(async () => Object.entries(await held(page)).filter(([name]) => !name.startsWith('ah-shell-')).flatMap(([, files]) => files)).toEqual([]);
        expect(await buildCaches(page)).toHaveLength(1);
    });

    const [firstBuild] = await buildCaches(page);

    await test.step('a new build in an open tab: a notice, nothing moves until Reload', async () => {
        await build(2);
        await page.evaluate(() => window.shellRegistration.update());
        await expect.poll(() => page.evaluate(() => window.shell.updateReady.value)).toBe(true);
        expect(await shown(page)).toBe('build 1');
        expect(await buildCaches(page)).toHaveLength(2);

        await page.evaluate(() => { window.shell.applyUpdate(); });
        await expect(page.locator('#app')).toHaveText('build 2');
        await expect.poll(() => buildCaches(page)).toHaveLength(1);
        expect(await buildCaches(page)).not.toContain(firstBuild);
        expect(await page.evaluate(() => window.shell.updateReady.value)).toBe(false);
    });

    const [secondBuild] = await buildCaches(page);

    await test.step('a new build on a fresh load: it runs at once and its worker moves in with no notice', async () => {
        await build(3);
        await page.reload();
        await expect(page.locator('#app')).toHaveText('build 3');
        await expect.poll(async () => { const names = await buildCaches(page); return names.length === 1 && names[0] !== secondBuild; }, { timeout: 20000 }).toBe(true);
        expect(await page.evaluate(() => window.shell.updateReady.value)).toBe(false);
        expect(await page.evaluate(() => window.shell.build)).toBe(3);
    });

    await test.step('withdrawn: caches and registration go, the app still loads, and it is not registered again', async () => {
        env.APP_SHELL_WORKER = 'off';
        await page.reload();
        await expect.poll(() => cacheNames(page)).toEqual([]);
        await expect(async () => {
            await page.reload();
            await expect(page.locator('#app')).toHaveText('build 3');
            expect(await page.evaluate(async () => ({
                controlled: Boolean(navigator.serviceWorker.controller),
                registrations: (await navigator.serviceWorker.getRegistrations()).length,
                caches: (await caches.keys()).length,
            }))).toEqual({ controlled: false, registrations: 0, caches: 0 });
        }).toPass({ timeout: 20000 });
        expect(await page.evaluate(() => window.shell.updateReady.value)).toBe(false);
        delete env.APP_SHELL_WORKER;
    });

    expect(violations).toEqual([]);
    await context.close();
});
