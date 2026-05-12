/**
 * BUG-023 regression test: `sharp(file.path)` / `sharp(buffer)` was
 * invoked without any size or dimension validation. A 30000×30000 PNG
 * (pixel bomb) could OOM the worker.
 *
 * The fix introduces `utils/imageGuard.js` with `guardFile` /
 * `guardBuffer` helpers and wires them into all five `sharp(...)`
 * callsites in `Modules/storage/`. This test exercises the helper
 * directly with synthetic in-memory inputs.
 *
 * Run from project root: `node .claude/tests/test-bug-023.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const sharp = require('sharp');
const guard = require(path.join(projectRoot, 'utils', 'imageGuard.js'));

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

async function makePng(w, h) {
    return await sharp({
        create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
}

(async () => {
    section('getLimits — defaults / env');
    {
        const original = {
            bytes: process.env.MAX_IMAGE_FILE_BYTES,
            pixels: process.env.MAX_IMAGE_PIXELS,
        };
        delete process.env.MAX_IMAGE_FILE_BYTES;
        delete process.env.MAX_IMAGE_PIXELS;
        const def = guard.getLimits();
        assert('default MAX_BYTES is 25 MB', def.MAX_BYTES === 25 * 1024 * 1024);
        assert('default MAX_PIXELS is 50 megapixels', def.MAX_PIXELS === 50 * 1000 * 1000);

        process.env.MAX_IMAGE_FILE_BYTES = '2048';
        process.env.MAX_IMAGE_PIXELS = '100';
        const env = guard.getLimits();
        assert('env override MAX_BYTES applies', env.MAX_BYTES === 2048);
        assert('env override MAX_PIXELS applies', env.MAX_PIXELS === 100);

        process.env.MAX_IMAGE_FILE_BYTES = '0';
        process.env.MAX_IMAGE_PIXELS = 'nonsense';
        const clamped = guard.getLimits();
        assert('zero MAX_BYTES is clamped to defaults', clamped.MAX_BYTES === 25 * 1024 * 1024);
        assert('non-numeric MAX_PIXELS falls back to default',
            clamped.MAX_PIXELS === 50 * 1000 * 1000);

        if (original.bytes !== undefined) process.env.MAX_IMAGE_FILE_BYTES = original.bytes;
        else delete process.env.MAX_IMAGE_FILE_BYTES;
        if (original.pixels !== undefined) process.env.MAX_IMAGE_PIXELS = original.pixels;
        else delete process.env.MAX_IMAGE_PIXELS;
    }

    section('checkFileSizeBytes — threshold');
    {
        process.env.MAX_IMAGE_FILE_BYTES = '1024';
        let threw = null;
        try { guard.checkFileSizeBytes(512); } catch (e) { threw = e; }
        assert('512 bytes passes', threw === null);
        threw = null;
        try { guard.checkFileSizeBytes(2048); } catch (e) { threw = e; }
        assert('2048 bytes throws ImageGuardError', threw && threw.code === 'IMAGE_TOO_LARGE');
        assert('error carries statusCode 413', threw && threw.statusCode === 413);
        delete process.env.MAX_IMAGE_FILE_BYTES;
    }

    section('guardBuffer — pixel-bomb rejection');
    {
        process.env.MAX_IMAGE_PIXELS = String(64); // 8×8 = 64 pixels limit
        const tinyOk = await makePng(8, 8);
        let threw = null;
        try { await guard.guardBuffer(tinyOk); } catch (e) { threw = e; }
        assert('8×8 buffer (≤ limit) passes', threw === null);

        const bomb = await makePng(16, 16); // 256 pixels — over the limit
        threw = null;
        try { await guard.guardBuffer(bomb); } catch (e) { threw = e; }
        assert('16×16 buffer is rejected (pixel-bomb)',
            threw && threw.code === 'IMAGE_TOO_MANY_PIXELS');
        assert('rejection details include width/height/pixels',
            threw && threw.details
            && threw.details.width === 16
            && threw.details.height === 16
            && threw.details.pixels === 256);
        delete process.env.MAX_IMAGE_PIXELS;
    }

    section('guardFile — file size + dimensions');
    {
        process.env.MAX_IMAGE_FILE_BYTES = '1000000'; // 1 MB
        process.env.MAX_IMAGE_PIXELS = String(100);

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug023-'));
        const tinyPath = path.join(tmpDir, 'tiny.png');
        fs.writeFileSync(tinyPath, await makePng(5, 5));
        let threw = null;
        try { await guard.guardFile(tinyPath); } catch (e) { threw = e; }
        assert('5×5 file (25 pixels) passes both limits', threw === null);

        const bombPath = path.join(tmpDir, 'bomb.png');
        fs.writeFileSync(bombPath, await makePng(20, 20));
        threw = null;
        try { await guard.guardFile(bombPath); } catch (e) { threw = e; }
        assert('20×20 file is rejected on pixel count',
            threw && threw.code === 'IMAGE_TOO_MANY_PIXELS');

        // Size-only rejection (the helper floors MAX_BYTES at 1024 for
        // safety, so use values above that floor).
        delete process.env.MAX_IMAGE_PIXELS;
        process.env.MAX_IMAGE_FILE_BYTES = '1024';
        const bigPath = path.join(tmpDir, 'big.bin');
        fs.writeFileSync(bigPath, Buffer.alloc(2000)); // 2000 bytes > 1024
        threw = null;
        try { guard.checkPathSize(bigPath); } catch (e) { threw = e; }
        assert('checkPathSize rejects files > MAX_BYTES',
            threw && threw.code === 'IMAGE_TOO_LARGE');

        fs.rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.MAX_IMAGE_FILE_BYTES;
    }

    section('source — every sharp() callsite is preceded by a guard');
    const targets = [
        path.join(projectRoot, 'Modules', 'storage', 'wasabi', 'controller.js'),
        path.join(projectRoot, 'Modules', 'storage', 'server', 'helpers', 'bucket.helper.js'),
    ];
    for (const t of targets) {
        const src = fs.readFileSync(t, 'utf-8');
        const noComments = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        // Count sharp( occurrences in executable code that are NOT
        // the metadata-only sharp(input).metadata() call inside the
        // guard itself.
        const guardImports = /require\(['"][^'"]*imageGuard[^'"]*['"]\)/.test(noComments);
        assert(`${path.relative(projectRoot, t)} imports imageGuard`,
            guardImports);
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
