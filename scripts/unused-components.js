#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_EXT = new Set(['.vue', '.js', '.ts', '.mjs', '.cjs']);
const ENTRY_FILES = new Set(['App.vue']);
const SPECIFIER_RE = /(?:from|import|require)\s*\(?\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_PREFIX_RE = /import\(\s*`([^`$]*)\$\{/g;
const BASENAME_RE = /([A-Za-z0-9_.-]+\.vue)\b/g;

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
    }
    return out;
}

function resolveSpecifier(spec, fromFile, srcRoot) {
    let base;
    if (spec.startsWith('@/')) base = path.join(srcRoot, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
    else return null;
    if (base.endsWith('.vue')) return base;
    for (const candidate of [`${base}.vue`, path.join(base, 'index.vue')]) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

// `import(\`./steps/${name}.vue\`)` can resolve to any file under the static
// prefix, so everything in that directory counts as referenced.
function dynamicImportDirs(source, fromFile) {
    const dirs = [];
    for (const m of source.matchAll(DYNAMIC_PREFIX_RE)) {
        const staticPart = m[1];
        const dir = staticPart.endsWith('/') ? staticPart : path.dirname(staticPart);
        dirs.push(path.resolve(path.dirname(fromFile), dir));
    }
    return dirs;
}

function findUnusedComponents(srcRoot) {
    const files = walk(srcRoot);
    const referencedPaths = new Set();
    const referencedBasenames = new Set();
    const dynamicDirs = [];

    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        for (const m of source.matchAll(SPECIFIER_RE)) {
            const resolved = resolveSpecifier(m[1], file, srcRoot);
            if (resolved && resolved !== file) referencedPaths.add(resolved);
        }
        for (const m of source.matchAll(BASENAME_RE)) {
            if (m[1] !== path.basename(file)) referencedBasenames.add(m[1]);
        }
        dynamicDirs.push(...dynamicImportDirs(source, file));
    }

    return files
        .filter((f) => f.endsWith('.vue'))
        .filter((f) => !ENTRY_FILES.has(path.basename(f)))
        .filter((f) => !referencedPaths.has(f))
        .filter((f) => !referencedBasenames.has(path.basename(f)))
        .filter((f) => !dynamicDirs.some((dir) => f.startsWith(dir + path.sep)))
        .map((f) => path.relative(srcRoot, f))
        .sort();
}

function main(argv) {
    const srcRoot = path.resolve(__dirname, '..', 'frontend', 'src');
    const unused = findUnusedComponents(srcRoot);
    if (argv.includes('--json')) {
        process.stdout.write(JSON.stringify(unused, null, 2) + '\n');
    } else {
        unused.forEach((f) => process.stdout.write(f + '\n'));
        process.stderr.write(`${unused.length} unreferenced .vue file(s) under frontend/src\n`);
    }
    return unused.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { findUnusedComponents };
