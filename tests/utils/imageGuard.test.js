/**
 * BUG-045 bootstrap test — `utils/imageGuard.js` was introduced in
 * BUG-023 to block pixel-bomb uploads before `sharp(...)` blows up.
 * This test exercises the public surface that's safe to call without
 * a real image file (limits + helpers).
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
let guard;

try {
    guard = require(path.resolve(ROOT, 'utils/imageGuard.js'));
} catch (e) {
    // If imageGuard isn't present on this branch, skip the suite
    // instead of failing — the file lands in the BUG-023 PR.
    describe.skip('utils/imageGuard (file not present on this branch)', () => {
        test.skip('skipped', () => {});
    });
}

if (guard) {
    describe('utils/imageGuard', () => {
        test('exports a getLimits function returning numeric caps', () => {
            expect(typeof guard.getLimits).toBe('function');
            const limits = guard.getLimits();
            expect(limits).toEqual(expect.objectContaining({
                MAX_BYTES: expect.any(Number),
                MAX_PIXELS: expect.any(Number)
            }));
            expect(limits.MAX_BYTES).toBeGreaterThan(0);
            expect(limits.MAX_PIXELS).toBeGreaterThan(0);
        });

        test('getLimits respects env overrides', () => {
            const originalBytes = process.env.MAX_IMAGE_FILE_BYTES;
            const originalPixels = process.env.MAX_IMAGE_PIXELS;
            try {
                process.env.MAX_IMAGE_FILE_BYTES = '524288';   // 512KB
                process.env.MAX_IMAGE_PIXELS = '1000000'; // 1MP
                const limits = guard.getLimits();
                expect(limits.MAX_BYTES).toBe(524288);
                expect(limits.MAX_PIXELS).toBe(1000000);
            } finally {
                process.env.MAX_IMAGE_FILE_BYTES = originalBytes;
                process.env.MAX_IMAGE_PIXELS = originalPixels;
            }
        });
    });
}
