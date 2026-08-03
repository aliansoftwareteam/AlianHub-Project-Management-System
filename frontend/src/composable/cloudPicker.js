// AHE-3838 — opens each provider's own file picker and returns a normalised
// list of picked files.
//
// Deliberately no folder browsing of our own: every provider ships a drop-in
// picker widget, so we load their script, open it, and take the metadata it hands
// back. Nothing here touches our storage.
//
// Normalised shape returned to callers (one entry per picked file):
//   { id, name, size, mimeType, url, iconUrl, thumbnailUrl }
//
// Auth differs per provider:
//   dropbox   — Chooser needs only the public app key; the user signs in inside
//               the widget. No token ever reaches us.
//   google    — Picker needs an OAuth access token, which the server mints from
//               the stored refresh token.
//   onedrive  — same as google.
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// ── script loading ──────────────────────────────────────────────────────────
// One in-flight promise per URL, so opening a picker twice never injects the
// SDK twice (which for the Dropbox drop-in would re-register its globals).
const scriptPromises = new Map();

const loadScript = (url, attrs = {}) => {
    if (scriptPromises.has(url)) return scriptPromises.get(url);
    const promise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-cloud-picker="${url}"]`);
        if (existing && existing.dataset.loaded === 'true') return resolve();

        const el = document.createElement('script');
        el.src = url;
        el.async = true;
        el.dataset.cloudPicker = url;
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        el.onload = () => { el.dataset.loaded = 'true'; resolve(); };
        el.onerror = () => {
            // Let a later attempt retry rather than caching the failure forever —
            // this is usually a transient network/ad-blocker condition.
            scriptPromises.delete(url);
            el.remove();
            reject(new Error(`Could not load ${url}`));
        };
        document.head.appendChild(el);
    });
    scriptPromises.set(url, promise);
    return promise;
};

// ── server helpers ──────────────────────────────────────────────────────────

/** Which providers this workspace has set up, and which this user has connected. */
export const fetchCloudProviders = async () => {
    try {
        const res = await apiRequest('get', `${env.CLOUD_STORAGE}/providers`);
        if (res && res.data && res.data.status) return res.data.data || [];
        return [];
    } catch (e) {
        // The attach menu must still open with "Upload from computer" if this
        // fails, so an error here is not fatal.
        console.error('cloudPicker: could not load providers', e);
        return [];
    }
};

/** Short-lived access token (+ browser-safe config) for one provider. */
const fetchPickerToken = async (provider) => {
    const res = await apiRequest('get', `${env.CLOUD_STORAGE}/${provider}/token`);
    const payload = res && res.data;
    if (!payload || !payload.status) {
        const err = new Error((payload && payload.statusText) || 'Could not authorise the picker.');
        err.code = (payload && payload.code) || '';
        throw err;
    }
    return payload.data || {};
};

/** Start the OAuth consent redirect for a provider. */
export const connectCloudProvider = async (provider, returnTo) => {
    // Query string built into the URL: apiRequest's 5th argument is spread into
    // the axios config, so it is not a params bag.
    const target = returnTo || (window.location.pathname + window.location.search);
    const query = `?returnTo=${encodeURIComponent(target)}`;
    const res = await apiRequest('get', `${env.CLOUD_STORAGE}/${provider}/auth-url${query}`);
    const payload = res && res.data;
    if (!payload || !payload.status || !payload.data || !payload.data.url) {
        throw new Error((payload && payload.statusText) || 'Could not start sign-in.');
    }
    // Full-page redirect, not a popup: the consent screens of all three providers
    // refuse to render inside one in several configurations.
    window.location.assign(payload.data.url);
    return true;
};

export const disconnectCloudProvider = async (provider) => {
    const res = await apiRequest('delete', `${env.CLOUD_STORAGE}/${provider}`);
    return !!(res && res.data && res.data.status);
};

// ── Dropbox ─────────────────────────────────────────────────────────────────

const openDropboxChooser = ({ appKey, multiple }) => new Promise((resolve, reject) => {
    loadScript('https://www.dropbox.com/static/api/2/dropins.js', {
        id: 'dropboxjs',
        'data-app-key': appKey,
    }).then(() => {
        if (!window.Dropbox || typeof window.Dropbox.choose !== 'function') {
            reject(new Error('The Dropbox Chooser is unavailable.'));
            return;
        }
        window.Dropbox.choose({
            multiselect: !!multiple,
            // 'preview' returns a shareable link that renders in Dropbox — the
            // link-mode behaviour we want. 'direct' links expire after 4 hours,
            // so they are useless for a stored attachment.
            linkType: 'preview',
            success: (files) => resolve((files || []).map((f) => ({
                id: f.id || f.link,
                name: f.name,
                size: Number(f.bytes || 0),
                mimeType: '',
                url: f.link,
                iconUrl: f.icon || '',
                thumbnailUrl: (f.thumbnailLink || ''),
            }))),
            cancel: () => resolve([]),
        });
    }).catch(reject);
});

// ── Google Drive ────────────────────────────────────────────────────────────

const loadGooglePicker = () => loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve, reject) => {
    if (!window.gapi) return reject(new Error('The Google API script did not initialise.'));
    if (window.google && window.google.picker) return resolve();
    window.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Could not load the Google Picker.')) });
}));

const openGooglePicker = ({ token, apiKey, multiple }) => new Promise((resolve, reject) => {
    loadGooglePicker().then(() => {
        const picker = window.google.picker;
        const view = new picker.DocsView(picker.ViewId.DOCS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false);
        const builder = new picker.PickerBuilder()
            .setOAuthToken(token)
            .addView(view)
            .setCallback((data) => {
                if (data.action === picker.Action.CANCEL) return resolve([]);
                if (data.action !== picker.Action.PICKED) return;
                resolve((data.docs || []).map((d) => ({
                    id: d.id,
                    name: d.name,
                    size: Number(d.sizeBytes || 0),
                    mimeType: d.mimeType || '',
                    // Prefer the canonical Drive link; url is a fallback for
                    // shortcut-type results that omit it.
                    url: d.url || `https://drive.google.com/open?id=${encodeURIComponent(d.id)}`,
                    iconUrl: d.iconUrl || '',
                    thumbnailUrl: '',
                })));
            });
        // The developer key is optional but Google throttles keyless picker use.
        if (apiKey) builder.setDeveloperKey(apiKey);
        if (multiple) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
        builder.build().setVisible(true);
    }).catch(reject);
});

