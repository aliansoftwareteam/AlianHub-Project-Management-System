// AHE-3838 — cloud file storage (Google Drive / OneDrive / Dropbox).
//
// Split of responsibilities:
//   integration_connections     the COMPANY's app registration per provider
//                               (client id/secret), managed in Settings →
//                               Integrations. One per workspace.
//   cloud_storage_connections   one row per (user, provider) holding that
//                               person's OAuth grant. Every user has their own
//                               Drive, so the grant cannot be company-wide.
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
const { removeCache } = require('../../utils/commonFunctions');
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

/**
 * Owner (1) or Admin (2) only. The app credentials are workspace-wide and one of
 * them is a client SECRET, so an ordinary member must not be able to change (or
 * replace) them. Same lookup pattern as Modules/ScreenshotRetention — role comes
 * from the per-tenant company_users record, never from the request, and any
 * lookup failure denies.
 */
const isCompanyAdmin = async (companyId, userId) => {
    if (!companyId || !userId) return false;
    try {
        const record = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(userId) }, { _id: 1, roleType: 1, userId: 1 }],
        }, 'findOne');
        return !!record && [1, 2].includes(Number(record.roleType));
    } catch (e) {
        logger.error(`${LOG_PREFIX} role check failed (company ${companyId}, user ${userId}): ${e.message}`);
        return false;
    }
};

// ── workspace app credentials ───────────────────────────────────────────────

const loadAppConfig = async (companyId, provider) => {
    const row = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
        data: [{ type: String(provider), deletedStatusKey: { $ne: 1 } }],
    }, 'findOne');
    if (!row) return null;
    const cfg = (row.config && (row.config.toObject ? row.config.toObject() : row.config)) || {};
    return { enabled: row.enabled !== false, config: cfg };
};

// ── per-user connections ────────────────────────────────────────────────────

const loadConnection = (companyId, userId, provider) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
    data: [{ userId: String(userId), provider: String(provider), deletedStatusKey: { $ne: 1 } }],
}, 'findOne');

const upsertConnection = (companyId, userId, provider, patch) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
    data: [
        { userId: String(userId), provider: String(provider) },
        { $set: { ...patch, userId: String(userId), provider: String(provider), deletedStatusKey: 0 } },
        { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after' },
    ],
}, 'findOneAndUpdate');

/**
 * GET /api/v1/cloud-storage/settings
 *
 * Everything the Settings → Integrations section needs: the field definitions,
 * the stored non-secret values, which secrets are set, and whether the caller may
 * edit. Readable by any member (so they can see what's available and connect
 * their own account); only admins get canManage: true.
 */
