/**
 * BUG-019 regression test: `Modules/MainChats/controller.js:71` did
 * `setChat = await MongoDbCrudOpration(...)` without a `const`/`let`,
 * creating an implicit global. The risk is twofold:
 *
 *   - Non-strict mode: `setChat` becomes a property of `globalThis`,
 *     shared between concurrent requests on the same Node process.
 *     Two simultaneous calls can clobber each other and the second
 *     response can include the first request's data.
 *   - Strict mode (any ES module / `'use strict'`): the assignment
 *     throws `ReferenceError: setChat is not defined`.
 *
 * The fix adds `const`. This test verifies:
 *   - The handler no longer references a global `setChat`.
 *   - The source has the const declaration.
 *
 * Run from project root: `node .claude/tests/test-bug-019.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const ctrlPath = path.join(projectRoot, 'Modules', 'MainChats', 'controller.js');

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

section('source — implicit global is gone');

const src = fs.readFileSync(ctrlPath, 'utf-8');
const srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// The bare `setChat = await ...` is the bug. After the fix it must be
// preceded by a declaration keyword.
assert('no bare `setChat = await ...` assignment remains',
    !/^\s*setChat\s*=\s*await/m.test(srcNoComments));
assert('setChat is now declared with const',
    /const\s+setChat\s*=\s*await\s+MongoDbCrudOpration/.test(srcNoComments));

section('module loads without leaking globals');
// Sanity: requiring the module shouldn't create a `setChat` global.
delete require.cache[require.resolve(ctrlPath)];
require(ctrlPath);
assert('global.setChat is undefined after require',
    typeof global.setChat === 'undefined' && !('setChat' in global));
assert('exports.setChats is a function (handler still wired up)',
    typeof require(ctrlPath).setChats === 'function');

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
    console.log('Failed cases:');
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
process.exit(0);
