const FLAG_ON = ['true', '1', 'on', 'yes'];
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/* The manage scopes are never implied: not by a missing scope list, not by a default approval, not by a
 * personal token's write. A client asks for one, the person ticks it at consent, and an owner or admin
 * names it in the workspace's approval of that client. */
const MANAGE_SCOPES = Object.freeze(['tasks:manage', 'docs:manage']);
/* Reading chat is given the same way and no other: it is not part of reading tasks, of a default approval, of a
 * personal token's read or of a manage scope. */
const CHAT_SCOPE = 'chat:read';
const OPT_IN_SCOPES = Object.freeze([...MANAGE_SCOPES, CHAT_SCOPE]);
const SCOPES = Object.freeze(['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write', ...OPT_IN_SCOPES]);
const isManageScope = (scope) => MANAGE_SCOPES.includes(scope);
const isOptInScope = (scope) => OPT_IN_SCOPES.includes(scope);
const READ_SCOPES = Object.freeze(SCOPES.filter((scope) => scope.endsWith(':read') && !isOptInScope(scope)));
const PLAIN_SCOPES = Object.freeze(SCOPES.filter((scope) => !isOptInScope(scope)));

// An opt-in scope unlocks nothing while its tools are off, so it is neither listed nor taken at authorization then.
const manageOffered = () => require('../Mcp/manageFlag').enabled();
const chatOffered = () => require('../Mcp/dataFlag').enabled();
const isOffered = (scope) => (isManageScope(scope) ? manageOffered() : scope !== CHAT_SCOPE || chatOffered());
const offeredScopes = () => SCOPES.filter(isOffered);

/* The scopes a client named for itself, or null when it named none and may ask for any. A pre-registered
 * client that named none is taken to have named every scope but the opt-in ones. */
const namedScopes = (client) => {
    const named = Array.isArray(client.scopes) ? client.scopes : [];
    if (named.length) return named;
    return client.kind === 'preregistered' ? PLAIN_SCOPES : null;
};

const mayAskFor = (client, scope) => {
    if (!isOptInScope(scope)) return true;
    const named = namedScopes(client);
    return isOffered(scope) && (!named || named.includes(scope));
};

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

const MODE = Object.freeze({ OFF: 'off', BOTH: 'both', ONLY: 'only' });

// on, true, 1 and yes predate the modes and mean both: personal access tokens still work on /mcp.
// Unset means both, unless the issuer would stop the server at boot: then it stays off (see unsetIssuerProblem).
const mode = (env = process.env) => {
    const value = String(env.MCP_OAUTH || '').trim().toLowerCase();
    if (value === '') return issuerProblem(env) ? MODE.OFF : MODE.BOTH;
    if (value === MODE.ONLY) return MODE.ONLY;
    if (value === MODE.BOTH || flagOn(value)) return MODE.BOTH;
    return MODE.OFF;
};

const isOn = (env = process.env) => mode(env) !== MODE.OFF;

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

/* Why a server that left MCP_OAUTH unset is running without it, for one startup log line. */
const unsetIssuerProblem = (env = process.env) => (String(env.MCP_OAUTH || '').trim() === '' ? issuerProblem(env) : '');

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
    SCOPES, READ_SCOPES, MANAGE_SCOPES, CHAT_SCOPE, OPT_IN_SCOPES, PLAIN_SCOPES, isManageScope, isOptInScope, offeredScopes, namedScopes, mayAskFor, CODE_TTL_MS, CODE_REUSE_WINDOW_MS, DEFAULTS, MODE,
    mode, isOn, dcrOn, lifetimes, rateLimitPerMinute, metadataCacheMs, issuer, issuerProblem, unsetIssuerProblem, assertIssuer, resource, canonicalResource, endpoints,
};
