/**
 * CORS allow-list helpers — shared between the Express HTTP layer
 * (BUG-002 / #56) and the Socket.io transport (BUG-003 / #57).
 *
 * Previously both layers accepted `origin: '*'`, which combined with
 * credentialed cookies and JS-readable tokens opened a CSRF / token-theft
 * path from any third-party origin. This module builds an allow-list from
 * environment variables and returns an `origin` callback compatible with
 * the `cors` middleware shape used by both Express and engine.io.
 *
 * Allow-list sources (deduped, trailing slashes stripped):
 *   - WEBURL          (the configured frontend URL — required in prod)
 *   - APIURL          (set when the API is hosted on a different domain)
 *   - CORS_ORIGINS    (optional comma-separated list of extra origins)
 *
 * Accepted without lookup:
 *   - Requests with no Origin header (same-origin, curl, mobile apps)
 *   - `null` origin (sandboxed iframes, some Electron renderers)
 *   - `file://...` origins (Electron desktop client)
 *
 * The allow-list is rebuilt on every request so operators can update the
 * env without restarting the process; the cost is a small Set construction
 * per request, which is negligible compared to JWT verification.
 */
'use strict';

const splitAndClean = (raw) => {
    if (!raw) return [];
    return String(raw)
        .split(',')
        .map((entry) => entry.trim().replace(/\/+$/, ''))
        .filter(Boolean);
};

const buildCorsAllowList = (env = process.env) => {
    const allowed = new Set();
    splitAndClean(env.WEBURL).forEach((o) => allowed.add(o));
    splitAndClean(env.APIURL).forEach((o) => allowed.add(o));
    splitAndClean(env.CORS_ORIGINS).forEach((o) => allowed.add(o));
    return allowed;
};

const isOriginAllowed = (origin, allowList) => {
    if (!origin) return true; // no Origin header
    if (origin === 'null') return true;
    if (typeof origin === 'string' && origin.startsWith('file://')) return true;
    if (typeof origin !== 'string') return false;
    const normalized = origin.replace(/\/+$/, '');
    return allowList.has(normalized);
};

const corsOriginDelegate = (origin, callback) => {
    const allowList = buildCorsAllowList();
    if (isOriginAllowed(origin, allowList)) {
        return callback(null, true);
    }
    return callback(new Error(`CORS: origin ${origin} not allowed`));
};

module.exports = {
    splitAndClean,
    buildCorsAllowList,
    isOriginAllowed,
    corsOriginDelegate,
};
