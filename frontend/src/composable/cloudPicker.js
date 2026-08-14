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

// ── workspace settings (Settings → Integrations) ────────────────────────────

/**
 * Field definitions + stored values for every provider, plus whether the caller
 * may edit them. Secret values are never returned — only a flag saying
 * one is stored.
 */
export const fetchCloudSettings = async () => {
    const res = await apiRequest('get', `${env.CLOUD_STORAGE}/settings`);
    const payload = res && res.data;
    if (!payload || !payload.status) {
        throw new Error((payload && payload.statusText) || 'Could not load cloud storage settings.');
    }
    return payload.data || { canManage: false, providers: [] };
};

export const saveCloudSettings = async (provider, config) => {
    const res = await apiRequest('put', `${env.CLOUD_STORAGE}/settings/${provider}`, { config });
    const payload = res && res.data;
    if (!payload || !payload.status) {
        throw new Error((payload && payload.statusText) || 'Could not save.');
    }
    return payload.data || {};
};

export const clearCloudSettings = async (provider) => {
    const res = await apiRequest('delete', `${env.CLOUD_STORAGE}/settings/${provider}`);
    const payload = res && res.data;
    if (!payload || !payload.status) {
        throw new Error((payload && payload.statusText) || 'Could not remove.');
    }
    return true;
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
    //
    // `origin` is sent explicitly because the dev server proxies /api, making this
    // a SAME-origin request — browsers omit the Origin header on those, so the
    // server would otherwise have to guess. It only honours allow-listed values.
    const target = returnTo || (window.location.pathname + window.location.search);
    const query = `?returnTo=${encodeURIComponent(target)}&origin=${encodeURIComponent(window.location.origin)}`;
    const res = await apiRequest('get', `${env.CLOUD_STORAGE}/${provider}/auth-url${query}`);
    const payload = res && res.data;
    if (!payload || !payload.status || !payload.data || !payload.data.url) {
        throw new Error((payload && payload.statusText) || 'Could not start sign-in.');
    }
    // Full-page redirect, not a popup: provider consent screens refuse to render
    // inside one in several configurations.
    window.location.assign(payload.data.url);
    return true;
};

export const disconnectCloudProvider = async (provider) => {
    const res = await apiRequest('delete', `${env.CLOUD_STORAGE}/${provider}`);
    return !!(res && res.data && res.data.status);
};

// ── Dropbox ─────────────────────────────────────────────────────────────────

const openDropboxChooser = ({ appKey, multiple, mode }) => new Promise((resolve, reject) => {
    loadScript('https://www.dropbox.com/static/api/2/dropins.js', {
        id: 'dropboxjs',
        'data-app-key': appKey,
    }).then(() => {
        if (!window.Dropbox || typeof window.Dropbox.choose !== 'function') {
            reject(new Error('The Dropbox Chooser is unavailable.'));
            return;
        }
        // linkType depends on what we're about to do with the file:
        //   preview — a shareable link that renders in Dropbox and does not
        //             expire. Right for LINK mode, where we store it.
        //   direct  — a raw content URL that expires in ~4 hours. Useless to
        //             store, but exactly what IMPORT needs: the Chooser gives us
        //             no OAuth token, so this link is the only way the server can
        //             fetch the bytes at all.
        const isImport = mode === 'import';
        window.Dropbox.choose({
            multiselect: !!multiple,
            linkType: isImport ? 'direct' : 'preview',
            success: (files) => resolve((files || []).map((f) => ({
                id: f.id || f.link,
                name: f.name,
                size: Number(f.bytes || 0),
                mimeType: '',
                url: f.link,
                iconUrl: f.icon || '',
                thumbnailUrl: (f.thumbnailLink || ''),
                // Only meaningful for import, and deliberately not stored on the
                // attachment — it would be dead within hours.
                downloadUrl: isImport ? f.link : '',
            }))),
            cancel: () => resolve([]),
        });
    }).catch(reject);
});

