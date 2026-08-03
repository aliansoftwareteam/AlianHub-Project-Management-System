// AHE-3838 — pure provider metadata for cloud file storage. No DB, no network,
// no env reads: everything here is a constant or a pure function, so it is
// unit-testable and safe to require from anywhere.
//
// Two providers, two auth shapes:
//
//   google_drive — full OAuth 2.0 authorization-code flow. We hold a refresh
//     token server-side and hand the browser a short-lived access token when it
//     needs to open the picker.
//
//   dropbox — the Chooser is a drop-in widget that needs only the public app
//     key; no OAuth, no tokens stored. OAuth fields exist solely so "import a
//     copy" can download bytes server-side, and are optional.

const PROVIDERS = {
    google_drive: {
        key: 'google_drive',
        name: 'Google Drive',
        icon: '📁',
        // Rendered by the settings form. `secret: true` values are write-only —
        // never returned to the client, only a "is it set" flag.
        fields: [
            { key: 'client_id', label: 'OAuth client ID', secret: false },
            { key: 'client_secret', label: 'OAuth client secret', secret: true },
            { key: 'api_key', label: 'Picker API key', secret: false },
            // REQUIRED for anything that touches the file after picking.
            //
            // With drive.file scope, Drive only grants the app access to a picked
            // file if the Picker was built with setAppId(<project number>). Without
            // it the pick still succeeds and the link works, but every later Drive
            // API call for that file returns 404 "File not found" — which is
            // exactly what broke thumbnails and importing.
            { key: 'app_id', label: 'Cloud project number (App ID) — needed for previews and importing', secret: false },
        ],
        setupHint: 'console.cloud.google.com → enable the Picker API and Drive API, create an API key and an OAuth client ID (Web application). The project number is on the project dashboard.',
        // Shown in the settings row so the whole checklist is visible without
        // leaving the page. Every line here is something that silently breaks a
        // specific capability if skipped — learned the hard way during AHE-3838.
        needsRedirectUri: true,
        requirements: [
            'Enable **Google Picker API** — without it the file picker will not open.',
            'Enable **Google Drive API** — needed for previews and for importing copies.',
            'Create an **OAuth client ID (Web application)** → client ID + client secret.',
            'Create an **API key** → used as the Picker API key.',
            'Copy the **project number** from the project dashboard into App ID. Skip it and picking still works, but previews and imports fail with "File not found".',
            'Add the redirect URI shown above to the client\'s **Authorised redirect URIs** (one per environment).',
            'On the **OAuth consent screen**, add the scope `drive.file`, and while the app is in Testing add yourself under Test users.',
        ],
        oauth: true,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        // drive.file grants access ONLY to files the user explicitly picks — not
        // their whole Drive. It is both the least invasive scope and the one that
        // avoids Google's restricted-scope verification.
        scope: 'https://www.googleapis.com/auth/drive.file',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
        // Fields the browser is allowed to see (the picker needs them).
        publicFields: ['client_id', 'api_key', 'app_id'],
        requiredFields: ['client_id', 'client_secret'],
        // Google needs these two to return a refresh token at all.
        extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    },
    dropbox: {
        key: 'dropbox',
        name: 'Dropbox',
        icon: '🗂️',
        fields: [
            { key: 'app_key', label: 'App key', secret: false },
            { key: 'app_secret', label: 'App secret (only needed to import copies)', secret: true },
        ],
        setupHint: 'dropbox.com/developers → Create app → Scoped access. Only the App key is required.',
        // No OAuth, so no redirect URI — but the domain allow-list is mandatory and
        // is the one step whose omission produces Dropbox's opaque
        // "App is misconfigured" screen instead of a useful error.
        needsRedirectUri: false,
        requirements: [
            'dropbox.com/developers → **Create app** → Scoped access → **Full Dropbox**.',
            'Copy the **App key** from the app\'s Settings tab.',
            'On the same tab, add your domain to **Chooser / Saver / Embedder domains** — e.g. `localhost` for dev, plus your staging and production hostnames. Bare hostname, no protocol or port. Miss this and the picker shows "App is misconfigured".',
            'No redirect URI, consent screen or API scopes needed — the picker signs the user in itself.',
            'The **App secret** is only needed for importing copies; linking works without it.',
        ],
        // The Chooser needs no user grant, so this provider is usable with the
        // app key alone. oauth stays false and connect/disconnect are no-ops.
        oauth: false,
        authUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
        scope: 'files.content.read files.metadata.read account_info.read',
        userInfoUrl: 'https://api.dropboxapi.com/2/users/get_current_account',
        publicFields: ['app_key'],
        requiredFields: ['app_key'],
        extraAuthParams: { token_access_type: 'offline' },
    },
};

