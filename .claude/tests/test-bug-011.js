/**
 * BUG-011 regression test: `Modules/auth/controller/verifyInvitation.js`
 * decoded `req.body.id` (base64), split it `&`/`=`-style, then did
 *
 *     req.body = finalObj;
 *
 * — completely replacing `req.body` with attacker-controlled key/value
 * pairs. There was no allow-list of which keys could be set, so a crafted
 * invitation blob could smuggle arbitrary fields into `req.body` that
 * downstream code would read as if they were validated.
 *
 * The fix parses into a *local* `invite` object via `parseInviteBlob`,
 * accepting only `userId`, `companyId`, `linkId`, `docId`. `req.body`
 * is no longer mutated.
 *
 * Run from project root: `node .claude/tests/test-bug-011.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const ctrlPath = path.join(projectRoot, 'Modules', 'auth', 'controller', 'verifyInvitation.js');
const ctrl = require(ctrlPath);

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// Node's atob global accepts a base64 string and returns the decoded bytes.
// We encode test payloads with Buffer to avoid Vite/browser-only APIs.
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');

section('parseInviteBlob — unit');

assert('rejects empty input → null', ctrl.parseInviteBlob('') === null);
assert('rejects non-string input → null', ctrl.parseInviteBlob(123) === null);
assert('rejects invalid base64 → null',
    ctrl.parseInviteBlob('not-base64-!@#$%^') === null);

{
    const blob = b64('userId=507f1f77bcf86cd799439011&companyId=507f1f77bcf86cd799439022&linkId=abc&docId=507f1f77bcf86cd799439033');
    const out = ctrl.parseInviteBlob(blob);
    assert('all 4 allowed keys parsed',
        out && out.userId === '507f1f77bcf86cd799439011'
            && out.companyId === '507f1f77bcf86cd799439022'
            && out.linkId === 'abc'
            && out.docId === '507f1f77bcf86cd799439033',
        JSON.stringify(out));
}

{
    // Attacker tries to smuggle `role=admin` (and other made-up keys).
    const blob = b64('userId=u1&companyId=c1&linkId=L1&docId=d1&role=admin&isAdmin=true&password=p&__proto__=poisoned');
    const out = ctrl.parseInviteBlob(blob);
    assert('disallowed keys dropped — role',
        out && !('role' in out), JSON.stringify(out));
    assert('disallowed keys dropped — isAdmin',
        out && !('isAdmin' in out));
    assert('disallowed keys dropped — password',
        out && !('password' in out));
    assert('disallowed keys dropped — __proto__',
        out && !Object.prototype.hasOwnProperty.call(out, '__proto__'));
    assert('Object.prototype is not polluted',
        Object.prototype.poisoned === undefined
        && ({}).poisoned === undefined);
}

{
    // Value containing `=` should be preserved (split-on-first-`=` semantics).
    const blob = b64('userId=abc=def&companyId=c1');
    const out = ctrl.parseInviteBlob(blob);
    assert('value containing "=" is preserved verbatim',
        out && out.userId === 'abc=def' && out.companyId === 'c1',
        JSON.stringify(out));
}

{
    // Parts without `=` are skipped.
    const blob = b64('userId&companyId=c1&linkId');
    const out = ctrl.parseInviteBlob(blob);
    assert('parts without "=" are skipped',
        out && !('userId' in out) && out.companyId === 'c1' && !('linkId' in out),
        JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// checkPermission — early-return paths (no Mongo needed)
// ---------------------------------------------------------------------------
section('checkPermission — early-return paths');

function makeMockReqRes(body) {
    const state = { sendCount: 0, lastBody: null };
    const res = {
        json(payload) { state.lastBody = payload; state.sendCount += 1; return res; },
        send(payload) { state.lastBody = payload; state.sendCount += 1; return res; },
        status() { return res; },
    };
    const req = { body, headers: {} };
    return { req, res, state };
}

{
    const { req, res, state } = makeMockReqRes({});
    ctrl.checkPermission(req, res);
    assert('missing req.body.id → key=1, "Invalid URL id."',
        state.lastBody && state.lastBody.key === 1
        && state.lastBody.status === false
        && /Invalid URL id/.test(state.lastBody.statusText),
        JSON.stringify(state.lastBody));
}

{
    const { req, res, state } = makeMockReqRes({ id: 'not-base64-!!!' });
    ctrl.checkPermission(req, res);
    assert('invalid base64 → key=1, "Invalid URL."',
        state.lastBody && state.lastBody.key === 1
        && state.lastBody.status === false
        && /Invalid URL/.test(state.lastBody.statusText),
        JSON.stringify(state.lastBody));
}

{
    // No userId in the blob → "User Not Found." (key=2)
    const blob = b64('companyId=c1&linkId=L1');
    const { req, res, state } = makeMockReqRes({ id: blob });
    ctrl.checkPermission(req, res);
    assert('missing userId → key=2 "User Not Found."',
        state.lastBody && state.lastBody.key === 2
        && state.lastBody.status === true
        && /User Not Found/.test(state.lastBody.statusText),
        JSON.stringify(state.lastBody));
    assert('missing userId → response echoes parsed companyId',
        state.lastBody && state.lastBody.companyId === 'c1');
    assert('missing userId → response echoes parsed linkId',
        state.lastBody && state.lastBody.linkId === 'L1');
}

{
    // Only userId — missing companyId.
    const blob = b64('userId=u1');
    const { req, res, state } = makeMockReqRes({ id: blob });
    ctrl.checkPermission(req, res);
    assert('userId but missing companyId → key=1 "Invalid URL."',
        state.lastBody && state.lastBody.key === 1 && /Invalid URL/.test(state.lastBody.statusText),
        JSON.stringify(state.lastBody));
}

{
    // userId + companyId but no linkId.
    const blob = b64('userId=u1&companyId=c1');
    const { req, res, state } = makeMockReqRes({ id: blob });
    ctrl.checkPermission(req, res);
    assert('userId+companyId but missing linkId → key=1 "Invalid URL."',
        state.lastBody && state.lastBody.key === 1 && /Invalid URL/.test(state.lastBody.statusText));
}

section('req.body is NOT mutated');

{
    const blob = b64('userId=u1&companyId=c1&linkId=L1&role=admin&isAdmin=true');
    const { req, res } = makeMockReqRes({ id: blob });
    const originalBody = req.body;
    ctrl.checkPermission(req, res);
    assert('req.body still references the same object after call',
        req.body === originalBody);
    assert('req.body still has only the original `id` field',
        Object.keys(req.body).length === 1 && req.body.id === blob,
        JSON.stringify(req.body));
    assert('req.body.role was NOT injected by the handler',
        req.body.role === undefined);
    assert('req.body.isAdmin was NOT injected by the handler',
        req.body.isAdmin === undefined);
    assert('req.body.userId was NOT injected by the handler',
        req.body.userId === undefined);
}

section('source — req.body assignment is gone');

const src = fs.readFileSync(ctrlPath, 'utf-8');
const srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
assert('source no longer contains `req.body = finalObj`',
    !/req\.body\s*=\s*finalObj/.test(srcNoComments));
assert('source no longer contains any `req.body =` assignment',
    !/req\.body\s*=\s*[^=]/.test(srcNoComments),
    (srcNoComments.match(/req\.body\s*=\s*[^=].{0,40}/g) || []).join(' | '));
assert('source exports parseInviteBlob',
    /exports\.parseInviteBlob\s*=/.test(srcNoComments));
assert('source has the ALLOWED_INVITE_KEYS allow-list',
    /ALLOWED_INVITE_KEYS\s*=\s*new\s+Set\s*\(/.test(srcNoComments));

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
    console.log('Failed cases:');
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
process.exit(0);
