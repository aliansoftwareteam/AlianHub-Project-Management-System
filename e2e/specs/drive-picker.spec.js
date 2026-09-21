const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { STATE_DIR, resolveMongoUrl } = require('../support/env');
const { startServer } = require('../support/server');

/* The Drive picker page under CSP_MODE=enforce. Google's real picker needs an account and credentials, so
 * api.js is answered by a stub that calls eval (as Google's module does) and returns one picked file. The
 * app page plays the opener's side of the handshake itself; cloudPicker.js is covered by vitest. */

const GOOGLE_API = 'https://apis.google.com/js/api.js';
const STUB = `
window.gapi = { load(name, options) {
    window.google = { picker: eval('({ ViewId: { DOCS: "docs" }, Action: { PICKED: "picked", CANCEL: "cancel" }, Feature: { MULTISELECT_ENABLED: "multi" } })') };
    const picker = window.google.picker;
    picker.DocsView = class { setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } };
    picker.PickerBuilder = class {
        setOAuthToken(token) { this.token = token; return this; }
        addView() { return this; }
        setDeveloperKey() { return this; }
        setAppId() { return this; }
        enableFeature() { return this; }
        setCallback(callback) { this.callback = callback; return this; }
        build() { return { setVisible: () => setTimeout(() => this.callback({ action: 'picked', docs: [{ id: 'e2e-file', name: this.token + '.pdf', sizeBytes: 3, mimeType: 'application/pdf', url: 'https://drive.google.com/file/d/e2e-file/view' }] }), 50) }; }
    };
    options.callback();
} };`;

const watchViolations = () => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
        window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
};

let server;

test.beforeAll(async () => {
    test.setTimeout(180000);
    server = await startServer({ mongoUrl: resolveMongoUrl(), logFile: path.join(STATE_DIR, 'drive-picker-e2e-server.log'), env: { CSP_MODE: 'enforce' } });
});

test.afterAll(async () => { if (server) await server.stop(); });

test('the Drive picker page runs Google\'s script under its own policy while the app enforces its policy', async ({ context, page }) => {
    await context.addInitScript(watchViolations);
    await context.route(GOOGLE_API, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));

    const app = await page.goto(`${server.baseURL}/login`);
    expect(app.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
    expect(app.headers()['content-security-policy']).not.toContain('apis.google.com');

    const popupDocument = context.waitForEvent('response', (res) => res.url() === `${server.baseURL}/pickers/google-drive`);
    const popupOpened = page.waitForEvent('popup');
    const exchange = page.evaluate(() => new Promise((resolve) => {
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
        const popup = window.open('/pickers/google-drive', 'drive-picker', 'popup,width=900,height=700');
        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin || event.source !== popup) return;
            if (event.data.type === 'drive-picker:ready') {
                popup.postMessage({ type: 'drive-picker:config', nonce, config: { token: 'e2e-token', developerKey: '', appId: '', multiple: false, labels: { loading: 'Opening' } } }, window.location.origin);
            } else if (event.data.nonce === nonce) {
                resolve(event.data);
            }
        });
    }));

    const popup = await popupOpened;
    const popupViolations = [];
    popup.on('console', (message) => { if (/Content Security Policy/i.test(message.text())) popupViolations.push(message.text()); });
    const popupPolicy = (await popupDocument).headers()['content-security-policy'];
    expect(popupPolicy).toContain("'unsafe-eval'");
    expect(popupPolicy).toContain("frame-ancestors 'none'");

    const result = await exchange;
    expect(result).toEqual({
        type: 'drive-picker:picked',
        nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
        files: [{ id: 'e2e-file', name: 'e2e-token.pdf', sizeBytes: 3, mimeType: 'application/pdf', url: 'https://drive.google.com/file/d/e2e-file/view', iconUrl: '', thumbnails: [] }],
    });
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect(popupViolations).toEqual([]);
    expect(await page.evaluate(() => window.__violations)).toEqual([]);
});

test('the app page itself still refuses the Google picker script', async ({ context, page }) => {
    await context.addInitScript(watchViolations);
    await page.goto(`${server.baseURL}/login`);
    const blocked = await page.evaluate(() => {
        const tag = document.createElement('script');
        tag.src = 'https://apis.google.com/js/api.js';
        return new Promise((resolve) => { tag.onerror = () => resolve(true); tag.onload = () => resolve(false); document.head.appendChild(tag); });
    });
    expect(blocked).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__violations)).toEqual(expect.arrayContaining([expect.stringMatching(/^script-src-elem https:\/\/apis\.google\.com/)]));
});