const PROVIDER_KEYS = Object.keys(PROVIDERS);

const byKey = (key) => PROVIDERS[String(key || '')] || null;
const isProvider = (key) => !!byKey(key);

/**
 * The workspace credential key differs per provider (client_id vs app_key), so
 * "is this provider set up?" has to consult requiredFields rather than assume.
 */
const isConfigured = (providerKey, config) => {
    const p = byKey(providerKey);
    if (!p) return false;
    const cfg = config && typeof config === 'object' ? config : {};
    return p.requiredFields.every((f) => String(cfg[f] || '').trim().length > 0);
};

/**
 * Describe a provider for the settings form. Shape mirrors the Integrations
 * catalog so the form stays generic, but this module owns its own list — the
 * cloud providers are deliberately absent from that catalog (one place to
 * configure them, not two).
 */
const describe = (providerKey) => {
    const p = byKey(providerKey);
    if (!p) return null;
    return {
        provider: p.key,
        name: p.name,
        icon: p.icon || '',
        oauth: !!p.oauth,
        setupHint: p.setupHint || '',
        needsRedirectUri: !!p.needsRedirectUri,
        requirements: (p.requirements || []).slice(),
        fields: (p.fields || []).map((f) => ({ key: f.key, label: f.label, secret: !!f.secret })),
        requiredFields: p.requiredFields.slice(),
    };
};

/**
 * Sanitise a submitted app config: keep only declared fields, clip values, and
 * treat an omitted/blank SECRET as "leave the stored one alone". Without that
 * last rule, re-saving the form (which never receives the stored secret back)
 * would silently wipe it.
 */
const sanitizeAppConfig = (providerKey, submitted, existing = {}) => {
    const p = byKey(providerKey);
    if (!p) return { valid: false, reason: 'Unknown provider.', config: {} };
    const raw = submitted && typeof submitted === 'object' && !Array.isArray(submitted) ? submitted : {};
    const prev = existing && typeof existing === 'object' ? existing : {};
    const out = {};
    for (const f of p.fields || []) {
        const incoming = raw[f.key];
        const provided = incoming !== undefined && incoming !== null && String(incoming).trim().length > 0;
        if (provided) {
            out[f.key] = String(incoming).trim().slice(0, 512);
        } else if (f.secret && prev[f.key]) {
            out[f.key] = prev[f.key];      // keep the secret we already hold
        }
    }
    const missing = p.requiredFields.filter((f) => !String(out[f] || '').trim().length);
    if (missing.length) {
        const labels = missing.map((k) => {
            const field = (p.fields || []).find((x) => x.key === k);
            return (field && field.label) || k;
        });
        return { valid: false, reason: `Required: ${labels.join(', ')}.`, config: out };
    }
    return { valid: true, reason: '', config: out };
};

/**
 * App config as the settings form may see it: plain values for normal fields,
 * and a booleans-only `secrets` map for the write-only ones.
 */
const redactAppConfig = (providerKey, config) => {
    const p = byKey(providerKey);
    if (!p) return { config: {}, secrets: {} };
    const cfg = config && typeof config === 'object' ? config : {};
    const out = {};
    const secrets = {};
    for (const f of p.fields || []) {
        if (f.secret) secrets[f.key] = !!String(cfg[f.key] || '').length;
        else out[f.key] = String(cfg[f.key] || '');
    }
    return { config: out, secrets };
};

/** Only the fields the browser genuinely needs. Never leaks a *_secret. */
const publicConfig = (providerKey, config) => {
    const p = byKey(providerKey);
    if (!p) return {};
    const cfg = config && typeof config === 'object' ? config : {};
    const out = {};
    for (const f of p.publicFields) {
        if (String(cfg[f] || '').length) out[f] = String(cfg[f]);
    }
    return out;
};

