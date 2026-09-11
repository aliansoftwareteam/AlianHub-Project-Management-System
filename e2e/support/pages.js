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

const settingsNav = (page) => page.getByRole('navigation', { name: 'Settings navigation' });

module.exports = { signInThroughForm, settingsNav };