// ── OneDrive ────────────────────────────────────────────────────────────────

const openOneDrivePicker = ({ token, clientId, multiple }) => new Promise((resolve, reject) => {
    loadScript('https://js.live.net/v7.5/OneDrive.js').then(() => {
        if (!window.OneDrive || typeof window.OneDrive.open !== 'function') {
            reject(new Error('The OneDrive picker is unavailable.'));
            return;
        }
        window.OneDrive.open({
            clientId,
            action: 'share',      // returns a shareable link rather than raw content
            multiSelect: !!multiple,
            advanced: {
                // Reuse the token the server already refreshed instead of running a
                // second, independent MSAL login inside the widget.
                accessToken: token,
                redirectUri: window.location.origin,
            },
            success: (response) => resolve(((response && response.value) || []).map((v) => ({
                id: v.id,
                name: v.name,
                size: Number(v.size || 0),
                mimeType: (v.file && v.file.mimeType) || '',
                url: (v.permissions && v.permissions[0] && v.permissions[0].link && v.permissions[0].link.webUrl) || v.webUrl || '',
                iconUrl: '',
                thumbnailUrl: (v.thumbnails && v.thumbnails[0] && v.thumbnails[0].medium && v.thumbnails[0].medium.url) || '',
            }))),
            cancel: () => resolve([]),
            error: (e) => reject(new Error((e && e.message) || 'The OneDrive picker failed.')),
        });
    }).catch(reject);
});

// ── public entry point ──────────────────────────────────────────────────────

/**
 * Open `provider`'s picker and resolve with the picked files (empty array if the
 * user cancelled).
 *
 * Throws with `code === 'not_connected'` / `'reauth_required'` when the user needs
 * to (re)authorise, so the caller can offer a Connect action instead of showing a
 * meaningless error.
 */
export const pickCloudFiles = async ({ provider, multiple = true }) => {
    if (provider === 'dropbox') {
        const { config } = await fetchPickerToken('dropbox');
        const appKey = (config && config.app_key) || '';
        if (!appKey) throw new Error('Dropbox is not set up for this workspace yet.');
        return openDropboxChooser({ appKey, multiple });
    }

    const { token, config } = await fetchPickerToken(provider);
    if (!token) {
        const err = new Error('Not connected.');
        err.code = 'not_connected';
        throw err;
    }
    if (provider === 'google_drive') {
        return openGooglePicker({ token, apiKey: (config && config.api_key) || '', multiple });
    }
    if (provider === 'onedrive') {
        return openOneDrivePicker({ token, clientId: (config && config.client_id) || '', multiple });
    }
    throw new Error('Unknown provider.');
};

/** Ask the server to copy a picked file into our own storage. */
export const importCloudFile = async ({ provider, fileId, filename, path }) => {
    const res = await apiRequest('post', `${env.CLOUD_STORAGE}/${provider}/import`, { fileId, filename, path });
    const payload = res && res.data;
    if (!payload || !payload.status) {
        const err = new Error((payload && payload.statusText) || 'Import failed.');
        err.code = (payload && payload.code) || '';
        throw err;
    }
    return payload.data || {};
};

export function cloudPicker() {
    return {
        fetchCloudProviders,
        pickCloudFiles,
        connectCloudProvider,
        disconnectCloudProvider,
        importCloudFile,
    };
}
