// AHE-3838 — cloud file storage (Google Drive / Dropbox).
//
// Everything here is PER USER. One row in cloud_storage_connections per
// (user, provider) holds both that person's app registration (client id/secret,
// api key, app id) and their OAuth grant.
//
// Deliberately not company-scoped. An earlier revision kept the credentials in
// integration_connections, shared per workspace — which meant a fresh member
// opened Settings and saw the owner's saved credentials, and could edit or
// delete them for everybody. For an optional, self-hosted attachment source that
// is simply wrong: each person sets up their own, and two people may point at the
// same drive account independently without interfering.
//
// So a user can only ever read or write their own row, and there is no shared
// state left to trample.
//
// The browser never receives a refresh token. It asks for a short-lived access
// token only at the moment it opens a picker.
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { buildCorsAllowList, isOriginAllowed } = require('../../utils/cors');
const logger = require('../../Config/loggerConfig');
const P = require('./helpers/cloudProviders');
const R = require('./helpers/cloudStorageRules');
const { encryptToken, decryptToken } = require('./helpers/cloudCrypto');

const LOG_PREFIX = '[cloud-storage]';

// Import cap. Mirrors the intent of the normal upload limit: without it, a
// pointer to a 5 GB Drive file would stream straight into Wasabi.
const MAX_IMPORT_BYTES = Number(process.env.CLOUD_STORAGE_MAX_IMPORT_BYTES || 100 * 1024 * 1024);

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);

// Caller identity comes from the JWT middleware only. Never from the body —
// a forgeable userId here would let one user read another's Drive tokens.
const userOf = (req) => String(req.uid || '');

const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');

/**
 * Where to send the user after consent.
 *
 * The callback necessarily lands on the API origin (that is the registered
 * redirect URI), but in development the SPA runs on a DIFFERENT origin — :8080
 * with a dev-server proxy — so redirecting to APIURL would drop the user on
 * :4000, a separate origin with its own localStorage, looking logged out.
 *
 * So the caller tells us where it came from, and we only honour it if it is on
 * the CORS allow-list we already maintain (WEBURL / APIURL / CORS_ORIGINS).
 * Validating here rather than at redirect time is what stops this becoming an
 * open redirect — after this point the value is inside a signed token.
 */
const resolveReturnOrigin = (req) => {
    const candidates = [
        req.query && req.query.origin,
        req.headers && req.headers.origin,
        // Same-origin GETs often omit the Origin header; Referer still carries it.
        (() => {
            try { return new URL(String((req.headers || {}).referer || '')).origin; } catch (e) { return ''; }
        })(),
    ];
    const allowList = buildCorsAllowList();
    for (const candidate of candidates) {
        const value = String(candidate || '').replace(/\/+$/, '');
        if (value && isOriginAllowed(value, allowList) && /^https?:\/\//i.test(value)) return value;
    }
    return apiBase();
};
// Deliberately outside the JWT-protected /api/v1/cloud-storage prefix — see
// routes.js. Whatever this resolves to must also be registered as an authorised
// redirect URI in each provider's developer console, per environment.
const redirectUri = () => `${apiBase()}/api/v1/cloud-oauth/callback`;

// ── per-user credentials + grant (one row, one owner) ───────────────────────

const loadConnection = (companyId, userId, provider) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
    data: [{ userId: String(userId), provider: String(provider), deletedStatusKey: { $ne: 1 } }],
}, 'findOne');

/**
 * This user's own app config for a provider, or {} if they haven't set one up.
 * Never falls back to anyone else's — that fallback is exactly the leak this
 * design removes.
 */
const loadAppConfig = async (companyId, userId, provider) => {
    const row = await loadConnection(companyId, userId, provider);
    if (!row) return { config: {}, row: null };
    const cfg = (row.config && (row.config.toObject ? row.config.toObject() : row.config)) || {};
    return { config: cfg, row };
};

const upsertConnection = (companyId, userId, provider, patch) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
    data: [
        { userId: String(userId), provider: String(provider) },
        { $set: { ...patch, userId: String(userId), provider: String(provider), deletedStatusKey: 0 } },
        { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after' },
    ],
}, 'findOneAndUpdate');

/**
 * Did the identity of the app registration change? Only these fields invalidate
 * an existing grant — editing e.g. the API key or App ID does not.
 */
