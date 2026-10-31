/**
 * BUG-041 regression — drop `aws-sdk` v2; consolidate on @aws-sdk/* v3.
 *
 * Pre-fix: both `aws-sdk` (v2) and `@aws-sdk/*` (v3) were installed and
 * used in the same codebase. v2 is maintenance-only; keeping both
 * bloats the install and creates conflicting SES surfaces.
 *
 * Post-fix:
 *   1. `aws-sdk` removed from package.json.
 *   2. SES mail goes through `@aws-sdk/client-ses` in `Modules/mailProvider.js`
 *      (task 083 replaced the old `Config/aws.js` shim and `servicewithAWS.js`).
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

['Config/aws.js', 'Modules/mailProvider.js'].forEach(file => {
    const src = readSrc(file);
    const live = liveLinesContaining(src, "require('aws-sdk')");
    assert(live.length === 0, `${file} has no live require('aws-sdk') (found ${live.length})`);
    const liveSub = liveLinesContaining(src, "require('aws-sdk/");
    assert(liveSub.length === 0, `${file} has no live require('aws-sdk/...') (found ${liveSub.length})`);
});

// 4. SES mail uses the v3 client.
const provider = readSrc('Modules/mailProvider.js');
assert(/require\("@aws-sdk\/client-ses"\)/.test(provider), 'Modules/mailProvider.js requires @aws-sdk/client-ses');
assert(/SendRawEmailCommand/.test(provider), 'Modules/mailProvider.js sends through SendRawEmailCommand');

console.log('\nAll BUG-041 assertions passed.');
