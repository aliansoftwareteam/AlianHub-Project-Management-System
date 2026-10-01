const fs = require('node:fs');
const path = require('node:path');
const { storageStatePath } = require('./fixtures');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Login.vue finishes with a full reload, and the router then sends a signed-in user
 * to Home at #/<companyId>. */
async function signInThroughForm(page, { email, password, companyId }) {
    await page.goto('/#/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('.auth__actions button[type="submit"]').click();
    await page.waitForURL(new RegExp(`#/${escapeRegex(companyId)}(/|$)`), { timeout: 60000 });
    await page.waitForFunction("window.localStorage.getItem('isLogging') === 'true'");
}

async function saveStorageState(browser, state, role) {
    const context = await browser.newContext({ baseURL: state.baseURL });
    try {
        const page = await context.newPage();
        await signInThroughForm(page, { email: state.users[role].email, password: state.password, companyId: state.companyId });
        // The first-visit tour sits beside what it describes; a spec that wants it clears this key.
        await page.evaluate("window.localStorage.setItem('ah.tour.skipped.shell', '1')");
        const file = storageStatePath(role);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await context.storageState({ path: file });
    } finally {
        await context.close();
    }
}

const settingsNav = (page) => page.getByRole('navigation', { name: 'Settings navigation' });

module.exports = { signInThroughForm, saveStorageState, settingsNav };
