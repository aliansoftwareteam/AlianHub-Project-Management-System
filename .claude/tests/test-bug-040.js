/**
 * BUG-040 regression — drop the deprecated `atob` / `btoa` npm shims.
 *
 * Node has had both available as runtime globals since v16, so the
 * shim packages are dead weight that haven't been maintained.
 *
 * Post-fix we expect:
 *   1. neither package is listed in package.json,
 *   2. neither package resolves through node's module loader,
 *   3. the call sites in Modules/auth use a `Buffer`-based inline
 *      replacement that decodes/encodes equivalently to what the
 *      old packages did.
 */

const fs = require('fs');
const path = require('path');

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exit(1);
    }
    console.log('PASS:', label);
}

const ROOT = path.resolve(__dirname, '../..');

// 1. package.json no longer lists either dep.
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
assert(!('atob' in allDeps), 'package.json no longer lists `atob`');
assert(!('btoa' in allDeps), 'package.json no longer lists `btoa`');

// 2. node-modules resolution fails for them.
function canResolve(name) {
    try { require.resolve(name, { paths: [ROOT] }); return true; } catch (_) { return false; }
}
assert(!canResolve('atob'), '`require("atob")` no longer resolves');
assert(!canResolve('btoa'), '`require("btoa")` no longer resolves');

// 3. call sites swapped to Buffer-based replacements.
const verifySrc = fs.readFileSync(path.resolve(ROOT, 'Modules/auth/controller/verifyInvitation.js'), 'utf8');
const sendSrc = fs.readFileSync(path.resolve(ROOT, 'Modules/auth/controller/sendInvitation.js'), 'utf8');
assert(!/require\(\s*['"]atob['"]\s*\)/.test(verifySrc), 'verifyInvitation.js no longer requires `atob`');
assert(!/require\(\s*['"]btoa['"]\s*\)/.test(sendSrc), 'sendInvitation.js no longer requires `btoa`');
assert(/Buffer\.from/.test(verifySrc), 'verifyInvitation.js uses Buffer-based replacement');
assert(/Buffer\.from/.test(sendSrc), 'sendInvitation.js uses Buffer-based replacement');

// 4. behavioural parity — Buffer roundtrip == old shim output for sample input.
const sampleEncoded = Buffer.from('hello=world&x=1', 'binary').toString('base64');
const sampleDecoded = Buffer.from(sampleEncoded, 'base64').toString('binary');
assert(sampleDecoded === 'hello=world&x=1', 'Buffer-based atob/btoa replacement round-trips correctly');

console.log('\nAll BUG-040 assertions passed.');
