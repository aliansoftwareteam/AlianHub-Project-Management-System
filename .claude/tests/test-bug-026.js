/**
 * BUG-026 regression test: `Modules/Users/controller.js` had
 * `response.isEmailVerified == false` (loose-equality), which would
 * also match 0, "", null, undefined, NaN. A user document missing the
 * field entirely (legacy data) would be treated as "Email Not Verified"
 * even though it was never explicitly false.
 *
 * The fix swaps to strict equality (`=== false`).
 *
 * The audit also flagged a sibling file (`Modules/usersModule/...`)
 * that no longer exists post the naming-conventions refactor — the
 * actual site is `Modules/Users/controller.js`. Verified.
 *
 * Run from project root: `node .claude/tests/test-bug-026.js`
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

section('Modules/Users/controller.js — strict equality');
const src = fs.readFileSync(path.join(projectRoot, 'Modules', 'Users', 'controller.js'), 'utf-8');
const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

assert('no `isEmailVerified == false` (loose) anywhere',
    !/isEmailVerified\s*==\s*false/.test(noComments));
assert('uses `isEmailVerified === false` (strict)',
    /isEmailVerified\s*===\s*false/.test(noComments));

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
