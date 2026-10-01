import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const { ShellWorkerPlugin } = require('../../shellWorkerPlugin.js');

vi.setConfig({ testTimeout: 60000 });

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-shell-worker-'));
afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

/* Stands in for the copy of public/ and for the HTML plugin, which add their files before hashing. */
class PublicFiles {
    constructor(files) { this.files = files; }

    apply(compiler) {
        const { Compilation, sources } = compiler.webpack;
        compiler.hooks.thisCompilation.tap('PublicFiles', (compilation) => {
            compilation.hooks.processAssets.tap({ name: 'PublicFiles', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
                for (const [name, text] of Object.entries(this.files)) compilation.emitAsset(name, new sources.RawSource(text));
            });
        });
    }
}

const PUBLIC = { 'index.html': '<div id="app"></div>', 'manifest.webmanifest': '{}', 'icons/icon-192.png': 'png', 'logo.png': 'png', 'firebase-messaging-sw.js': '// push' };

const LAZY_PAGES = `
export const signIn = () => import(/* webpackChunkName: "login" */ './login.js');
export const report = () => import(/* webpackChunkName: "report" */ './report.js');
`;

const build = (name, entrySource, publicFiles = PUBLIC, firstPaintChunks = ['login']) => new Promise((resolve, reject) => {
    const dir = path.join(workDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.js'), `${entrySource}\n${LAZY_PAGES}`);
    fs.writeFileSync(path.join(dir, 'login.js'), 'export default "sign-in page";');
    fs.writeFileSync(path.join(dir, 'report.js'), 'export default "a page opened later";');
    webpack({
        mode: 'production',
        context: dir,
        entry: { app: './main.js' },
        output: { path: path.join(dir, 'dist'), filename: 'js/[name].[contenthash:8].js', chunkFilename: 'js/[name].[contenthash:8].js', publicPath: '/' },
        devtool: 'source-map',
        plugins: [new PublicFiles(publicFiles), new ShellWorkerPlugin({ firstPaintChunks })],
    }, (error, stats) => {
        if (error || stats.hasErrors()) return reject(error || new Error(stats.toString('errors-only')));
        const dist = path.join(dir, 'dist');
        const worker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
        return resolve({ dist, worker, shell: JSON.parse(/^const SHELL = (\{.*\});$/m.exec(worker)[1]) });
    });
});

describe('the build writes sw.js', () => {
    it('with the final names of the files it emitted: the entry and the sign-in chunk to precache, the other chunk for first use', async () => {
        const { dist, shell } = await build('first', 'console.log("first");');
        const scripts = fs.readdirSync(path.join(dist, 'js')).filter((file) => file.endsWith('.js'));
        const named = (chunk) => `/js/${scripts.find((file) => new RegExp(`^${chunk}\\.[0-9a-f]{8}\\.js$`).test(file))}`;

        expect(scripts).toHaveLength(3);
        expect(shell.hashed).toEqual([named('app'), named('login')]);
        expect(shell.lazy).toEqual([named('report')]);
        expect(shell.plain).toEqual(['/icons/icon-192.png', '/index.html', '/manifest.webmanifest']);
        expect(fs.readdirSync(path.join(dist, 'js')).some((file) => file.endsWith('.map'))).toBe(true);
    });

    it('and fails when a chunk it was told a first paint needs is not in the build', async () => {
        await expect(build('renamed', 'console.log("renamed");', PUBLIC, ['login', 'sign-in'])).rejects.toThrow(/sign-in/);
    });

    it('as one script a worker can run as it is', async () => {
        const { worker } = await build('runnable', 'console.log("runnable");');
        expect(worker).not.toMatch(/^\s*(import|export)\s/m);
        expect(worker).not.toMatch(/importScripts/);
        expect(() => new vm.Script(worker)).not.toThrow();
    });

    it('under the same version for the same build, and a new one when a script or the document changes', async () => {
        const first = await build('v1', 'console.log("one");');
        const sameAgain = await build('v1-again', 'console.log("one");');
        const otherScript = await build('v2', 'console.log("two");');
        const otherDocument = await build('v3', 'console.log("one");', { ...PUBLIC, 'index.html': '<div id="app" lang="en"></div>' });

        expect(sameAgain.shell.version).toBe(first.shell.version);
        expect(otherScript.shell.version).not.toBe(first.shell.version);
        expect(otherDocument.shell.version).not.toBe(first.shell.version);
        expect(otherDocument.shell.hashed).toEqual(first.shell.hashed);
    });

    it('under a new version when only a chunk kept on first use changes', async () => {
        const first = await build('lazy-1', 'console.log("one");');
        const dir = path.join(workDir, 'lazy-1');
        const laterReport = await new Promise((resolve, reject) => {
            fs.writeFileSync(path.join(dir, 'report.js'), 'export default "the same page, changed";');
            webpack({
                mode: 'production',
                context: dir,
                entry: { app: './main.js' },
                output: { path: path.join(dir, 'dist-2'), filename: 'js/[name].[contenthash:8].js', chunkFilename: 'js/[name].[contenthash:8].js', publicPath: '/' },
                plugins: [new PublicFiles(PUBLIC), new ShellWorkerPlugin({ firstPaintChunks: ['login'] })],
            }, (error, stats) => (error || stats.hasErrors() ? reject(error || new Error(stats.toString('errors-only'))) : resolve(JSON.parse(/^const SHELL = (\{.*\});$/m.exec(fs.readFileSync(path.join(dir, 'dist-2', 'sw.js'), 'utf8'))[1]))));
        });

        expect(laterReport.lazy).not.toEqual(first.shell.lazy);
        expect(laterReport.version).not.toBe(first.shell.version);
    });
});

describe('vue.config.js', () => {
    const load = (mode) => {
        const before = process.env.NODE_ENV;
        process.env.NODE_ENV = mode;
        try {
            delete require.cache[require.resolve('../../vue.config.js')];
            return require('../../vue.config.js');
        } finally {
            process.env.NODE_ENV = before;
        }
    };
    const hasWorkerPlugin = (config) => config.configureWebpack.plugins.some((plugin) => plugin.constructor.name === 'ShellWorkerPlugin');

    it('adds the worker to a production build and to no other', () => {
        expect(hasWorkerPlugin(load('production'))).toBe(true);
        expect(hasWorkerPlugin(load('development'))).toBe(false);
    });

    it('names the sign-in chunk as needed for a first paint, under the name the router gives it', () => {
        const plugin = load('production').configureWebpack.plugins.find((entry) => entry.constructor.name === 'ShellWorkerPlugin');
        expect(plugin.firstPaintChunks).toEqual(['login']);
        const routes = fs.readFileSync(path.resolve(__dirname, '../../src/router/auth/index.js'), 'utf8');
        expect(routes).toMatch(/webpackChunkName: "login" \*\/ '@\/views\/Authentication\/Login\/Login\.vue'/);
    });
});
