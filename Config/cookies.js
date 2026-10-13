/* Cookie reads and clears for the session cookies. Free of requires so the
 * HTTP middleware, the socket handshake and the auth controllers share it. */

const parse = (header) => {
    const out = {};
    String(header || '').split(';').forEach((part) => {
        const at = part.indexOf('=');
        if (at === -1) return;
        const name = part.slice(0, at).trim();
        if (!name || Object.prototype.hasOwnProperty.call(out, name)) return;
        try {
            out[name] = decodeURIComponent(part.slice(at + 1).trim());
        } catch (e) {
            out[name] = part.slice(at + 1).trim();
        }
    });
    return out;
};

/* The named cookie off a request: an already-parsed jar wins, else the header. */
const readCookie = (req, name) => {
    if (req && req.cookies && typeof req.cookies === 'object' && typeof req.cookies[name] === 'string') return req.cookies[name];
    const headers = (req && req.headers) || {};
    return parse(headers.cookie)[name] || '';
};

/* Clearing must name the same domain and path the cookie was set with or the
 * browser keeps it; httpOnly/secure/sameSite do not affect the match. */
const clearOptions = (req) => ({
    path: '/',
    domain: process.env.NODE_ENV === 'production' && req && req.hostname ? req.hostname : undefined,
});

const clearAuthCookies = (res, req) => {
    res.clearCookie('accessToken', clearOptions(req));
    res.clearCookie('refreshToken', clearOptions(req));
};

/* Auth cookies are httpOnly once the frontend no longer reads them (slice 11);
 * the affiliate cookie stays readable. */
const httpOnlyCookies = () => ['on', 'true', '1', 'yes'].includes(String(process.env.SESSION_COOKIE_HTTPONLY || '').trim().toLowerCase());

/* The socket handshake carries the token in auth (native clients) or the
 * session cookie (browsers); an explicit token wins. */
const handshakeToken = (handshake) => {
    const sent = handshake && handshake.auth && handshake.auth.token;
    return sent || readCookie(handshake, 'accessToken') || '';
};

module.exports = { parse, readCookie, clearOptions, clearAuthCookies, handshakeToken, httpOnlyCookies };
