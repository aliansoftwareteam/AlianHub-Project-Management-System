const { accountFromToken } = require('../../tokenAccount');

/* Upwork's own MCP server (task 095). It signs clients up itself; its sign-in pages live on www.upwork.com.
 * Endpoints from its published metadata, read 2026-11-12. */
module.exports = {
    id: 'upwork',
    name: 'Upwork',
    transport: 'mcp',
    mcp: { url: 'https://mcp.upwork.com/mcp' },
    auth: {
        authorizeUrl: 'https://www.upwork.com/ab/account-security/oauth2/authorize',
        tokenUrl: 'https://www.upwork.com/api/v3/oauth2/token',
        pkce: 'S256',
        registration: 'dynamic',
        registrationUrl: 'https://www.upwork.com/register',
    },
    products: { work: [] },
    readAccount: accountFromToken(['user_id', 'tenant_id']),
    egressHosts: ['mcp.upwork.com', 'www.upwork.com'],
    rateLimit: { statuses: [429] },
    deadGrantErrors: ['invalid_grant'],
};
