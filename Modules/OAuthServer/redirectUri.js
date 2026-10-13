const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const MAX_LENGTH = 2000;
const MAX_URIS = 10;

const parse = (value) => {
    try { return new URL(value); } catch (error) { return null; }
};

/* MCP 2025-11-25 "Communication Security": a redirect URI is https, or http on a loopback host. No fragment
 * and no userinfo (OAuth 2.1 section 2.3.1), and the string must already be the parser's own form, so a
 * backslash, whitespace or a case change cannot make the browser land somewhere the string does not say. */
const isAllowedRedirectUri = (value) => {
    if (typeof value !== 'string' || !value || value.length > MAX_LENGTH) return false;
    const url = parse(value);
    if (!url || url.href !== value) return false;
    if (url.hash || value.includes('#') || url.username || url.password) return false;
    if (url.protocol === 'https:') return Boolean(url.hostname);
    if (url.protocol === 'http:') return LOOPBACK_HOSTS.includes(url.hostname);
    return false;
};

const validRedirectUris = (list) => Array.isArray(list)
    && list.length > 0
    && list.length <= MAX_URIS
    && list.every(isAllowedRedirectUri);

const isLoopbackHttp = (url) => url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname);

/* Exact string comparison (OAuth 2.1 section 2.3.1), except that a native app's http loopback redirect may
 * come back on any port (OAuth 2.1 section 2.3.1, RFC 8252 section 7.3): the OS picks the port at run time.
 * localhost gets the loopback rule too, because the MCP spec's own examples use it. */
const sameIgnoringPort = (registered, presented) => {
    const a = parse(registered);
    return Boolean(a) && isLoopbackHttp(a)
        && a.hostname === presented.hostname
        && a.pathname === presented.pathname
        && a.search === presented.search;
};

const matchesRegistered = (client, presented) => {
    if (typeof presented !== 'string' || !isAllowedRedirectUri(presented) || !Array.isArray(client.redirectUris)) return false;
    if (client.redirectUris.includes(presented)) return true;
    const url = new URL(presented);
    return isLoopbackHttp(url) && client.redirectUris.some((registered) => sameIgnoringPort(registered, url));
};

module.exports = { isAllowedRedirectUri, validRedirectUris, matchesRegistered, MAX_URIS };
