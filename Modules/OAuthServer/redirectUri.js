const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const MAX_LENGTH = 2000;
const MAX_URIS = 10;

/* MCP 2025-11-25 "Communication Security": a redirect URI is https, or http on a loopback host. No fragment
 * (OAuth 2.1 section 2.3.1), no credentials, and nothing a URL parser would rewrite, so the registered string
 * is the one a browser is sent to. */
const isAllowedRedirectUri = (value) => {
    if (typeof value !== 'string' || !value || value.length > MAX_LENGTH) return false;
    let url;
    try { url = new URL(value); } catch (error) { return false; }
    if (value.includes('#') || url.username || url.password) return false;
    if (url.protocol === 'https:') return Boolean(url.hostname);
    if (url.protocol === 'http:') return LOOPBACK_HOSTS.includes(url.hostname);
    return false;
};

const validRedirectUris = (list) => Array.isArray(list)
    && list.length > 0
    && list.length <= MAX_URIS
    && list.every(isAllowedRedirectUri);

// Exact string comparison (OAuth 2.1 section 2.3.1): a trailing slash, a case change, an extra query or a fragment is another URI.
const matchesRegistered = (client, presented) => typeof presented === 'string'
    && isAllowedRedirectUri(presented)
    && Array.isArray(client.redirectUris)
    && client.redirectUris.includes(presented);

module.exports = { isAllowedRedirectUri, validRedirectUris, matchesRegistered, MAX_URIS };
