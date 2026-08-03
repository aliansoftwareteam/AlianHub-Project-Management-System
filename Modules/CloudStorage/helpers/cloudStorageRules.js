// AHE-3838 — pure validation/shaping rules for cloud storage. No DB, no network.
const jwt = require('jsonwebtoken');
const P = require('./cloudProviders');

// ── OAuth `state` ───────────────────────────────────────────────────────────
//
// The OAuth callback CANNOT be JWT-protected: it is a browser redirect arriving
// from Google/Microsoft, with no Authorization header and no companyid header.
// So `state` is the only thing telling us who the grant belongs to — and it
// round-trips through a third party in a query string the user can see and edit.
//
// It is therefore a SIGNED JWT, not a plain blob. Without a signature, anyone
// could craft ?state={companyId,userId of a colleague} and bind their own Drive
// grant onto that colleague's account (or vice versa). Signed + short-lived +
// audience-pinned, so a state minted for one purpose can't be replayed elsewhere.
const STATE_AUDIENCE = 'alianhub:cloud-storage:oauth';
const STATE_TTL = '10m';

const stateSecret = () => `${process.env.JWT_SECRET || ''}::cloud-storage-state`;

const encodeState = ({ companyId, userId, provider, returnTo, returnOrigin }, secret = stateSecret()) => jwt.sign(
    {
        companyId: String(companyId),
        userId: String(userId),
        provider: String(provider),
        // Only a path is kept — never a full URL. An attacker-supplied absolute
        // URL here would turn the callback into an open redirect.
        returnTo: safeReturnPath(returnTo),
        // The origin the flow started from, so consent returns the user to the
        // app they were actually using. In dev the SPA is on :8080 while the API
        // (and therefore the callback) is on :4000 — without this the user lands
        // on :4000, a different origin, with different localStorage, and appears
        // logged out. The CALLER must have validated this against the CORS
        // allow-list before minting; the signature then makes it tamper-proof.
        returnOrigin: String(returnOrigin || ''),
    },
    secret,
    { algorithm: 'HS256', audience: STATE_AUDIENCE, expiresIn: STATE_TTL },
);

const decodeState = (token, secret = stateSecret()) => {
    try {
        const d = jwt.verify(String(token || ''), secret, { algorithms: ['HS256'], audience: STATE_AUDIENCE });
        if (!d || !d.companyId || !d.userId || !P.isProvider(d.provider)) return null;
        return d;
    } catch (e) {
        return null; // expired, tampered, or wrong audience — fail closed
    }
};

/**
 * Keep only a same-origin path. Rejects absolute URLs, protocol-relative
 * (`//evil.com`) and backslash variants that some browsers normalise to a host.
 */
const safeReturnPath = (value) => {
    const raw = String(value || '');
    if (!raw.startsWith('/')) return '';
    if (raw.startsWith('//') || raw.startsWith('/\\')) return '';
    return raw.slice(0, 512);
};

// ── URL / string safety ────────────────────────────────────────────────────

const clip = (value, max = 512) => String(value === null || value === undefined ? '' : value).slice(0, max);

const isHttpsUrl = (value) => /^https:\/\/[^\s]+$/i.test(String(value || ''));

/**
 * Is this a Dropbox content URL the server may fetch?
 *
 * Dropbox's Chooser is the one provider that gives us no OAuth token, so importing
 * has to work from the temporary `direct` link the widget returns — which means the
 * URL arrives from the BROWSER. Handing a client-supplied URL to server-side axios
 * is textbook SSRF (file://, http://169.254.169.254/, an internal admin port), so
 * it is matched against an explicit host allow-list rather than merely checked for
 * "looks like https".
 *
 * Parsed with URL() so tricks like `https://dl.dropboxusercontent.com@evil.com/`
 * resolve to their real host (evil.com) and are rejected.
 */
const DROPBOX_CONTENT_HOSTS = new Set([
    'dl.dropboxusercontent.com',
    'www.dropbox.com',
    'dropbox.com',
    'content.dropboxapi.com',
]);

const isDropboxContentUrl = (value) => {
    const raw = String(value || '');
    if (!isHttpsUrl(raw)) return false;
    let parsed;
    try { parsed = new URL(raw); } catch (e) { return false; }
    if (parsed.protocol !== 'https:') return false;
    // Credentials in the URL are only ever an attempt to disguise the host.
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (DROPBOX_CONTENT_HOSTS.has(host)) return true;
    // Per-user content subdomains, e.g. uc1234abcd.dl.dropboxusercontent.com
    return host.endsWith('.dl.dropboxusercontent.com');
};

// ── Token freshness ────────────────────────────────────────────────────────
/** Treat a token as stale slightly early, so it can't expire mid-request. */
const EXPIRY_SKEW_MS = 60 * 1000;
const isExpired = (expiresAt, now = new Date()) => {
    if (!expiresAt) return true;
    const t = new Date(expiresAt).getTime();
    if (!Number.isFinite(t)) return true;
    return t - EXPIRY_SKEW_MS <= now.getTime();
};

module.exports = {
    STATE_AUDIENCE,
    STATE_TTL,
    encodeState,
    decodeState,
    safeReturnPath,
    isHttpsUrl,
    isDropboxContentUrl,
    DROPBOX_CONTENT_HOSTS,
    clip,
    isExpired,
    EXPIRY_SKEW_MS,
};
