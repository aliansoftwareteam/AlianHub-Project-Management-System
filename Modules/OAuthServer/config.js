const FLAG_ON = ['true', '1', 'on', 'yes'];
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const SCOPES = Object.freeze(['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write']);

const CODE_TTL_MS = MINUTE_MS;
// A spent code is kept past its expiry so a late replay is still recognised and revokes its grant.
const CODE_REUSE_WINDOW_MS = 60 * MINUTE_MS;

const DEFAULTS = Object.freeze({
    accessTokenMinutes: 15,
    refreshTokenDays: 30,
    grantMaxDays: 90,
    rateLimitPerMinute: 30,
    metadataCacheSeconds: 300,
});

const flagOn = (value) => FLAG_ON.includes(String(value || '').trim().toLowerCase());

const isOn = (env = process.env) => flagOn(env.MCP_OAUTH);

const dcrOn = (env = process.env) => isOn(env) && flagOn(env.MCP_OAUTH_DCR);

const positive = (value, fallback) => {
    const n = Number(String(value === undefined ? '' : value).trim());
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const lifetimes = (env = process.env) => ({
    accessMs: positive(env.MCP_OAUTH_ACCESS_TOKEN_MINUTES, DEFAULTS.accessTokenMinutes) * MINUTE_MS,
    refreshMs: positive(env.MCP_OAUTH_REFRESH_TOKEN_DAYS, DEFAULTS.refreshTokenDays) * DAY_MS,
    grantMs: positive(env.MCP_OAUTH_GRANT_MAX_DAYS, DEFAULTS.grantMaxDays) * DAY_MS,
    codeMs: CODE_TTL_MS,
});

const rateLimitPerMinute = (env = process.env) => Math.floor(positive(env.MCP_OAUTH_RATE_LIMIT_PER_MIN, DEFAULTS.rateLimitPerMinute));

const metadataCacheMs = (env = process.env) => positive(env.MCP_OAUTH_CLIENT_METADATA_CACHE_SECONDS, DEFAULTS.metadataCacheSeconds) * 1000;

const issuer = (env = process.env) => {
    const raw = String(env.MCP_OAUTH_ISSUER || env.APIURL || '').trim();
    if (!raw) return '';
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
};

// RFC 8707 / MCP "canonical server URI": the MCP endpoint of this instance, lower-case scheme and host, no fragment.
const resource = (env = process.env) => `${issuer(env)}/mcp`;

/* A presented resource names this server when it is the canonical URI once the URL parser has lower-cased
 * its scheme and host (the MCP spec asks servers to accept upper case there). Anything else, a trailing
 * slash, a query or a fragment included, names another resource. */
const canonicalResource = (value, env = process.env) => {
    if (typeof value !== 'string' || !value || value.includes('#')) return null;
    let url;
    try { url = new URL(value); } catch (error) { return null; }
    return url.href === resource(env) ? url.href : null;
};

const endpoints = (env = process.env) => {
    const base = issuer(env);
    return {
        authorization: `${base}/oauth/authorize`,
        token: `${base}/oauth/token`,
        revocation: `${base}/oauth/revoke`,
        registration: `${base}/oauth/register`,
    };
};

module.exports = {
    SCOPES, CODE_TTL_MS, CODE_REUSE_WINDOW_MS, DEFAULTS,
    isOn, dcrOn, lifetimes, rateLimitPerMinute, metadataCacheMs, issuer, resource, canonicalResource, endpoints,
};
