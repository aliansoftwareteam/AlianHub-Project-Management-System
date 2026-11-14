const { accountFromToken } = require('../../tokenAccount');

/* HubSpot's own MCP server (task 095). It does not sign clients up itself: an "MCP auth app" is created once in a
 * HubSpot developer account (Development → MCP Auth Apps) and its id and secret set as CONNECTOR_HUBSPOT_CLIENT_*,
 * or the shared sign-in service's on hosted instances. Its token endpoint takes the secret in the form. Endpoints
 * from its published metadata, read 2026-11-12. */
module.exports = {
    id: 'hubspot',
    name: 'HubSpot',
    transport: 'mcp',
    mcp: { url: 'https://mcp.hubspot.com/' },
    auth: {
        authorizeUrl: 'https://mcp.hubspot.com/oauth/authorize/user',
        tokenUrl: 'https://mcp.hubspot.com/oauth/v3/token',
        pkce: 'S256',
    },
    products: { crm: [] },
    readAccount: accountFromToken(['user_id', 'hub_id'], ['user', 'hub_domain']),
    egressHosts: ['mcp.hubspot.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
