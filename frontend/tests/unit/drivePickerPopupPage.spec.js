import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STATIC_DIR = path.resolve(__dirname, '../../../Modules/Pickers/static');
const PAGE = fs.readFileSync(path.join(STATIC_DIR, 'google-drive.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(STATIC_DIR, 'google-drive.js'), 'utf8');
const ORIGIN = window.location.origin;
const NONCE = 'a'.repeat(32);
const CONFIG = { token: 'ya29.popup-token', developerKey: 'AIza-dev-key', appId: '1234567890', multiple: true, labels: { loading: 'Opening Google Drive' } };

const deliver = (data, { origin = ORIGIN, source } = {}) => {
    const event = new Event('message');
    Object.defineProperties(event, { data: { value: data }, origin: { value: origin }, source: { value: source } });
    window.dispatchEvent(event);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeGoogle = () => {
    const calls = { built: 0 };
    class DocsView {
        setIncludeFolders() { return this; }
        setSelectFolderEnabled() { return this; }
    }
    class PickerBuilder {
        setOAuthToken(token) { calls.token = token; return this; }
        addView() { return this; }
        setCallback(callback) { calls.callback = callback; return this; }
        setDeveloperKey(key) { calls.developerKey = key; return this; }
        setAppId(id) { calls.appId = id; return this; }
        enableFeature(feature) { calls.feature = feature; return this; }
        build() { calls.built += 1; return { setVisible: () => {} }; }
    }
    const picker = { DocsView, PickerBuilder, ViewId: { DOCS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, Feature: { MULTISELECT_ENABLED: 'multi' } };
    return { calls, gapi: { load: (name, { callback }) => { window.google = { picker }; callback(); } } };
};

let opener;
let listeners;

const boot = () => {
    document.head.innerHTML = '';
    document.body.innerHTML = PAGE.replace(/^[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').replace(/<script\b[^>]*><\/script>/gi, '');
    new Function(SCRIPT)();
};

const loadGoogle = async (google = fakeGoogle()) => {
    const tag = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
    expect(tag).not.toBeNull();
    window.gapi = google.gapi;
    tag.dispatchEvent(new Event('load'));
    await settle();
    return google.calls;
};

describe('the Drive picker popup page', () => {
    beforeEach(() => {
        opener = { postMessage: vi.fn() };
        Object.defineProperty(window, 'opener', { value: opener, configurable: true });
        vi.spyOn(window, 'close').mockImplementation(() => {});
        listeners = [];
        const add = window.addEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, options) => { listeners.push([type, fn]); add(type, fn, options); });
    });

    afterEach(() => {
        listeners.forEach(([type, fn]) => window.removeEventListener(type, fn));
        vi.restoreAllMocks();
        delete window.gapi;
        delete window.google;
        Object.defineProperty(window, 'opener', { value: null, configurable: true });
    });

    it('tells its opener it is ready, on the app origin only', () => {
        boot();
        expect(opener.postMessage).toHaveBeenCalledWith({ type: 'drive-picker:ready' }, ORIGIN);
    });

    it('closes at once when nothing opened it', () => {
        Object.defineProperty(window, 'opener', { value: null, configurable: true });
        boot();
        expect(window.close).toHaveBeenCalled();
        expect(document.querySelector('script[src*="apis.google.com"]')).toBeNull();
    });

    it('ignores settings from another origin, another window, of another type or with a malformed nonce', () => {
        boot();
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: opener, origin: 'https://evil.example' });
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: window });
        deliver({ type: 'drive-picker:picked', nonce: NONCE, config: CONFIG }, { source: opener });
        deliver({ type: 'drive-picker:config', nonce: 'short', config: CONFIG }, { source: opener });
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: { ...CONFIG, token: '' } }, { source: opener });
        expect(document.querySelector('script[src*="apis.google.com"]')).toBeNull();
    });

    it('opens the picker with the settings its opener sent and shows the label it was given', async () => {
        boot();
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: opener });
        expect(document.getElementById('status').textContent).toBe('Opening Google Drive');
        const calls = await loadGoogle();
        expect(calls).toMatchObject({ token: CONFIG.token, developerKey: CONFIG.developerKey, appId: CONFIG.appId, feature: 'multi', built: 1 });
    });

    it('takes the first settings only', async () => {
        boot();
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: opener });
        deliver({ type: 'drive-picker:config', nonce: 'b'.repeat(32), config: { ...CONFIG, token: 'ya29.other' } }, { source: opener });
        const calls = await loadGoogle();
        expect(calls.token).toBe(CONFIG.token);
        expect(calls.built).toBe(1);
    });

    it('sends the picked files with the nonce to its opener and closes', async () => {
        boot();
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: opener });
        const calls = await loadGoogle();
        calls.callback({ action: 'picked', docs: [{ id: 'f1', name: 'Plan.pdf', sizeBytes: 12, mimeType: 'application/pdf', url: 'https://drive.google.com/file/d/f1/view', iconUrl: 'https://x.example/i.png', thumbnails: [{ url: 'https://x.example/t.png', width: 64, height: 64 }], serviceId: 'docs' }] });
        expect(opener.postMessage).toHaveBeenLastCalledWith({
            type: 'drive-picker:picked',
            nonce: NONCE,
            files: [{ id: 'f1', name: 'Plan.pdf', sizeBytes: 12, mimeType: 'application/pdf', url: 'https://drive.google.com/file/d/f1/view', iconUrl: 'https://x.example/i.png', thumbnails: [{ url: 'https://x.example/t.png', width: 64 }] }],
        }, ORIGIN);
        expect(window.close).toHaveBeenCalled();
    });

    it('sends a cancel with the nonce and closes', async () => {
        boot();
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: opener });
        const calls = await loadGoogle();
        calls.callback({ action: 'loaded' });
        expect(window.close).not.toHaveBeenCalled();
        calls.callback({ action: 'cancel' });
        expect(opener.postMessage).toHaveBeenLastCalledWith({ type: 'drive-picker:cancel', nonce: NONCE }, ORIGIN);
        expect(window.close).toHaveBeenCalled();
    });

    it('reports an error to its opener and closes when the Google script fails', async () => {
        boot();
        deliver({ type: 'drive-picker:config', nonce: NONCE, config: CONFIG }, { source: opener });
        document.querySelector('script[src="https://apis.google.com/js/api.js"]').dispatchEvent(new Event('error'));
        await settle();
        expect(opener.postMessage).toHaveBeenLastCalledWith({ type: 'drive-picker:error', nonce: NONCE }, ORIGIN);
        expect(window.close).toHaveBeenCalled();
    });
});
