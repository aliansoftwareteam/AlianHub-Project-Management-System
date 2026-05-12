/**
 * BUG-024 regression test: `fs.readFileSync` was used in five request
 * handlers across `Modules/storage/wasabi/controller.js` and one site in
 * `Modules/notification/notification-middleware/controllerV2.js`. Each
 * read blocked the entire Node event loop for the duration of the disk
 * read — under concurrent load every other route degraded.
 *
 * The fix swaps each call to `fs.promises.readFile(...)` and adjusts
 * the surrounding Promise/callback structure to `await` it.
 *
 * This test verifies source-level that:
 *   - No executable `fs.readFileSync(` call remains in either file.
 *   - The async API is used instead (`fs.promises.readFile`).
 *
 * Run from project root: `node .claude/tests/test-bug-024.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const targets = [
    'Modules/storage/wasabi/controller.js',
    'Modules/notification/notification-middleware/controllerV2.js',
];

section('source — no executable fs.readFileSync remains in scoped handlers');

for (const rel of targets) {
    const src = fs.readFileSync(path.join(projectRoot, rel), 'utf-8');
    const noComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const syncMatches = (noComments.match(/fs\.readFileSync\s*\(/g) || []).length;
    assert(`${rel}: 0 executable fs.readFileSync calls`,
        syncMatches === 0,
        `found ${syncMatches}`);

    // Async usage should be present (we replaced the sync calls with async).
    const asyncMatches = (noComments.match(/fs\.promises\.readFile\s*\(/g) || []).length;
    assert(`${rel}: uses fs.promises.readFile`,
        asyncMatches >= 1,
        `found ${asyncMatches}`);
}

section('module loads without syntax errors after the refactor');

for (const rel of targets) {
    const fullPath = path.join(projectRoot, rel);
    let loadError = null;
    try {
        delete require.cache[require.resolve(fullPath)];
        require(fullPath);
    } catch (err) {
        loadError = err;
    }
    // The wasabi controller pulls in a lot of transitive deps that may need
    // env vars; accept "module loads without a SyntaxError" as the bar here.
    assert(`${rel}: module loads (no SyntaxError)`,
        loadError === null || loadError.name !== 'SyntaxError',
        loadError ? `${loadError.name}: ${loadError.message}` : '');
}

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
    console.log('Failed cases:');
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
process.exit(0);
