/**
 * BUG-012 regression test: `Modules/auth/helper.js` had the auth
 * rate-limit numbers hard-coded inside `manageResetAttempt` —
 * 9 attempts / 10-min window / 10-min block — and the magic-number
 * variable was named `fiveMinutes` even though its value was 10 min.
 *
 * The fix:
 *   - Exports a pure helper `getRateLimitConfig()` that returns
 *     `{ MAX_ATTEMPTS, WINDOW_MS, BLOCK_MS }` from env, with safer
 *     defaults (5 / 15 min / 30 min).
 *   - `manageResetAttempt` reads from that helper at request time so
 *     operators can tune via env without restart.
 *
 * Run from project root: `node .claude/tests/test-bug-012.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const helperPath = path.join(projectRoot, 'Modules', 'auth', 'helper.js');
const helper = require(helperPath);

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// Snapshot and clear the env vars so we test the defaults cleanly.
const ORIGINAL = {
    MAX: process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    WINDOW: process.env.AUTH_RATE_LIMIT_WINDOW_MS,
    BLOCK: process.env.AUTH_RATE_LIMIT_BLOCK_MS,
};
delete process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS;
delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
delete process.env.AUTH_RATE_LIMIT_BLOCK_MS;

section('getRateLimitConfig — defaults');
{
    const c = helper.getRateLimitConfig();
    assert('default MAX_ATTEMPTS is 5 (was 9)',
        c.MAX_ATTEMPTS === 5, `got ${c.MAX_ATTEMPTS}`);
    assert('default WINDOW_MS is 15 minutes',
        c.WINDOW_MS === 15 * 60 * 1000, `got ${c.WINDOW_MS}`);
    assert('default BLOCK_MS is 30 minutes (was 10 min)',
        c.BLOCK_MS === 30 * 60 * 1000, `got ${c.BLOCK_MS}`);
}

section('getRateLimitConfig — env overrides');
{
    process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = '3';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.AUTH_RATE_LIMIT_BLOCK_MS = '120000';
    const c = helper.getRateLimitConfig();
    assert('env override on MAX_ATTEMPTS',
        c.MAX_ATTEMPTS === 3, `got ${c.MAX_ATTEMPTS}`);
    assert('env override on WINDOW_MS',
        c.WINDOW_MS === 60000, `got ${c.WINDOW_MS}`);
    assert('env override on BLOCK_MS',
        c.BLOCK_MS === 120000, `got ${c.BLOCK_MS}`);
    delete process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS;
    delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
    delete process.env.AUTH_RATE_LIMIT_BLOCK_MS;
}

section('getRateLimitConfig — clamping / safety');
{
    process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = '0';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '0';
    process.env.AUTH_RATE_LIMIT_BLOCK_MS = '0';
    const c = helper.getRateLimitConfig();
    assert('MAX_ATTEMPTS clamped to >=1 when env is 0',
        c.MAX_ATTEMPTS >= 1, `got ${c.MAX_ATTEMPTS}`);
    assert('WINDOW_MS clamped to >=1000 when env is 0',
        c.WINDOW_MS >= 1000, `got ${c.WINDOW_MS}`);
    assert('BLOCK_MS clamped to >=1000 when env is 0',
        c.BLOCK_MS >= 1000, `got ${c.BLOCK_MS}`);
    delete process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS;
    delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
    delete process.env.AUTH_RATE_LIMIT_BLOCK_MS;
}

{
    process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = 'not-a-number';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = 'nonsense';
    process.env.AUTH_RATE_LIMIT_BLOCK_MS = '';
    const c = helper.getRateLimitConfig();
    assert('non-numeric MAX_ATTEMPTS falls back to default 5',
        c.MAX_ATTEMPTS === 5, `got ${c.MAX_ATTEMPTS}`);
    assert('non-numeric WINDOW_MS falls back to default',
        c.WINDOW_MS === 15 * 60 * 1000, `got ${c.WINDOW_MS}`);
    assert('empty BLOCK_MS falls back to default',
        c.BLOCK_MS === 30 * 60 * 1000, `got ${c.BLOCK_MS}`);
    delete process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS;
    delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;
    delete process.env.AUTH_RATE_LIMIT_BLOCK_MS;
}

section('source — magic numbers replaced with the helper');
const src = fs.readFileSync(helperPath, 'utf-8');
const srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

assert('no `fiveMinutes` variable anywhere (the bad name is gone)',
    !/\bfiveMinutes\b/.test(srcNoComments));
assert('no executable `attempts > 9` check (old threshold gone)',
    !/attempts\s*>\s*9\b/.test(srcNoComments));
assert('no executable `10 \\* 60 \\* 1000` literal in the attempt logic',
    !/\b10\s*\*\s*60\s*\*\s*1000\b/.test(srcNoComments));
assert('manageResetAttempt now reads MAX_ATTEMPTS from getRateLimitConfig',
    /getRateLimitConfig\s*\(/.test(srcNoComments));
assert('threshold check uses the MAX_ATTEMPTS variable',
    /attempts\s*>=\s*MAX_ATTEMPTS/.test(srcNoComments));
assert('window check uses WINDOW_MS',
    /WINDOW_MS/.test(srcNoComments));
assert('block-duration uses BLOCK_MS',
    /BLOCK_MS/.test(srcNoComments));

section('.env.example documents the new vars');
const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf-8');
assert('.env.example declares AUTH_RATE_LIMIT_MAX_ATTEMPTS',
    /AUTH_RATE_LIMIT_MAX_ATTEMPTS\s*=/.test(envExample));
assert('.env.example declares AUTH_RATE_LIMIT_WINDOW_MS',
    /AUTH_RATE_LIMIT_WINDOW_MS\s*=/.test(envExample));
assert('.env.example declares AUTH_RATE_LIMIT_BLOCK_MS',
    /AUTH_RATE_LIMIT_BLOCK_MS\s*=/.test(envExample));

// Restore env
if (ORIGINAL.MAX !== undefined) process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = ORIGINAL.MAX;
if (ORIGINAL.WINDOW !== undefined) process.env.AUTH_RATE_LIMIT_WINDOW_MS = ORIGINAL.WINDOW;
if (ORIGINAL.BLOCK !== undefined) process.env.AUTH_RATE_LIMIT_BLOCK_MS = ORIGINAL.BLOCK;

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
    console.log('Failed cases:');
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
process.exit(0);
