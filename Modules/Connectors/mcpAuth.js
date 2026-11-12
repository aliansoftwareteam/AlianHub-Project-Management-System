const agentFetch = require('../Agents/engine/agentFetch');
const egressContext = require('../Agents/engine/egressContext');

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

const getJson = async (url, hosts) => {
    let res;
    try {
        res = await agentFetch.callApi(url, { hosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
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

const firstJson = async (urls, host) => {
    for (const url of [...new Set(urls)]) {
        // eslint-disable-next-line no-await-in-loop
        const found = await getJson(url, [host]);
        if (found) return found;
    }
    return null;
};

/* Where an MCP server sends a client to sign in: its protected-resource metadata (RFC 9728), then its authorization
 * server's metadata (RFC 8414, or OpenID discovery). Every address must be https. The hosts found are returned so
 * the caller can name them as the connector's egress hosts; nothing outside them is contacted later. */
const discover = ({ url, companyId, actor }) => egressContext.run({ companyId: String(companyId), actor: String(actor || '') }, async () => {
    const server = httpsUrl(url);
    if (!server) return { ok: false, error: 'not_https' };
    const path = server.pathname.replace(/\/+$/, '');
    const resource = await firstJson([
        `${server.origin}/.well-known/oauth-protected-resource${path}`,
        `${server.origin}/.well-known/oauth-protected-resource`,
    ], server.hostname);
    const named = resource && Array.isArray(resource.authorization_servers) ? resource.authorization_servers[0] : server.origin;
    const issuer = httpsUrl(named);
    if (!issuer) return { ok: false, error: 'not_https' };
    const issuerPath = issuer.pathname.replace(/\/+$/, '');
    const meta = await firstJson([
        `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
        `${issuer.origin}/.well-known/openid-configuration${issuerPath}`,
        `${issuer.origin}${issuerPath}/.well-known/openid-configuration`,
    ], issuer.hostname);
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
});

module.exports = { discover };
