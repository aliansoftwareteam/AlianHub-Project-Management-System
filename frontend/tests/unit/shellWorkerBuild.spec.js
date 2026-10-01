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

const build = (name, entrySource, publicFiles = PUBLIC) => new Promise((resolve, reject) => {
    const dir = path.join(workDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.js'), entrySource);
    webpack({
        mode: 'production',
        context: dir,
        entry: { app: './main.js' },
        output: { path: path.join(dir, 'dist'), filename: 'js/[name].[contenthash:8].js', publicPath: '/' },
        devtool: 'source-map',
        plugins: [new PublicFiles(publicFiles), new ShellWorkerPlugin()],
    }, (error, stats) => {
        if (error || stats.hasErrors()) return reject(error || new Error(stats.toString('errors-only')));
        const dist = path.join(dir, 'dist');
        const worker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
        return resolve({ dist, worker, shell: JSON.parse(/^const SHELL = (\{.*\});$/m.exec(worker)[1]) });
    });
});

describe('the build writes sw.js', () => {
    it('with the final names of the files it emitted, and without maps, images, other workers or itself', async () => {
        const { dist, shell } = await build('first', 'console.log("first");');
        const scripts = fs.readdirSync(path.join(dist, 'js')).filter((file) => file.endsWith('.js'));

        expect(scripts).toHaveLength(1);
        expect(scripts[0]).toMatch(/^app\.[0-9a-f]{8}\.js$/);
        expect(shell.hashed).toEqual([`/js/${scripts[0]}`]);
        expect(shell.plain).toEqual(['/icons/icon-192.png', '/index.html', '/manifest.webmanifest']);
        expect(fs.readdirSync(path.join(dist, 'js')).some((file) => file.endsWith('.map'))).toBe(true);
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
});