const credentialsChanged = (provider, before = {}, after = {}) => {
    const keys = provider === 'dropbox' ? ['app_key'] : ['client_id', 'client_secret'];
    return keys.some((k) => String(before[k] || '') !== String(after[k] || ''));
};

/**
 * GET /api/v1/cloud-storage/settings
 *
 * Everything the Settings → Integrations section needs: the field definitions,
 * the stored non-secret values and which secrets are set.
 *
 * Open to every member. This is an OPTIONAL extra attachment source on a
 * self-hosted, open-source app — anyone willing to register an app with a
 * provider may set it up, and anyone with an account may connect it. Uploading
 * from your computer is always there for whoever doesn't want to.
 */
exports.getSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const rows = [];
        for (const key of P.PROVIDER_KEYS) {
            const described = P.describe(key);
            let cfg = {};
            let connection = null;
            try {
                const own = await loadAppConfig(companyId, userId, key);
                cfg = own.config;
                connection = own.row;
            } catch (e) {
                logger.error(`${LOG_PREFIX} own config read failed (${key}): ${e.message}`);
            }
            const configured = P.isConfigured(key, cfg);
            rows.push({
                ...described,
                ...P.redactAppConfig(key, cfg),
                configured,
                // Dropbox's Chooser needs no grant, so configured == usable there.
                connected: described.oauth
                    ? !!(configured && connection && connection.status === 'connected' && connection.accessToken)
                    : configured,
                connectionStatus: (connection && connection.status) || '',
                accountEmail: (connection && connection.accountEmail) || '',
            });
        }
        return res.send({ status: true, data: { redirectUri: redirectUri(), providers: rows } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} getSettings: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

exports.saveSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const existing = await loadAppConfig(companyId, userId, provider);
        const check = P.sanitizeAppConfig(provider, (req.body || {}).config, existing.config);
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const saved = await upsertConnection(companyId, userId, provider, {
            config: check.config,
            // Changing the client id/secret invalidates any grant obtained under
            // the old app, so a re-save that alters them clears the tokens rather
            // than leaving a connection that cannot refresh.
            ...(credentialsChanged(provider, existing.config, check.config)
                ? { accessToken: '', refreshToken: '', expiresAt: null, status: 'disconnected', accountEmail: '', accountName: '' }
                : {}),
        });
        logger.info(`${LOG_PREFIX} ${provider} credentials saved by user ${userId}`);
        return res.send({
            status: true,
            statusText: 'Saved.',
            data: { provider, ...P.redactAppConfig(provider, (saved && saved.config) || check.config) },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} saveSettings: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * DELETE /api/v1/cloud-storage/settings/:provider
 *
 * Forget THIS user's credentials and grant for a provider. Nobody else is
 * touched — an earlier revision cascaded across every user because the
 * credentials were shared; now there is nothing shared to cascade to.
 */
exports.clearSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
            data: [
                { userId: String(userId), provider },
                { $set: { config: {}, accessToken: '', refreshToken: '', expiresAt: null, status: 'disconnected', accountEmail: '', accountName: '', deletedStatusKey: 1 } },
            ],
        }, 'updateOne');
        logger.info(`${LOG_PREFIX} ${provider} credentials removed by user ${userId}`);
        return res.send({ status: true, statusText: 'Removed.' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} clearSettings: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/cloud-storage/providers
 *
 * One row per provider: is it set up for this workspace, has THIS user connected
 * it, and the browser-safe config the picker needs. Drives the attach menu, so it
 * has to be cheap and never throw — a provider that errors is reported as
 * unavailable rather than failing the whole list.
 */
exports.listProviders = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!userId) return res.send({ status: false, statusText: 'Not authenticated.' });

        const out = [];
        for (const key of P.PROVIDER_KEYS) {
            const meta = P.byKey(key);
            let cfg = {};
            let connection = null;
            try {
                const own = await loadAppConfig(companyId, userId, key);
                cfg = own.config;
                connection = own.row;
            } catch (e) {
                logger.error(`${LOG_PREFIX} own config read failed (${key}): ${e.message}`);
            }
            const configured = P.isConfigured(key, cfg);
            out.push({
                provider: key,
                name: meta.name,
                // Dropbox's Chooser needs no user grant, so it is usable as soon
                // as the workspace app key exists.
                requiresConnect: !!meta.oauth,
                configured,
                connected: meta.oauth
                    ? !!(configured && connection && connection.status === 'connected' && connection.accessToken)
                    : configured,
                status: (connection && connection.status) || (configured ? 'available' : 'not_configured'),
                accountEmail: (connection && connection.accountEmail) || '',
                config: configured ? P.publicConfig(key, cfg) : {},
            });
        }
        return res.send({ status: true, data: out });
    } catch (e) {
        logger.error(`${LOG_PREFIX} listProviders: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/cloud-storage/:provider/auth-url?returnTo=/path
 * Returns the consent URL. `state` is signed — see cloudStorageRules.
 */
exports.authUrl = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!apiBase()) return res.send({ status: false, statusText: 'APIURL is not configured on the server, so the OAuth redirect URI cannot be built.' });

        const own = await loadAppConfig(companyId, userId, provider);
        if (!P.isConfigured(provider, own.config)) {
            return res.send({ status: false, statusText: `Add your ${P.byKey(provider).name} credentials first.` });
        }
        const state = R.encodeState({
            companyId,
            userId,
            provider,
            returnTo: req.query && req.query.returnTo,
            returnOrigin: resolveReturnOrigin(req),
        });
        const url = P.buildAuthUrl({ provider, config: own.config, redirectUri: redirectUri(), state });
        return res.send({ status: true, data: { url, redirectUri: redirectUri() } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} authUrl: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/cloud-storage/oauth/callback?code&state
 *
 * PUBLIC by necessity — this is a redirect from the provider, with no JWT and no
 * companyid header. The signed `state` is the only identity here, which is why it
 * is verified before anything is written.
 */
exports.oauthCallback = async (req, res) => {
    // `origin` comes from the signed state, so it is one of the allow-listed
    // values resolveReturnOrigin() approved when the flow started.
    const fail = (message, returnTo, origin) => {
        const target = `${origin || apiBase()}${R.safeReturnPath(returnTo) || '/'}`;
        const sep = target.includes('?') ? '&' : '?';
        return res.redirect(`${target}${sep}cloudStorage=error&reason=${encodeURIComponent(String(message).slice(0, 200))}`);
    };
    try {
        const { code, state, error } = req.query || {};
        const decoded = R.decodeState(state);
        // Verify state BEFORE reporting a provider error, so a forged state can't
        // steer the redirect.
        if (!decoded) {
            logger.error(`${LOG_PREFIX} callback rejected: invalid or expired state`);
            return fail('The sign-in link expired. Please try connecting again.', '', '');
        }
        const returnOrigin = decoded.returnOrigin || apiBase();
        if (error) return fail(String(error), decoded.returnTo, returnOrigin);
        if (!code) return fail('No authorization code was returned.', decoded.returnTo, returnOrigin);

        const { companyId, userId, provider } = decoded;
        const own = await loadAppConfig(companyId, userId, provider);
        if (!P.isConfigured(provider, own.config)) return fail('Your credentials for this provider are no longer set up.', decoded.returnTo, returnOrigin);

        const tokenRes = await axios.post(
            P.tokenUrlFor(provider),
            P.tokenRequestBody({ provider, config: own.config, code, redirectUri: redirectUri() }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 },
        );
        const tok = tokenRes.data || {};
        if (!tok.access_token) return fail('The provider did not return an access token.', decoded.returnTo, returnOrigin);

        // Best-effort: label the connection with the account it belongs to, so a
        // user with two Google accounts can tell which one is linked.
        let account = { email: '', name: '' };
        try {
            const meta = P.byKey(provider);
            const isDropbox = provider === 'dropbox';
            const infoRes = await axios({
                method: isDropbox ? 'post' : 'get',
                url: meta.userInfoUrl,
                headers: { Authorization: `Bearer ${tok.access_token}` },
                data: isDropbox ? null : undefined,
                timeout: 15000,
            });
            account = P.parseAccount(provider, infoRes.data);
        } catch (e) {
            logger.error(`${LOG_PREFIX} account lookup failed (${provider}): ${e.message}`);
        }

        const expiresAt = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : null;
        const patch = {
            accessToken: encryptToken(tok.access_token),
            expiresAt,
            scope: String(tok.scope || ''),
            status: 'connected',
            accountEmail: account.email,
            accountName: account.name,
            connectedAt: new Date(),
        };
        // A refresh is only issued on first consent; a re-auth that omits it must
        // not wipe the one we already hold.
        if (tok.refresh_token) patch.refreshToken = encryptToken(tok.refresh_token);
        await upsertConnection(companyId, userId, provider, patch);

        logger.info(`${LOG_PREFIX} ${provider} connected for user ${userId}`);
        const target = `${returnOrigin}${R.safeReturnPath(decoded.returnTo) || '/'}`;
        const sep = target.includes('?') ? '&' : '?';
        return res.redirect(`${target}${sep}cloudStorage=connected&provider=${encodeURIComponent(provider)}`);
    } catch (e) {
        const detail = (e.response && e.response.data && (e.response.data.error_description || e.response.data.error)) || e.message;
        logger.error(`${LOG_PREFIX} oauthCallback: ${detail}`);
        return fail(detail, '', '');
    }
};

/**
 * Return a usable access token for (user, provider), refreshing if needed.
 * Resolves { token } or { error } — never throws, so callers can map the failure
 * onto a response.
 */
const getAccessToken = async (companyId, userId, provider) => {
    const { config, row: conn } = await loadAppConfig(companyId, userId, provider);
    if (!P.isConfigured(provider, config)) {
        return { error: `Add your ${P.byKey(provider).name} credentials first.` };
    }
    if (!conn) return { error: 'not_connected' };

    const current = decryptToken(conn.accessToken);
    if (current && !R.isExpired(conn.expiresAt)) return { token: current, config };

    const refresh = decryptToken(conn.refreshToken);
    if (!refresh) return { error: 'reauth_required' };

    try {
        const tokenRes = await axios.post(
            P.tokenUrlFor(provider),
            P.tokenRequestBody({ provider, config, refreshToken: refresh }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 },
        );
        const tok = tokenRes.data || {};
        if (!tok.access_token) return { error: 'reauth_required' };
        const patch = {
            accessToken: encryptToken(tok.access_token),
            expiresAt: tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : null,
            status: 'connected',
            lastUsedAt: new Date(),
        };
        // Providers sometimes rotate the refresh token on use.
        if (tok.refresh_token) patch.refreshToken = encryptToken(tok.refresh_token);
        await upsertConnection(companyId, userId, provider, patch);
        return { token: tok.access_token, config };
    } catch (e) {
        const detail = (e.response && e.response.data && (e.response.data.error_description || e.response.data.error)) || e.message;
        logger.error(`${LOG_PREFIX} refresh failed (${provider}, user ${userId}): ${detail}`);
        // The grant is gone (revoked in the provider's console, password change,
        // …). Mark it so the UI prompts to reconnect instead of failing silently
        // on every pick.
        try { await upsertConnection(companyId, userId, provider, { status: 'reauth_required' }); } catch (_e) { /* best effort */ }
        return { error: 'reauth_required' };
    }
};

/**
 * GET /api/v1/cloud-storage/:provider/token
 * Short-lived access token for the browser picker. Refresh tokens stay server-side.
 */
exports.pickerToken = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const meta = P.byKey(provider);
        if (!meta.oauth) {
            // Dropbox: nothing to hand out — the Chooser authenticates the user
            // itself against the public app key.
            const own = await loadAppConfig(companyId, userId, provider);
            if (!P.isConfigured(provider, own.config)) return res.send({ status: false, statusText: `Add your ${meta.name} credentials first.` });
            return res.send({ status: true, data: { token: '', config: P.publicConfig(provider, own.config) } });
        }

        const result = await getAccessToken(companyId, userId, provider);
        if (result.error) {
            return res.send({ status: false, statusText: result.error, code: result.error });
        }
        return res.send({ status: true, data: { token: result.token, config: P.publicConfig(provider, result.config) } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} pickerToken: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/cloud-storage/:provider/thumbnail?fileId=...
 *
 * A preview image URL for one linked file. Resolved per render rather than stored
 * on the attachment, because every provider issues these as short-lived URLs.
 *
 * Always answers 200 with `{ url: '' }` when there is no thumbnail to be had —
 * no access, not an image, provider hiccup. A missing preview is cosmetic, so the
 * tile should fall back to its placeholder quietly rather than log an error for
 * something that is often simply "this file has no preview".
 */
exports.thumbnail = async (req, res) => {
    // Read outside the try: the catch logs it, and a const declared inside the try
    // is not in scope there — referencing it threw a ReferenceError, which rejected
    // the handler and brought the process down via unhandledRejection.
    const provider = String((req.params || {}).provider || '');
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const fileId = R.clip((req.query || {}).fileId, 512);
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!fileId) return res.send({ status: false, statusText: 'fileId is required.' });

        const request = P.thumbnailRequestFor(provider, fileId);
        if (!request) return res.send({ status: true, data: { url: '' } });

        const auth = await getAccessToken(companyId, userId, provider);
        if (auth.error) return res.send({ status: true, data: { url: '' } });

        const response = await axios.get(request.url, {
            headers: { Authorization: `Bearer ${auth.token}` },
            timeout: 15000,
        });
        const url = request.pick(response.data) || '';
        // Only hand back an https URL — this value goes straight into an <img src>.
        return res.send({ status: true, data: { url: R.isHttpsUrl(url) ? url : '' } });
    } catch (e) {
        // Loud, and with the provider's own words. Logging this at debug hid a
        // real misconfiguration behind a blank tile: with drive.file scope, Drive
        // returns 404 for a picked file unless the Picker was built with
        // setAppId(<project number>), so "no preview" looked like "this file has
        // no preview" when it actually meant "the app was never granted the file".
        const detail = (e.response && e.response.data && e.response.data.error
            && (e.response.data.error.message || e.response.data.error))
            || e.message;
        const status = (e.response && e.response.status) || '';
        logger.error(`${LOG_PREFIX} thumbnail lookup failed (${provider} ${status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
        // Still a 200 with an empty url — a missing preview must not break the
        // tile — but `reason` makes it visible in devtools instead of silent.
        return res.send({ status: true, data: { url: '', reason: typeof detail === 'string' ? detail : 'lookup failed' } });
    }
};

/**
 * DELETE /api/v1/cloud-storage/:provider — forget this user's grant.
 * Soft delete, matching every other collection in the codebase.
 */
exports.disconnect = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
            data: [
                { userId: String(userId), provider },
                { $set: { deletedStatusKey: 1, accessToken: '', refreshToken: '', status: 'disconnected' } },
            ],
        }, 'updateOne');
        logger.info(`${LOG_PREFIX} ${provider} disconnected for user ${userId}`);
        return res.send({ status: true, statusText: 'Disconnected.' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} disconnect: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * POST /api/v1/cloud-storage/:provider/import  { fileId, filename, path }
 *
 * "Import a copy": pull the bytes down with the user's token and hand them to
 * the SAME storage layer an ordinary upload uses. The resulting attachment has no
 * `source`, so from that point on nothing about it is cloud-specific.
 */
exports.importFile = async (req, res) => {
    let tmpPath = '';
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        const body = req.body || {};
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const fileId = R.clip(body.fileId, 512);
        const storagePath = R.clip(body.path, 1024);
        if (!fileId) return res.send({ status: false, statusText: 'fileId is required.' });
        if (!storagePath) return res.send({ status: false, statusText: 'path is required.' });
        // The path becomes a filesystem/bucket key — refuse traversal outright.
        if (storagePath.includes('..') || storagePath.startsWith('/') || storagePath.includes('\\')) {
            return res.send({ status: false, statusText: 'path is not valid.' });
        }

        // Dropbox's Chooser issues no OAuth token, so importing uses the temporary
        // `direct` link it returns instead. That URL comes from the browser, so it
        // is matched against a host allow-list first — see isDropboxContentUrl.
        // Every other provider goes through the stored grant.
        const suppliedUrl = R.clip(body.downloadUrl, 2048);
        const useSuppliedUrl = provider === 'dropbox' && suppliedUrl;
        if (useSuppliedUrl && !R.isDropboxContentUrl(suppliedUrl)) {
            logger.error(`${LOG_PREFIX} import rejected a non-Dropbox download URL from user ${userId}`);
            return res.send({ status: false, statusText: 'That download link is not a Dropbox URL.' });
        }

        let request;
        let authHeader = {};
        if (useSuppliedUrl) {
            request = { url: suppliedUrl, method: 'get', headers: {} };
        } else {
            const auth = await getAccessToken(companyId, userId, provider);
            if (auth.error) {
                // Dropbox reaching here means link mode was used for the pick, so
                // there is no direct URL and no grant to fall back on.
                const statusText = (provider === 'dropbox' && auth.error === 'not_connected')
                    ? 'Dropbox import needs the file to be re-picked with "Import a copy" ticked.'
                    : auth.error;
                return res.send({ status: false, statusText, code: auth.error });
            }
            request = P.downloadRequestFor(provider, fileId);
            if (!request) return res.send({ status: false, statusText: 'This provider cannot be imported from.' });
            authHeader = { Authorization: `Bearer ${auth.token}` };
        }

        const download = await axios({
            method: request.method || 'get',
            url: request.url,
            headers: { ...(request.headers || {}), ...authHeader },
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: MAX_IMPORT_BYTES,
            maxBodyLength: MAX_IMPORT_BYTES,
            // Dropbox redirects to a per-user content host; do NOT let a redirect
            // walk us off the allow-listed origin onto something arbitrary.
            maxRedirects: 5,
            beforeRedirect: useSuppliedUrl
                ? (options) => {
                    const next = `${options.protocol}//${options.hostname}${options.path || ''}`;
                    if (!R.isDropboxContentUrl(next)) throw new Error('Refused a redirect away from Dropbox.');
                }
                : undefined,
        });

        const buffer = Buffer.from(download.data);
        if (buffer.length > MAX_IMPORT_BYTES) {
            return res.send({ status: false, statusText: `That file is larger than the ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB import limit.` });
        }

        const filename = R.clip(body.filename || path.basename(storagePath), 255);
        tmpPath = path.join(os.tmpdir(), `alianhub-cloud-${Date.now()}-${Math.abs(buffer.length)}-${path.basename(storagePath)}`);
        fs.writeFileSync(tmpPath, buffer);

        const storedPath = await storeImportedFile({ companyId, storagePath, tmpPath, filename, size: buffer.length });

        logger.info(`${LOG_PREFIX} imported ${filename} (${buffer.length} bytes) from ${provider} for user ${userId}`);
        return res.send({ status: true, statusText: 'Imported.', data: { url: storedPath, size: buffer.length, filename } });
    } catch (e) {
        // arraybuffer responseType means an error body arrives as bytes, not JSON —
        // decode it or the reason is lost and all you get is "status code 404".
        let payload = e.response && e.response.data;
        if (payload && (Buffer.isBuffer(payload) || payload instanceof ArrayBuffer)) {
            try { payload = JSON.parse(Buffer.from(payload).toString('utf8')); } catch (_e) { payload = null; }
        }
        let detail = (payload && (payload.error_description || payload.error_summary
            || (payload.error && (payload.error.message || payload.error)))) || e.message;
        const status = (e.response && e.response.status) || '';
        // 404 here almost always means the app was never granted the file, not that
        // the file is missing — see the app_id note in cloudProviders.
        if (String(status) === '404' && String(req.params.provider) === 'google_drive') {
            detail = `${detail} — Drive returned 404 for a picked file. This usually means the Google Drive "Cloud project number (App ID)" is missing in Settings → Integrations: without it, drive.file never grants this app access to the file you picked.`;
        }
        logger.error(`${LOG_PREFIX} importFile (${status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
        return res.send({ status: false, statusText: typeof detail === 'string' ? detail : 'Import failed.' });
    } finally {
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_e) { /* already gone */ } }
    }
};

/**
 * Put an imported file where a normal upload would have put it, honouring
 * STORAGE_TYPE. Deliberately calls the same primitives the storage routes use
 * rather than reimplementing either backend.
 */
const storeImportedFile = async ({ companyId, storagePath, tmpPath, filename, size }) => {
    const storageType = String(process.env.STORAGE_TYPE || 'wasabi');
    if (storageType === 'server') {
        // Server storage: multer normally writes straight to the final location,
        // so "uploading" is just placing the file there.
        const dest = path.join(__dirname, '../../storage', String(companyId), storagePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(tmpPath, dest);
        return storagePath;
    }
    const { uploadFileWasabiPromise } = require('../storage/wasabi/controller');
    // Same argument shape the /api/v1/wasabi/uploadFile route passes, including
    // the multer-like file object the helper reads size/name from.
    const stored = await uploadFileWasabiPromise(
        String(companyId),
        storagePath,
        tmpPath,
        false,
        { path: tmpPath, originalname: filename, size },
        '',
    );
    return Array.isArray(stored) ? stored[0] : stored;
};

exports.__test__ = { getAccessToken, storeImportedFile, MAX_IMPORT_BYTES };
