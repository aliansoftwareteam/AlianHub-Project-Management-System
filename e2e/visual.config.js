const path = require('node:path');
const { defineConfig } = require('@playwright/test');
const { LOCALE, TIMEZONE } = require('../scripts/visual/freeze');
const { THRESHOLD, MAX_DIFF_PIXEL_RATIO, baselineDir } = require('../scripts/visual/settings');

module.exports = defineConfig({
    testDir: './visual',
    outputDir: './visual-results',
    snapshotPathTemplate: path.join(baselineDir(), '{arg}{ext}'),
    // Only `npm run visual:accept` writes a baseline; Playwright would otherwise create a missing one and fail the test.
    updateSnapshots: 'none',
    globalSetup: require.resolve('./visual/global-setup.js'),
    // One page at a time: a second worker competes for the CPU and moves the moment a screen comes to rest.
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    timeout: 120000,
    expect: {
        timeout: 20000,
        toHaveScreenshot: { threshold: THRESHOLD, maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO, animations: 'disabled', caret: 'hide', scale: 'css' },
    },
    reporter: [['list'], ['html', { outputFolder: 'visual-report', open: 'never' }]],
    use: {
        browserName: 'chromium',
        deviceScaleFactor: 1,
        locale: LOCALE,
        timezoneId: TIMEZONE,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
    },
});
