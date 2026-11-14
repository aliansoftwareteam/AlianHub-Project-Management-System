const { accountFromToken } = require('../../tokenAccount');

/* Canva's own MCP server (task 095). Its metadata offers dynamic registration; Canva may admit only clients it has
 * approved, in which case an app from Canva's developer portal is set as CONNECTOR_CANVA_CLIENT_*, which then wins.
 * Endpoints and scopes from its published metadata, read 2026-11-12. */
module.exports = {
    id: 'canva',
    name: 'Canva',
    transport: 'mcp',
    mcp: { url: 'https://mcp.canva.com/mcp' },
    auth: {
        authorizeUrl: 'https://mcp.canva.com/authorize',
        tokenUrl: 'https://mcp.canva.com/token',
        pkce: 'S256',
        registration: 'dynamic',
        registrationUrl: 'https://mcp.canva.com/register',
    },
    products: { designs: ['profile:read', 'design:meta:read', 'design:content:read', 'folder:read'] },
    readAccount: accountFromToken(['user_id', 'team_id']),
    egressHosts: ['mcp.canva.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
