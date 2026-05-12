/**
 * BUG-022 regression test: `sharp` was pinned to 0.32.6, which carries
 * CVE-2024-28219 (heap-buffer overflow via crafted SVG). The fix bumps
 * the dependency to ^0.34.0 (current stable major).
 *
 * This test verifies:
 *   - package.json declares sharp >= 0.34.0
 *   - The installed version meets the same floor
 *   - `require('sharp')` loads and round-trips a tiny in-memory image
 *     successfully (no API regression vs the callers in
 *     Modules/storage/...)
 *
 * Run from project root: `node .claude/tests/test-bug-022.js`
 */
'use strict';

const path = require('path');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const pkg = require(path.join(projectRoot, 'package.json'));

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// Helper: very lightweight semver comparison sufficient for the assertion
// "this is >= 0.34.0". Strips any leading ^/~/v.
function gteFloor(actual, floor) {
    const a = String(actual).replace(/^[^0-9]+/, '').split('.').map(Number);
    const f = floor.split('.').map(Number);
    for (let i = 0; i < f.length; i += 1) {
        const av = a[i] || 0;
        if (av > f[i]) return true;
        if (av < f[i]) return false;
    }
    return true;
}

section('package.json — declared version');

const declared = pkg.dependencies && pkg.dependencies.sharp;
assert('sharp is listed as a runtime dependency', typeof declared === 'string' && declared.length > 0);
assert('declared version >= 0.34.0 (CVE-2024-28219 fixed in 0.33.2)',
    gteFloor(declared, '0.34.0'), `declared=${declared}`);

section('installed version on disk');

let installed = null;
try {
    installed = require(path.join(projectRoot, 'node_modules', 'sharp', 'package.json')).version;
} catch (_) {
    installed = null;
}
assert('sharp is installed', installed !== null);
assert('installed version >= 0.34.0', installed && gteFloor(installed, '0.34.0'),
    `installed=${installed}`);

section('runtime smoke — sharp loads and processes a tiny image');

(async () => {
    let sharp = null;
    let loadError = null;
    try {
        sharp = require('sharp');
    } catch (err) {
        loadError = err;
    }
    assert('require("sharp") succeeds', sharp !== null,
        loadError ? loadError.message : '');

    if (sharp) {
        // Generate a 4x4 red PNG in memory, resize to 2x2, read metadata.
        try {
            const tinyPng = await sharp({
                create: {
                    width: 4,
                    height: 4,
                    channels: 3,
                    background: { r: 255, g: 0, b: 0 },
                },
            }).png().toBuffer();

            const resized = await sharp(tinyPng).resize(2, 2, { fit: 'inside' }).toBuffer();
            const meta = await sharp(resized).metadata();

            assert('resize().toBuffer() works (no API regression)',
                Buffer.isBuffer(resized) && resized.length > 0);
            assert('metadata() reports the resized dimensions',
                meta && (meta.width === 2 && meta.height === 2),
                `width=${meta && meta.width} height=${meta && meta.height}`);
        } catch (err) {
            assert('runtime smoke', false, err.message);
        }
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
})().catch((err) => { console.error('FATAL', err); process.exit(1); });
