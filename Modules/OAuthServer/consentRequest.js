const crypto = require('crypto');
const tokenHash = require('./tokenHash');
const config = require('./config');
const { readCookie } = require('../../Config/cookies');

const TTL_MS = 10 * 60 * 1000;
const COOKIE_PREFIX = 'ahoauth_';
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const MAX_LENGTH = 8192;

const macOf = (body) => Buffer.from(tokenHash.hashOf(`consent-request:${body}`), 'hex').toString('base64url');
const csrfDigest = (token) => tokenHash.hashOf(`consent-csrf:${token}`);

/* A validated authorization request travels to the consent page and back signed rather than stored: nothing
 * about it can change on the way, and it lapses on its own. The CSRF token goes to the browser in a cookie
 * of its own (named after this request, so two sign-ins in one browser do not trample each other) and only
 * its keyed digest rides in the request, which binds the two. The client's name rides along so a client ID
 * metadata document is not fetched again for the answer. */
function seal({ client, redirectUri, scopes, state, codeChallenge }, now = Date.now()) {
    const csrf = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(12).toString('base64url');
    const payload = {
        c: client.clientId, n: client.name || '', k: client.kind || '', r: redirectUri, s: [...scopes], st: state, cc: codeChallenge, x: csrfDigest(csrf), i: nonce, e: now + TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { request: `${body}.${macOf(body)}`, csrf, cookieName: `${COOKIE_PREFIX}${nonce}` };
}

function open(request, now = Date.now()) {
    if (typeof request !== 'string' || !request || request.length > MAX_LENGTH) return null;
    const parts = request.split('.');
    if (parts.length !== 2 || !parts[0] || !tokenHash.sameSecret(macOf(parts[0]), parts[1])) return null;
    let p;
    try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (error) { return null; }
    if (!p || typeof p !== 'object' || typeof p.e !== 'number' || p.e <= now || !NONCE_PATTERN.test(String(p.i))) return null;
    if (typeof p.c !== 'string' || typeof p.r !== 'string' || !Array.isArray(p.s) || typeof p.x !== 'string') return null;
    return {
        clientId: p.c, clientName: p.n || '', clientKind: p.k || '', redirectUri: p.r, scopes: p.s, state: p.st, codeChallenge: p.cc,
        csrfDigest: p.x, cookieName: `${COOKIE_PREFIX}${p.i}`, nonce: p.i, expiresAt: p.e,
    };
}

// The cookie value a request's own browser holds, and only when its digest is the one sealed into the request.
const cookieToken = (req, opened) => {
    const token = readCookie(req, opened.cookieName);
    return token && tokenHash.sameSecret(csrfDigest(token), opened.csrfDigest) ? token : '';
};

const csrfMatches = (req, opened, presented) => {
    const token = cookieToken(req, opened);
    return Boolean(token) && typeof presented === 'string' && tokenHash.sameSecret(token, presented);
};

/* Strict, so a cross-site form post arrives without it; scoped to /oauth, where the consent routes live. */
const cookieOptions = () => ({
    path: '/oauth',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.issuer().startsWith('https:'),
});

const setCookie = (res, sealed) => res.cookie(sealed.cookieName, sealed.csrf, { ...cookieOptions(), maxAge: TTL_MS });

const clearCookie = (res, opened) => res.clearCookie(opened.cookieName, cookieOptions());

module.exports = { TTL_MS, seal, open, cookieToken, csrfMatches, setCookie, clearCookie };
