/**
 * BUG-025 regression test: console.log / console.error calls in
 * `Modules/auth/controller/sendInvitation.js` and
 * `Modules/MainChats/controller.js` printed PII (emails, error
 * stacks, invitation-link context) directly to stdout. The fix
 * replaces them with Winston `logger.{info,error}` calls so the
 * output is captured by the structured log pipeline.
 *
 * Run from project root: `node .claude/tests/test-bug-025.js`
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
    'Modules/auth/controller/sendInvitation.js',
    'Modules/MainChats/controller.js',
];

section('source — no executable console.{log,error} calls remain');
for (const rel of targets) {
    const src = fs.readFileSync(path.join(projectRoot, rel), 'utf-8');
    const noComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const consoleHits = (noComments.match(/\bconsole\.(log|error|warn|info|debug)\s*\(/g) || []).length;
    assert(`${rel}: 0 executable console.* calls`,
        consoleHits === 0, `found ${consoleHits}`);
    // Winston is used
    const loggerHits = (noComments.match(/\blogger\.(error|warn|info)\s*\(/g) || []).length;
    assert(`${rel}: uses Winston logger`, loggerHits >= 1, `found ${loggerHits}`);
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
