/**
 * BUG-017 regression test: `array.forEach(async x => { … })` doesn't wait
 * and silently swallows rejections. The audit flagged ~14 sites; this test
 * covers:
 *
 *   - The two genuine concurrency-bug sites (Category B): a real `await`
 *     was being lost inside `forEach`. We exercise them and confirm the
 *     awaited work now completes before the surrounding function returns.
 *
 *   - The remaining 12 sites (Category A): the `async` keyword was unused
 *     (no `await` inside). We grep the source to confirm none of those
 *     `forEach(async ...)` patterns still exists in executable code.
 *
 * Run from project root: `node .claude/tests/test-bug-017.js`
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

// ---------------------------------------------------------------------------
// Category B Site 1: bucket.helper.js — uploadIamgesInStorage now awaits
// every copyFile before resolving.
// ---------------------------------------------------------------------------
section('bucket.helper.js — uploadIamgesInStorage waits for every file copy');

const bucketPath = require.resolve(path.join(projectRoot, 'Modules', 'storage', 'server', 'helpers', 'bucket.helper.js'));
delete require.cache[bucketPath];
const bucketHelper = require(bucketPath);

(async () => {
    // Replace the internal copyFile via monkey-patch. We can't reach the
    // file-level `copyFile` directly so we override `fs.cp` (used inside).
    const realFs = require('fs');
    const originalCp = realFs.cp;
    const cpCalls = [];
    let cpInflight = 0;
    let cpPeak = 0;
    realFs.cp = (src, dest, cb) => {
        cpInflight += 1;
        if (cpInflight > cpPeak) cpPeak = cpInflight;
        // Stagger the callbacks so we can prove the loop actually waited.
        setTimeout(() => {
            cpCalls.push({ src, dest, finishedAt: Date.now() });
            cpInflight -= 1;
            cb(null);
        }, 30);
    };

    const start = Date.now();
    await bucketHelper.uploadIamgesInStorage(
        [
            { path: 'a/1.png', filePath: 'tmp/1.png' },
            { path: 'a/2.png', filePath: 'tmp/2.png' },
            { path: 'a/3.png', filePath: 'tmp/3.png' },
        ],
        'company-1'
    );
    const elapsed = Date.now() - start;

    realFs.cp = originalCp;

    assert('all 3 copyFile calls completed before resolve',
        cpCalls.length === 3, `cpCalls=${cpCalls.length}`);
    assert('the function waited (elapsed >= one timer tick)',
        elapsed >= 25, `elapsed=${elapsed}`);
    assert('copies ran in parallel (peak in-flight > 1)',
        cpPeak > 1, `cpPeak=${cpPeak}`);

    // ----- Site 2 (AI/controller.js) is exercised via source check, since
    //       its full call graph (streaming OpenAI response handler) is
    //       impractical to stub at unit-test level. -----

    // -----------------------------------------------------------------------
    // Source grep: no `forEach(async ...)` remains in executable code
    // -----------------------------------------------------------------------
    section('source — no forEach(async) remains in executable code');

    const SCAN_DIRS = [
        path.join(projectRoot, 'Modules'),
        path.join(projectRoot, 'frontend', 'src'),
    ];
    const SCAN_EXT = /\.(js|vue)$/;

    function walk(dir, out) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'dist') continue;
                walk(full, out);
            } else if (SCAN_EXT.test(entry.name)) {
                out.push(full);
            }
        }
    }
    const files = [];
    for (const d of SCAN_DIRS) walk(d, files);

    const pattern = /\.forEach\s*\(\s*async/;
    const hits = [];
    for (const f of files) {
        const raw = fs.readFileSync(f, 'utf-8');
        // Strip block + line comments so we don't get false-positives from
        // our own fix-explanation comments referencing the OLD pattern.
        const noComments = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        if (pattern.test(noComments)) {
            const linesWithHit = raw.split(/\r?\n/)
                .map((l, i) => ({ line: i + 1, text: l }))
                .filter((x) => pattern.test(x.text) && !/\/\/.*forEach\s*\(\s*async/.test(x.text));
            if (linesWithHit.length) {
                hits.push({ file: path.relative(projectRoot, f), lines: linesWithHit.map((x) => x.line) });
            }
        }
    }
    assert('no executable .forEach(async ...) calls remain anywhere',
        hits.length === 0,
        hits.map((h) => `${h.file}:${h.lines.join(',')}`).join(' | '));

    // -----------------------------------------------------------------------
    // Targeted source checks for the two Category B fixes
    // -----------------------------------------------------------------------
    section('source — Category B fixes use proper async patterns');

    const aiSrc = fs.readFileSync(path.join(projectRoot, 'Modules', 'AI', 'controller.js'), 'utf-8');
    assert('AI/controller.js: uses for...of with await for chunkObjects',
        /for\s*\(\s*const\s+chunk\s+of\s+chunkObjects\s*\)\s*\{[\s\S]*?await\s+exports\.limitCountUpdate/.test(aiSrc));

    const bucketSrc = fs.readFileSync(path.join(projectRoot, 'Modules', 'storage', 'server', 'helpers', 'bucket.helper.js'), 'utf-8');
    assert('bucket.helper.js: uses Promise.allSettled(imageArray.map(...))',
        /await\s+Promise\.allSettled\s*\(\s*imageArray\.map\s*\(\s*async/.test(bucketSrc));

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