// ── Google Drive ────────────────────────────────────────────────────────────

/**
 * Biggest entry from the Picker's `thumbnails` array ([{url,width,height}]).
 *
 * This is a real preview image. It is NOT the same as `iconUrl`, which is a
 * 16px file-TYPE glyph — stretching that into a 131x100 tile produced a blurry
 * coloured blob, so the tile must never fall back to it.
 */
const largestThumbnail = (thumbnails) => {
    if (!Array.isArray(thumbnails) || !thumbnails.length) return '';
    const best = thumbnails
        .filter((t) => t && t.url)
        .sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0];
    return (best && best.url) || '';
};

const loadGooglePicker = () => loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve, reject) => {
    if (!window.gapi) return reject(new Error('The Google API script did not initialise.'));
    if (window.google && window.google.picker) return resolve();
    window.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Could not load the Google Picker.')) });
}));

const openGooglePicker = ({ token, apiKey, appId, multiple }) => new Promise((resolve, reject) => {
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
                    thumbnailUrl: largestThumbnail(d.thumbnails),
                })));
            });
        // The developer key is optional but Google throttles keyless picker use.
        if (apiKey) builder.setDeveloperKey(apiKey);
        // setAppId is what makes a drive.file pick actually grant our app access
        // to that file. Omit it and picking still works, but every later Drive API
        // call for the file 404s — no thumbnails, no importing.
        if (appId) builder.setAppId(appId);
        if (multiple) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
        builder.build().setVisible(true);
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
export const pickCloudFiles = async ({ provider, multiple = true, mode = 'link' }) => {
    if (provider === 'dropbox') {
        const { config } = await fetchPickerToken('dropbox');
        const appKey = (config && config.app_key) || '';
        if (!appKey) throw new Error('Dropbox is not set up for this workspace yet.');
        // Dropbox needs to know the mode up front: the kind of link the Chooser
        // returns is decided when it opens, not afterwards.
        return openDropboxChooser({ appKey, multiple, mode });
    }

    const { token, config } = await fetchPickerToken(provider);
    if (!token) {
        const err = new Error('Not connected.');
        err.code = 'not_connected';
        throw err;
    }
    if (provider === 'google_drive') {
        return openGooglePicker({
            token,
            apiKey: (config && config.api_key) || '',
            appId: (config && config.app_id) || '',
            multiple,
        });
    }
    throw new Error('Unknown provider.');
};

// Resolved thumbnails, keyed `provider:fileId`. The pickers don't return a usable
// preview for drive files, so each one costs a round trip — cache them for the
// life of the page so scrolling a list or opening Files & Links doesn't refetch.
// Value is a promise, so N tiles mounting at once share one request.
const thumbnailCache = new Map();

/**
 * Preview image URL for a linked file, or '' if it has none.
 *
 * Resolved at render time rather than stored on the attachment because every
 * provider issues these as short-lived URLs — a stored one would eventually 404.
 * Never throws: a missing preview is cosmetic.
 */
export const resolveCloudThumbnail = (provider, fileId) => {
    if (!provider || !fileId) return Promise.resolve('');
    const key = `${provider}:${fileId}`;
    if (thumbnailCache.has(key)) return thumbnailCache.get(key);

    const promise = apiRequest('get', `${env.CLOUD_STORAGE}/${provider}/thumbnail?fileId=${encodeURIComponent(fileId)}`)
        .then((res) => (res && res.data && res.data.status && res.data.data && res.data.data.url) || '')
        .catch(() => {
            // Don't cache a transient failure — let the next mount retry.
            thumbnailCache.delete(key);
            return '';
        });
    thumbnailCache.set(key, promise);
    return promise;
};

/** Ask the server to copy a picked file into our own storage. */
export const importCloudFile = async ({ provider, fileId, filename, path, downloadUrl }) => {
    const res = await apiRequest('post', `${env.CLOUD_STORAGE}/${provider}/import`, { fileId, filename, path, downloadUrl });
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
