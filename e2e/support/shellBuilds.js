const fs = require('fs');
const os = require('os');
const path = require('path');

/* Webpack is a frontend dependency, and the e2e shards install only the root's. So CI makes these
 * builds in the job that builds the frontend and names them in E2E_SHELL_BUILDS; without it the spec
 * builds them itself, so a local run never tests builds left over from older sources. */

const ROOT = path.resolve(__dirname, '..', '..');
const FRONT = path.join(ROOT, 'frontend');
const REGISTRATION = path.join(FRONT, 'src', 'serviceWorker', 'registration.js');
const ICON = path.join(FRONT, 'public', 'icons', 'icon-192.png');
const IMAGE = '/img/mark.0a1b2c3d.png';
const BUILD_NUMBERS = [1, 2, 3];

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

const buildShell = (number, dist) => new Promise((resolve, reject) => {
    const webpack = require(path.join(FRONT, 'node_modules', 'webpack'));
    const HtmlWebpackPlugin = require(path.join(FRONT, 'node_modules', 'html-webpack-plugin'));
    const { ShellWorkerPlugin } = require(path.join(FRONT, 'shellWorkerPlugin.js'));
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-shell-src-'));
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
    }, (error, stats) => {
        fs.rmSync(src, { recursive: true, force: true });
        if (error || stats.hasErrors()) reject(error || new Error(stats.toString('errors-only')));
        else resolve();
    });
});

const placeShell = async (number, dist) => {
    if (!process.env.E2E_SHELL_BUILDS) return buildShell(number, dist);
    const prebuilt = path.resolve(process.env.E2E_SHELL_BUILDS, String(number));
    if (!fs.existsSync(path.join(prebuilt, 'sw.js'))) throw new Error(`${prebuilt} has no sw.js: the prebuilt shell builds are incomplete`);
    fs.rmSync(dist, { recursive: true, force: true });
    fs.cpSync(prebuilt, dist, { recursive: true });
};

if (require.main === module) {
    const out = path.resolve(process.argv[2] || 'shell-builds');
    (async () => {
        for (const number of BUILD_NUMBERS) await buildShell(number, path.join(out, String(number)));
    })().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { placeShell, IMAGE };
