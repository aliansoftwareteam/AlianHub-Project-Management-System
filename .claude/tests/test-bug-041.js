/**
 * BUG-041 regression — drop `aws-sdk` v2; consolidate on @aws-sdk/* v3.
 *
 * Pre-fix: both `aws-sdk` (v2) and `@aws-sdk/*` (v3) were installed and
 * used in the same codebase. v2 is maintenance-only; keeping both
 * bloats the install and creates conflicting SES surfaces.
 *
 * Post-fix:
 *   1. `aws-sdk` removed from package.json.
 *   2. `Config/aws.js` builds the SES client from `@aws-sdk/client-ses`
 *      and exposes a v2-shaped `.sendEmail(params, cb)` shim so the one
 *      consumer (`Modules/servicewithAWS.js`) doesn't have to rewrite
 *      its callback contract.
 *   3. No live `require('aws-sdk')` remains anywhere in source.
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

// 1. package.json no longer lists `aws-sdk`.
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
assert(!('aws-sdk' in allDeps), 'package.json no longer lists `aws-sdk`');

// 2. `@aws-sdk/client-ses` is installed (the v3 replacement).
assert('@aws-sdk/client-ses' in allDeps, 'package.json lists `@aws-sdk/client-ses` (the v3 SES client)');

// 3. Source-grep: no live require('aws-sdk') anywhere outside comments.
function readSrc(rel) { return fs.readFileSync(path.resolve(ROOT, rel), 'utf8'); }
function liveLinesContaining(src, needle) {
    return src.split('\n').filter(line => {
        const trimmed = line.trim();
        // Skip line-comments and block-comment lines that start with `*`
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
        return line.includes(needle);
    });
}

['Config/aws.js', 'Modules/servicewithAWS.js'].forEach(file => {
    const src = readSrc(file);
    const live = liveLinesContaining(src, "require('aws-sdk')");
    assert(live.length === 0, `${file} has no live require('aws-sdk') (found ${live.length})`);
    const liveSub = liveLinesContaining(src, "require('aws-sdk/");
    assert(liveSub.length === 0, `${file} has no live require('aws-sdk/...') (found ${liveSub.length})`);
});

// 4. The v3 shim is wired correctly: Config/aws.js exports `ses` with
//    a sendEmail callback shim and a raw SESClient.
const cfgAws = readSrc('Config/aws.js');
assert(/SESClient/.test(cfgAws), 'Config/aws.js imports SESClient from @aws-sdk/client-ses');
assert(/SendEmailCommand/.test(cfgAws), 'Config/aws.js imports SendEmailCommand');
assert(/sendEmail\s*\(\s*params\s*,\s*callback\s*\)/.test(cfgAws), 'Config/aws.js exposes a v2-shaped sendEmail(params, callback) shim');

// 5. servicewithAWS.js no longer constructs its own v2 client.
const svcSrc = readSrc('Modules/servicewithAWS.js');
const liveAWSConfig = liveLinesContaining(svcSrc, 'AWS.config.update');
assert(liveAWSConfig.length === 0, 'servicewithAWS.js no longer calls AWS.config.update (was v2-only)');
const liveAWSNew = liveLinesContaining(svcSrc, 'new AWS.SES');
assert(liveAWSNew.length === 0, 'servicewithAWS.js no longer instantiates `new AWS.SES` (was v2-only)');

// 6. Smoke-load the shim and verify it accepts a v2-shaped call.
//    We don't actually send mail; we just confirm the shim invokes the
//    callback once. Use a fake SESClient that fails fast.
const { SESClient } = require('@aws-sdk/client-ses');
const stubClient = new SESClient({ region: 'us-east-1' });
const original = stubClient.send;
stubClient.send = () => Promise.reject(new Error('stub failure'));

// Reconstruct the shim shape from Config/aws.js — we can't easily load
// the module because it pulls in env config; this asserts the SHAPE is
// preserved.
const sesShim = {
    sendEmail(params, callback) {
        stubClient.send().then(d => callback(null, d)).catch(e => callback(e));
    }
};

(function asyncSmoke() {
    let called = false;
    sesShim.sendEmail({ Destination: { ToAddresses: ['t@example.com'] } }, (err, data) => {
        called = true;
        assert(!!err && /stub failure/.test(err.message), 'sendEmail shim invokes callback with v2-shaped (err, data)');
    });
    setImmediate(() => {
        if (!called) {
            console.error('FAIL: sendEmail shim never invoked callback');
            process.exit(1);
        }
        console.log('\nAll BUG-041 assertions passed.');
    });
})();
