/**
 * CORS allow-list helpers (BUG-002 / #56 fix).
 *
 * Previously the Express app accepted `cors({origin: '*'})`, so any browser
 * origin could call any API route. This module builds an allow-list from
 * environment variables and returns an `origin` callback compatible with
 * the `cors` middleware.
 *
 * Allow-list sources (deduped, trailing slashes stripped):
 *   - WEBURL          (the configured frontend URL — required in prod)
 *   - APIURL          (set when the API is hosted on a different domain)
 *   - CORS_ORIGINS    (optional comma-separated list of extra origins)
 *
 * Accepted without lookup:
 *   - Requests with no Origin header (same-origin, curl, mobile apps)
 *   - `null` origin (sandboxed iframes, some Electron renderers)
 *   - `file://...` origins (Electron desktop client, dev builds)
 *   - `app://...` origins (Electron desktop client served via electron-serve,
 *     e.g. the packaged time-tracker-app — origin appears as `app://.`)
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
    if (typeof origin === 'string' && origin.startsWith('app://')) return true;
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