const authUrlFor = (providerKey) => (byKey(providerKey) || {}).authUrl || '';
const tokenUrlFor = (providerKey) => (byKey(providerKey) || {}).tokenUrl || '';

/**
 * Build the consent URL. `state` must already be signed — see
 * cloudStorageRules.encodeState; this function does not authenticate anything.
 */
const buildAuthUrl = ({ provider, config, redirectUri, state }) => {
    const p = byKey(provider);
    if (!p) return '';
    const cfg = config || {};
    const params = new URLSearchParams({
        client_id: String(cfg.client_id || cfg.app_key || ''),
        redirect_uri: String(redirectUri || ''),
        response_type: 'code',
        scope: p.scope,
        state: String(state || ''),
        ...(p.extraAuthParams || {}),
    });
    return `${authUrlFor(provider, cfg)}?${params.toString()}`;
};

/** Form body for the code→token and refresh→token exchanges. */
const tokenRequestBody = ({ provider, config, code, refreshToken, redirectUri }) => {
    const cfg = config || {};
    const body = {
        client_id: String(cfg.client_id || cfg.app_key || ''),
        client_secret: String(cfg.client_secret || cfg.app_secret || ''),
    };
    if (refreshToken) {
        body.grant_type = 'refresh_token';
        body.refresh_token = String(refreshToken);
    } else {
        body.grant_type = 'authorization_code';
        body.code = String(code || '');
        body.redirect_uri = String(redirectUri || '');
    }
    return new URLSearchParams(body).toString();
};

/**
 * Normalise the wildly different /me shapes into { email, name }.
 */
const parseAccount = (provider, raw) => {
    const d = raw && typeof raw === 'object' ? raw : {};
    if (provider === 'google_drive') {
        return { email: String(d.email || ''), name: String(d.name || '') };
    }
    if (provider === 'dropbox') {
        return { email: String(d.email || ''), name: String((d.name && d.name.display_name) || '') };
    }
    return { email: '', name: '' };
};

/**
 * Where the server downloads the bytes from, for "import a copy". Google needs
 * ?alt=media; Graph exposes /content; Dropbox takes the path in a header, which
 * the caller handles (returns null here so the caller knows to special-case it).
 */
const downloadRequestFor = (provider, fileId) => {
    const id = encodeURIComponent(String(fileId || ''));
    if (provider === 'google_drive') {
        return { url: `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, headers: {} };
    }
    if (provider === 'dropbox') {
        return {
            url: 'https://content.dropboxapi.com/2/files/download',
            method: 'POST',
            headers: { 'Dropbox-API-Arg': JSON.stringify({ path: String(fileId || '') }) },
        };
    }
    return null;
};

/**
 * Where to ask for a preview image of a file.
 *
 * Needed because the pickers do NOT hand one back for drive files — Google's
 * Picker has no `thumbnails` field for DocsView results and its `iconUrl` is a
 * 16px type glyph, so a real preview has to be fetched from the API.
 *
 * These URLs are short-lived by design, which is why we resolve them per render
 * instead of storing them on the attachment.
 */
const thumbnailRequestFor = (provider, fileId) => {
    const id = encodeURIComponent(String(fileId || ''));
    if (provider === 'google_drive') {
        return {
            url: `https://www.googleapis.com/drive/v3/files/${id}?fields=thumbnailLink,hasThumbnail&supportsAllDrives=true`,
            pick: (d) => (d && d.hasThumbnail && d.thumbnailLink ? String(d.thumbnailLink) : ''),
        };
    }
    // Dropbox: the Chooser already returns a thumbnailLink for images, and its
    // thumbnail API streams binary rather than handing back a URL — not worth
    // proxying, so linked Dropbox files without one keep the placeholder.
    return null;
};

module.exports = {
    PROVIDERS,
    PROVIDER_KEYS,
    byKey,
    isProvider,
    isConfigured,
    describe,
    sanitizeAppConfig,
    redactAppConfig,
    publicConfig,
    authUrlFor,
    tokenUrlFor,
    buildAuthUrl,
    tokenRequestBody,
    parseAccount,
    downloadRequestFor,
    thumbnailRequestFor,
};
