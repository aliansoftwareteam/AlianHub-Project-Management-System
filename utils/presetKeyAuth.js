/**
 * Preset-key authentication middleware (BUG-008 / #62 fix).
 *
 * Two operator endpoints — `/api/v1/setPresetCompany/:id` and
 * `/connections/:id` — accepted the `PRECOMPANYKEY` secret as a URL path
 * segment, compared it to `config.PRECOMPANYKEY` with `===`, and returned
 * a 200 "Unauthorized" body on mismatch. Three problems:
 *
 *   1. URL-path secrets leak into reverse-proxy logs, CDN logs, browser
 *      history, Referer headers, and APM tools. The secret stops being
 *      a secret the moment it's used.
 *   2. `===` is not constant-time, so a determined attacker can extract
 *      the key one character at a time via response timing.
 *   3. Returning HTTP 200 on auth failure obscures the failure from
 *      monitoring tools.
 *
 * This middleware fixes all three by:
 *
 *   - Reading the key from the `x-preset-key` request header (never the
 *     URL path).
 *   - Comparing it with `crypto.timingSafeEqual` in constant time.
 *   - Returning HTTP 401 on missing / wrong key, HTTP 404 when the env
 *     var is not configured at all (the endpoint is then effectively
 *     disabled — fail-closed).
 */
'use strict';

const crypto = require('crypto');

const PRESET_HEADER = 'x-preset-key';

const constantTimeEqual = (a, b) => {
    const aBuf = Buffer.from(String(a == null ? '' : a), 'utf-8');
    const bBuf = Buffer.from(String(b == null ? '' : b), 'utf-8');
    if (aBuf.length !== bBuf.length) {
        // Equal-length sham compare so we don't leak the supplied value's
        // length via fast-fail timing.
        try {
            const dummy = Buffer.alloc(bBuf.length, 0);
            crypto.timingSafeEqual(Buffer.alloc(bBuf.length, 0), dummy);
        } catch (_) { /* noop */ }
        return false;
    }
    return crypto.timingSafeEqual(aBuf, bBuf);
};

const requirePresetKey = (req, res, next) => {
    const configured = process.env.PRECOMPANYKEY || '';
    if (!configured) {
        // Endpoint is effectively disabled when PRECOMPANYKEY isn't set —
        // fail-closed instead of accepting an empty string.
        return res.status(404).json({ status: false, message: 'Not Found' });
    }
    const supplied = req.headers && req.headers[PRESET_HEADER]
        ? String(req.headers[PRESET_HEADER]) : '';
    if (!supplied || !constantTimeEqual(supplied, configured)) {
        return res.status(401).json({ status: false, message: 'Unauthorized' });
    }
    return next();
};

module.exports = {
    PRESET_HEADER,
    constantTimeEqual,
    requirePresetKey,
};
