/* global document, getComputedStyle -- used inside functions that run in the page */
const STEP_TIMEOUT_MS = 10000;
const QUIET_MS = 1000;
const QUIET_LIMIT_MS = 20000;
const BUSY_LIMIT_MS = 12000;
const BUSY_POLL_MS = 250;
const BUSY = '[class*="skeleton"], [class*="skelaton"], [class*="spinner"], .lds-roller, [aria-busy="true"]';
const SOCKET_PATH = '/socket.io/';
const SHELL = '.ah-app';
const SHELL_TIMEOUT_MS = 30000;

function networkQuiet(page) {
    return new Promise((resolve) => {
        const inFlight = new Set();
        let quiet = null;
        const finish = () => {
            clearTimeout(quiet);
            clearTimeout(limit);
            page.off('request', onStart);
            page.off('requestfinished', onEnd);
            page.off('requestfailed', onEnd);
            resolve();
        };
        const arm = () => {
            clearTimeout(quiet);
            if (!inFlight.size) quiet = setTimeout(finish, QUIET_MS);
        };
        const onStart = (request) => {
            if (request.url().includes(SOCKET_PATH)) return;
            inFlight.add(request);
            clearTimeout(quiet);
        };
        const onEnd = (request) => {
            inFlight.delete(request);
            arm();
        };
        const limit = setTimeout(finish, QUIET_LIMIT_MS);
        page.on('request', onStart);
        page.on('requestfinished', onEnd);
        page.on('requestfailed', onEnd);
        arm();
    });
}

const showsBusy = (page) => page.evaluate((selector) => [...document.querySelectorAll(selector)].some((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}), BUSY);

// A view can pause longer than the quiet window before it asks for its rows, so a skeleton on screen outranks a quiet network.
async function settle(page) {
    await networkQuiet(page);
    const deadline = Date.now() + BUSY_LIMIT_MS;
    while (await showsBusy(page)) {
        if (Date.now() > deadline) return { note: 'still showing a loading state' };
        await page.waitForTimeout(BUSY_POLL_MS);
    }
    await networkQuiet(page);
    return {};
}

async function runStep(page, step) {
    if (step.action === 'press') return page.keyboard.press(step.key);
    const target = page.locator(step.selector).first();
    if (step.action === 'click') return target.click({ timeout: STEP_TIMEOUT_MS });
    if (step.action === 'hover') return target.hover({ timeout: STEP_TIMEOUT_MS });
    if (step.action === 'scrollTo') return target.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT_MS });
    if (step.action === 'waitFor') return target.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    throw new Error(`Unknown step "${step.action}"`);
}

module.exports = { SHELL, SHELL_TIMEOUT_MS, settle, runStep };
