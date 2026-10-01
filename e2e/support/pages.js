/* eslint-env browser */
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
        const file = storageStatePath(role);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await context.storageState({ path: file });
    } finally {
        await context.close();
    }
}

const settingsNav = (page) => page.getByRole('navigation', { name: 'Settings navigation' });

/* The first-run tours and the getting-started checklist sit over the screen a flow is about. */
const skipFirstRun = (page) => page.addInitScript(() => {
    for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
    sessionStorage.setItem('ah.gs.dismissed', '1');
});

const taskPanel = (page) => page.getByRole('dialog', { name: 'Task detail' });

const listRow = (page, taskName) => page.getByRole('row').filter({ has: page.getByRole('button', { name: taskName, exact: true }) });

/* A row's actions are hidden until the row is hovered or holds focus. */
async function chooseFromRowMenu(page, row, taskName, item) {
    await row.getByRole('button', { name: taskName, exact: true }).focus();
    await row.getByRole('button', { name: `More actions for ${taskName}`, exact: true }).click();
    await page.getByRole('menu', { name: `More actions for ${taskName}`, exact: true }).getByRole('menuitem', { name: item, exact: true }).click();
}

module.exports = { chooseFromRowMenu, listRow, saveStorageState, settingsNav, signInThroughForm, skipFirstRun, taskPanel };
