const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { startHarness } = require('./harness');
const { ROLE_NAMES, storageStatePath } = require('./fixtures');
const { signInThroughForm } = require('./pages');

async function saveStorageState(browser, state, role) {
    const context = await browser.newContext({ baseURL: state.baseURL });
    try {
        const page = await context.newPage();
        await signInThroughForm(page, { email: state.users[role].email, password: state.password, companyId: state.companyId });
        const file = storageStatePath(role);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await context.storageState({ path: file });
    } finally {
        await context.close();
    }
}

module.exports = async () => {
    const harness = await startHarness({ name: 'e2e' });
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
