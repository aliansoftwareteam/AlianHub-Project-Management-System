// The resource server (Modules/Mcp) names the same flag, issuer, resource and scopes as the
// authorization server, so both come from its config rather than a second derivation.
const oauthConfig = require('../Modules/OAuthServer/config');

const { SCOPES, READ_SCOPES, isOn, issuer, resource } = oauthConfig;
const WRITE_SCOPES = Object.freeze(SCOPES.filter((scope) => scope.endsWith(':write')));

// RFC 9728 §3.1: the well-known segment goes between the host and the resource's path.
const resourceMetadataUrl = (env = process.env) => {
    const url = new URL(resource(env));
    return `${url.origin}/.well-known/oauth-protected-resource${url.pathname.replace(/\/+$/, '')}`;
};

module.exports = { SCOPES, READ_SCOPES, WRITE_SCOPES, isOn, issuer, resource, resourceMetadataUrl };
