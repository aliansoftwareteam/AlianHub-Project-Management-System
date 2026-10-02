const { chromium } = require('@playwright/test');
const { startHarness } = require('./harness');
const { ROLE_NAMES } = require('./fixtures');
const { saveStorageState } = require('./pages');

module.exports = async () => {
    const harness = await startHarness({ name: 'e2e', env: { MCP_TOOLS_WORK: 'on' } });
    const browser = await chromium.launch();
    try {
        for (const role of ROLE_NAMES) await saveStorageState(browser, harness.state, role);
    } catch (error) {
        await harness.stop();
        throw error;
    } finally {
        await browser.close();
    }
    return () => harness.stop();
};