exports.getSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const canManage = await isCompanyAdmin(companyId, userId);
        const rows = [];
        for (const key of P.PROVIDER_KEYS) {
            const described = P.describe(key);
            let app = null;
            try { app = await loadAppConfig(companyId, key); } catch (e) {
                logger.error(`${LOG_PREFIX} app config read failed (${key}): ${e.message}`);
            }
            const cfg = (app && app.config) || {};
            const configured = !!(app && app.enabled && P.isConfigured(key, cfg));
            let connection = null;
            if (configured) {
                try { connection = await loadConnection(companyId, userId, key); } catch (e) {
                    logger.error(`${LOG_PREFIX} connection read failed (${key}): ${e.message}`);
                }
            }
            rows.push({
                ...described,
                ...P.redactAppConfig(key, cfg),
                configured,
                enabled: !app || app.enabled !== false,
                connected: described.oauth ? !!(connection && connection.status === 'connected') : configured,
                connectionStatus: (connection && connection.status) || '',
                accountEmail: (connection && connection.accountEmail) || '',
            });
        }
        return res.send({ status: true, data: { canManage, redirectUri: redirectUri(), providers: rows } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} getSettings: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * PUT /api/v1/cloud-storage/settings/:provider  { config: {...} }
 * Save this workspace's app registration for one provider. Admin only.
 */
exports.saveSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!(await isCompanyAdmin(companyId, userId))) {
            return res.send({ status: false, statusText: 'Only an owner or admin can change these credentials.' });
        }

        const existing = await loadAppConfig(companyId, provider);
        const check = P.sanitizeAppConfig(provider, (req.body || {}).config, (existing && existing.config) || {});
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
            data: [
                { type: provider },
                {
                    $set: {
                        type: provider,
                        name: P.byKey(provider).name,
                        config: check.config,
                        status: 'connected',
                        enabled: true,
                        deletedStatusKey: 0,
                        createdBy: String(userId),
                        connectedAt: new Date(),
                    },
                },
                { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        // The marketplace caches this collection per company; clear it so the two
        // views can't disagree about what is connected.
        removeCache(`integration_connections:${companyId}`);
        logger.info(`${LOG_PREFIX} ${provider} app credentials saved by ${userId}`);
        return res.send({ status: true, statusText: 'Saved.', data: { provider, ...P.redactAppConfig(provider, (saved && saved.config) || check.config) } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} saveSettings: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * DELETE /api/v1/cloud-storage/settings/:provider
 * Remove the workspace credentials. Admin only.
 *
 * Also drops every user's grant for that provider: the tokens were issued to an
 * app registration that is being removed, so leaving them would strand rows whose
 * refresh can never succeed again.
 */
exports.clearSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const provider = String(req.params.provider || '');
        if (!P.isProvider(provider)) return res.send({ status: false, statusText: 'Unknown provider.' });
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!(await isCompanyAdmin(companyId, userId))) {
            return res.send({ status: false, statusText: 'Only an owner or admin can change these credentials.' });
        }

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
            data: [{ type: provider }, { $set: { config: {}, enabled: false, status: 'disconnected', deletedStatusKey: 1 } }],
        }, 'updateOne');
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CLOUD_STORAGE_CONNECTIONS,
            data: [{ provider }, { $set: { deletedStatusKey: 1, accessToken: '', refreshToken: '', status: 'disconnected' } }],
        }, 'updateMany');
        removeCache(`integration_connections:${companyId}`);
        logger.info(`${LOG_PREFIX} ${provider} app credentials removed by ${userId}`);
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
            let app = null;
            try { app = await loadAppConfig(companyId, key); } catch (e) {
                logger.error(`${LOG_PREFIX} app config read failed (${key}): ${e.message}`);
            }
            const configured = !!(app && app.enabled && P.isConfigured(key, app.config));
            let connection = null;
            if (configured) {
                try { connection = await loadConnection(companyId, userId, key); } catch (e) {
                    logger.error(`${LOG_PREFIX} connection read failed (${key}): ${e.message}`);
                }
            }
            out.push({
                provider: key,
                name: meta.name,
                // Dropbox's Chooser needs no user grant, so it is usable as soon
                // as the workspace app key exists.
                requiresConnect: !!meta.oauth,
                configured,
                connected: meta.oauth ? !!(connection && connection.status === 'connected') : configured,
                status: (connection && connection.status) || (configured ? 'available' : 'not_configured'),
                accountEmail: (connection && connection.accountEmail) || '',
                config: configured ? P.publicConfig(key, app.config) : {},
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

        const app = await loadAppConfig(companyId, provider);
        if (!app || !app.enabled || !P.isConfigured(provider, app.config)) {
            return res.send({ status: false, statusText: `${P.byKey(provider).name} is not set up for this workspace yet.` });
        }
        const state = R.encodeState({
            companyId,
            userId,
            provider,
            returnTo: req.query && req.query.returnTo,
            returnOrigin: resolveReturnOrigin(req),
        });
        const url = P.buildAuthUrl({ provider, config: app.config, redirectUri: redirectUri(), state });
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
        const app = await loadAppConfig(companyId, provider);
        if (!app || !P.isConfigured(provider, app.config)) return fail('This provider is no longer set up.', decoded.returnTo, returnOrigin);

        const tokenRes = await axios.post(
            P.tokenUrlFor(provider, app.config),
            P.tokenRequestBody({ provider, config: app.config, code, redirectUri: redirectUri() }),
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
    const app = await loadAppConfig(companyId, provider);
    if (!app || !app.enabled || !P.isConfigured(provider, app.config)) {
        return { error: `${P.byKey(provider).name} is not set up for this workspace yet.` };
    }
    const conn = await loadConnection(companyId, userId, provider);
    if (!conn) return { error: 'not_connected' };

    const current = decryptToken(conn.accessToken);
    if (current && !R.isExpired(conn.expiresAt)) return { token: current, config: app.config };

    const refresh = decryptToken(conn.refreshToken);
    if (!refresh) return { error: 'reauth_required' };

    try {
        const tokenRes = await axios.post(
            P.tokenUrlFor(provider, app.config),
            P.tokenRequestBody({ provider, config: app.config, refreshToken: refresh }),
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
        return { token: tok.access_token, config: app.config };
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
            const app = await loadAppConfig(companyId, provider);
            if (!app || !P.isConfigured(provider, app.config)) return res.send({ status: false, statusText: `${meta.name} is not set up for this workspace yet.` });
            return res.send({ status: true, data: { token: '', config: P.publicConfig(provider, app.config) } });
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

        const auth = await getAccessToken(companyId, userId, provider);
        if (auth.error) return res.send({ status: false, statusText: auth.error, code: auth.error });

        const request = P.downloadRequestFor(provider, fileId);
        if (!request) return res.send({ status: false, statusText: 'This provider cannot be imported from.' });

        const download = await axios({
            method: request.method || 'get',
            url: request.url,
            headers: { ...(request.headers || {}), Authorization: `Bearer ${auth.token}` },
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: MAX_IMPORT_BYTES,
            maxBodyLength: MAX_IMPORT_BYTES,
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
