const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const ROOT = path.join(__dirname, '..', '..');

/* The production image installs with `npm ci --omit=dev`, so a package the server reaches but that only sits in
 * devDependencies crashes the boot (14.45.0: @modelcontextprotocol/sdk, reached through Agents → Connectors).
 * Walks every file the server can require from server.js, lazy requires included, and lists each package it names. */
const REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const BUILTIN = new Set(builtinModules);

const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

function resolveFile(from, spec) {
    const base = path.resolve(path.dirname(from), spec);
    return [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

function reachedPackages(entry) {
    const seen = new Set();
    const packages = new Map();
    const queue = [entry];
    while (queue.length) {
        const file = queue.pop();
        if (seen.has(file) || !file.endsWith('.js')) continue;
        seen.add(file);
        for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(REQUIRE)) {
            if (spec.startsWith('.')) {
                const next = resolveFile(file, spec);
                if (next) queue.push(next);
                continue;
            }
            const name = packageOf(spec.replace(/^node:/, ''));
            if (spec.startsWith('node:') || BUILTIN.has(name)) continue;
            if (!packages.has(name)) packages.set(name, path.relative(ROOT, file).split(path.sep).join('/'));
        }
    }
    return { files: seen.size, packages };
}

describe('runtime dependencies', () => {
    it('installs every package the server can require with npm ci --omit=dev', () => {
        const { files, packages } = reachedPackages(path.join(ROOT, 'server.js'));
        // What `npm ci --omit=dev` leaves at the top of node_modules: the lockfile entries not marked dev-only.
        const lock = require('../../package-lock.json').packages;
        const installed = (name) => Boolean(lock[`node_modules/${name}`]) && lock[`node_modules/${name}`].dev !== true;
        const missing = [...packages].filter(([name]) => !installed(name)).map(([name, file]) => `${name} (required by ${file})`);

        expect(files).toBeGreaterThan(100);
        expect(missing).toEqual([]);
    });
});
