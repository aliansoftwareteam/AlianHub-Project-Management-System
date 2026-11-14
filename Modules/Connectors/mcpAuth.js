const agentFetch = require('../Agents/engine/agentFetch');
const egressContext = require('../Agents/engine/egressContext');
const fetcher = require('../Agents/engine/safeFetch');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 64 * 1024;
const MAX_SCOPES = 50;

const httpsUrl = (value) => {
    try {
        const url = new URL(String(value));
        return url.protocol === 'https:' ? url : null;
    } catch (e) {
        return null;
    }
};

/* A person adding a custom server reads its metadata before its hosts are on the workspace list, which the add puts
 * them on; the address rules still apply to every request, with no redirect and no credential. */
const unlistedGet = (url, hosts) => {
    const target = new URL(String(url));
    if (target.protocol !== 'https:' || !hosts.includes(target.hostname)) throw new Error('not a host of this server');
    return fetcher.safeFetch(target.href, { method: 'get', timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, maxRedirects: 0, headers: { Accept: 'application/json' } });
};

const getJson = async (url, hosts, unlisted) => {
    let res;
    try {
        res = unlisted ? await unlistedGet(url, hosts) : await agentFetch.callApi(url, { hosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
    } catch (e) {
        return null;
    }
    if (res.status < 200 || res.status >= 300) return null;
    try {
        const body = JSON.parse(res.body);
        return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    } catch (e) {
        return null;
    }
};

const firstJson = async (urls, host, unlisted) => {
    for (const url of [...new Set(urls)]) {
        // eslint-disable-next-line no-await-in-loop
        const found = await getJson(url, [host], unlisted);
        if (found) return found;
    }
    return null;
};

/* Where an MCP server sends a client to sign in: its protected-resource metadata (RFC 9728), then its authorization
 * server's metadata (RFC 8414, or OpenID discovery). Every address must be https. The hosts found are returned so
 * the caller can name them as the connector's egress hosts; nothing outside them is contacted later. */
const find = async (url, unlisted) => {
    const server = httpsUrl(url);
    if (!server) return { ok: false, error: 'not_https' };
    const path = server.pathname.replace(/\/+$/, '');
    const resource = await firstJson([
        `${server.origin}/.well-known/oauth-protected-resource${path}`,
        `${server.origin}/.well-known/oauth-protected-resource`,
    ], server.hostname, unlisted);
    const named = resource && Array.isArray(resource.authorization_servers) ? resource.authorization_servers[0] : server.origin;
    const issuer = httpsUrl(named);
    if (!issuer) return { ok: false, error: 'not_https' };
    const issuerPath = issuer.pathname.replace(/\/+$/, '');
    const meta = await firstJson([
        `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
        `${issuer.origin}/.well-known/openid-configuration${issuerPath}`,
        `${issuer.origin}${issuerPath}/.well-known/openid-configuration`,
    ], issuer.hostname, unlisted);
    if (!meta) return { ok: false, error: 'no_metadata' };

    const authorize = httpsUrl(meta.authorization_endpoint);
    const token = httpsUrl(meta.token_endpoint);
    if (!authorize || !token) return { ok: false, error: 'no_endpoints' };
    const registration = meta.registration_endpoint ? httpsUrl(meta.registration_endpoint) : null;
    const revoke = meta.revocation_endpoint ? httpsUrl(meta.revocation_endpoint) : null;
    const pkce = Array.isArray(meta.code_challenge_methods_supported) && meta.code_challenge_methods_supported.includes('S256') ? 'S256' : null;
    const auth = {
        authorizeUrl: authorize.href,
        tokenUrl: token.href,
        ...(revoke ? { revokeUrl: revoke.href } : {}),
        ...(pkce ? { pkce } : {}),
        ...(registration && pkce ? { registration: 'dynamic', registrationUrl: registration.href } : {}),
    };
    const scopes = (Array.isArray(resource && resource.scopes_supported) ? resource.scopes_supported : [])
        .filter((scope) => typeof scope === 'string' && scope.trim()).slice(0, MAX_SCOPES);
    const hosts = [...new Set([server, authorize, token, registration, revoke].filter(Boolean).map((u) => u.hostname))];
    return { ok: true, auth, scopes, hosts };
};

const discover = ({ url, companyId, actor, unlisted = false }) => (unlisted
    ? egressContext.run({}, () => find(url, true))
    : egressContext.run({ companyId: String(companyId), actor: String(actor || '') }, () => find(url, false)));

module.exports = { discover };
