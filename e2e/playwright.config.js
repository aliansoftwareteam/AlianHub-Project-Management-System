const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './specs',
    outputDir: './test-results',
    globalSetup: require.resolve('./support/global-setup.js'),
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    timeout: 60000,
    expect: { timeout: 15000 },
    reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
    use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
