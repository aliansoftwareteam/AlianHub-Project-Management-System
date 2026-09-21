// Shared by the MCP resource server (Modules/Mcp) and the authorization server
// (Modules/OAuthServer), so both name the same issuer and the same /mcp resource.

const FLAG_ON = ['true', '1', 'on', 'yes'];

const SCOPES = Object.freeze(['tasks:read', 'tasks:write', 'projects:read', 'docs:read', 'time:read', 'time:write']);
const READ_SCOPES = Object.freeze(SCOPES.filter((scope) => scope.endsWith(':read')));
const WRITE_SCOPES = Object.freeze(SCOPES.filter((scope) => scope.endsWith(':write')));

const isOn = (env = process.env) => FLAG_ON.includes(String(env.MCP_OAUTH || '').trim().toLowerCase());

const issuer = (env = process.env) => {
    const raw = String(env.MCP_OAUTH_ISSUER || env.APIURL || '').trim();
    if (!raw) return '';
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
};

const resource = (env = process.env) => `${issuer(env)}/mcp`;

// RFC 9728 §3.1: the well-known segment goes between the host and the resource's path.
const resourceMetadataUrl = (env = process.env) => {
    const url = new URL(resource(env));
    return `${url.origin}/.well-known/oauth-protected-resource${url.pathname.replace(/\/+$/, '')}`;
};

module.exports = { SCOPES, READ_SCOPES, WRITE_SCOPES, isOn, issuer, resource, resourceMetadataUrl };
