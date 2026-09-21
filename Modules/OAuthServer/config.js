const FLAG_ON = ['true', '1', 'on', 'yes'];
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const SCOPES = Object.freeze(['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write']);
const READ_SCOPES = Object.freeze(SCOPES.filter((scope) => scope.endsWith(':read')));

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

const issuerSource = (env) => String(env.MCP_OAUTH_ISSUER || env.APIURL || '').trim();

const issuer = (env = process.env) => {
    const raw = issuerSource(env);
    if (!raw) return '';
    return new URL(raw).origin;
};

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const PLAIN_HTTP_ENVS = ['', 'development', 'test'];

/* Checked once at start, so a misconfigured server does not boot and hand out tokens bound to a resource
 * no client can reach. The issuer is an origin: a path would move the metadata to a path-inserted
 * well-known URL (RFC 8414 section 3.1), which this server does not serve, so a path is refused instead.
 * Plain http is for a developer's own machine only (MCP 2025-11-25, "Communication Security"). */
const issuerProblem = (env = process.env) => {
    const raw = issuerSource(env);
    if (!raw) return 'MCP_OAUTH is on but neither MCP_OAUTH_ISSUER nor APIURL is set';
    let url;
    try { url = new URL(raw); } catch (error) { return `MCP_OAUTH_ISSUER (or APIURL) "${raw}" is not an absolute URL`; }
    if (url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#')) return `MCP_OAUTH_ISSUER (or APIURL) "${raw}" must be an origin with no credentials, query or fragment`;
    if (url.pathname !== '/') return `MCP_OAUTH_ISSUER (or APIURL) "${raw}" has a path; the MCP authorization server needs an origin (RFC 8414 section 3.1)`;
    if (url.protocol === 'https:') return '';
    const nodeEnv = String(env.NODE_ENV || '').trim();
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname) && PLAIN_HTTP_ENVS.includes(nodeEnv)) return '';
    return `MCP_OAUTH_ISSUER (or APIURL) "${raw}" must be https; plain http is allowed only on a loopback host outside production`;
};

const assertIssuer = (env = process.env) => {
    const problem = issuerProblem(env);
    if (problem) throw new Error(`${problem}. Set MCP_OAUTH_ISSUER or turn MCP_OAUTH off.`);
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
    SCOPES, READ_SCOPES, CODE_TTL_MS, CODE_REUSE_WINDOW_MS, DEFAULTS,
    isOn, dcrOn, lifetimes, rateLimitPerMinute, metadataCacheMs, issuer, issuerProblem, assertIssuer, resource, canonicalResource, endpoints,
};
